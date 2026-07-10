"use client";

import { useEffect } from "react";
import { useMap } from "@/atc/components/map/map";

const CHANGE_NOTIFY_INTERVAL_MS = 250;
const CENTER_EPSILON = 0.000001;
const ZOOM_EPSILON = 0.0001;

export type MapViewState = {
  zoom: number;
  center: { lat: number; lng: number };
};

type MapStateTrackerProps = {
  /** Mutable ref updated on every moveend - avoids re-renders. */
  stateRef: React.MutableRefObject<MapViewState>;
  /** Optional callback notified at a bounded rate for React consumers. */
  onChange?: (state: MapViewState) => void;
};

function viewStateChanged(previous: MapViewState | null, next: MapViewState) {
  return (
    previous === null ||
    Math.abs(previous.zoom - next.zoom) > ZOOM_EPSILON ||
    Math.abs(previous.center.lat - next.center.lat) > CENTER_EPSILON ||
    Math.abs(previous.center.lng - next.center.lng) > CENTER_EPSILON
  );
}

/**
 * Invisible component that sits inside <MapView> and tracks zoom + center.
 * Updates a parent-owned ref (zero re-renders) and optionally calls onChange.
 */
export function MapStateTracker({ stateRef, onChange }: MapStateTrackerProps) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;

    let notifyTimer: ReturnType<typeof setTimeout> | null = null;
    let lastNotifiedAt = 0;
    let lastNotifiedState: MapViewState | null = null;

    function notifyLatest() {
      notifyTimer = null;
      const latest = stateRef.current;
      if (!viewStateChanged(lastNotifiedState, latest)) return;

      lastNotifiedAt = performance.now();
      lastNotifiedState = latest;
      onChange?.(latest);
    }

    function scheduleNotification() {
      if (!onChange || notifyTimer !== null) return;

      const elapsed = performance.now() - lastNotifiedAt;
      if (lastNotifiedState === null || elapsed >= CHANGE_NOTIFY_INTERVAL_MS) {
        notifyLatest();
        return;
      }

      notifyTimer = setTimeout(
        notifyLatest,
        CHANGE_NOTIFY_INTERVAL_MS - elapsed,
      );
    }

    function update() {
      if (!map) return;
      const center = map.getCenter();
      const zoom = map.getZoom();
      const next: MapViewState = {
        zoom,
        center: { lat: center.lat, lng: center.lng },
      };
      stateRef.current = next;
      scheduleNotification();
    }

    // Seed initial state
    update();

    map.on("moveend", update);
    map.on("zoomend", update);

    return () => {
      if (notifyTimer !== null) clearTimeout(notifyTimer);
      map.off("moveend", update);
      map.off("zoomend", update);
    };
  }, [map, isLoaded, onChange, stateRef]);

  return null;
}
