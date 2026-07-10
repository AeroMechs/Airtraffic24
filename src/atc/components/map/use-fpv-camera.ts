"use client";

import { useEffect, type MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import {
  FPV_DISTANCE_ZOOM_OFFSET,
  fpvZoomForAltitude,
  lerp,
  lerpLng,
  normalizeLng,
  projectLngLatElevationPixelDelta,
  setMapInteractionsEnabled,
  smoothstep,
} from "./camera-controller-utils";
import { getZoomAdjustedElevationScale } from "./altitude-projection";
import type { AltitudeDisplayMode } from "@/atc/lib/altitude-display-mode";
import type { City } from "@/atc/lib/cities";
import type { FlightState } from "@/atc/lib/opensky";
import type { AircraftCameraMode } from "@/atc/lib/aircraft-camera-mode";
import { altitudeToElevation } from "@/atc/lib/flight-utils";

const DEFAULT_ZOOM = 9.2;
const DEFAULT_PITCH = 49;
const DEFAULT_BEARING = 27.4;
const FPV_FLY_DURATION = 1600;
const FPV_PITCH = 65;
const FPV_CENTER_ALPHA = 0.09;
const FPV_BEARING_ALPHA = 0.06;
const FPV_ZOOM_ALPHA = 0.03;
const FPV_IDLE_RECENTER_MS = 1200;
const FPV_EASE_IN_MS = 1000;
const FREE_IDLE_RECENTER_MS = 260;
const FREE_EASE_IN_MS = 450;
const FPV_VIEW_CHANGE_DURATION = 700;
const FPV_RENDER_POSITION_WAIT_MS = 450;
const NOMINAL_FRAME_MS = 1000 / 60;
const MAX_CAMERA_FRAME_MS = 100;

type LockedCameraMode = Exclude<AircraftCameraMode, "free">;

const CAMERA_MODE_CONFIG: Record<
  LockedCameraMode,
  { pitch: number; bearingOffset: number | null; zoomOffset: number }
> = {
  rear: {
    pitch: FPV_PITCH,
    bearingOffset: 0,
    zoomOffset: FPV_DISTANCE_ZOOM_OFFSET,
  },
  front: {
    pitch: 58,
    bearingOffset: 180,
    zoomOffset: FPV_DISTANCE_ZOOM_OFFSET,
  },
  top: {
    pitch: 0,
    bearingOffset: null,
    zoomOffset: 0.45,
  },
};

function normalizeBearing(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

function lockedModeConfig(cameraMode: AircraftCameraMode) {
  return cameraMode === "free" ? null : CAMERA_MODE_CONFIG[cameraMode];
}

type FpvPosition = {
  icao24?: string;
  lng: number;
  lat: number;
  alt: number;
  track: number;
};

function isValidFpvPosition(
  position: FpvPosition | null | undefined,
  icao24: string,
): position is FpvPosition {
  return (
    position != null &&
    Number.isFinite(position.lng) &&
    Number.isFinite(position.lat) &&
    Math.abs(position.lat) <= 90 &&
    (position.icao24 == null ||
      position.icao24.toLowerCase() === icao24.toLowerCase())
  );
}

function frameAdjustedAlpha(baseAlpha: number, deltaMs: number): number {
  return 1 - Math.pow(1 - baseAlpha, deltaMs / NOMINAL_FRAME_MS);
}

export function useFpvCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  fpvFlight: FlightState | null,
  city: City,
  fpvFlightRef: MutableRefObject<FlightState | null>,
  fpvPosRef: MutableRefObject<MutableRefObject<FpvPosition | null> | undefined>,
  isFpvActiveRef: MutableRefObject<boolean>,
  prevFpvRef: MutableRefObject<string | null>,
  cameraMode: AircraftCameraMode = "rear",
  altitudeDisplayMode: AltitudeDisplayMode = "presentation",
) {
  useEffect(() => {
    if (!map || !isLoaded) {
      if (isFpvActiveRef.current) {
        isFpvActiveRef.current = false;
      }
      return;
    }

    const fpv = fpvFlightRef.current;
    const fpvKey = fpv?.icao24 ?? null;
    const modeKey = fpvKey ? `${fpvKey}:${cameraMode}` : null;

    const wasFpv = prevFpvRef.current !== null;
    const isViewChange =
      fpvKey !== null &&
      prevFpvRef.current?.startsWith(`${fpvKey}:`) === true;
    prevFpvRef.current = modeKey;

    if (
      !fpv ||
      fpv.longitude == null ||
      fpv.latitude == null ||
      !Number.isFinite(fpv.longitude) ||
      !Number.isFinite(fpv.latitude) ||
      Math.abs(fpv.latitude) > 90
    ) {
      isFpvActiveRef.current = false;
      if (wasFpv) {
        setMapInteractionsEnabled(map, true);
      }
      if (wasFpv) {
        map.flyTo({
          center: city.coordinates,
          zoom: DEFAULT_ZOOM,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          duration: 1800,
          essential: true,
        });
      }
      return;
    }

    const activeFpv = fpv;
    isFpvActiveRef.current = true;
    setMapInteractionsEnabled(map, true);

    const flightBearing = Number.isFinite(fpv.trueTrack)
      ? fpv.trueTrack!
      : map.getBearing();
    const modeConfig = lockedModeConfig(cameraMode);

    let fpvOffsetX = 0;
    let fpvOffsetY = 0;
    // MapLibre applies `offset` by shifting the map's actual center away from
    // the requested geographic center. Reading getCenter() on the next frame
    // and applying the offset again therefore compounds that shift. Keep the
    // unshifted tracking center separately and only update it from aircraft
    // motion (or an explicit user gesture).
    let logicalCenter: { lng: number; lat: number } | null = null;

    let frameId: number | null = null;
    let startupFrameId: number | null = null;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let prevBearing = flightBearing;
    const positionBeforeActivation = fpvPosRef.current?.current ?? null;
    const activationStartedAt = performance.now();

    let lastInteractionTime = 0;
    let recenterStartTime = 0;
    let programmaticMove = false;
    let lastCameraFrameTime = 0;

    function onUserInteraction() {
      if (programmaticMove || !map) return;
      const userCenter = map.getCenter();
      logicalCenter = { lng: userCenter.lng, lat: userCenter.lat };
      fpvOffsetX = 0;
      fpvOffsetY = 0;
      lastInteractionTime = performance.now();
      recenterStartTime = 0;
    }

    const onMapInteraction = (e: unknown) => {
      if (programmaticMove) return;
      const evt = e as { originalEvent?: Event };
      if (!evt?.originalEvent) return;
      onUserInteraction();
    };

    const interactionEventTypes = [
      "movestart",
      "move",
      "zoomstart",
      "zoom",
      "rotatestart",
      "rotate",
      "pitchstart",
      "pitch",
    ] as const;

    for (const t of interactionEventTypes) {
      map.on(t, onMapInteraction);
    }

    // Reset FPV tracking on tab resume to prevent camera jumps from
    // stale lerp values accumulated during the hidden period.
    let wasHidden = false;
    function onFpvVisibilityResume() {
      if (document.visibilityState === "visible" && wasHidden) {
        wasHidden = false;
        const resumedTrack = fpvFlightRef.current?.trueTrack;
        if (resumedTrack != null && Number.isFinite(resumedTrack)) {
          prevBearing = resumedTrack;
        }
        fpvOffsetX = 0;
        fpvOffsetY = 0;
        lastInteractionTime = 0;
        recenterStartTime = 0;
        lastCameraFrameTime = 0;
      } else if (document.visibilityState === "hidden") {
        wasHidden = true;
      }
    }
    document.addEventListener("visibilitychange", onFpvVisibilityResume);

    function keepInFrame() {
      if (!isFpvActiveRef.current || !map) {
        frameId = null;
        return;
      }

      // Skip camera updates when tab is hidden - saves CPU and
      // prevents jarring camera jumps from stale alpha lerps on resume.
      if (document.hidden) {
        lastCameraFrameTime = 0;
        frameId = requestAnimationFrame(keepInFrame);
        return;
      }

      const interpPos = fpvPosRef.current?.current ?? null;
      const live = fpvFlightRef.current;

      const posLng = interpPos?.lng ?? live?.longitude ?? null;
      const posLat = interpPos?.lat ?? live?.latitude ?? null;
      const posAlt = interpPos?.alt ?? live?.baroAltitude ?? 5000;
      const posTrack = interpPos?.track ?? live?.trueTrack ?? null;

      if (posLng == null || posLat == null) {
        frameId = requestAnimationFrame(keepInFrame);
        return;
      }

      if (
        !Number.isFinite(posLng) ||
        !Number.isFinite(posLat) ||
        Math.abs(posLat) > 90
      ) {
        frameId = requestAnimationFrame(keepInFrame);
        return;
      }

      const now = performance.now();
      const deltaMs = lastCameraFrameTime
        ? Math.min(now - lastCameraFrameTime, MAX_CAMERA_FRAME_MS)
        : NOMINAL_FRAME_MS;
      lastCameraFrameTime = now;
      const idleMs =
        lastInteractionTime === 0
          ? Math.max(FPV_IDLE_RECENTER_MS, FREE_IDLE_RECENTER_MS) + 1
          : now - lastInteractionTime;
      const idleRecenterMs =
        cameraMode === "free" ? FREE_IDLE_RECENTER_MS : FPV_IDLE_RECENTER_MS;
      const easeInMs =
        cameraMode === "free" ? FREE_EASE_IN_MS : FPV_EASE_IN_MS;
      const isIdle = idleMs > idleRecenterMs;

      let trackingStrength = 0;
      if (isIdle) {
        if (recenterStartTime === 0) {
          recenterStartTime = now;
        }
        const easeElapsed = now - recenterStartTime;
        const t = Math.min(easeElapsed / easeInMs, 1);
        trackingStrength = smoothstep(t);
      }

      const liveBearing =
        posTrack !== null && Number.isFinite(posTrack) ? posTrack : prevBearing;
      // Update prevBearing to track live heading (used as fallback when
      // tracking strength is zero and for tab-resume reset).
      const bearingDelta = ((liveBearing - prevBearing + 540) % 360) - 180;
      prevBearing =
        prevBearing + bearingDelta * frameAdjustedAlpha(0.15, deltaMs);

      if (trackingStrength > 0.001) {
        const safeAlt = Number.isFinite(posAlt) ? posAlt : 5000;
        const activeModeConfig = lockedModeConfig(cameraMode);
        const targetZoom = activeModeConfig
          ? fpvZoomForAltitude(safeAlt) - activeModeConfig.zoomOffset
          : map.getZoom();
        const currentZoom = map.getZoom();
        const zoomAlpha =
          frameAdjustedAlpha(FPV_ZOOM_ALPHA, deltaMs) * trackingStrength;
        const smoothZoom = lerp(currentZoom, targetZoom, zoomAlpha);

        const currentPitch = map.getPitch();
        const targetLng = normalizeLng(posLng);
        const targetLat = posLat;
        const center = logicalCenter ?? map.getCenter();
        const centerAlpha =
          frameAdjustedAlpha(FPV_CENTER_ALPHA, deltaMs) * trackingStrength;
        const nextLogicalCenter = {
          lng: lerpLng(center.lng, targetLng, centerAlpha),
          lat: lerp(center.lat, targetLat, centerAlpha),
        };

        const canvas = map.getCanvas();
        const canvasW = Math.max(1, canvas.clientWidth);
        const canvasH = Math.max(1, canvas.clientHeight);

        const elevationMeters = Math.max(
          altitudeToElevation(safeAlt, altitudeDisplayMode) *
            getZoomAdjustedElevationScale(currentZoom, altitudeDisplayMode),
          200,
        );
        const deltaPx = projectLngLatElevationPixelDelta(
          map,
          targetLng,
          targetLat,
          elevationMeters,
        );
        if (deltaPx) {
          const groundPoint = map.project([targetLng, targetLat]);
          const groundDx = groundPoint.x - canvasW / 2;
          const groundDy = groundPoint.y - canvasH / 2;
          // Isolate elevation from ordinary horizontal tracking error. The
          // old accumulated correction mixed both together and could alternate
          // ahead/behind the plane as center and offset chased one another.
          const desiredX = -(deltaPx.dx - groundDx);
          const desiredY = -(deltaPx.dy - groundDy);
          const offsetAlpha =
            frameAdjustedAlpha(0.05, deltaMs) * trackingStrength;
          fpvOffsetX = lerp(fpvOffsetX, desiredX, offsetAlpha);
          fpvOffsetY = lerp(fpvOffsetY, desiredY, offsetAlpha);
        } else {
          const decayAlpha =
            frameAdjustedAlpha(0.06, deltaMs) * trackingStrength;
          fpvOffsetX = lerp(fpvOffsetX, 0, decayAlpha);
          fpvOffsetY = lerp(fpvOffsetY, 0, decayAlpha);
        }

        const maxScale = Math.min(1.5, Math.max(1, elevationMeters / 15_000));
        const maxOffset = 0.25 * maxScale * Math.min(canvasW, canvasH);
        fpvOffsetX = Math.max(-maxOffset, Math.min(maxOffset, fpvOffsetX));
        fpvOffsetY = Math.max(-maxOffset, Math.min(maxOffset, fpvOffsetY));

        // Single-level bearing interpolation - lerp map bearing directly
        // toward the live heading.  Avoids the double-smoothing oscillation
        // that occurred when prevBearing was intermediated separately.
        const currentBearing = map.getBearing();
        const targetBearing = activeModeConfig
          ? activeModeConfig.bearingOffset === null
            ? 0
            : normalizeBearing(
                liveBearing + activeModeConfig.bearingOffset,
              )
          : currentBearing;
        const bearingToLive =
          ((targetBearing - currentBearing + 540) % 360) - 180;
        const newMapBearing =
          currentBearing +
          bearingToLive *
            frameAdjustedAlpha(FPV_BEARING_ALPHA, deltaMs) *
            trackingStrength;

        const pitchAlpha =
          frameAdjustedAlpha(0.05, deltaMs) * trackingStrength;
        const newPitch = activeModeConfig
          ? lerp(currentPitch, activeModeConfig.pitch, pitchAlpha)
          : currentPitch;

        programmaticMove = true;
        try {
          map.easeTo({
            center: [nextLogicalCenter.lng, nextLogicalCenter.lat],
            ...(activeModeConfig
              ? {
                  bearing: newMapBearing,
                  zoom: smoothZoom,
                  pitch: newPitch,
                }
              : {}),
            offset: [fpvOffsetX, fpvOffsetY],
            duration: 0,
            animate: false,
            essential: true,
          });
          logicalCenter = nextLogicalCenter;
        } finally {
          programmaticMove = false;
        }
      }

      frameId = requestAnimationFrame(keepInFrame);
    }

    function beginFpvApproach(position: FpvPosition) {
      const initialBearing = Number.isFinite(position.track)
        ? position.track
        : flightBearing;
      const initialAltitude = Number.isFinite(position.alt)
        ? position.alt
        : 5000;
      const bearing = modeConfig
        ? modeConfig.bearingOffset === null
          ? 0
          : normalizeBearing(initialBearing + modeConfig.bearingOffset)
        : map!.getBearing();
      const zoom = modeConfig
        ? fpvZoomForAltitude(initialAltitude) - modeConfig.zoomOffset
        : map!.getZoom();
      const pitch = modeConfig?.pitch ?? map!.getPitch();
      const duration = isViewChange
        ? FPV_VIEW_CHANGE_DURATION
        : FPV_FLY_DURATION;

      prevBearing = initialBearing;
      logicalCenter = {
        lng: normalizeLng(position.lng),
        lat: position.lat,
      };
      map!.stop();
      map!.flyTo({
        center: [logicalCenter.lng, logicalCenter.lat],
        zoom,
        pitch,
        bearing,
        duration,
        essential: true,
      });

      startupTimer = setTimeout(() => {
        startupTimer = null;
        frameId = requestAnimationFrame(keepInFrame);
      }, duration + 120);
    }

    function waitForRenderedPosition(now: number) {
      const renderedPosition = fpvPosRef.current?.current ?? null;
      const hasFreshRenderedPosition =
        isValidFpvPosition(renderedPosition, activeFpv.icao24) &&
        renderedPosition !== positionBeforeActivation;
      const waitedLongEnough =
        now - activationStartedAt >= FPV_RENDER_POSITION_WAIT_MS;

      if (hasFreshRenderedPosition) {
        startupFrameId = null;
        beginFpvApproach(renderedPosition);
        return;
      }

      if (waitedLongEnough) {
        startupFrameId = null;
        beginFpvApproach({
          icao24: activeFpv.icao24,
          lng: activeFpv.longitude!,
          lat: activeFpv.latitude!,
          alt: Number.isFinite(activeFpv.baroAltitude)
            ? activeFpv.baroAltitude!
            : 5000,
          track: flightBearing,
        });
        return;
      }

      startupFrameId = requestAnimationFrame(waitForRenderedPosition);
    }

    startupFrameId = requestAnimationFrame(waitForRenderedPosition);

    return () => {
      if (startupFrameId != null) cancelAnimationFrame(startupFrameId);
      if (startupTimer) clearTimeout(startupTimer);
      if (frameId != null) cancelAnimationFrame(frameId);
      document.removeEventListener("visibilitychange", onFpvVisibilityResume);
      for (const t of interactionEventTypes) {
        map.off(t, onMapInteraction);
      }
      if (map && isFpvActiveRef.current) {
        setMapInteractionsEnabled(map, true);
        isFpvActiveRef.current = false;
      }
    };
  }, [
    map,
    isLoaded,
    fpvFlight?.icao24,
    city,
    cameraMode,
    altitudeDisplayMode,
    fpvFlightRef,
    fpvPosRef,
    isFpvActiveRef,
    prevFpvRef,
  ]);
}
