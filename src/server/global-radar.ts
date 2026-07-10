import {
  fetchFromRadar,
  type FlightRadar24Aircraft,
  type FlightRadar24Options,
} from "flightradar24-client";

import { lookupAirline } from "@/atc/lib/airlines";

export type RadarMode = "global" | "nearby";

export const MAX_GLOBAL_RADAR_FLIGHTS = 8_000;
export const MAX_NEARBY_RADAR_FLIGHTS = 5_000;

export type RadarFlight = {
  id: string;
  icao24?: string;
  flightNumber: string;
  callsign: string;
  airline: string;
  origin: string;
  destination: string;
  route: string;
  latitude: number;
  longitude: number;
  altitudeFt: number;
  speedKt: number;
  headingDeg: number;
  verticalRateFpm: number;
  status: string;
  aircraftType: string;
  tailNumber: string;
  source: "FlightRadar24 live";
  lastContact: string;
  onGround: boolean;
  isGlider: boolean;
};

export type RadarSnapshot = {
  mode: RadarMode;
  generatedAt: string;
  source:
    | "FlightRadar24 live"
    | "FlightRadar24 cached"
    | "FlightRadar24 partial live";
  sourceDetail: string;
  center: { latitude: number; longitude: number; label: string };
  flights: RadarFlight[];
  totals: {
    tracked: number;
    airborne: number;
    onGround: number;
  };
  provider: {
    name: string;
    status: "Live" | "Degraded";
    detail: string;
  };
};

type RadarQuery = {
  limit: number;
  center?: { latitude: number; longitude: number };
  radiusNm?: number;
};

type RadarTile = {
  id: string;
  north: number;
  west: number;
  south: number;
  east: number;
  presets: RadarPreset[];
  minUsefulRows?: number;
};

type RadarPreset = "default" | "noFaa" | "adsbOnly" | "allTraffic";

type CacheEntry = {
  expiresAt: number;
  staleUntil: number;
  generatedAt: string;
  flights: RadarFlight[];
};

type CachedResult = {
  flights: RadarFlight[];
  generatedAt: string;
  stale: boolean;
  partial?: boolean;
};

type FetchResult = {
  flights: RadarFlight[];
  complete: boolean;
};

const DEFAULT_CENTER = { latitude: 24, longitude: 18, label: "Global" };
const GLOBAL_LIMIT = MAX_GLOBAL_RADAR_FLIGHTS;
const NEARBY_LIMIT = 1_000;
const CACHE_TTL_MS = 30_000;
const STALE_TTL_MS = 5 * 60_000;
const TILE_TIMEOUT_MS = 7_000;
const REQUEST_BUDGET_MS = 45_000;
const TILE_CONCURRENCY = 2;
const TILE_MIN_USEFUL_ROWS = 120;
const MAX_CACHE_ENTRIES = 64;

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<CachedResult>>();

class RadarTileTimeoutError extends Error {
  constructor() {
    super("Radar tile timeout");
    this.name = "RadarTileTimeoutError";
  }
}

