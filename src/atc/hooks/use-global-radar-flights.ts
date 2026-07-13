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
  aircraftType: string;
  tailNumber: string;
  onGround: boolean;
  isGlider: boolean;
  /** Compact provider observation time in Unix epoch seconds. */
  lastContact?: number | null;
};

type RadarResponse = {
  data?: {
    generatedAt?: string;
    source?:
      | "FlightRadar24 live"
      | "FlightRadar24 cached"
      | "FlightRadar24 partial live";
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
const MAX_BACKOFF_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 52_000;
const GLOBAL_TRAFFIC_LIMIT = 8_000;
const NEARBY_TRAFFIC_LIMIT = 1_000;
const FT_TO_METERS = 0.3048;
const KNOTS_TO_METERS_PER_SECOND = 0.514444;
const FPM_TO_METERS_PER_SECOND = 0.00508;

function getBackoffDelay(failureCount: number) {
  return Math.min(
    MAX_BACKOFF_INTERVAL_MS,
    BACKOFF_INTERVAL_MS * 2 ** Math.min(2, Math.max(0, failureCount - 1)),
  );
}

function getRetryAfterDelay(response: Response) {
  const retryAfter = response.headers.get("Retry-After")?.trim();
  if (!retryAfter) return BACKOFF_INTERVAL_MS;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return Math.min(
      MAX_BACKOFF_INTERVAL_MS,
      Math.max(BACKOFF_INTERVAL_MS, seconds * 1_000),
    );
  }

  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt)
    ? Math.min(
        MAX_BACKOFF_INTERVAL_MS,
        Math.max(BACKOFF_INTERVAL_MS, retryAt - Date.now()),
      )
    : BACKOFF_INTERVAL_MS;
}

