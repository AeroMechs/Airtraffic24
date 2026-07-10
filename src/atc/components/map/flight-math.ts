import type { Snapshot } from "./flight-layer-constants";

// ── Interpolation Math ─────────────────────────────────────────────────

export function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return a + delta * t;
}

export function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Signed shortest-path longitude delta in degrees.
 *
 * Keeping this allocation-free matters because the interpolation and bearing
 * paths call it for every visible aircraft on every animation frame.
 */
export function wrappedLongitudeDelta(
  fromLongitude: number,
  toLongitude: number,
): number {
  return ((toLongitude - fromLongitude + 540) % 360) - 180;
}

/** Interpolate longitude without taking the long way around the globe. */
export function interpolateLongitude(
  fromLongitude: number,
  toLongitude: number,
  t: number,
): number {
  return fromLongitude + wrappedLongitudeDelta(fromLongitude, toLongitude) * t;
}

// ── Distance Helpers ───────────────────────────────────────────────────

export function horizontalDistanceFromLngLat(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number {
  const avgLatRad = ((aLat + bLat) * 0.5 * Math.PI) / 180;
  const metersPerDegLon = 111_320 * Math.max(0, Math.cos(avgLatRad));
  const dx = wrappedLongitudeDelta(aLng, bLng) * metersPerDegLon;
  const dy = (bLat - aLat) * 111_320;
  return Math.hypot(dx, dy);
}

export function horizontalDistanceMeters(a: Snapshot, b: Snapshot): number {
  return horizontalDistanceFromLngLat(a.lng, a.lat, b.lng, b.lat);
}

export function metersPerDegreeLongitude(latitude: number): number {
  return Math.max(111_320 * Math.cos((latitude * Math.PI) / 180), 1);
}

export function offsetPositionByTrack(
  position: { lng: number; lat: number },
  trackDeg: number,
  forwardMeters: number,
): { lng: number; lat: number } {
  const radians = (trackDeg * Math.PI) / 180;
  return {
    lng:
      position.lng +
      (Math.sin(radians) * forwardMeters) /
        metersPerDegreeLongitude(position.lat),
    lat: position.lat + (Math.cos(radians) * forwardMeters) / 111_320,
  };
}