function readCacheEntry(key: string) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function writeCacheEntry(key: string, entry: CacheEntry) {
  cache.delete(key);
  cache.set(key, entry);

  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

const PRESETS = {
  default: {
    estimatedPositions: true,
  },
  noFaa: {
    FAA: false,
    FLARM: true,
    MLAT: true,
    ADSB: true,
    estimatedPositions: true,
  },
  adsbOnly: {
    FAA: false,
    FLARM: false,
    MLAT: false,
    ADSB: true,
    estimatedPositions: true,
  },
  allTraffic: {
    FAA: true,
    FLARM: true,
    MLAT: true,
    ADSB: true,
    inAir: true,
    onGround: true,
    inactive: false,
    gliders: false,
    estimatedPositions: true,
  },
} satisfies Record<RadarPreset, FlightRadar24Options>;

const GLOBAL_TILES: RadarTile[] = [
  {
    id: "world",
    north: 89,
    west: -180,
    south: -89,
    east: 180,
    presets: ["default"],
    minUsefulRows: 500,
  },
  {
    id: "north-america-west",
    north: 72,
    west: -170,
    south: 5,
    east: -105,
    presets: ["adsbOnly", "default", "noFaa"],
  },
  {
    id: "north-america-east",
    north: 72,
    west: -105,
    south: 5,
    east: -50,
    presets: ["adsbOnly", "noFaa", "default"],
  },
  {
    id: "europe-west",
    north: 72,
    west: -25,
    south: 30,
    east: 10,
    presets: ["default", "noFaa", "adsbOnly"],
  },
  {
    id: "europe-east",
    north: 72,
    west: 10,
    south: 30,
    east: 45,
    presets: ["noFaa", "default", "adsbOnly"],
  },
  {
    id: "india",
    north: 38,
    west: 66,
    south: 5,
    east: 100,
    presets: ["adsbOnly", "default", "allTraffic"],
  },
  {
    id: "southeast-asia",
    north: 25,
    west: 90,
    south: -10,
    east: 145,
    presets: ["adsbOnly", "default", "noFaa"],
  },
  {
    id: "middle-east",
    north: 45,
    west: 30,
    south: 5,
    east: 66,
    presets: ["noFaa", "default", "adsbOnly"],
  },
  {
    id: "africa",
    north: 35,
    west: -20,
    south: -35,
    east: 55,
    presets: ["adsbOnly", "default", "noFaa"],
  },
  {
    id: "south-america",
    north: 15,
    west: -85,
    south: -58,
    east: -30,
    presets: ["adsbOnly", "default", "noFaa"],
  },
  {
    id: "oceania",
    north: -5,
    west: 110,
    south: -50,
    east: 180,
    presets: ["adsbOnly", "noFaa", "default"],
  },
];

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

function cacheKey({ limit, center, radiusNm }: RadarQuery) {
  if (!center || !radiusNm) return `global:v1:${limit}`;
  return [
    "nearby:v1",
    limit,
    center.latitude.toFixed(2),
    center.longitude.toFixed(2),
    Math.round(radiusNm),
  ].join(":");
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function boundsFromCenter(
  center: { latitude: number; longitude: number },
  radiusNm: number,
) {
  const latRadius = radiusNm / 60;
  const lonRadius =
    radiusNm /
    (60 * Math.max(0.2, Math.cos((center.latitude * Math.PI) / 180)));

  return {
    north: clamp(center.latitude + latRadius, -85, 85),
    west: clamp(center.longitude - lonRadius, -180, 180),
    south: clamp(center.latitude - latRadius, -85, 85),
    east: clamp(center.longitude + lonRadius, -180, 180),
  };
}

function tileContains(
  tile: RadarTile,
  center: { latitude: number; longitude: number },
) {
  return (
    center.latitude <= tile.north &&
    center.latitude >= tile.south &&
    center.longitude >= tile.west &&
    center.longitude <= tile.east
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new RadarTileTimeoutError()), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      runWorker,
    ),
  );
  return results;
}

function toRadarFlight(
  aircraft: FlightRadar24Aircraft,
  index: number,
  tileId: string,
): RadarFlight | null {
  if (
    !Number.isFinite(aircraft.latitude) ||
    !Number.isFinite(aircraft.longitude)
  ) {
    return null;
  }

  const flightNumber =
    aircraft.flight || aircraft.callsign || `LIVE${index + 1}`;
  const callsign = aircraft.callsign || flightNumber.replace(/\s+/g, "");
  const origin = aircraft.origin || "---";
  const destination = aircraft.destination || "---";
  const lastContact =
    typeof aircraft.timestamp === "number" &&
    Number.isFinite(aircraft.timestamp)
      ? new Date(aircraft.timestamp * 1_000).toISOString()
      : new Date().toISOString();

  return {
    id: `fr24-${aircraft.modeSCode || aircraft.id || callsign}-${tileId}-${index}`,
    icao24: aircraft.modeSCode?.toLowerCase(),
    flightNumber,
    callsign,
    airline: lookupAirline(callsign) ?? "Live operator",
    origin,
    destination,
    route:
      origin !== "---" || destination !== "---"
        ? `${origin}-${destination}`
        : "Live aircraft track",
    latitude: aircraft.latitude,
    longitude: aircraft.longitude,
    altitudeFt: Number.isFinite(aircraft.altitude) ? aircraft.altitude : 0,
    speedKt:
      typeof aircraft.speed === "number" && Number.isFinite(aircraft.speed)
        ? aircraft.speed
        : 0,
    headingDeg: Number.isFinite(aircraft.bearing) ? aircraft.bearing : 0,
    verticalRateFpm:
      typeof aircraft.rateOfClimb === "number" &&
      Number.isFinite(aircraft.rateOfClimb)
        ? aircraft.rateOfClimb
        : 0,
    status: aircraft.isOnGround ? "On ground" : "Airborne",
    aircraftType: aircraft.model || "ADS-B",
    tailNumber: aircraft.registration ?? "-",
    source: "FlightRadar24 live",
    lastContact,
    onGround: aircraft.isOnGround,
    isGlider: aircraft.isGlider,
  };
}

