import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  getGlobalRadarSnapshot,
  MAX_GLOBAL_RADAR_FLIGHTS,
  MAX_NEARBY_RADAR_FLIGHTS,
  type RadarMode,
  type RadarSnapshot,
} from "@/server/global-radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RESPONSE_BYTES = 4_000_000;

type RadarTransportFlight = Pick<
  RadarSnapshot["flights"][number],
  | "id"
  | "icao24"
  | "flightNumber"
  | "callsign"
  | "airline"
  | "origin"
  | "destination"
  | "latitude"
  | "longitude"
  | "altitudeFt"
  | "speedKt"
  | "headingDeg"
  | "verticalRateFpm"
  | "aircraftType"
  | "tailNumber"
  | "onGround"
  | "isGlider"
>;

type SerializableRadarSnapshot = Omit<RadarSnapshot, "flights"> & {
  flights: Array<RadarSnapshot["flights"][number] | RadarTransportFlight>;
};

function modeFromRequest(value: string | null): RadarMode {
  return value === "nearby" ? "nearby" : "global";
}

function numberFromRequest(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function compactFlight(
  flight: RadarSnapshot["flights"][number],
): RadarTransportFlight {
  return {
    id: flight.id,
    icao24: flight.icao24,
    flightNumber: flight.flightNumber,
    callsign: flight.callsign,
    airline: flight.airline,
    origin: flight.origin,
    destination: flight.destination,
    latitude: flight.latitude,
    longitude: flight.longitude,
    altitudeFt: flight.altitudeFt,
    speedKt: flight.speedKt,
    headingDeg: flight.headingDeg,
    verticalRateFpm: flight.verticalRateFpm,
    aircraftType: flight.aircraftType,
    tailNumber: flight.tailNumber,
    onGround: flight.onGround,
    isGlider: flight.isGlider,
  };
}

function serializeWithinLimit(snapshot: RadarSnapshot, compact: boolean) {
  let responseSnapshot: SerializableRadarSnapshot = compact
    ? { ...snapshot, flights: snapshot.flights.map(compactFlight) }
    : snapshot;
  let body = JSON.stringify({ data: responseSnapshot });
  let byteLength = Buffer.byteLength(body);
  let truncated = false;

  while (byteLength > MAX_RESPONSE_BYTES && responseSnapshot.flights.length > 0) {
    const currentFlights = responseSnapshot.flights;
    const proportionalLength = Math.floor(
      currentFlights.length * (MAX_RESPONSE_BYTES / byteLength) * 0.98,
    );
    const nextLength = Math.max(
      0,
      Math.min(currentFlights.length - 1, proportionalLength),
    );
    const flights = currentFlights.slice(0, nextLength);

    responseSnapshot = {
      ...responseSnapshot,
      flights,
      totals: {
        tracked: flights.length,
        airborne: flights.filter((flight) => !flight.onGround).length,
        onGround: flights.filter((flight) => flight.onGround).length,
      },
    };
    body = JSON.stringify({ data: responseSnapshot });
    byteLength = Buffer.byteLength(body);
    truncated = true;
  }

  return { body, truncated };
}

function responseEtag(body: string) {
  const digest = createHash("sha256")
    .update(body)
    .digest("base64url")
    .slice(0, 27);
  return `"${digest}"`;
}

function etagMatches(headerValue: string | null, etag: string) {
  if (!headerValue) return false;
  const normalizedEtag = etag.replace(/^W\//, "").replace(/^"|"$/g, "");
  return headerValue.split(",").some((candidate) => {
    const value = candidate.trim();
    const normalizedValue = value
      .replace(/^W\//, "")
      .replace(/^"|"$/g, "");
    return value === "*" || normalizedValue === normalizedEtag;
  });
}

export async function GET(request: NextRequest) {
  const mode = modeFromRequest(request.nextUrl.searchParams.get("mode"));
  const compact = request.nextUrl.searchParams.get("compact") === "1";
  const latitude = clamp(
    numberFromRequest(request.nextUrl.searchParams.get("lat"), 24),
    -85,
    85,
  );
  const longitude = clamp(
    numberFromRequest(request.nextUrl.searchParams.get("lon"), 18),
    -180,
    180,
  );
  const radiusNm = Math.min(
    Math.max(
      numberFromRequest(request.nextUrl.searchParams.get("radiusNm"), 250),
      25,
    ),
    3_500,
  );
  const limit = Math.trunc(Math.min(
    Math.max(
      numberFromRequest(
        request.nextUrl.searchParams.get("limit"),
        mode === "global" ? 8_000 : 1_000,
      ),
      25,
    ),
    mode === "global"
      ? MAX_GLOBAL_RADAR_FLIGHTS
      : MAX_NEARBY_RADAR_FLIGHTS,
  ));

  const snapshot = await getGlobalRadarSnapshot({
    mode,
    latitude,
    longitude,
    radiusNm,
    limit,
  });
  const { body, truncated } = serializeWithinLimit(snapshot, compact);
  const etag = responseEtag(body);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control":
      mode === "global"
        ? "public, max-age=0, must-revalidate"
        : "no-store",
  });

  if (mode === "global") {
    headers.set(
      "Vercel-CDN-Cache-Control",
      "max-age=20, stale-while-revalidate=10",
    );
  }
  if (truncated) {
    headers.set("X-Airtraffic24-Truncated", "1");
  }
  headers.set("ETag", etag);

  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(body, { headers });
}
