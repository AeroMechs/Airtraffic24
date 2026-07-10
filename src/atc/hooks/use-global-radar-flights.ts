"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FlightState } from "@/atc/lib/opensky-types";

type RadarMode = "global" | "nearby";

type RadarFlight = {
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
  source: "FlightRadar24 live" | "FlightRadar24 cached";
  onGround: boolean;
};

type RadarResponse = {
  data?: {
    flights: RadarFlight[];
    provider: {
      name: string;
      status: "Live" | "Degraded";
      detail: string;
    };
  };
};

const GLOBAL_POLL_INTERVAL_MS = 30_000;
const NEARBY_POLL_INTERVAL_MS = 5_000;
const BACKOFF_INTERVAL_MS = 15_000;
const GLOBAL_TRAFFIC_LIMIT = 8_000;
const NEARBY_TRAFFIC_LIMIT = 1_000;
const FT_TO_METERS = 0.3048;
const KNOTS_TO_METERS_PER_SECOND = 0.514444;
const FPM_TO_METERS_PER_SECOND = 0.00508;

function syntheticIcao24(id: string, index: number) {
  let hash = index + 1;
  for (let character = 0; character < id.length; character += 1) {
    hash = (hash * 31 + id.charCodeAt(character)) & 0xffffff;
  }
  return hash.toString(16).padStart(6, "0").slice(-6);
}

function categoryFromType(aircraftType: string) {
  const type = aircraftType.toUpperCase();
  if (/A38|A34|B74|B77|B78|A35|A33|B76/.test(type)) return 6;
  if (/A2[012]|A3[12]|B73|B75|C919/.test(type)) return 4;
  if (/AT[47]|DH8|SF34/.test(type)) return 3;
  return 3;
}

function typeCodeFromAircraft(aircraftType: string) {
  const match = aircraftType.toUpperCase().match(/[A-Z0-9]{3,4}/);
  return match?.[0] ?? null;
}

function toFlightState(flight: RadarFlight, index: number): FlightState {
  const altitudeMeters = Math.max(0, flight.altitudeFt * FT_TO_METERS);

  return {
    icao24: (flight.icao24 || syntheticIcao24(flight.id, index)).toLowerCase(),
    callsign: flight.callsign || flight.flightNumber,
    originCountry: flight.airline,
    longitude: flight.longitude,
    latitude: flight.latitude,
    baroAltitude: altitudeMeters,
    onGround: flight.onGround,
    velocity: Math.max(0, flight.speedKt * KNOTS_TO_METERS_PER_SECOND),
    trueTrack: flight.headingDeg,
    verticalRate: flight.verticalRateFpm * FPM_TO_METERS_PER_SECOND,
    geoAltitude: altitudeMeters,
    squawk: null,
    spiFlag: false,
    positionSource: "adsb",
    category: categoryFromType(flight.aircraftType),
    typeCode: typeCodeFromAircraft(flight.aircraftType),
    registration: flight.tailNumber !== "-" ? flight.tailNumber : null,
    typeDescription: flight.aircraftType,
    routeOrigin: flight.origin !== "---" ? flight.origin : null,
    routeDestination:
      flight.destination !== "---" ? flight.destination : null,
    debugData: null,
  };
}

export function useGlobalRadarFlights({
  enabled,
  mode,
  center,
  radiusNm = 250,
  limit,
}: {
  enabled: boolean;
  mode: RadarMode;
  role?: string;
  center?: { latitude: number; longitude: number };
  radiusNm?: number;
  limit?: number;
}) {
  const [flights, setFlights] = useState<FlightState[]>([]);
  const [loading, setLoading] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchDataRef = useRef<() => void>(() => {});

  const query = useMemo(() => {
    const params = new URLSearchParams({ mode });
    params.set(
      "limit",
      String(
        limit ??
          (mode === "global" ? GLOBAL_TRAFFIC_LIMIT : NEARBY_TRAFFIC_LIMIT),
      ),
    );
    if (mode === "nearby" && center) {
      params.set("lat", center.latitude.toFixed(4));
      params.set("lon", center.longitude.toFixed(4));
      params.set("radiusNm", String(radiusNm));
    }
    return params.toString();
  }, [center, limit, mode, radiusNm]);

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleNext = useCallback(
    (delayMs: number) => {
      clearTimer();
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      timerRef.current = setTimeout(() => fetchDataRef.current(), delayMs);
    },
    [clearTimer],
  );

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setLoading(true);
      setRateLimited(false);
      setRetryIn(0);

      const response = await fetch(`/api/radar/flights?${query}`, {
        cache: mode === "global" ? "default" : "no-store",
        signal: controller.signal,
      });

      if (response.status === 429) {
        setRateLimited(true);
        setRetryIn(Math.round(BACKOFF_INTERVAL_MS / 1_000));
        scheduleNext(BACKOFF_INTERVAL_MS);
        return;
      }

      if (!response.ok) {
        scheduleNext(BACKOFF_INTERVAL_MS);
        return;
      }

      const payload = (await response.json()) as RadarResponse;
      if (!payload.data) {
        scheduleNext(BACKOFF_INTERVAL_MS);
        return;
      }

      setSource(payload.data.provider.name);
      setFlights(payload.data.flights.map(toFlightState));
      scheduleNext(
        mode === "global"
          ? GLOBAL_POLL_INTERVAL_MS
          : NEARBY_POLL_INTERVAL_MS,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      scheduleNext(BACKOFF_INTERVAL_MS);
    } finally {
      setLoading(false);
    }
  }, [enabled, mode, query, scheduleNext]);

  useEffect(() => {
    fetchDataRef.current = () => void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      abortRef.current?.abort();
      return;
    }

    const kickoffTimer = window.setTimeout(() => void fetchData(), 0);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void fetchData();
      } else {
        clearTimer();
        abortRef.current?.abort();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(kickoffTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimer();
      abortRef.current?.abort();
    };
  }, [clearTimer, enabled, fetchData]);

  return {
    flights: enabled ? flights : [],
    loading: enabled ? loading : false,
    rateLimited: enabled ? rateLimited : false,
    retryIn: enabled ? retryIn : 0,
    source: enabled ? source : null,
  };
}