function dedupe(flights: RadarFlight[]) {
  const seen = new Set<string>();
  const result: RadarFlight[] = [];

  for (const flight of flights) {
    const key = (
      flight.icao24 ||
      flight.callsign ||
      `${flight.latitude.toFixed(3)}:${flight.longitude.toFixed(3)}`
    ).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(flight);
  }

  return result;
}

async function fetchTile(
  tile: RadarTile,
  deadlineAt: number,
): Promise<FetchResult> {
  const collected: RadarFlight[] = [];
  const minUsefulRows = tile.minUsefulRows ?? TILE_MIN_USEFUL_ROWS;
  let complete = true;
  let receivedResponse = false;

  for (const preset of tile.presets) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      complete = false;
      break;
    }

    try {
      const aircraft = await withTimeout(
        fetchFromRadar(
          tile.north,
          tile.west,
          tile.south,
          tile.east,
          undefined,
          PRESETS[preset],
        ),
        Math.min(TILE_TIMEOUT_MS, remainingMs),
      );
      receivedResponse = true;
      const flights = aircraft
        .map((item, index) =>
          toRadarFlight(item, index, `${tile.id}:${preset}`),
        )
        .filter((item): item is RadarFlight => Boolean(item));

      collected.push(...flights);
      if (flights.length >= minUsefulRows) break;
    } catch (error) {
      if (error instanceof RadarTileTimeoutError || Date.now() >= deadlineAt) {
        complete = false;
        // The provider client cannot abort its underlying request. Do not
        // start more preset requests for this tile while the timed-out one
        // is still winding down.
        break;
      }
      continue;
    }
  }

  return {
    flights: dedupe(collected),
    complete: complete && receivedResponse,
  };
}

async function fetchUncached({
  limit,
  center,
  radiusNm,
}: RadarQuery): Promise<FetchResult> {
  const deadlineAt = Date.now() + REQUEST_BUDGET_MS;

  if (center && radiusNm) {
    const nearbyTile: RadarTile = {
      id: "nearby",
      ...boundsFromCenter(center, radiusNm),
      presets: ["adsbOnly", "noFaa", "default", "allTraffic"],
      minUsefulRows: 20,
    };
    const directResult = await fetchTile(nearbyTile, deadlineAt);
    const direct = directResult.flights.filter(
      (flight) => distanceNm(center, flight) <= radiusNm,
    );

    if (direct.length >= 20) {
      return {
        flights: dedupe(direct).slice(0, limit),
        complete: directResult.complete,
      };
    }

    const regionalTiles = GLOBAL_TILES.filter(
      (tile) => tile.id !== "world" && tileContains(tile, center),
    ).slice(0, 2);
    const regional = await runWithConcurrency(
      regionalTiles,
      2,
      async (tile) =>
        fetchTile({ ...tile, minUsefulRows: 40 }, deadlineAt),
    );
    return {
      flights: dedupe([
        ...direct,
        ...regional.flatMap((result) => result.flights),
      ])
        .filter((flight) => distanceNm(center, flight) <= radiusNm)
        .slice(0, limit),
      complete:
        directResult.complete && regional.every((result) => result.complete),
    };
  }

  const tileResults = await runWithConcurrency(
    GLOBAL_TILES,
    TILE_CONCURRENCY,
    async (tile) => fetchTile(tile, deadlineAt),
  );
  return {
    flights: dedupe(tileResults.flatMap((result) => result.flights)).slice(
      0,
      limit,
    ),
    complete: tileResults.every((result) => result.complete),
  };
}

