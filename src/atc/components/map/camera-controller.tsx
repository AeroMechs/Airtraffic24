"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useMap } from "./map";
import { smoothstep } from "./camera-controller-utils";
import { useSettings } from "@/atc/hooks/use-settings";
import type { City } from "@/atc/lib/cities";
import type { FlightState } from "@/atc/lib/opensky";
import type { AircraftCameraMode } from "@/atc/lib/aircraft-camera-mode";
import { useFpvCamera } from "./use-fpv-camera";
import {
  useFollowCamera,
  type TrackedAircraftPosition,
} from "./use-follow-camera";
import { useKeyboardCamera } from "./use-keyboard-camera";
import { useOrbitCamera } from "./use-orbit-camera";

const DEFAULT_ZOOM = 9.2;
const DEFAULT_PITCH = 49;
const DEFAULT_BEARING = 27.4;
export function CameraController({
  city,
  cityZoom = DEFAULT_ZOOM,
  followFlight = null,
  fpvFlight = null,
  fpvCameraMode = "rear",
  fpvPositionRef,
  panelOpen = false,
}: {
  city: City;
  cityZoom?: number;
  followFlight?: FlightState | null;
  fpvFlight?: FlightState | null;
  fpvCameraMode?: AircraftCameraMode;
  fpvPositionRef?: MutableRefObject<TrackedAircraftPosition | null>;
  panelOpen?: boolean;
}) {
  const { map, isLoaded } = useMap();
  const { settings } = useSettings();
  const prevCityRef = useRef<string | null>(null);
  const prevFpvRef = useRef<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbitFrameRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);
  const isFollowingRef = useRef(false);
  const isFpvActiveRef = useRef(false);
  const followFlightRef = useRef<FlightState | null>(followFlight);
  const fpvFlightRef = useRef<FlightState | null>(fpvFlight);
  const fpvPosRef = useRef(fpvPositionRef);
  const followFlightKey = followFlight?.icao24 ?? null;
  const fpvFlightKey = fpvFlight?.icao24 ?? null;

  useEffect(() => {
    fpvPosRef.current = fpvPositionRef;
  }, [fpvPositionRef]);

  useEffect(() => {
    followFlightRef.current = followFlight;
  }, [followFlight]);

  useEffect(() => {
    fpvFlightRef.current = fpvFlight;
  }, [fpvFlight]);

  // City flyTo
  useEffect(() => {
    if (!map || !isLoaded || !city) return;
    const cityViewKey = `${city.id}:${cityZoom.toFixed(2)}`;
    if (followFlightKey || fpvFlightKey) {
      // Record the requested city without starting a second transition while
      // an aircraft camera owns the map.
      prevCityRef.current = cityViewKey;
      return;
    }
    if (cityViewKey === prevCityRef.current) return;

    prevCityRef.current = cityViewKey;
    map.flyTo({
      center: city.coordinates,
      zoom: cityZoom,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      duration: 2800,
      essential: true,
    });
  }, [
    map,
    isLoaded,
    city,
    cityZoom,
    followFlightKey,
    fpvFlightKey,
  ]);

  // The regular selected-aircraft camera follows the exact interpolated
  // renderer position through one RAF loop. This avoids chasing feed samples.
  useFollowCamera(
    map,
    isLoaded,
    followFlight,
    followFlightRef,
    fpvPosRef,
    isFollowingRef,
    settings.altitudeDisplayMode,
    panelOpen,
    settings.renderQuality,
  );

  // FPV camera hook
  useFpvCamera(
    map,
    isLoaded,
    fpvFlight,
    city,
    fpvFlightRef,
    fpvPosRef,
    isFpvActiveRef,
    prevFpvRef,
    fpvCameraMode,
    settings.altitudeDisplayMode,
  );

  // North-up & reset-view
  useEffect(() => {
    if (!map || !isLoaded || !city) return;

    let northUpRafId: number | undefined;

    const onNorthUp = () => {
      if (isFpvActiveRef.current || isFollowingRef.current) return;
      if (northUpRafId != null) cancelAnimationFrame(northUpRafId);
      if (!map) return;
      const m = map;

      // Stop any in-progress flyTo/easeTo (e.g. city transition, follow
      // init) so this RAF setBearing() loop won't fight a parallel
      // camera animation - which causes visible oscillation.
      m.stop();

      const startBearing = m.getBearing();
      const delta = ((0 - startBearing + 540) % 360) - 180;
      if (Math.abs(delta) < 0.5) {
        m.setBearing(0);
        return;
      }
      const duration = 650;
      const start = performance.now();
      function animateBearing() {
        const t = Math.min((performance.now() - start) / duration, 1);
        const eased = smoothstep(t);
        m.setBearing(startBearing + delta * eased);
        if (t < 1) {
          northUpRafId = requestAnimationFrame(animateBearing);
        } else {
          northUpRafId = undefined;
        }
      }
      northUpRafId = requestAnimationFrame(animateBearing);
    };

    const onResetView = (event: Event) => {
      if (isFpvActiveRef.current || isFollowingRef.current) return;
      const customEvent = event as CustomEvent<{ center?: [number, number] }>;
      const center = customEvent.detail?.center ?? city.coordinates;
      map.flyTo({
        center,
        zoom: cityZoom,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        duration: 1200,
        essential: true,
      });
    };

    window.addEventListener("atc:north-up", onNorthUp);
    window.addEventListener("atc:reset-view", onResetView);

    return () => {
      if (northUpRafId != null) cancelAnimationFrame(northUpRafId);
      window.removeEventListener("atc:north-up", onNorthUp);
      window.removeEventListener("atc:reset-view", onResetView);
    };
  }, [map, isLoaded, city, cityZoom]);

  // Keyboard camera hook
  useKeyboardCamera(
    map,
    isLoaded,
    isFpvActiveRef,
    isInteractingRef,
    idleTimerRef,
  );

  // Auto-orbit hook
  useOrbitCamera(
    map,
    isLoaded,
    city,
    followFlight,
    fpvFlight,
    settings,
    isInteractingRef,
    orbitFrameRef,
    idleTimerRef,
  );

  return null;
}
