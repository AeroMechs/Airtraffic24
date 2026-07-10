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

function serializeWithinLimit(snapshot: RadarSnapshot) {
  let responseSnapshot = snapshot;
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

export async function GET(request: NextRequest) {
  const mode = modeFromRequest(request.nextUrl.searchParams.get("mode"));
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
  const { body, truncated } = serializeWithinLimit(snapshot);
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

  return new NextResponse(body, { headers });
}
