"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer } from "@deck.gl/layers";
import { useMap } from "./map";
import type { FlightState } from "@/atc/lib/opensky";
import type { TrailEntry } from "@/atc/hooks/use-trail-history";
import { type PickingInfo, MapView } from "@deck.gl/core";

import type {
  DeckGLOverlay,
  ElevatedPoint,
  Snapshot,
} from "./flight-layer-constants";
import {
  DEFAULT_ANIM_DURATION_MS,
  MIN_ANIM_DURATION_MS,
  MAX_ANIM_DURATION_MS,
  MIN_CADENCE_BUFFER_MS,
  MAX_CADENCE_BUFFER_MS,
  CADENCE_BUFFER_RATIO,
  TELEPORT_THRESHOLD_METERS,
  TRACK_DAMPING,
  MLAT_POSITION_ALPHA,
  AIRCRAFT_PICK_RADIUS_PX,
  GLOBE_FADE_ZOOM_FLOOR,
  GLOBE_FADE_ZOOM_CEIL,
  BASE_AIRCRAFT_SIZE,
  LOD_3D_ZOOM_IN,
  LOD_3D_ZOOM_OUT,
  type FlightLayerProps,
} from "./flight-layer-constants";

import {
  aircraftSizeMultiplier,
  tintAircraftColor,
  applySpecialTint,
  AIRCRAFT_ICON_MAPPING,
  getHaloUrl,
  getRingUrl,
  getAircraftAtlasUrl,
} from "./aircraft-appearance";

import {
  horizontalDistanceMeters,
  interpolateLongitude,
  lerpAngle,
  smoothStep,
} from "./flight-math";

import {
  computePitchByIcao,
  computeBankByIcao,
  computeInterpolatedFlights,
  FLIGHT_RENDER_STALE_MS,
  MAX_FLIGHT_EXTRAPOLATION_MS,
  getSafeInterpolationProgress,
  updateInterpolatedInPlace,
} from "./flight-interpolation";

import { buildTrailLayers } from "./flight-layer-builders";
import { buildSelectionPulseLayers } from "./flight-layer-builders";
import { buildAircraftModelLayers } from "./aircraft-model-layers";
import {
  preloadAllModels,
  priorityPreloadSelectedFlightModel,
} from "./aircraft-model-mapping";
import { trailStore } from "@/atc/lib/trails/store/trail-store";
import { getZoomAdjustedElevationScale } from "./altitude-projection";
import { altitudeToColor, altitudeToElevation } from "@/atc/lib/flight-utils";
import { useGlobeDots } from "./use-globe-dots";
import { getDevicePerformanceProfile } from "@/atc/lib/device-performance";

const HIGH_DENSITY_TRAIL_LIMIT = 700;
const HIGH_DENSITY_3D_LIMIT = 1_800;
const HIGH_DENSITY_3D_ZOOM_LIMIT = 7.25;
const HIGH_DENSITY_TRAIL_ZOOM_RECOVERY = 8;
const FOLLOW_APPROACH_WORK_ZOOM = 9.25;
const VIEWPORT_PADDING_RATIO = 0.3;
const VIEWPORT_UPDATE_THROTTLE_MS = 120;
const VIEWPORT_REBUILD_SHIFT_RATIO = 0.08;
const VIEWPORT_REBUILD_SCALE_RATIO = 0.06;
const DATA_SNAP_STALE_MIN_MS = 120_000;
const FRAME_STALE_GRACE_MS = 5_000;

type ExpandedViewportBounds = {
  west: number;
  east: number;
  south: number;
  north: number;
  allLongitudes: boolean;
};

function getExpandedViewportBounds(
  map: maplibregl.Map,
): ExpandedViewportBounds {
  const bounds = map.getBounds();
  let west = bounds.getWest();
  let east = bounds.getEast();
  if (east < west) east += 360;

  const width = Math.max(0, east - west);
  const height = Math.max(0, bounds.getNorth() - bounds.getSouth());
  const lngPadding = width * VIEWPORT_PADDING_RATIO;
  const latPadding = height * VIEWPORT_PADDING_RATIO;

  west -= lngPadding;
  east += lngPadding;

  return {
    west,
    east,
    south: Math.max(-90, bounds.getSouth() - latPadding),
    north: Math.min(90, bounds.getNorth() + latPadding),
    allLongitudes: east - west >= 360,
  };
}

function isFlightInsideViewport(
  flight: FlightState,
  bounds: ExpandedViewportBounds,
): boolean {
  const longitude = flight.longitude;
  const latitude = flight.latitude;
  if (longitude == null || latitude == null) return false;
  if (latitude < bounds.south || latitude > bounds.north) return false;
  if (bounds.allLongitudes) return true;

  // MapLibre can expose unwrapped bounds around the international date line.
  // Compare adjacent world copies without normalising the camera itself.
  for (let worldCopy = -2; worldCopy <= 2; worldCopy++) {
    const shiftedLongitude = longitude + worldCopy * 360;
    if (shiftedLongitude >= bounds.west && shiftedLongitude <= bounds.east) {
      return true;
    }
  }
  return false;
}

function wrappedLongitudeDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function shouldRefreshViewportBounds(
  previous: ExpandedViewportBounds | null,
  next: ExpandedViewportBounds,
): boolean {
  if (!previous) return true;
  if (previous.allLongitudes !== next.allLongitudes) return true;

  const previousWidth = Math.max(0.000_001, previous.east - previous.west);
  const nextWidth = Math.max(0.000_001, next.east - next.west);
  const previousHeight = Math.max(
    0.000_001,
    previous.north - previous.south,
  );
  const nextHeight = Math.max(0.000_001, next.north - next.south);
  const widthChange = Math.abs(nextWidth - previousWidth) / previousWidth;
  const heightChange = Math.abs(nextHeight - previousHeight) / previousHeight;

  if (
    widthChange >= VIEWPORT_REBUILD_SCALE_RATIO ||
    heightChange >= VIEWPORT_REBUILD_SCALE_RATIO
  ) {
    return true;
  }

  const previousCenterLat = (previous.south + previous.north) / 2;
  const nextCenterLat = (next.south + next.north) / 2;
  if (
    Math.abs(nextCenterLat - previousCenterLat) >=
    previousHeight * VIEWPORT_REBUILD_SHIFT_RATIO
  ) {
    return true;
  }

  if (previous.allLongitudes) return false;

  const previousCenterLng = (previous.west + previous.east) / 2;
  const nextCenterLng = (next.west + next.east) / 2;
  return (
    wrappedLongitudeDistance(nextCenterLng, previousCenterLng) >=
    previousWidth * VIEWPORT_REBUILD_SHIFT_RATIO
  );
}

