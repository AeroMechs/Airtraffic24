import { NextResponse, type NextRequest } from "next/server";

import {
  getGlobalRadarSnapshot,
  type RadarMode,
} from "@/server/global-radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function modeFromRequest(value: string | null): RadarMode {
  return value === "nearby" ? "nearby" : "global";
}

function numberFromRequest(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const mode = modeFromRequest(request.nextUrl.searchParams.get("mode"));
  const latitude = numberFromRequest(
    request.nextUrl.searchParams.get("lat"),
    24,
  );
  const longitude = numberFromRequest(
    request.nextUrl.searchParams.get("lon"),
    18,
  );
  const radiusNm = Math.min(
    Math.max(numberFromRequest(request.nextUrl.searchParams.get("radiusNm"), 250), 25),
    3_500,
  );
  const limit = Math.min(
    Math.max(
      numberFromRequest(
        request.nextUrl.searchParams.get("limit"),
        mode === "global" ? 8_000 : 1_000,
      ),
      25,
    ),
    mode === "global" ? 10_000 : 5_000,
  );

  return NextResponse.json(
    {
      data: await getGlobalRadarSnapshot({
        mode,
        latitude,
        longitude,
        radiusNm,
        limit,
      }),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
