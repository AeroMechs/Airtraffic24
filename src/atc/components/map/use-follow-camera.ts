"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import {
  lerp,
  lerpLng,
  normalizeLng,
  projectLngLatElevationPixelDelta,
} from "./camera-controller-utils";
import { getZoomAdjustedElevationScale } from "./altitude-projection";
import type { AltitudeDisplayMode } from "@/atc/lib/altitude-display-mode";
import {
  getDevicePerformanceProfile,
  type RenderQuality,
} from "@/atc/lib/device-performance";
import { altitudeToElevation } from "@/atc/lib/flight-utils";
import type { FlightState } from "@/atc/lib/opensky";

const RENDER_POSITION_WAIT_MS = 220;
const CENTER_RESPONSE_MS = 90;
const BEARING_RESPONSE_MS = 260;
const OFFSET_RESPONSE_MS = 180;
const LAYOUT_OFFSET_RESPONSE_MS = 180;
const MAX_FRAME_DELTA_MS = 100;
const MAX_CAMERA_TARGET_FPS = 30;
const LOW_ZOOM_APPROACH_THRESHOLD = 5.5;
const FOLLOW_EASE_ID = "aircraft-follow";
const FOLLOW_APPROACH_EASE_ID = "aircraft-follow-approach";

export type TrackedAircraftPosition = {
  /** Included by the renderer when available to reject a previous selection. */
  icao24?: string;
  lng: number;
  lat: number;
  alt: number;
  track: number;
};

function isValidPosition(
  position: TrackedAircraftPosition | null | undefined,
): position is TrackedAircraftPosition {
  return (
    position != null &&
    Number.isFinite(position.lng) &&
    Number.isFinite(position.lat) &&
    Math.abs(position.lat) <= 90
  );
}

function isPositionForFlight(
  position: TrackedAircraftPosition | null | undefined,
  icao24: string,
): position is TrackedAircraftPosition {
  return (
    isValidPosition(position) &&
    (position.icao24 == null ||
      position.icao24.toLowerCase() === icao24.toLowerCase())
  );
}

function rawFlightPosition(
  flight: FlightState | null,
): TrackedAircraftPosition | null {
  if (
    !flight ||
    flight.longitude == null ||
    flight.latitude == null ||
    !Number.isFinite(flight.longitude) ||
    !Number.isFinite(flight.latitude) ||
    Math.abs(flight.latitude) > 90
  ) {
    return null;
  }

  return {
    lng: flight.longitude,
    lat: flight.latitude,
    alt: Number.isFinite(flight.baroAltitude) ? flight.baroAltitude! : 5000,
    track: Number.isFinite(flight.trueTrack) ? flight.trueTrack! : 0,
  };
}

function smoothingAlpha(deltaMs: number, responseMs: number): number {
  return 1 - Math.exp(-deltaMs / responseMs);
}

function bearingToward(
  currentBearing: number,
  targetBearing: number,
  alpha: number,
): number {
  const delta = ((targetBearing - currentBearing + 540) % 360) - 180;
  return currentBearing + delta * alpha;
}

function visibleMapCenterOffsetX(map: maplibregl.Map): number {
  const canvasRect = map.getCanvas().getBoundingClientRect();
  const containerRect = map.getContainer().getBoundingClientRect();
  const viewportWidth =
    document.documentElement.clientWidth || window.innerWidth;
  const visibleLeft = Math.max(0, canvasRect.left, containerRect.left);
  const visibleRight = Math.min(
    viewportWidth,
    canvasRect.right,
    containerRect.right,
  );

  if (
    !Number.isFinite(visibleLeft) ||
    !Number.isFinite(visibleRight) ||
    visibleRight <= visibleLeft
  ) {
    return 0;
  }

  const visibleCenter = (visibleLeft + visibleRight) / 2;
  const canvasCenter = (canvasRect.left + canvasRect.right) / 2;
  return visibleCenter - canvasCenter;
}

/**
 * Keeps the regular selected-aircraft camera locked to the same interpolated
 * position that the renderer uses. Only the first approach is animated by
 * MapLibre; steady-state tracking has one RAF writer and no queued easings.
 */
