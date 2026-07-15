"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import type { FlightState } from "@/atc/lib/opensky";
import { altitudeToColor } from "@/atc/lib/flight-utils";
import { type PickingInfo } from "@deck.gl/core";
import type { TrailEntry } from "@/atc/hooks/use-trail-history";
import {
  densifyGreatCircle2D,
  splitAtAntimeridian,
  unwrapLngPath,
} from "@/atc/lib/geo";
import {
  GLOBE_FADE_ZOOM_CEIL,
  GLOBE_FADE_ZOOM_FLOOR,
  GEOJSON_THROTTLE_MS,
  GEOJSON_DEBOUNCE_MS,
} from "./flight-layer-constants";
import { createAircraftAtlas } from "./aircraft-appearance";

const SOURCE_ID = "globe-aircraft-source";
const SYMBOL_LAYER_ID = "globe-aircraft-symbols";
const HIT_LAYER_ID = "globe-aircraft-hit-targets";
const TRAIL_SOURCE_ID = "globe-trail-source";
const TRAIL_LAYER_ID = "globe-trail-lines";
const AIRCRAFT_ATLAS_SIZE = 128;
const iconScale = (pixels: number) => pixels / AIRCRAFT_ATLAS_SIZE;

const UNKNOWN_ALTITUDE_IMAGE_ID = "globe-aircraft-altitude-unknown";
const ALTITUDE_IMAGE_BANDS = [
  { id: "globe-aircraft-altitude-ground", maxMeters: 100, sampleMeters: 0 },
  { id: "globe-aircraft-altitude-very-low", maxMeters: 500, sampleMeters: 250 },
  { id: "globe-aircraft-altitude-low", maxMeters: 1_200, sampleMeters: 800 },
  { id: "globe-aircraft-altitude-low-mid", maxMeters: 2_500, sampleMeters: 1_800 },
  { id: "globe-aircraft-altitude-mid", maxMeters: 4_000, sampleMeters: 3_200 },
  { id: "globe-aircraft-altitude-mid-high", maxMeters: 6_000, sampleMeters: 5_000 },
  { id: "globe-aircraft-altitude-high", maxMeters: 8_500, sampleMeters: 7_250 },
  { id: "globe-aircraft-altitude-higher", maxMeters: 10_500, sampleMeters: 9_500 },
  { id: "globe-aircraft-altitude-cruise", maxMeters: Infinity, sampleMeters: 12_000 },
] as const;

const ALTITUDE_IMAGE_IDS = [
  UNKNOWN_ALTITUDE_IMAGE_ID,
  ...ALTITUDE_IMAGE_BANDS.map(({ id }) => id),
];

function altitudeImageId(altitudeMeters: number | null): string {
  if (altitudeMeters === null || !Number.isFinite(altitudeMeters)) {
    return UNKNOWN_ALTITUDE_IMAGE_ID;
  }

  return (
    ALTITUDE_IMAGE_BANDS.find(
      ({ maxMeters }) => altitudeMeters <= maxMeters,
    )?.id ?? ALTITUDE_IMAGE_BANDS[ALTITUDE_IMAGE_BANDS.length - 1].id
  );
}

/** Build a colored raster icon with a restrained edge for map contrast. */
function createAltitudeAircraftImage(
  aircraftAtlas: HTMLCanvasElement,
  color: readonly [number, number, number],
): ImageData | null {
  const size = aircraftAtlas.width;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = size;
  maskCanvas.height = size;
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) return null;

  maskContext.drawImage(aircraftAtlas, 0, 0);
  maskContext.globalCompositeOperation = "source-in";
  maskContext.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  maskContext.fillRect(0, 0, size, size);
  maskContext.globalCompositeOperation = "source-over";

  const outlineCanvas = document.createElement("canvas");
  outlineCanvas.width = size;
  outlineCanvas.height = size;
  const outlineContext = outlineCanvas.getContext("2d");
  if (!outlineContext) return null;

  outlineContext.drawImage(aircraftAtlas, 0, 0);
  outlineContext.globalCompositeOperation = "source-in";
  outlineContext.fillStyle = "rgba(5, 10, 18, 0.92)";
  outlineContext.fillRect(0, 0, size, size);
  outlineContext.globalCompositeOperation = "source-over";

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  for (const [x, y] of [
    [-5, 0],
    [5, 0],
    [0, -5],
    [0, 5],
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ]) {
    context.drawImage(outlineCanvas, x, y);
  }
  context.drawImage(maskCanvas, 0, 0);

  return context.getImageData(0, 0, size, size);
}