function fallbackTrackId(flight: RadarFlight) {
  const identity =
    flight.tailNumber !== "-"
      ? `registration:${flight.tailNumber}`
      : flight.callsign
        ? `callsign:${flight.callsign}`
        : flight.flightNumber
          ? `flight:${flight.flightNumber}`
          : `provider:${flight.id}`;
  let hash = 2_166_136_261;
  for (let character = 0; character < identity.length; character += 1) {
    hash ^= identity.charCodeAt(character);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(6, "0").slice(-6);
}

function categoryFromType(
  aircraftType: string,
  isGlider: boolean,
): number | null {
  if (isGlider) return 9;
  const type = aircraftType.toUpperCase();
  if (/A38|A34|B74|B77|B78|A35|A33|B76/.test(type)) return 6;
  if (/A2[012]|A3[12]|B73|B75|C919/.test(type)) return 4;
  if (/AT[47]|DH8|SF34/.test(type)) return 3;
  return null;
}

function typeCodeFromAircraft(aircraftType: string) {
  const match = aircraftType.toUpperCase().match(/[A-Z0-9]{3,4}/);
  return match?.[0] ?? null;
}

function toFlightState(flight: RadarFlight): FlightState {
  const altitudeMeters = Math.max(0, flight.altitudeFt * FT_TO_METERS);

  return {
    icao24: (flight.icao24 || fallbackTrackId(flight)).toLowerCase(),
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
    category: categoryFromType(flight.aircraftType, flight.isGlider),
    typeCode: typeCodeFromAircraft(flight.aircraftType),
    registration: flight.tailNumber !== "-" ? flight.tailNumber : null,
    typeDescription: flight.aircraftType,
    routeOrigin: flight.origin !== "---" ? flight.origin : null,
    routeDestination:
      flight.destination !== "---" ? flight.destination : null,
    lastContactAt:
      typeof flight.lastContact === "number" &&
      Number.isFinite(flight.lastContact) &&
      flight.lastContact > 0
        ? flight.lastContact * 1_000
        : null,
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
  const [initialLoading, setInitialLoading] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<
    "Live" | "Degraded" | null
  >(null);
  const [providerDetail, setProviderDetail] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [requestDurationMs, setRequestDurationMs] = useState<number | null>(
    null,
  );
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const flightsRef = useRef<FlightState[]>([]);
  const dataQueryRef = useRef<string | null>(null);
  const completedQueryRef = useRef<string | null>(null);
  const fetchDataRef = useRef<() => void>(() => {});

  const query = useMemo(() => {
    const params = new URLSearchParams({ mode });
    params.set("compact", "1");
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

  const stopRetryCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const clearRetryCountdown = useCallback(() => {
    stopRetryCountdown();
    setRetryIn(0);
  }, [stopRetryCountdown]);

  const startRetryCountdown = useCallback(
    (delayMs: number) => {
      clearRetryCountdown();
      const retryAt = Date.now() + delayMs;

      const update = () => {
        const seconds = Math.max(
          0,
          Math.ceil((retryAt - Date.now()) / 1_000),
        );
        setRetryIn(seconds);
        if (seconds === 0 && countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      };

      update();
      countdownRef.current = setInterval(update, 1_000);
    },
    [clearRetryCountdown],
  );

  const cancelCurrentRequest = useCallback(() => {
    requestSequenceRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
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
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      timerRef.current = setTimeout(() => fetchDataRef.current(), delayMs);
    },
    [clearTimer],
  );

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    if (
      (typeof document !== "undefined" &&
        document.visibilityState !== "visible") ||
      (typeof navigator !== "undefined" && !navigator.onLine)
    ) {
      clearTimer();
      clearRetryCountdown();
      setLoading(false);
      setInitialLoading(false);

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const message =
          "You are offline. Showing the latest real positions until the connection returns.";
        const hasCurrentData =
          dataQueryRef.current === query && flightsRef.current.length > 0;
        setRateLimited(false);
        setProviderStatus("Degraded");
        setProviderDetail(message);
        setUnavailable(!hasCurrentData);
        setError(message);
      }
      return;
    }

    // Visibility and online events can arrive together. Reuse the active
    // request instead of aborting it and restarting a multi-megabyte load.
    if (abortRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    const requestSequence = ++requestSequenceRef.current;
    const requestStartedAt = performance.now();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const isCurrentRequest = () =>
      requestSequence === requestSequenceRef.current;
    const markFailure = (message: string) => {
      setError(message);
      setProviderStatus("Degraded");
      setProviderDetail(message);
      setUnavailable(
        dataQueryRef.current !== query || flightsRef.current.length === 0,
      );
    };
    const scheduleFailureRetry = () => {
      consecutiveFailuresRef.current += 1;
      const delayMs = getBackoffDelay(consecutiveFailuresRef.current);
      startRetryCountdown(delayMs);
      scheduleNext(delayMs);
      return delayMs;
    };

    try {
      setLoading(true);
      setInitialLoading(completedQueryRef.current !== query);
      setRateLimited(false);
      clearRetryCountdown();
      setError(null);

      const response = await fetch(`/api/radar/flights?${query}`, {
        cache: mode === "global" ? "default" : "no-store",
        signal: controller.signal,
      });
      if (!isCurrentRequest()) return;

      if (response.status === 429) {
        setRateLimited(true);
        markFailure("The radar provider is rate limited. Retrying shortly.");
        consecutiveFailuresRef.current += 1;
        const delayMs = Math.max(
          getBackoffDelay(consecutiveFailuresRef.current),
          getRetryAfterDelay(response),
        );
        startRetryCountdown(delayMs);
        scheduleNext(delayMs);
        return;
      }

      if (!response.ok) {
        markFailure(`Radar request failed (${response.status}).`);
        scheduleFailureRetry();
        return;
      }

      const payload = (await response.json()) as RadarResponse;
      if (!isCurrentRequest()) return;
      if (
        !payload.data ||
        !Array.isArray(payload.data.flights) ||
        !payload.data.provider ||
        (payload.data.provider.status !== "Live" &&
          payload.data.provider.status !== "Degraded")
      ) {
        markFailure("The radar provider returned an invalid response.");
        scheduleFailureRetry();
        return;
      }

      const nextFlights = payload.data.flights.map(toFlightState);
      const isDegraded = payload.data.provider.status === "Degraded";
      const canPreserveLastKnown =
        isDegraded &&
        nextFlights.length === 0 &&
        dataQueryRef.current === query &&
        flightsRef.current.length > 0;

      completedQueryRef.current = query;
      setSource(payload.data.provider.name);
      setProviderStatus(payload.data.provider.status);
      setProviderDetail(
        canPreserveLastKnown
          ? "Live refresh delayed; showing the latest real positions saved in this browser."
          : payload.data.provider.detail,
      );
      setUnavailable(
        isDegraded && nextFlights.length === 0 && !canPreserveLastKnown,
      );

      if (!canPreserveLastKnown) {
        flightsRef.current = nextFlights;
        dataQueryRef.current = query;
        setFlights(nextFlights);
        const generatedAt = payload.data.generatedAt
          ? Date.parse(payload.data.generatedAt)
          : Number.NaN;
        setLastUpdatedAt(
          isDegraded && nextFlights.length === 0
            ? null
            : Number.isFinite(generatedAt)
              ? generatedAt
              : null,
        );
      }

      if (isDegraded && nextFlights.length === 0) {
        setError(
          canPreserveLastKnown
            ? "Live refresh delayed; showing the latest real positions saved in this browser."
            : payload.data.provider.detail,
        );
      }
      if (isDegraded) {
        scheduleFailureRetry();
      } else {
        consecutiveFailuresRef.current = 0;
        scheduleNext(
          mode === "global"
            ? GLOBAL_POLL_INTERVAL_MS
            : NEARBY_POLL_INTERVAL_MS,
        );
      }
    } catch (caught) {
      if (requestSequence !== requestSequenceRef.current) return;
      if (caught instanceof Error && caught.name === "AbortError" && !timedOut) {
        return;
      }
      markFailure(
        timedOut
          ? "The radar provider took too long to respond. Retrying shortly."
          : caught instanceof Error
            ? caught.message
            : "The radar request failed.",
      );
      scheduleFailureRetry();
    } finally {
      clearTimeout(timeout);
      if (requestSequence === requestSequenceRef.current) {
        abortRef.current = null;
        setRequestDurationMs(
          Math.max(0, performance.now() - requestStartedAt),
        );
        setLoading(false);
        setInitialLoading(false);
      }
    }
  }, [
    clearRetryCountdown,
    clearTimer,
    enabled,
    mode,
    query,
    scheduleNext,
    startRetryCountdown,
  ]);

  useEffect(() => {
    fetchDataRef.current = () => void fetchData();
  }, [fetchData]);

  useEffect(() => {
    consecutiveFailuresRef.current = 0;
  }, [query]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      stopRetryCountdown();
      cancelCurrentRequest();
      return;
    }

    const kickoffTimer = window.setTimeout(() => void fetchData(), 0);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void fetchData();
      } else {
        clearTimer();
        clearRetryCountdown();
        cancelCurrentRequest();
        setLoading(false);
        setInitialLoading(false);
      }
    }

    function onOnline() {
      if (document.visibilityState === "visible") {
        clearTimer();
        void fetchData();
      }
    }

    function onOffline() {
      const message =
        "You are offline. Showing the latest real positions until the connection returns.";
      const hasCurrentData =
        dataQueryRef.current === query && flightsRef.current.length > 0;
      clearTimer();
      clearRetryCountdown();
      cancelCurrentRequest();
      setLoading(false);
      setInitialLoading(false);
      setRateLimited(false);
      setProviderStatus("Degraded");
      setProviderDetail(message);
      setUnavailable(!hasCurrentData);
      setError(message);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearTimeout(kickoffTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearTimer();
      stopRetryCountdown();
      cancelCurrentRequest();
    };
  }, [
    cancelCurrentRequest,
    clearRetryCountdown,
    clearTimer,
    enabled,
    fetchData,
    query,
    stopRetryCountdown,
  ]);

  return {
    flights: enabled ? flights : [],
    loading: enabled ? loading : false,
    initialLoading: enabled ? initialLoading : false,
    refreshing: enabled ? loading && !initialLoading : false,
    rateLimited: enabled ? rateLimited : false,
    retryIn: enabled ? retryIn : 0,
    source: enabled ? source : null,
    providerStatus: enabled ? providerStatus : null,
    providerDetail: enabled ? providerDetail : null,
    stale: enabled ? providerStatus === "Degraded" : false,
    unavailable: enabled ? unavailable : false,
    lastUpdatedAt: enabled ? lastUpdatedAt : null,
    requestDurationMs: enabled ? requestDurationMs : null,
    error: enabled ? error : null,
  };
}
