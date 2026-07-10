export const AIRCRAFT_CAMERA_MODES = [
  "rear",
  "front",
  "top",
  "free",
] as const;

export type AircraftCameraMode = (typeof AIRCRAFT_CAMERA_MODES)[number];