export function useFollowCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  followFlight: FlightState | null,
  followFlightRef: MutableRefObject<FlightState | null>,
  trackedPositionRef: MutableRefObject<
    MutableRefObject<TrackedAircraftPosition | null> | undefined
  >,
  isFollowingRef: MutableRefObject<boolean>,
  altitudeDisplayMode: AltitudeDisplayMode = "presentation",
  panelOpen = false,
  renderQuality?: RenderQuality,
) {
  const performanceProfile = getDevicePerformanceProfile(renderQuality);
  const approachDurationMs = performanceProfile.followApproachDurationMs;
  const approachZoom = performanceProfile.followApproachZoom;
  const approachPitch = performanceProfile.followApproachPitch;
  // MapLibre continues rendering each short ease at display refresh rate. A
  // 30 Hz target cadence stays visually smooth while halving camera/event work
  // on 60/120/144 Hz panels.
  const cameraWriteIntervalMs = Math.max(
    performanceProfile.followUpdateIntervalMs,
    1000 / MAX_CAMERA_TARGET_FPS,
  );
  const layoutOffsetXRef = useRef(0);
  const measureLayoutOffsetRef = useRef<() => void>(() => undefined);

  // CSS translates the full map surface when the desktop details panel opens.
  // Cache the center of the transformed canvas' visible intersection instead
  // of reading layout in the tracking RAF. Transform completion and resizes
  // are the only times this geometry can materially change.
  useEffect(() => {
    if (!map || !isLoaded) {
      layoutOffsetXRef.current = 0;
      measureLayoutOffsetRef.current = () => undefined;
      return;
    }

    let measureFrame: number | null = null;
    const mapSurface = map
      .getContainer()
      .closest<HTMLElement>(".atc-map-surface");

    const measure = () => {
      layoutOffsetXRef.current = visibleMapCenterOffsetX(map);
    };
    const scheduleMeasure = () => {
      if (measureFrame != null) cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => {
        measureFrame = null;
        measure();
      });
    };
    const onSurfaceTransitionEnd = (event: TransitionEvent) => {
      if (
        event.target === mapSurface &&
        event.propertyName === "transform"
      ) {
        scheduleMeasure();
      }
    };

    measureLayoutOffsetRef.current = measure;
    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    mapSurface?.addEventListener("transitionend", onSurfaceTransitionEnd);

    return () => {
      if (measureFrame != null) cancelAnimationFrame(measureFrame);
      window.removeEventListener("resize", scheduleMeasure);
      mapSurface?.removeEventListener("transitionend", onSurfaceTransitionEnd);
      measureLayoutOffsetRef.current = () => undefined;
    };
  }, [map, isLoaded, panelOpen]);

  useEffect(() => {
    if (!map || !isLoaded) {
      isFollowingRef.current = false;
      return;
    }

    const followKey = followFlight?.icao24 ?? null;
    if (!followKey || !rawFlightPosition(followFlightRef.current)) {
      isFollowingRef.current = false;
      return;
    }

    isFollowingRef.current = true;
    map.stop();

    let frameId: number | null = null;
    let approachStageTimer: number | null = null;
    let approachEndsAt = 0;
    let approachStarted = false;
    let measuredAfterApproach = false;
    let lastFrameTime = 0;
    let lastCameraWriteTime = 0;
    let smoothLng = map.getCenter().lng;
    let smoothLat = map.getCenter().lat;
    let smoothBearing = map.getBearing();
    let offsetX = 0;
    let offsetY = 0;
    let layoutOffsetX = layoutOffsetXRef.current;
    const waitStartedAt = performance.now();
    const positionBeforeSelection = trackedPositionRef.current?.current ?? null;

    const beginApproach = (
      target: TrackedAircraftPosition,
      now: number,
    ) => {
      approachStarted = true;
      smoothLng = normalizeLng(target.lng);
      smoothLat = target.lat;
      smoothBearing = Number.isFinite(target.track)
        ? target.track
        : map.getBearing();
      const prefersReducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false;
      const cameraTarget = {
        center: [smoothLng, smoothLat] as [number, number],
        zoom: approachZoom,
        pitch: approachPitch,
        bearing: smoothBearing,
        offset: [layoutOffsetXRef.current, 0] as [number, number],
      };

      if (prefersReducedMotion) {
        map.easeTo({
          ...cameraTarget,
          duration: 0,
          animate: false,
          easeId: FOLLOW_APPROACH_EASE_ID,
          noMoveStart: true,
          essential: false,
        });
        approachEndsAt = now;
        return;
      }

      const useStagedApproach =
        performanceProfile.tier !== "high" &&
        map.getZoom() < LOW_ZOOM_APPROACH_THRESHOLD;
      approachEndsAt = now + approachDurationMs;

      if (useStagedApproach) {
        // First center the inexpensive world overview, then introduce the
        // zoom/pitch once the destination tiles are already being requested.
        // This avoids one giant CPU/GPU spike on phones and integrated GPUs.
        const centerStageDuration = Math.max(
          120,
          Math.round(approachDurationMs * 0.24),
        );
        const detailStageDuration = Math.max(
          220,
          approachDurationMs - centerStageDuration,
        );

        // Keep the steady-state RAF writer parked until the detail stage has
        // actually finished. Background-tab and busy-main-thread throttling
        // can delay this timer beyond the nominal total approach duration.
        approachEndsAt = Number.POSITIVE_INFINITY;
        map.easeTo({
          center: cameraTarget.center,
          bearing: cameraTarget.bearing,
          offset: cameraTarget.offset,
          duration: centerStageDuration,
          easing: (t) => 1 - Math.pow(1 - t, 3),
          easeId: FOLLOW_APPROACH_EASE_ID,
          essential: false,
        });
        approachStageTimer = window.setTimeout(() => {
          approachStageTimer = null;
          if (!isFollowingRef.current) return;
          approachEndsAt = performance.now() + detailStageDuration;
          map.easeTo({
            ...cameraTarget,
            duration: detailStageDuration,
            easing: (t) => t * t * (3 - 2 * t),
            easeId: FOLLOW_APPROACH_EASE_ID,
            noMoveStart: true,
            essential: false,
          });
        }, centerStageDuration);
        return;
      }

      map.flyTo({
        ...cameraTarget,
        duration: approachDurationMs,
        maxDuration: approachDurationMs,
        essential: false,
      });
    };

    const track = (now: number) => {
      if (!isFollowingRef.current) {
        frameId = null;
        return;
      }

      if (document.hidden) {
        lastFrameTime = 0;
        lastCameraWriteTime = 0;
        frameId = requestAnimationFrame(track);
        return;
      }

      const renderedPosition = trackedPositionRef.current?.current ?? null;

      if (!approachStarted) {
        // The shared ref may still contain the previously tracked aircraft for
        // one frame. Wait for the renderer to publish a fresh object before
        // approaching it; raw feed coordinates are only a resilience fallback.
        const hasFreshRenderedPosition =
          isPositionForFlight(renderedPosition, followKey) &&
          renderedPosition !== positionBeforeSelection;
        const waitedLongEnough = now - waitStartedAt >= RENDER_POSITION_WAIT_MS;
        const initialTarget = hasFreshRenderedPosition
          ? renderedPosition
          : waitedLongEnough
            ? rawFlightPosition(followFlightRef.current)
            : null;

        if (initialTarget) {
          beginApproach(initialTarget, now);
        }

        frameId = requestAnimationFrame(track);
        return;
      }

      // Do not let a second camera writer interrupt the one initial flyTo.
      if (now < approachEndsAt) {
        frameId = requestAnimationFrame(track);
        return;
      }

      if (!measuredAfterApproach) {
        measuredAfterApproach = true;
        measureLayoutOffsetRef.current();
      }

      const target = isPositionForFlight(renderedPosition, followKey)
        ? renderedPosition
        : rawFlightPosition(followFlightRef.current);
      if (!target) {
        frameId = requestAnimationFrame(track);
        return;
      }

      if (
        lastCameraWriteTime > 0 &&
        now - lastCameraWriteTime < cameraWriteIntervalMs
      ) {
        frameId = requestAnimationFrame(track);
        return;
      }

      if (lastFrameTime === 0) {
        // `getCenter()` is the transform center after MapLibre applies the
        // panel/elevation offset. Feeding it back as the logical aircraft
        // coordinate would compound that offset on the first tracking frame.
        // Keep the geographic target seeded by beginApproach instead.
        smoothBearing = map.getBearing();
        lastFrameTime = now;
      }

      const deltaMs = Math.min(
        Math.max(now - lastFrameTime, 1),
        MAX_FRAME_DELTA_MS,
      );
      lastFrameTime = now;
      lastCameraWriteTime = now;

      const centerAlpha = smoothingAlpha(deltaMs, CENTER_RESPONSE_MS);
      const bearingAlpha = smoothingAlpha(deltaMs, BEARING_RESPONSE_MS);
      const offsetAlpha = smoothingAlpha(deltaMs, OFFSET_RESPONSE_MS);
      const layoutOffsetAlpha = smoothingAlpha(
        deltaMs,
        LAYOUT_OFFSET_RESPONSE_MS,
      );
      smoothLng = lerpLng(smoothLng, target.lng, centerAlpha);
      smoothLat = lerp(smoothLat, target.lat, centerAlpha);
      if (Number.isFinite(target.track)) {
        smoothBearing = bearingToward(
          smoothBearing,
          target.track,
          bearingAlpha,
        );
      }

      // Deck.gl draws the model above the ground coordinate. At a pitched
      // camera that elevation moves the model away from the visual center, so
      // derive the altitude-only screen delta and counter it with MapLibre's
      // camera offset. Subtracting the ground projection prevents horizontal
      // follow lag from contaminating the elevation correction.
      const elevationMeters =
        altitudeToElevation(target.alt, altitudeDisplayMode) *
        getZoomAdjustedElevationScale(map.getZoom(), altitudeDisplayMode);
      const elevatedDelta = projectLngLatElevationPixelDelta(
        map,
        target.lng,
        target.lat,
        elevationMeters,
      );
      if (elevatedDelta) {
        const canvas = map.getCanvas();
        const groundPoint = map.project([target.lng, target.lat]);
        const groundDx = groundPoint.x - canvas.clientWidth / 2;
        const groundDy = groundPoint.y - canvas.clientHeight / 2;
        const targetOffsetX = -(elevatedDelta.dx - groundDx);
        const targetOffsetY = -(elevatedDelta.dy - groundDy);
        const maxOffset = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.3;
        offsetX = Math.max(
          -maxOffset,
          Math.min(maxOffset, lerp(offsetX, targetOffsetX, offsetAlpha)),
        );
        offsetY = Math.max(
          -maxOffset,
          Math.min(maxOffset, lerp(offsetY, targetOffsetY, offsetAlpha)),
        );
      } else {
        offsetX = lerp(offsetX, 0, offsetAlpha);
        offsetY = lerp(offsetY, 0, offsetAlpha);
      }
      layoutOffsetX = lerp(
        layoutOffsetX,
        layoutOffsetXRef.current,
        layoutOffsetAlpha,
      );

      // A short, overlapping ease absorbs polling/interpolation jitter without
      // queuing camera animations. Reusing the ease id lets MapLibre replace
      // the previous target without emitting a new move lifecycle each frame.
      map.easeTo({
        center: [smoothLng, smoothLat],
        bearing: smoothBearing,
        offset: [offsetX + layoutOffsetX, offsetY],
        duration: Math.max(70, cameraWriteIntervalMs * 2.5),
        easing: (t) => t,
        easeId: FOLLOW_EASE_ID,
        noMoveStart: true,
        essential: false,
      });

      frameId = requestAnimationFrame(track);
    };

    frameId = requestAnimationFrame(track);

    return () => {
      isFollowingRef.current = false;
      if (frameId != null) cancelAnimationFrame(frameId);
      if (approachStageTimer != null) {
        window.clearTimeout(approachStageTimer);
      }
      map.stop();
    };
  }, [
    map,
    isLoaded,
    followFlight?.icao24,
    followFlightRef,
    trackedPositionRef,
    isFollowingRef,
    altitudeDisplayMode,
    performanceProfile.tier,
    approachDurationMs,
    approachZoom,
    approachPitch,
    cameraWriteIntervalMs,
    renderQuality,
  ]);
}