/**
 * Custom hook that manages native MapLibre GeoJSON aircraft and trail layers
 * at overview zoom levels. A single symbol layer draws heading-aware,
 * altitude-colored silhouettes, keeping thousands of aircraft cheap in both
 * Mercator and globe projection while preserving globe curvature and
 * antimeridian handling.
 */
export function useGlobeDots(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  flightsRef: MutableRefObject<FlightState[]>,
  trailsRef: MutableRefObject<TrailEntry[]>,
  dataTimestampRef: MutableRefObject<number>,
  onClickRef: MutableRefObject<(info: PickingInfo<FlightState> | null) => void>,
  showTrailsRef: MutableRefObject<boolean>,
) {
  const lastGeoJsonUpdateRef = useRef(0);
  const lastGeoJsonTimestampRef = useRef(0);
  const geoJsonClearedRef = useRef(false);
  const globeZoomEnteredAtRef = useRef(0);
  // Cache last visibility state to avoid calling setLayoutProperty every frame
  const lastDotsVisibleRef = useRef<boolean | null>(null);

  // Set up MapLibre source, layer, and event handlers
  useEffect(() => {
    if (!map || !isLoaded) return;

    const ensureGlobeLayers = () => {
      // ── Aircraft symbols ──
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }

      const aircraftAtlas = createAircraftAtlas();
      const palette = [
        {
          id: UNKNOWN_ALTITUDE_IMAGE_ID,
          color: [132, 145, 160] as const,
        },
        ...ALTITUDE_IMAGE_BANDS.map(({ id, sampleMeters }) => ({
          id,
          color: altitudeToColor(sampleMeters).slice(0, 3) as [
            number,
            number,
            number,
          ],
        })),
      ];

      for (const { id, color } of palette) {
        if (map.hasImage(id)) continue;
        const image = createAltitudeAircraftImage(aircraftAtlas, color);
        if (image) map.addImage(id, image);
      }

      if (
        !map.getLayer(SYMBOL_LAYER_ID) &&
        map.hasImage(UNKNOWN_ALTITUDE_IMAGE_ID)
      ) {
        map.addLayer({
          id: SYMBOL_LAYER_ID,
          type: "symbol",
          source: SOURCE_ID,
          layout: {
            "symbol-placement": "point",
            "icon-image": ["get", "altitude_image"],
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              iconScale(9),
              2,
              iconScale(12),
              GLOBE_FADE_ZOOM_CEIL,
              iconScale(16),
            ],
            "icon-rotate": ["coalesce", ["get", "track"], 0],
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              GLOBE_FADE_ZOOM_FLOOR,
              1,
              GLOBE_FADE_ZOOM_CEIL,
              0,
            ],
          },
        });
      }

      // Keep the small overview silhouettes easy to select without adding a
      // visible dot or halo behind them.
      if (!map.getLayer(HIT_LAYER_ID)) {
        map.addLayer({
          id: HIT_LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              8,
              GLOBE_FADE_ZOOM_CEIL,
              12,
            ],
            "circle-opacity": 0,
            "circle-stroke-opacity": 0,
          },
        });
      }

      // ── Trail lines ──
      if (!map.getSource(TRAIL_SOURCE_ID)) {
        map.addSource(TRAIL_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }

      if (!map.getLayer(TRAIL_LAYER_ID)) {
        map.addLayer(
          {
            id: TRAIL_LAYER_ID,
            type: "line",
            source: TRAIL_SOURCE_ID,
            paint: {
              "line-color": ["get", "color"],
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0,
                0.8,
                2,
                1.2,
                GLOBE_FADE_ZOOM_CEIL,
                1.8,
              ],
              "line-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                GLOBE_FADE_ZOOM_FLOOR,
                0.65,
                GLOBE_FADE_ZOOM_CEIL,
                0,
              ],
            },
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
          },
          SYMBOL_LAYER_ID, // render trails below aircraft
        );
      }
    };

    ensureGlobeLayers();
    map.on("style.load", ensureGlobeLayers);

    const onDotClick = (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.GeoJSONFeature[] },
    ) => {
      const icao24 = e.features?.[0]?.properties?.icao24;
      if (!icao24) return;
      const flight = flightsRef.current.find((f) => f.icao24 === icao24);
      if (flight) {
        onClickRef.current({ object: flight } as PickingInfo<FlightState>);
      }
    };
    map.on("click", HIT_LAYER_ID, onDotClick);

    const onDotEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onDotLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("mouseenter", HIT_LAYER_ID, onDotEnter);
    map.on("mouseleave", HIT_LAYER_ID, onDotLeave);

    return () => {
      map.off("style.load", ensureGlobeLayers);
      map.off("click", HIT_LAYER_ID, onDotClick);
      map.off("mouseenter", HIT_LAYER_ID, onDotEnter);
      map.off("mouseleave", HIT_LAYER_ID, onDotLeave);
      try {
        if (map.getLayer(TRAIL_LAYER_ID)) map.removeLayer(TRAIL_LAYER_ID);
        if (map.getSource(TRAIL_SOURCE_ID)) map.removeSource(TRAIL_SOURCE_ID);
        if (map.getLayer(HIT_LAYER_ID)) map.removeLayer(HIT_LAYER_ID);
        if (map.getLayer(SYMBOL_LAYER_ID)) map.removeLayer(SYMBOL_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        for (const imageId of ALTITUDE_IMAGE_IDS) {
          if (map.hasImage(imageId)) map.removeImage(imageId);
        }
      } catch {
        /* map already removed */
      }
    };
  }, [map, isLoaded, flightsRef, onClickRef]);

  /**
   * Called from the RAF animation loop. Updates (or clears) both the aircraft
   * GeoJSON source and the trail line GeoJSON source based on current
   * zoom level and overview mode.
   */
  function updateGlobeDots(
    overviewEnabled: boolean,
    currentZoom: number,
    now: number,
  ) {
    if (!map) return;

    const dotsVisible =
      overviewEnabled && currentZoom <= GLOBE_FADE_ZOOM_CEIL;
    // Only call setLayoutProperty when visibility actually changes
    if (dotsVisible !== lastDotsVisibleRef.current) {
      lastDotsVisibleRef.current = dotsVisible;
      try {
        if (map.getLayer(SYMBOL_LAYER_ID)) {
          map.setLayoutProperty(
            SYMBOL_LAYER_ID,
            "visibility",
            dotsVisible ? "visible" : "none",
          );
        }
        if (map.getLayer(HIT_LAYER_ID)) {
          map.setLayoutProperty(
            HIT_LAYER_ID,
            "visibility",
            dotsVisible ? "visible" : "none",
          );
        }
        if (map.getLayer(TRAIL_LAYER_ID)) {
          map.setLayoutProperty(
            TRAIL_LAYER_ID,
            "visibility",
            dotsVisible ? "visible" : "none",
          );
        }
      } catch {
        /* layer may not exist yet */
      }
    }

    if (overviewEnabled) {
      if (currentZoom <= GLOBE_FADE_ZOOM_CEIL) {
        if (globeZoomEnteredAtRef.current === 0) {
          globeZoomEnteredAtRef.current = now;
        }
        const stableMs = now - globeZoomEnteredAtRef.current;

        if (stableMs >= GEOJSON_DEBOUNCE_MS) {
          const dataChanged =
            dataTimestampRef.current !== lastGeoJsonTimestampRef.current;
          const throttleExpired =
            now - lastGeoJsonUpdateRef.current > GEOJSON_THROTTLE_MS;

          if (dataChanged || throttleExpired) {
            // ── Update aircraft symbols ──
            const dotSrc = map.getSource(SOURCE_ID) as
              | maplibregl.GeoJSONSource
              | undefined;
            if (dotSrc) {
              const flights = flightsRef.current;
              const features = [];
              for (const f of flights) {
                if (
                  f.longitude == null ||
                  f.latitude == null ||
                  !Number.isFinite(f.longitude) ||
                  !Number.isFinite(f.latitude)
                )
                  continue;
                features.push({
                  type: "Feature" as const,
                  geometry: {
                    type: "Point" as const,
                    coordinates: [f.longitude, f.latitude],
                  },
                  properties: {
                    icao24: f.icao24,
                    altitude_image: altitudeImageId(f.baroAltitude),
                    track: Number.isFinite(f.trueTrack) ? f.trueTrack : 0,
                  },
                });
              }
              dotSrc.setData({ type: "FeatureCollection", features });
            }

            // ── Update trail lines ──
            const trailSrc = map.getSource(TRAIL_SOURCE_ID) as
              | maplibregl.GeoJSONSource
              | undefined;
            if (trailSrc) {
              // Respect the showTrails user setting
              if (!showTrailsRef.current) {
                trailSrc.setData({ type: "FeatureCollection", features: [] });
              } else {
                const trails = trailsRef.current;
                const trailFeatures: GeoJSON.Feature[] = [];

                for (const trail of trails) {
                  if (trail.path.length < 2) continue;

                  // Get the trail color from the most recent altitude
                  const lastAlt =
                    trail.baroAltitude ??
                    trail.altitudes[trail.altitudes.length - 1] ??
                    0;
                  const c = altitudeToColor(lastAlt);
                  const color = `rgba(${c[0]},${c[1]},${c[2]},0.7)`;

                  // Limit to last N points for performance at globe zoom
                  const maxPts = 60;
                  const rawPath =
                    trail.path.length > maxPts
                      ? trail.path.slice(trail.path.length - maxPts)
                      : trail.path;

                  // Unwrap longitudes for continuity
                  const unwrapped = unwrapLngPath(rawPath);

                  // Densify along great-circle arcs so trails curve
                  // properly on the globe (segments > 0.3° get subdivided)
                  const densified = densifyGreatCircle2D(unwrapped, 0.3, 16);

                  // Normalize longitudes back to [-180, 180] range
                  const normalized: [number, number][] = densified.map(
                    ([lng, lat]) => {
                      let normLng = lng;
                      while (normLng > 180) normLng -= 360;
                      while (normLng < -180) normLng += 360;
                      return [normLng, lat];
                    },
                  );

                  // Split at antimeridian crossings for MapLibre
                  const segments = splitAtAntimeridian(normalized);

                  for (const seg of segments) {
                    if (seg.length < 2) continue;
                    trailFeatures.push({
                      type: "Feature",
                      geometry: {
                        type: "LineString",
                        coordinates: seg,
                      },
                      properties: { color, icao24: trail.icao24 },
                    });
                  }
                }

                trailSrc.setData({
                  type: "FeatureCollection",
                  features: trailFeatures,
                });
              } // end showTrails check
            }

            lastGeoJsonUpdateRef.current = now;
            lastGeoJsonTimestampRef.current = dataTimestampRef.current;
            geoJsonClearedRef.current = false;
          }
        }
      } else {
        globeZoomEnteredAtRef.current = 0;
        if (!geoJsonClearedRef.current) {
          clearNativeSources();
        }
      }
    } else if (!geoJsonClearedRef.current) {
      clearNativeSources();
    }
  }

  function clearNativeSources() {
    if (!map) return;
    try {
      const dotSrc = map.getSource(SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (dotSrc) {
        dotSrc.setData({ type: "FeatureCollection", features: [] });
      }
      const trailSrc = map.getSource(TRAIL_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (trailSrc) {
        trailSrc.setData({ type: "FeatureCollection", features: [] });
      }
      geoJsonClearedRef.current = true;
    } catch {
      /* source may be removed */
    }
  }

  return { updateGlobeDots };
}
