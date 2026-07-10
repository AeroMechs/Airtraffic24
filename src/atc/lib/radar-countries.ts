import { AIRPORTS, type Airport } from "@/atc/lib/airports";
import type { City } from "@/atc/lib/cities";

export const WORLD_RADAR_COUNTRY = "WORLD";

export type RadarCountryCoverage = {
  code: string;
  label: string;
  airportCount: number;
  center: { latitude: number; longitude: number };
  radiusNm: number;
  city: City;
};

const PRIORITY_AIRPORTS: Record<string, string[]> = {
  AE: ["DXB", "AUH"],
  AU: ["SYD", "MEL"],
  BR: ["GRU", "GIG"],
  CA: ["YYZ", "YVR"],
  CN: ["PEK", "PVG"],
  DE: ["FRA", "MUC"],
  ES: ["MAD", "BCN"],
  FR: ["CDG", "ORY"],
  GB: ["LHR", "LGW"],
  IN: ["DEL", "BOM", "BLR", "HYD"],
  JP: ["HND", "NRT"],
  SG: ["SIN"],
  US: ["JFK", "ATL", "LAX", "ORD", "DFW"],
};

type CountryAccumulator = {
  code: string;
  airports: Airport[];
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

function countryLabel(code: string) {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

function distanceNm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const radiusNm = 3440.065;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const startLat = (from.latitude * Math.PI) / 180;
  const endLat = (to.latitude * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLon / 2) ** 2;

  return 2 * radiusNm * Math.asin(Math.sqrt(haversine));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function airportScore(airport: Airport, priority: string[]) {
  const priorityIndex = priority.indexOf(airport.iata);
  if (priorityIndex >= 0) return 10_000 - priorityIndex;

  let score = 0;
  if (/^[A-Z]{3}$/.test(airport.iata)) score += 300;
  if (airport.icao) score += 100;
  if (/international/i.test(airport.name)) score += 50;
  if (/airport/i.test(airport.name)) score += 10;
  return score;
}

function representativeAirport(airports: Airport[], code: string) {
  const priority = PRIORITY_AIRPORTS[code] ?? [];
  return [...airports].sort(
    (a, b) => airportScore(b, priority) - airportScore(a, priority),
  )[0];
}

function buildCoverage() {
  const groups = new Map<string, CountryAccumulator>();

  for (const airport of AIRPORTS) {
    const code = airport.country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) continue;
    if (!Number.isFinite(airport.lat) || !Number.isFinite(airport.lng)) {
      continue;
    }

    const current = groups.get(code);
    if (!current) {
      groups.set(code, {
        code,
        airports: [airport],
        minLat: airport.lat,
        maxLat: airport.lat,
        minLng: airport.lng,
        maxLng: airport.lng,
      });
      continue;
    }

    current.airports.push(airport);
    current.minLat = Math.min(current.minLat, airport.lat);
    current.maxLat = Math.max(current.maxLat, airport.lat);
    current.minLng = Math.min(current.minLng, airport.lng);
    current.maxLng = Math.max(current.maxLng, airport.lng);
  }

  return Array.from(groups.values())
    .map((group) => {
      const label = countryLabel(group.code);
      const center = {
        latitude: (group.minLat + group.maxLat) / 2,
        longitude: (group.minLng + group.maxLng) / 2,
      };
      const corners = [
        { latitude: group.minLat, longitude: group.minLng },
        { latitude: group.minLat, longitude: group.maxLng },
        { latitude: group.maxLat, longitude: group.minLng },
        { latitude: group.maxLat, longitude: group.maxLng },
      ];
      const radiusNm = clamp(
        Math.ceil(Math.max(...corners.map((corner) => distanceNm(center, corner))) + 180),
        250,
        3500,
      );
      const airport = representativeAirport(group.airports, group.code);

      return {
        code: group.code,
        label,
        airportCount: group.airports.length,
        center,
        radiusNm,
        city: {
          id: `country-${group.code.toLowerCase()}`,
          name: label,
          country: group.code,
          iata: airport?.iata ?? group.code,
          coordinates: [center.longitude, center.latitude] as [
            longitude: number,
            latitude: number,
          ],
          radius: clamp(radiusNm / 60, 2.5, 24),
        },
      } satisfies RadarCountryCoverage;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const RADAR_COUNTRY_OPTIONS: RadarCountryCoverage[] = buildCoverage();

const RADAR_COUNTRY_BY_CODE = new Map(
  RADAR_COUNTRY_OPTIONS.map((country) => [country.code, country]),
);

export function normalizeRadarCountryCode(code: string | undefined | null) {
  const normalized = code?.trim().toUpperCase();
  if (!normalized || normalized === WORLD_RADAR_COUNTRY) {
    return WORLD_RADAR_COUNTRY;
  }

  return RADAR_COUNTRY_BY_CODE.has(normalized)
    ? normalized
    : WORLD_RADAR_COUNTRY;
}

export function getRadarCountryCoverage(code: string | undefined | null) {
  return RADAR_COUNTRY_BY_CODE.get(normalizeRadarCountryCode(code)) ?? null;
}
