/**
 * A stable, client-safe rendering profile for the lifetime of the page.
 *
 * The server always receives the balanced profile. In the browser we resolve
 * the profile once, so resize events and browser zoom cannot make MapLibre or
 * deck.gl recreate their render targets while the radar is running.
 */

export type DevicePerformanceTier = "constrained" | "balanced" | "high";
export type RenderQuality = "data-saver" | "balanced" | "high";

export type DevicePerformanceProfile = Readonly<{
  tier: DevicePerformanceTier;
  mapDprCap: number;
  deckDprCap: number;
  mapPixelRatio: number;
  deckPixelRatio: number;
  maxRadarFps: number;
  tileRequestCount: number;
  followApproachDurationMs: number;
  followApproachZoom: number;
  followApproachPitch: number;
  followUpdateIntervalMs: number;
  allowAllModelIdlePrefetch: boolean;
}>;

type DevicePerformanceSignals = Readonly<{
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  saveData?: boolean;
  effectiveType?: string;
  physicalPixelCount?: number;
  devicePixelRatio?: number;
}>;

type NavigatorWithPerformanceHints = Navigator & {
  deviceMemory?: number;
  connection?: NetworkInformationHints;
  mozConnection?: NetworkInformationHints;
  webkitConnection?: NetworkInformationHints;
};

type NetworkInformationHints = {
  saveData?: boolean;
  effectiveType?: string;
};

type ProfilePreset = Omit<
  DevicePerformanceProfile,
  "mapPixelRatio" | "deckPixelRatio"
>;

const PROFILE_PRESETS: Readonly<
  Record<DevicePerformanceTier, ProfilePreset>
> = {
  constrained: {
    tier: "constrained",
    mapDprCap: 1,
    deckDprCap: 1,
    maxRadarFps: 30,
    tileRequestCount: 6,
    followApproachDurationMs: 800,
    followApproachZoom: 10.8,
    followApproachPitch: 46,
    // The aircraft only moves a fraction of a pixel between these updates at
    // follow zoom. Capping constrained devices at 20 Hz leaves more main
    // thread time for tiles and GLB uploads without making tracking step.
    followUpdateIntervalMs: 1000 / 20,
    allowAllModelIdlePrefetch: false,
  },
  balanced: {
    tier: "balanced",
    mapDprCap: 1.35,
    deckDprCap: 1.25,
    maxRadarFps: 45,
    tileRequestCount: 10,
    followApproachDurationMs: 650,
    followApproachZoom: 11.1,
    followApproachPitch: 50,
    followUpdateIntervalMs: 1000 / 45,
    allowAllModelIdlePrefetch: false,
  },
  high: {
    tier: "high",
    mapDprCap: 1.75,
    deckDprCap: 1.5,
    maxRadarFps: 60,
    tileRequestCount: 16,
    followApproachDurationMs: 520,
    followApproachZoom: 11.4,
    followApproachPitch: 54,
    followUpdateIntervalMs: 1000 / 60,
    allowAllModelIdlePrefetch: true,
  },
};

let cachedClientProfile: DevicePerformanceProfile | null = null;
const cachedManualProfiles: Partial<
  Record<RenderQuality, DevicePerformanceProfile>
> = {};

const RENDER_QUALITY_TIER: Readonly<
  Record<RenderQuality, DevicePerformanceTier>
> = {
  "data-saver": "constrained",
  balanced: "balanced",
  high: "high",
};

function finitePositive(value: number | undefined): number | undefined {
  return value != null && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function resolveTier(
  signals: DevicePerformanceSignals,
): DevicePerformanceTier {
  const effectiveType = signals.effectiveType?.toLowerCase();

  // Explicit user/network constraints should win over optimistic hardware
  // guesses, especially because map tiles and GLBs are comparatively large.
  if (
    signals.saveData === true ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g"
  ) {
    return "constrained";
  }

  // A single hard hardware limit is enough to protect the page. Logical core
  // count can look deceptively high on inexpensive phones, so it must not
  // cancel a low-memory signal (or vice versa) through additive scoring.
  if (
    (signals.deviceMemoryGb != null && signals.deviceMemoryGb <= 4) ||
    (signals.hardwareConcurrency != null &&
      signals.hardwareConcurrency <= 4)
  ) {
    return "constrained";
  }

  // Only opt into the high profile with positive hardware evidence and a
  // manageable drawing-buffer size. Missing privacy-restricted hints remain
  // balanced rather than being promoted by a fast network or small viewport.
  const hasHighHardwareEvidence =
    signals.deviceMemoryGb != null &&
    signals.deviceMemoryGb >= 8 &&
    signals.hardwareConcurrency != null &&
    signals.hardwareConcurrency >= 8;
  const hasManageableFillRate =
    signals.physicalPixelCount != null &&
    signals.physicalPixelCount < 6_000_000;

  if (
    hasHighHardwareEvidence &&
    hasManageableFillRate &&
    effectiveType !== "3g"
  ) {
    return "high";
  }

  return "balanced";
}

function createProfile(
  tier: DevicePerformanceTier,
  devicePixelRatio: number,
): DevicePerformanceProfile {
  const preset = PROFILE_PRESETS[tier];
  const dpr = Math.max(1, devicePixelRatio);

  return Object.freeze({
    ...preset,
    mapPixelRatio: Math.min(dpr, preset.mapDprCap),
    deckPixelRatio: Math.min(dpr, preset.deckDprCap),
  });
}

export function resolveDevicePerformanceProfile(
  signals: DevicePerformanceSignals = {},
): DevicePerformanceProfile {
  const dpr = finitePositive(signals.devicePixelRatio) ?? 1;
  return createProfile(resolveTier(signals), dpr);
}

function readClientSignals(): DevicePerformanceSignals {
  const nav = navigator as NavigatorWithPerformanceHints;
  const connection =
    nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  const devicePixelRatio = finitePositive(window.devicePixelRatio) ?? 1;
  const width = finitePositive(window.innerWidth);
  const height = finitePositive(window.innerHeight);

  return {
    deviceMemoryGb: finitePositive(nav.deviceMemory),
    hardwareConcurrency: finitePositive(nav.hardwareConcurrency),
    saveData: connection?.saveData,
    effectiveType: connection?.effectiveType,
    physicalPixelCount:
      width != null && height != null
        ? width * height * devicePixelRatio * devicePixelRatio
        : undefined,
    devicePixelRatio,
  };
}

/**
 * Returns an immutable profile for the current browser page. Passing an
 * explicit Data Saver and High choices select their preset. Medium is capped
 * at the balanced preset but can step down on constrained hardware or links;
 * omitting a choice preserves fully automatic hardware/network detection.
 */
export function getDevicePerformanceProfile(
  quality?: RenderQuality,
): DevicePerformanceProfile {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return quality == null
      ? resolveDevicePerformanceProfile()
      : createProfile(RENDER_QUALITY_TIER[quality], 1);
  }

  if (quality != null) {
    const cachedProfile = cachedManualProfiles[quality];
    if (cachedProfile) return cachedProfile;

    const requestedTier = RENDER_QUALITY_TIER[quality];
    const tier =
      quality === "balanced" &&
      resolveTier(readClientSignals()) === "constrained"
        ? "constrained"
        : requestedTier;
    const profile = createProfile(
      tier,
      finitePositive(window.devicePixelRatio) ?? 1,
    );
    cachedManualProfiles[quality] = profile;
    return profile;
  }

  cachedClientProfile ??= resolveDevicePerformanceProfile(
    readClientSignals(),
  );
  return cachedClientProfile;
}