async function fetchRadarFlights(query: RadarQuery): Promise<CachedResult> {
  const key = cacheKey(query);
  const now = Date.now();
  const cached = readCacheEntry(key);

  if (cached && cached.expiresAt > now) {
    return {
      flights: cached.flights,
      generatedAt: cached.generatedAt,
      stale: false,
    };
  }

  const inflight = pending.get(key);
  if (inflight) return inflight;

  const request = fetchUncached(query)
    .then((result) => {
      const generatedAt = new Date().toISOString();
      if (result.complete && result.flights.length > 0) {
        writeCacheEntry(key, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          staleUntil: Date.now() + STALE_TTL_MS,
          generatedAt,
          flights: result.flights,
        });
        return { flights: result.flights, generatedAt, stale: false };
      }

      if (cached && cached.staleUntil > Date.now()) {
        return {
          flights: cached.flights,
          generatedAt: cached.generatedAt,
          stale: true,
        };
      }

      return {
        flights: result.flights,
        generatedAt,
        stale: true,
        partial: result.flights.length > 0 && !result.complete,
      };
    })
    .catch(() => {
      if (cached && cached.staleUntil > Date.now()) {
        return {
          flights: cached.flights,
          generatedAt: cached.generatedAt,
          stale: true,
        };
      }
      return {
        flights: [],
        generatedAt: new Date().toISOString(),
        stale: true,
      };
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

export async function getGlobalRadarSnapshot({
  mode,
  latitude = DEFAULT_CENTER.latitude,
  longitude = DEFAULT_CENTER.longitude,
  radiusNm = 250,
  limit,
}: {
  mode: RadarMode;
  latitude?: number;
  longitude?: number;
  radiusNm?: number;
  limit?: number;
}): Promise<RadarSnapshot> {
  const isNearby = mode === "nearby";
  const effectiveLimit = isNearby
    ? Math.min(
        Math.max(limit ?? NEARBY_LIMIT, 25),
        MAX_NEARBY_RADAR_FLIGHTS,
      )
    : Math.min(
        Math.max(limit ?? GLOBAL_LIMIT, 250),
        MAX_GLOBAL_RADAR_FLIGHTS,
      );
  const center = isNearby
    ? { latitude, longitude, label: "Nearby" }
    : DEFAULT_CENTER;
  const result = await fetchRadarFlights({
    limit: effectiveLimit,
    center: isNearby ? center : undefined,
    radiusNm: isNearby ? radiusNm : undefined,
  });
  const source = result.partial
    ? "FlightRadar24 partial live"
    : result.stale
      ? "FlightRadar24 cached"
      : "FlightRadar24 live";
  const status = result.stale ? "Degraded" : "Live";
  const detail = result.partial
    ? "The live provider deadline was reached; showing the available real positions without replacing the latest complete cache."
    : result.stale
    ? result.flights.length > 0
      ? "The live provider is temporarily unavailable; showing the latest real cached positions."
      : "The live provider is temporarily unavailable. No synthetic aircraft are displayed."
    : isNearby
      ? `Live aircraft positions within ${radiusNm} NM of the selected location.`
      : "Worldwide live aircraft positions assembled from cached regional radar tiles.";

  return {
    mode,
    generatedAt: result.generatedAt,
    source,
    sourceDetail: detail,
    center,
    flights: result.flights,
    totals: {
      tracked: result.flights.length,
      airborne: result.flights.filter((flight) => !flight.onGround).length,
      onGround: result.flights.filter((flight) => flight.onGround).length,
    },
    provider: {
      name: result.partial
        ? "FlightRadar24 partial live feed"
        : result.stale
          ? "FlightRadar24 cached feed"
          : "FlightRadar24 live feed",
      status,
      detail,
    },
  };
}