function getDataSnapStaleMs(animationDurationMs: number): number {
  return Math.max(DATA_SNAP_STALE_MIN_MS, animationDurationMs * 2.5);
}

function getFrameStaleMs(animationDurationMs: number): number {
  return Math.max(
    FLIGHT_RENDER_STALE_MS,
    35_000,
    animationDurationMs +
      MAX_FLIGHT_EXTRAPOLATION_MS +
      FRAME_STALE_GRACE_MS,
  );
}

export function FlightLayers({
  flights,
  trails,
  selectedEnvelope = null,
  onClick,
  selectedIcao24,
  showTrails,
  trailThickness,
  trailDistance,
  showShadows,
  showAltitudeColors,
  altitudeDisplayMode,
  globeMode = false,
  force2DMarkers = false,
  renderQuality,
  followIcao24 = null,
  fpvIcao24 = null,
  fpvPositionRef,
}: FlightLayerProps) {
  const { map, isLoaded } = useMap();
  const performanceProfile = getDevicePerformanceProfile(renderQuality);
  const radarFrameIntervalMs = 1000 / performanceProfile.maxRadarFps;
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const devicePixelRatioRef = useRef(performanceProfile.deckPixelRatio);
  const atlasUrl = getAircraftAtlasUrl();
  const haloUrl = getHaloUrl();
  const ringUrl = getRingUrl();

  useEffect(() => {
    devicePixelRatioRef.current = performanceProfile.deckPixelRatio;
    overlayRef.current?.setProps({
      useDevicePixels: performanceProfile.deckPixelRatio,
    });
  }, [performanceProfile.deckPixelRatio]);

  const prevSnapshotsRef = useRef<Map<string, Snapshot>>(new Map());
  const currSnapshotsRef = useRef<Map<string, Snapshot>>(new Map());
  const dataTimestampRef = useRef(0);
  const animDurationRef = useRef(DEFAULT_ANIM_DURATION_MS);
  const animFrameRef = useRef(0);
  // Recent poll intervals for median smoothing - prevents event loop
  // stalls from inflating animDuration beyond the true poll cadence.
  const recentIntervalsRef = useRef<number[]>([]);

  // Persistent caches reused across animation frames to reduce GC pressure
  const trailBasePathCacheRef = useRef(
    new Map<string, { key: string; basePath: ElevatedPoint[] }>(),
  );
  const interpolatedMapRef = useRef(new Map<string, FlightState>());
  const pitchMapRef = useRef(new Map<string, number>());
  const bankMapRef = useRef(new Map<string, number>());
  // Reusable containers for buildTrailLayers - clear+reuse each frame
  const handledIdsRef = useRef(new Set<string>());
  const visibleTrailCacheRef = useRef(new Map<string, ElevatedPoint[]>());
  const activeIcaosRef = useRef(new Set<string>());
  // Persistent caches for slope-limited trail paths and colors across frames
  const trailPathCacheRef = useRef(
    new Map<string, { key: string; result: [number, number, number][] }>(),
  );
  const trailColorCacheRef = useRef(
    new Map<
      string,
      { key: string; result: [number, number, number, number][] }
    >(),
  );
  // Cached trail-by-icao24 Map - rebuilt only when trailsRef changes, not every frame
  const trailMapRef = useRef(new Map<string, TrailEntry>());
  const lastTrailsForMapRef = useRef<TrailEntry[] | null>(null);

  // Interpolation pool - reuse FlightState objects between animation frames
  // to avoid ~18K object allocations/sec from spread syntax
  const interpArrayRef = useRef<FlightState[]>([]);
  const lastFlightsForInterpRef = useRef<FlightState[] | null>(null);

  // Only aircraft in (or just outside) the visible map are sent through
  // interpolation and deck.gl. The expanded bounds prevent pop-in while an
  // aircraft or camera crosses an edge, while selected/followed aircraft are
  // retained even when temporarily off-screen.
  const viewportBoundsRef = useRef<ExpandedViewportBounds | null>(null);
  const viewportRevisionRef = useRef(0);
  const viewportFlightCacheRef = useRef<{
    source: FlightState[] | null;
    revision: number;
    selectedId: string | null;
    followId: string | null;
    fpvId: string | null;
    result: FlightState[];
  }>({
    source: null,
    revision: -1,
    selectedId: null,
    followId: null,
    fpvId: null,
    result: [],
  });
  const trackingFlightCacheRef = useRef<{
    source: FlightState[] | null;
    id: string | null;
    flight: FlightState | null;
    result: FlightState[];
  }>({
    source: null,
    id: null,
    flight: null,
    result: [],
  });
  // At overview zoom the selected dot is drawn at the latest authoritative
  // position. Seed detailed interpolation from that exact same point once per
  // selection so crossing the Deck.gl visibility boundary cannot jump the
  // model (and its camera) backward to an older interpolation segment.
  const trackingInterpolationSeedRef = useRef({
    id: null as string | null,
    snapshot: null as Snapshot | null,
  });
  const visibleTrailEntriesCacheRef = useRef<{
    source: TrailEntry[] | null;
    flights: FlightState[] | null;
    selectedOnlyId: string | null;
    result: TrailEntry[];
  }>({
    source: null,
    flights: null,
    selectedOnlyId: null,
    result: [],
  });
  const selectedTrailFlightsRef = useRef<FlightState[]>([]);

  // Set on tab resume, cleared when fresh flight data arrives.
  // While true, the RAF loop clamps rawT to 1 (no dead reckoning)
  // so aircraft freeze at last-known positions on stale data instead
  // of extrapolating forward on minutes-old headings.
  const resumeSnapRef = useRef(false);
  const pageActiveRef = useRef(true);

  // Data version increments when raw flight data changes - drives color/scale updateTriggers
  const dataVersionRef = useRef(0);

  const flightsRef = useRef(flights);
  const trailsRef = useRef(trails);
  const selectedEnvelopeRef = useRef(selectedEnvelope);
  const onClickRef = useRef(onClick);
  const showTrailsRef = useRef(showTrails);
  const trailThicknessRef = useRef(trailThickness);
  const trailDistanceRef = useRef(trailDistance);
  const showShadowsRef = useRef(showShadows);
  const showAltColorsRef = useRef(showAltitudeColors);
  const altitudeDisplayModeRef = useRef(altitudeDisplayMode);
  const globeModeRef = useRef(globeMode);
  const force2DMarkersRef = useRef(force2DMarkers);
  const selectedIcao24Ref = useRef(selectedIcao24);
  const followIcao24Ref = useRef(followIcao24);
  const fpvIcao24Ref = useRef(fpvIcao24);
  const fpvPosRef = useRef(fpvPositionRef);
  const prevSelectedRef = useRef<string | null>(null);
  const selectionChangeTimeRef = useRef(0);

  const { updateGlobeDots } = useGlobeDots(
    map,
    isLoaded,
    flightsRef,
    trailsRef,
    dataTimestampRef,
    onClickRef,
    showTrailsRef,
  );

  // Stabilize updateGlobeDots via ref so the animation loop doesn't restart on every render
  const updateGlobeDotsRef = useRef(updateGlobeDots);

  // ── Sync props into refs ───────────────────────────────────────────

  useEffect(() => {
    updateGlobeDotsRef.current = updateGlobeDots;
    flightsRef.current = flights;
    trailsRef.current = trails;
    selectedEnvelopeRef.current = selectedEnvelope;
    showTrailsRef.current = showTrails;
    trailThicknessRef.current = trailThickness;
    trailDistanceRef.current = trailDistance;
    showShadowsRef.current = showShadows;
    showAltColorsRef.current = showAltitudeColors;
    altitudeDisplayModeRef.current = altitudeDisplayMode;
    force2DMarkersRef.current = force2DMarkers;
    followIcao24Ref.current = followIcao24;
    fpvIcao24Ref.current = fpvIcao24;
    fpvPosRef.current = fpvPositionRef;
    onClickRef.current = onClick;
    globeModeRef.current = globeMode;
    if (selectedIcao24 !== selectedIcao24Ref.current) {
      prevSelectedRef.current = selectedIcao24Ref.current;
      selectionChangeTimeRef.current = performance.now();
    }
    selectedIcao24Ref.current = selectedIcao24;
  }, [
    updateGlobeDots,
    flights,
    trails,
    selectedEnvelope,
    onClick,
    showTrails,
    trailThickness,
    trailDistance,
    showShadows,
    showAltitudeColors,
    altitudeDisplayMode,
    globeMode,
    force2DMarkers,
    selectedIcao24,
    followIcao24,
    fpvIcao24,
    fpvPositionRef,
  ]);

  useEffect(() => {
    const selectedId = (
      fpvIcao24 ??
      followIcao24 ??
      selectedIcao24
    )?.toLowerCase();
    if (!selectedId) return;

    const selectedFlight = flights.find(
      (flight) => flight.icao24.toLowerCase() === selectedId,
    );
    if (selectedFlight) {
      priorityPreloadSelectedFlightModel(selectedFlight);
    }
  }, [flights, selectedIcao24, followIcao24, fpvIcao24]);

  useEffect(() => {
    preloadAllModels(renderQuality);
  }, [renderQuality]);

  // ── Snapshot interpolation on new data ─────────────────────────────

  useEffect(() => {
    const now = performance.now();
    const elapsed = now - dataTimestampRef.current;

    // A normal global-radar update is roughly 30s apart. Only snap after a
    // genuinely long pause (for example a suspended tab), otherwise each
    // ordinary poll would be treated as stale and aircraft would jump.
    const isStale =
      dataTimestampRef.current > 0 &&
      elapsed > getDataSnapStaleMs(animDurationRef.current);

    // The first real snapshot after tab/online resume must become authoritative
    // immediately. Interpolating from a minutes-old pre-suspend position keeps
    // aircraft visibly behind for another full provider cadence.
    if (resumeSnapRef.current || isStale) {
      const snap = new Map<string, Snapshot>();
      for (const f of flights) {
        if (f.longitude != null && f.latitude != null) {
          snap.set(f.icao24, {
            lng: f.longitude,
            lat: f.latitude,
            alt: Number.isFinite(f.baroAltitude) ? f.baroAltitude! : 0,
            track: Number.isFinite(f.trueTrack) ? f.trueTrack! : 0,
          });
        }
      }
      prevSnapshotsRef.current = snap;
      currSnapshotsRef.current = new Map(snap);
      animDurationRef.current = DEFAULT_ANIM_DURATION_MS;
      dataTimestampRef.current = now;
      lastFlightsForInterpRef.current = null;
      resumeSnapRef.current = false;
      dataVersionRef.current++;
      return;
    }
    const oldLinearT = Math.min(elapsed / animDurationRef.current, 1);
    const oldAngleT = smoothStep(oldLinearT);

    const newPrev = new Map<string, Snapshot>();
    for (const f of flights) {
      if (f.longitude == null || f.latitude == null) continue;
      const id = f.icao24;
      const oldPrev = prevSnapshotsRef.current.get(id);
      const oldCurr = currSnapshotsRef.current.get(id);

      if (oldPrev && oldCurr) {
        if (
          horizontalDistanceMeters(oldPrev, oldCurr) <=
          TELEPORT_THRESHOLD_METERS
        ) {
          newPrev.set(id, {
            lng: interpolateLongitude(oldPrev.lng, oldCurr.lng, oldLinearT),
            lat: oldPrev.lat + (oldCurr.lat - oldPrev.lat) * oldLinearT,
            alt: oldPrev.alt + (oldCurr.alt - oldPrev.alt) * oldLinearT,
            track: lerpAngle(oldPrev.track, oldCurr.track, oldAngleT),
          });
        } else {
          newPrev.set(id, oldCurr);
        }
      } else if (oldCurr) {
        newPrev.set(id, oldCurr);
      }
    }
    prevSnapshotsRef.current = newPrev;

    const next = new Map<string, Snapshot>();
    for (const f of flights) {
      if (f.longitude != null && f.latitude != null) {
        const prev = newPrev.get(f.icao24);
        const rawTrack = Number.isFinite(f.trueTrack) ? f.trueTrack! : 0;
        const rawAlt = Number.isFinite(f.baroAltitude) ? f.baroAltitude! : 0;

        // MLAT positions (~100m accuracy) jitter visibly compared to
        // ADS-B (~10m). Apply EMA blending against the previous position
        // to suppress the noise while tracking real movement.
        const isMLAT = f.positionSource === "mlat";
        let lng = f.longitude;
        let lat = f.latitude;
        if (isMLAT && prev) {
          lng = interpolateLongitude(prev.lng, lng, MLAT_POSITION_ALPHA);
          lat = prev.lat + (lat - prev.lat) * MLAT_POSITION_ALPHA;
        }

        next.set(f.icao24, {
          lng,
          lat,
          alt: rawAlt,
          track:
            prev != null
              ? lerpAngle(prev.track, rawTrack, TRACK_DAMPING)
              : rawTrack,
        });
      }
    }
    currSnapshotsRef.current = next;
    if (dataTimestampRef.current > 0) {
      const observedInterval = now - dataTimestampRef.current;
      // Use median of recent intervals to filter event-loop stalls.
      // A single blocked tick (e.g. heavy parse of 5K aircraft) would
      // inflate observedInterval → animDuration, making aircraft move
      // too slowly that cycle. Median is robust to such outliers.
      const intervals = recentIntervalsRef.current;
      intervals.push(observedInterval);
      if (intervals.length > 5) intervals.shift();
      const sorted = [...intervals].sort((a, b) => a - b);
      const medianInterval = sorted[Math.floor(sorted.length / 2)];
      // Finish just after the expected next poll. This small, cadence-aware
      // reserve absorbs normal timer/network jitter without running beyond
      // the authoritative endpoint and snapping backwards on refresh.
      const cadenceBuffer = Math.max(
        MIN_CADENCE_BUFFER_MS,
        Math.min(
          MAX_CADENCE_BUFFER_MS,
          medianInterval * CADENCE_BUFFER_RATIO,
        ),
      );
      animDurationRef.current = Math.max(
        MIN_ANIM_DURATION_MS,
        Math.min(MAX_ANIM_DURATION_MS, medianInterval + cadenceBuffer),
      );
    }
    dataTimestampRef.current = now;
    // Fresh data arrived, so normal cadence interpolation can resume after a
    // visibility-change clamp.
    resumeSnapRef.current = false;
    // Increment data version so model layers know color/scale need recomputation
    dataVersionRef.current++;
  }, [flights]);

  // ── Cursor management ──────────────────────────────────────────────

  const handleHover = useCallback(
    (info: PickingInfo<FlightState>) => {
      const canvas = map?.getCanvas();
      if (canvas) canvas.style.cursor = info.object ? "pointer" : "";
    },
    [map],
  );

  useEffect(() => {
    return () => {
      const canvas = map?.getCanvas();
      if (canvas) canvas.style.cursor = "";
    };
  }, [map]);

  // Keep a throttled expanded viewport for render culling. This runs during
  // camera movement without touching React state, so panning and follow mode
  // stay responsive even with several thousand global aircraft loaded.
  useEffect(() => {
    if (!map || !isLoaded) return;

    let lastCheckAt = 0;

    const updateViewport = (force = false) => {
      const now = performance.now();
      if (!force && now - lastCheckAt < VIEWPORT_UPDATE_THROTTLE_MS) return;
      lastCheckAt = now;
      const nextBounds = getExpandedViewportBounds(map);
      if (!shouldRefreshViewportBounds(viewportBoundsRef.current, nextBounds)) {
        return;
      }
      viewportBoundsRef.current = nextBounds;
      viewportRevisionRef.current++;
      lastFlightsForInterpRef.current = null;
    };

    const onMove = () => updateViewport(false);
    const onMoveEnd = () => updateViewport(false);
    const onResize = () => updateViewport(true);

    updateViewport(true);
    map.on("move", onMove);
    map.on("moveend", onMoveEnd);
    map.on("resize", onResize);

    return () => {
      map.off("move", onMove);
      map.off("moveend", onMoveEnd);
      map.off("resize", onResize);
    };
  }, [map, isLoaded]);

  const handleClick = useCallback(
    (info: PickingInfo<FlightState>) => {
      if (info.object) onClick(info);
    },
    [onClick],
  );

  // Stable refs for event handlers - prevents RAF loop restart when handlers change
  const handleHoverRef = useRef(handleHover);
  const handleClickRef = useRef(handleClick);
  useEffect(() => {
    handleHoverRef.current = handleHover;
    handleClickRef.current = handleClick;
  }, [handleHover, handleClick]);

  const stableHover = useCallback(
    (info: PickingInfo<FlightState>) => handleHoverRef.current(info),
    [],
  );
  const stableClick = useCallback(
    (info: PickingInfo<FlightState>) => handleClickRef.current(info),
    [],
  );

  // ── Map click pass-through ─────────────────────────────────────────

  useEffect(() => {
    if (!map || !isLoaded) return;

    function onMapClick(e: maplibregl.MapMouseEvent) {
      const overlay = overlayRef.current;
      if (!overlay) {
        onClick(null);
        return;
      }
      const picked = (overlay as unknown as DeckGLOverlay).pickObject?.({
        x: e.point.x,
        y: e.point.y,
        radius: AIRCRAFT_PICK_RADIUS_PX,
      });
      if (!picked?.object) {
        onClick(null);
      }
    }

    map.on("click", onMapClick);
    return () => {
      map.off("click", onMapClick);
    };
  }, [map, isLoaded, onClick]);

  // ── Overlay lifecycle ──────────────────────────────────────────────

  useEffect(() => {
    if (!map || !isLoaded) return;

    function createOverlay() {
      overlayRef.current = new MapboxOverlay({
        interleaved: false,
        views: new MapView({ id: "mapbox" }) as never,
        pickingRadius: AIRCRAFT_PICK_RADIUS_PX,
        useDevicePixels: devicePixelRatioRef.current,
        _typedArrayManagerProps: { overAlloc: 1.5, poolSize: 0 },
        layers: [],
      });
      map!.addControl(overlayRef.current as unknown as maplibregl.IControl);
    }

    if (!overlayRef.current) {
      createOverlay();
    }

    // ── WebGL context loss recovery ──────────────────────────────
    // Mobile devices may reclaim GPU memory when the app is backgrounded.
    // Without explicit handling, the deck.gl overlay becomes permanently
    // blank. We listen for context events on MapLibre's canvas and
    // rebuild the overlay when the browser restores the context.
    const canvas = map.getCanvas();

    function onContextLost(e: Event) {
      e.preventDefault(); // allow browser to attempt restoration
    }

    function onContextRestored() {
      // Tear down the dead overlay and recreate with a fresh context.
      if (overlayRef.current) {
        try {
          map!.removeControl(
            overlayRef.current as unknown as maplibregl.IControl,
          );
          overlayRef.current.finalize();
        } catch {
          /* already dead */
        }
        overlayRef.current = null;
      }
      createOverlay();
    }

    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (overlayRef.current) {
        try {
          map.removeControl(
            overlayRef.current as unknown as maplibregl.IControl,
          );
          overlayRef.current.finalize();
        } catch {
          /* unmounted */
        }
        overlayRef.current = null;
      }
    };
  }, [map, isLoaded]);

  // Visual frame counter - increments once per rendered frame.
  // Used in updateTriggers so deck.gl recomputes attributes only when we push.
  const visualFrameRef = useRef(0);
  // LOD state: true = render 3D ScenegraphLayers, false = render 2D IconLayer.
  // Uses hysteresis to avoid flickering at the zoom boundary.
  const use3DRef = useRef(true);
  // Pitch/bank time-based throttle (~10fps regardless of animation frame rate)
  const lastPitchBankTimeRef = useRef(0);

  // ── Main animation loop ────────────────────────────────────────────

  useEffect(() => {
    if (!atlasUrl) return;

    let lastLayerFrameAt = 0;

    // Hoisted constant - avoids allocating a new array every frame
    const DEFAULT_COLOR: [number, number, number, number] = [
      180, 220, 255, 200,
    ];

    const isPageActive = () =>
      document.visibilityState === "visible" &&
      (typeof document.hasFocus !== "function" || document.hasFocus());

    function freezeAtCurrentSnapshots() {
      const curr = currSnapshotsRef.current;
      if (curr.size > 0) {
        prevSnapshotsRef.current = new Map(curr);
      }
      animDurationRef.current = DEFAULT_ANIM_DURATION_MS;
      lastFlightsForInterpRef.current = null;
      resumeSnapRef.current = true;

      trailBasePathCacheRef.current.clear();
      trailPathCacheRef.current.clear();
      trailColorCacheRef.current.clear();
      visibleTrailCacheRef.current.clear();
    }

    function markPageHidden() {
      pageActiveRef.current = false;
      freezeAtCurrentSnapshots();
    }

    function handleVisibilityResume() {
      pageActiveRef.current = isPageActive();
      freezeAtCurrentSnapshots();

      // Preserve existing trails but reset bootstrap state immediately. Some
      // browsers dispatch visibilitychange before window focus is restored.
      trailStore.handleVisibilityResume();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        handleVisibilityResume();
      } else {
        markPageHidden();
      }
    }
    function onWindowBlur() {
      // Losing focus is not a data suspension: radar polling continues. Pause
      // frame work without arming a stale-position snap that would otherwise
      // freeze aircraft until the next 30-second global poll.
      pageActiveRef.current = false;
    }
    function onWindowFocus() {
      pageActiveRef.current = isPageActive();
    }
    function onPageShow(event: PageTransitionEvent) {
      // `pageshow` also fires for an ordinary first load. Only BFCache
      // restoration represents a suspended page that needs an authoritative
      // snapshot reset; normal tab resumes are handled by visibilitychange.
      if (event.persisted) handleVisibilityResume();
    }
    pageActiveRef.current = isPageActive();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("pagehide", markPageHidden);
    window.addEventListener("pageshow", onPageShow);

    function buildAndPushLayers() {
      animFrameRef.current = requestAnimationFrame(buildAndPushLayers);

      // Skip rendering while the tab is hidden or the window is blurred.
      // Focus can be lost while the page remains visible, so checking only
      // document.hidden still lets stale trail/aircraft frames churn.
      if (!isPageActive()) {
        if (pageActiveRef.current) {
          if (document.visibilityState === "hidden") {
            markPageHidden();
          } else {
            pageActiveRef.current = false;
          }
        }
        return;
      }

      const overlay = overlayRef.current;
      if (!overlay) return;

      const now = performance.now();
      if (lastLayerFrameAt > 0) {
        const sinceLastLayerFrame = now - lastLayerFrameAt;
        if (sinceLastLayerFrame < radarFrameIntervalMs) return;
        lastLayerFrameAt +=
          radarFrameIntervalMs *
          Math.max(1, Math.floor(sinceLastLayerFrame / radarFrameIntervalMs));
      } else {
        lastLayerFrameAt = now;
      }
      visualFrameRef.current++;

      const currentZoom = map?.getZoom() ?? 10;
      const isGlobe = globeModeRef.current;
      const useNativeOverview = currentZoom <= GLOBE_FADE_ZOOM_CEIL;

      let globeFade = 1;
      let layersVisible = true;
      if (useNativeOverview) {
        if (currentZoom < GLOBE_FADE_ZOOM_FLOOR) {
          layersVisible = false;
          globeFade = 0;
        } else if (currentZoom < GLOBE_FADE_ZOOM_CEIL) {
          const t =
            (currentZoom - GLOBE_FADE_ZOOM_FLOOR) /
            (GLOBE_FADE_ZOOM_CEIL - GLOBE_FADE_ZOOM_FLOOR);
          // Match the native overview fade exactly: native opacity is 1 - t
          // while Deck opacity is t, so aircraft never vanish at the handoff.
          globeFade = t;
        }
      }

      try {
        const currentFlights = flightsRef.current;
        const currentTrails = trailsRef.current;
        const selectedFlightId = selectedIcao24Ref.current;
        const selectedIdForCull = selectedFlightId?.toLowerCase() ?? null;
        const followId = followIcao24Ref.current?.toLowerCase() ?? null;
        const fpvId = fpvIcao24Ref.current?.toLowerCase() ?? null;
        const trackingId = fpvId ?? followId;
        const trackingCache = trackingFlightCacheRef.current;

        if (
          trackingCache.source !== currentFlights ||
          trackingCache.id !== trackingId
        ) {
          const trackedFlight = trackingId
            ? currentFlights.find(
                (flight) => flight.icao24.toLowerCase() === trackingId,
              ) ?? null
            : null;
          trackingCache.source = currentFlights;
          trackingCache.id = trackingId;
          trackingCache.flight = trackedFlight;
          trackingCache.result = trackedFlight ? [trackedFlight] : [];
        }

        const interpolationSeed = trackingInterpolationSeedRef.current;
        if (interpolationSeed.id !== trackingId) {
          interpolationSeed.id = trackingId;
          interpolationSeed.snapshot = null;
        }
        if (
          trackingId &&
          currentZoom < GLOBE_FADE_ZOOM_CEIL
        ) {
          const currentSnapshot = currSnapshotsRef.current.get(trackingId);
          if (
            currentSnapshot &&
            interpolationSeed.snapshot !== currentSnapshot
          ) {
            prevSnapshotsRef.current.set(trackingId, {
              ...currentSnapshot,
            });
            interpolationSeed.snapshot = currentSnapshot;
            // Recreate the small selected-only interpolation array from the
            // newly aligned pair on the next detailed frame.
            lastFlightsForInterpRef.current = null;
          }
        }

        // Publish the position used by the overview dots before detailed Deck
        // layers become visible. Previously global selection had to wait for
        // the 450ms raw fallback because this loop returned at low zoom.
        const trackingPositionOut = fpvPosRef.current;
        const trackedRawFlight = trackingCache.flight;
        if (
          trackingPositionOut &&
          trackingId &&
          trackedRawFlight &&
          Number.isFinite(trackedRawFlight.longitude) &&
          Number.isFinite(trackedRawFlight.latitude)
        ) {
          trackingPositionOut.current = {
            icao24: trackingId,
            lng: trackedRawFlight.longitude!,
            lat: trackedRawFlight.latitude!,
            alt: Number.isFinite(trackedRawFlight.baroAltitude)
              ? trackedRawFlight.baroAltitude!
              : 5000,
            track: Number.isFinite(trackedRawFlight.trueTrack)
              ? trackedRawFlight.trueTrack!
              : 0,
          };
        } else if (trackingPositionOut) {
          trackingPositionOut.current = null;
        }

        // Globe dots use their own inexpensive MapLibre source. When the
        // detailed deck.gl layers are outside their visibility range, avoid
        // all interpolation, trail, and model work for this frame.
        updateGlobeDotsRef.current(
          isGlobe || useNativeOverview,
          currentZoom,
          now,
        );
        if (!layersVisible) {
          overlay.setProps({
            layers: [],
            useDevicePixels: devicePixelRatioRef.current,
          });
          return;
        }

        const elapsed = performance.now() - dataTimestampRef.current;
        const progress = getSafeInterpolationProgress({
          elapsedMs: elapsed,
          animDurationMs: animDurationRef.current,
          // `resumeSnapRef` stays true until fresh flight data arrives; during
          // that resume window we render the latest authoritative snapshot only.
          pageActive: pageActiveRef.current && !resumeSnapRef.current,
          staleThresholdMs: getFrameStaleMs(animDurationRef.current),
          maxExtrapolationMs: MAX_FLIGHT_EXTRAPOLATION_MS,
        });
        const rawT = progress.rawT;
        const tPos = progress.tPos;
        const tAngle = smoothStep(smoothStep(smoothStep(tPos)));

        const viewportRevision = viewportRevisionRef.current;
        const viewportCache = viewportFlightCacheRef.current;
        const approachActive = Boolean(
          trackingId &&
            map?.isEasing() &&
            currentZoom < FOLLOW_APPROACH_WORK_ZOOM,
        );

        let currentFlightsForRender: FlightState[];
        if (approachActive && trackingId) {
          // During the global-to-aircraft zoom, keep detailed work focused on
          // the selected plane. This avoids rebuilding PBR model buckets and
          // trail geometry for thousands of aircraft while tiles are moving.
          currentFlightsForRender = trackingCache.result;
        } else if (
          viewportCache.source === currentFlights &&
          viewportCache.revision === viewportRevision &&
          viewportCache.selectedId === selectedIdForCull &&
          viewportCache.followId === followId &&
          viewportCache.fpvId === fpvId
        ) {
          currentFlightsForRender = viewportCache.result;
        } else {
          const bounds = viewportBoundsRef.current;
          currentFlightsForRender = bounds
            ? currentFlights.filter((flight) => {
                const id = flight.icao24.toLowerCase();
                return (
                  id === selectedIdForCull ||
                  id === followId ||
                  id === fpvId ||
                  isFlightInsideViewport(flight, bounds)
                );
              })
            : currentFlights;

          viewportFlightCacheRef.current = {
            source: currentFlights,
            revision: viewportRevision,
            selectedId: selectedIdForCull,
            followId,
            fpvId,
            result: currentFlightsForRender,
          };
        }

        // On new poll data: full interpolation (creates new FlightState objects).
        // Between polls: mutate positions in-place (zero object allocations).
        let interpolated: FlightState[];
        if (currentFlightsForRender !== lastFlightsForInterpRef.current) {
          interpolated = computeInterpolatedFlights(
            currentFlightsForRender,
            prevSnapshotsRef.current,
            currSnapshotsRef.current,
            tPos,
            tAngle,
            rawT,
            animDurationRef.current,
          );
          interpArrayRef.current = interpolated;
          lastFlightsForInterpRef.current = currentFlightsForRender;

          // Rebuild Map only on new poll - updateInterpolatedInPlace mutates
          // the same FlightState objects in-place, so existing Map entries
          // remain valid between polls.
          const interpolatedMap = interpolatedMapRef.current;
          interpolatedMap.clear();
          for (const f of interpolated) {
            interpolatedMap.set(f.icao24, f);
          }
        } else {
          interpolated = interpArrayRef.current;
          updateInterpolatedInPlace(
            interpolated,
            currentFlightsForRender,
            prevSnapshotsRef.current,
            currSnapshotsRef.current,
            tPos,
            tAngle,
            rawT,
            animDurationRef.current,
          );
        }

        // Camera tracking output - use the exact position rendered this frame.
        // FPV takes priority; ordinary follow mode shares the same ref so its
        // camera cannot oscillate between raw poll positions and interpolated
        // aircraft positions.
        if (trackingPositionOut && trackingId) {
          const fpvF = interpolatedMapRef.current.get(trackingId) ?? null;
          if (
            fpvF &&
            Number.isFinite(fpvF.longitude) &&
            Number.isFinite(fpvF.latitude)
          ) {
            trackingPositionOut.current = {
              icao24: trackingId,
              lng: fpvF.longitude!,
              lat: fpvF.latitude!,
              alt: Number.isFinite(fpvF.baroAltitude)
                ? fpvF.baroAltitude!
                : 5000,
              track: Number.isFinite(fpvF.trueTrack) ? fpvF.trueTrack! : 0,
            };
          } else {
            trackingPositionOut.current = null;
          }
        } else if (trackingPositionOut && !trackingId) {
          trackingPositionOut.current = null;
        }

        // Rebuild trail-by-icao24 Map only when trails reference changes
        if (currentTrails !== lastTrailsForMapRef.current) {
          trailMapRef.current.clear();
          for (const t of currentTrails) {
            trailMapRef.current.set(t.icao24, t);
          }
          lastTrailsForMapRef.current = currentTrails;
        }

        // ── Globe dots ────────────────────────────────────────────────
        const altColors = showAltColorsRef.current;
        const visibleFlights = interpolated;
        const highDensityTrails =
          visibleFlights.length > HIGH_DENSITY_TRAIL_LIMIT;
        const renderFullTrails =
          !approachActive &&
          showTrailsRef.current &&
          (!highDensityTrails ||
            currentZoom >= HIGH_DENSITY_TRAIL_ZOOM_RECOVERY);
        const renderSelectedTrail =
          !approachActive &&
          showTrailsRef.current &&
          highDensityTrails &&
          !!selectedFlightId;
        const selectedOnlyId =
          renderSelectedTrail && !renderFullTrails ? selectedFlightId : null;

        let trailFlights = visibleFlights;
        if (selectedOnlyId) {
          const selectedTrailFlights = selectedTrailFlightsRef.current;
          selectedTrailFlights.length = 0;
          const selectedFlight = interpolatedMapRef.current.get(selectedOnlyId);
          if (selectedFlight) selectedTrailFlights.push(selectedFlight);
          trailFlights = selectedTrailFlights;
        }

        const trailEntryCache = visibleTrailEntriesCacheRef.current;
        let trailEntries: TrailEntry[];
        if (
          trailEntryCache.source === currentTrails &&
          trailEntryCache.flights === visibleFlights &&
          trailEntryCache.selectedOnlyId === selectedOnlyId
        ) {
          trailEntries = trailEntryCache.result;
        } else {
          const visibleIds = new Set(
            selectedOnlyId
              ? [selectedOnlyId]
              : visibleFlights.map((flight) => flight.icao24),
          );
          trailEntries = currentTrails.filter((trail) =>
            visibleIds.has(trail.icao24),
          );
          visibleTrailEntriesCacheRef.current = {
            source: currentTrails,
            flights: visibleFlights,
            selectedOnlyId,
            result: trailEntries,
          };
        }

        // Pitch/bank change slowly - recompute at ~10fps regardless of
        // animation frame rate. Values are retained in pitchMapRef/bankMapRef
        // between compute frames.
        const PITCH_BANK_INTERVAL_MS = 100;
        if (now - lastPitchBankTimeRef.current >= PITCH_BANK_INTERVAL_MS) {
          lastPitchBankTimeRef.current = now;
          computePitchByIcao(
            interpolated,
            trailMapRef.current,
            currSnapshotsRef.current,
            prevSnapshotsRef.current,
            pitchMapRef.current,
          );

          computeBankByIcao(
            interpolated,
            prevSnapshotsRef.current,
            currSnapshotsRef.current,
            tAngle,
            bankMapRef.current,
          );
        }
        const pitchByIcao = pitchMapRef.current;
        const bankByIcao = bankMapRef.current;

        const layers = [];

        // Tie the height ramp to the actual flight-layer visibility window so
        // aircraft and trails do not appear overly flattened as they fade in.
        const elevScale = getZoomAdjustedElevationScale(
          currentZoom,
          altitudeDisplayModeRef.current,
        );

        if (showShadowsRef.current && !approachActive) {
          layers.push(
            new IconLayer<FlightState>({
              id: "flight-shadows",
              pickable: false,
              visible: layersVisible,
              data: visibleFlights,
              opacity: globeFade,
              getPosition: (d) => [d.longitude!, d.latitude!, 0],
              getIcon: () => "aircraft",
              getSize: (d) =>
                BASE_AIRCRAFT_SIZE *
                aircraftSizeMultiplier(d.typeCode, d.category),
              getColor: () => [0, 0, 0, 60],
              getAngle: (d) =>
                360 - (Number.isFinite(d.trueTrack) ? d.trueTrack! : 0),
              iconAtlas: atlasUrl,
              iconMapping: AIRCRAFT_ICON_MAPPING,
              billboard: false,
              sizeUnits: "pixels",
              sizeScale: 1,
              updateTriggers: {
                getPosition: visualFrameRef.current,
                getAngle: visualFrameRef.current,
              },
            }),
          );
        }

        if (renderFullTrails || renderSelectedTrail) {
          layers.push(
            ...buildTrailLayers({
              interpolated: trailFlights,
              interpolatedMap: interpolatedMapRef.current,
              currentTrails: trailEntries,
              trailMap: trailMapRef.current,
              selectedIcao24: selectedFlightId,
              selectedEnvelope: selectedEnvelopeRef.current,
              trailDistance: trailDistanceRef.current,
              trailThickness: trailThicknessRef.current,
              altColors,
              altitudeDisplayMode: altitudeDisplayModeRef.current,
              defaultColor: DEFAULT_COLOR,
              elapsed,
              visualFrame: visualFrameRef.current,
              globeFade,
              currentZoom,
              elevScale,
              visible: layersVisible,
              trailBasePathCache: trailBasePathCacheRef.current,
              trailPathCache: trailPathCacheRef.current,
              trailColorCache: trailColorCacheRef.current,
              handledIdsSet: handledIdsRef.current,
              visibleTrailCacheMap: visibleTrailCacheRef.current,
              activeIcaosSet: activeIcaosRef.current,
            }),
          );
        }

        // Selection pulse layers (halo + rings) - skip entirely when
        // nothing is selected and no fade-out is in progress. Saves
        // constructing 4 IconLayer objects + deck.gl diffing per frame.
        if (selectedIcao24Ref.current || prevSelectedRef.current) {
          const pulseResult = buildSelectionPulseLayers({
            selectionChangeTime: selectionChangeTimeRef.current,
            selectedId: selectedIcao24Ref.current,
            prevId: prevSelectedRef.current,
            interpolated,
            interpolatedMap: interpolatedMapRef.current,
            elapsed,
            globeFade,
            currentZoom,
            elevScale,
            altitudeDisplayMode: altitudeDisplayModeRef.current,
            haloUrl,
            ringUrl,
            layersVisible,
          });
          layers.push(...pulseResult.layers);
          if (pulseResult.shouldClearPrev) {
            prevSelectedRef.current = null;
          }
        }

        // ── LOD: 3D models vs 2D icons ────────────────────────────────
        // At low zoom, aircraft are too small to distinguish 3D silhouettes.
        // Switch to a single IconLayer (2D) below LOD_3D_ZOOM_OUT and back
        // to ScenegraphLayers (3D) above LOD_3D_ZOOM_IN. The hysteresis
        // band (6.5–7.5) prevents rapid flickering at the boundary.
        const force2DHighDensity =
          visibleFlights.length > HIGH_DENSITY_3D_LIMIT &&
          !fpvId &&
          currentZoom < HIGH_DENSITY_3D_ZOOM_LIMIT;

        const force2DMarkersEnabled = force2DMarkersRef.current;

        if (force2DMarkersEnabled) {
          use3DRef.current = false;
        } else if (
          use3DRef.current &&
          (currentZoom < LOD_3D_ZOOM_OUT || force2DHighDensity)
        ) {
          use3DRef.current = false;
        } else if (
          !use3DRef.current &&
          currentZoom >= LOD_3D_ZOOM_IN &&
          !force2DHighDensity
        ) {
          use3DRef.current = true;
        }

        if (use3DRef.current) {
          // 3D: one ScenegraphLayer per model type
          layers.push(
            ...buildAircraftModelLayers({
              rawFlights: currentFlightsForRender,
              interpolatedMap: interpolatedMapRef.current,
              frameCounter: visualFrameRef.current,
              dataVersion: dataVersionRef.current,
              layersVisible,
              globeFade,
              elevScale,
              currentZoom,
              altitudeDisplayMode: altitudeDisplayModeRef.current,
              altColors,
              defaultColor: DEFAULT_COLOR,
              pitchByIcao,
              bankByIcao,
              handleHover: stableHover,
              handleClick: stableClick,
            }),
          );
        } else {
          // 2D: single IconLayer using the sprite atlas (much cheaper GPU-wise)
          layers.push(
            new IconLayer<FlightState>({
              id: "flight-aircraft-2d",
              pickable: true,
              visible: layersVisible,
              data: visibleFlights,
              opacity: globeFade,
              getPosition: (d) => [
                d.longitude!,
                d.latitude!,
                altitudeToElevation(
                  d.baroAltitude,
                  altitudeDisplayModeRef.current,
                ) * elevScale,
              ],
              getIcon: () => "aircraft",
              getSize: (d) =>
                BASE_AIRCRAFT_SIZE *
                aircraftSizeMultiplier(d.typeCode, d.category),
              getColor: (d) => {
                const base = altColors
                  ? altitudeToColor(d.baroAltitude)
                  : DEFAULT_COLOR;
                const catColor = tintAircraftColor(base, d.category);
                return applySpecialTint(catColor, d.dbFlags, d.emergencyStatus);
              },
              getAngle: (d) =>
                360 - (Number.isFinite(d.trueTrack) ? d.trueTrack! : 0),
              iconAtlas: atlasUrl,
              iconMapping: AIRCRAFT_ICON_MAPPING,
              billboard: false,
              sizeUnits: "pixels",
              sizeScale: 1,
              onHover: stableHover,
              onClick: stableClick,
              autoHighlight: true,
              highlightColor: [255, 255, 255, 80],
              updateTriggers: {
                getPosition: [
                  visualFrameRef.current,
                  elevScale,
                  altitudeDisplayModeRef.current,
                ],
                getAngle: visualFrameRef.current,
                getColor: [dataVersionRef.current, altColors],
              },
            }),
          );
        }

        overlay.setProps({
          layers,
          // Keep the drawing buffer stable for the overlay lifetime. Changing
          // DPR while crossing the 2D/3D LOD threshold reallocates the entire
          // WebGL framebuffer at the worst point in the selection zoom.
          useDevicePixels: devicePixelRatioRef.current,
        });
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("[atc] FlightLayers render error:", err);
        }
      }
    }

    buildAndPushLayers();
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("pagehide", markPageHidden);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [
    atlasUrl,
    haloUrl,
    ringUrl,
    stableHover,
    stableClick,
    map,
    radarFrameIntervalMs,
  ]);

  return null;
}
