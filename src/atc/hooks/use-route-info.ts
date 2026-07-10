"use client";

// ── Route Info Hook ─────────────────────────────────────────────────
//
// Resolves route data from the live provider first, then verified databases.
//
// Sources (queried in parallel server-side):
//   1. adsbdb.com       – flight-plan database
//   2. hexdb.io         – route lookup + airport metadata
//   3. OpenSky Network  – historical route data
//
// IMPORTANT: No predicted, observed, or interpolated routes are shown. If
// no verified database knows the route, the UI
// displays "Route unavailable" rather than guessing.
//
// Edge cases handled:
//   - Rapid flight switching: old requests are cancelled, only the
//     latest callsign's result is applied.
//   - Component unmount: no state updates after unmount.
//   - Hanging fetch: 15-second client timeout guarantees loading
//     never gets stuck.
//   - Cached results: instant display for recently-looked-up routes.
// ────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { FlightState } from "@/atc/lib/opensky";
import { findByIata, type Airport } from "@/atc/lib/airports";
import { lookupRoute, formatAirportCode } from "@/atc/lib/route-lookup";
import type { RouteInfo, RouteAirport } from "@/atc/lib/route-lookup";

// ── Types ──────────────────────────────────────────────────────────────

export type FlightRouteInfo = {
  /** Origin airport (verified from route database, or null) */
  origin: RouteAirport | null;
  /** Destination airport (verified from route database, or null) */
  destination: RouteAirport | null;
  /** Whether route data is actively being fetched */
  loading: boolean;
  /** Whether a verified route was found */
  available: boolean;
  /** Whether the route is definitively unknown (not just loading) */
  unavailable: boolean;
  /** Short display string, e.g. "LHR → JFK" */
  routeDisplay: string | null;
  /** Data source that resolved this route */
  source: "feed" | "adsbdb" | "hexdb" | "opensky" | null;
};

const EMPTY_ROUTE: FlightRouteInfo = {
  origin: null,
  destination: null,
  loading: false,
  available: false,
  unavailable: false,
  routeDisplay: null,
  source: null,
};

/** Max time to wait for a route lookup before forcing timeout. */
const LOOKUP_TIMEOUT_MS = 15_000;

function toRouteAirport(airport: Airport): RouteAirport {
  return {
    iata: airport.iata,
    icao: airport.icao,
    name: airport.name,
    municipality: airport.city,
    countryIso: airport.country,
    latitude: airport.lat,
    longitude: airport.lng,
  };
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useRouteInfo(flight: FlightState | null): FlightRouteInfo {
  const [apiRoute, setApiRoute] = useState<RouteInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);

  // Use a generation counter to ignore stale async results
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const callsign = flight?.callsign?.trim().toUpperCase() ?? null;
  const feedOrigin = flight?.routeOrigin?.trim().toUpperCase() ?? null;
  const feedDestination =
    flight?.routeDestination?.trim().toUpperCase() ?? null;
  const feedRoute = useMemo<FlightRouteInfo | null>(() => {
    if (!feedOrigin || !feedDestination) return null;
    const originAirport = findByIata(feedOrigin);
    const destinationAirport = findByIata(feedDestination);
    if (!originAirport || !destinationAirport) return null;

    const origin = toRouteAirport(originAirport);
    const destination = toRouteAirport(destinationAirport);
    return {
      origin,
      destination,
      loading: false,
      available: true,
      unavailable: false,
      routeDisplay: `${formatAirportCode(origin)} -> ${formatAirportCode(destination)}`,
      source: "feed",
    };
  }, [feedDestination, feedOrigin]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (feedRoute) {
      ++generationRef.current;
      return;
    }

    // No callsign → nothing to look up
    if (!callsign) {
      const generation = ++generationRef.current;
      queueMicrotask(() => {
        if (!mountedRef.current) return;
        if (generation !== generationRef.current) return;
        setApiRoute(null);
        setIsLoading(false);
        setIsUnavailable(false);
      });
      return;
    }

    // Start a new lookup generation
    const generation = ++generationRef.current;
    let active = true;
    let settled = false;

    queueMicrotask(() => {
      if (!active) return;
      if (settled) return;
      if (!mountedRef.current) return;
      if (generation !== generationRef.current) return;
      setIsLoading(true);
      setIsUnavailable(false);
      setApiRoute(null);
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, LOOKUP_TIMEOUT_MS);

    lookupRoute(callsign, controller.signal)
      .then((result) => {
        settled = true;
        clearTimeout(timeoutId);
        if (!mountedRef.current) return;
        if (generation !== generationRef.current) return; // stale

        setApiRoute(result);
        setIsLoading(false);
        setIsUnavailable(result === null);
      })
      .catch(() => {
        settled = true;
        clearTimeout(timeoutId);
        if (!mountedRef.current) return;
        if (generation !== generationRef.current) return; // stale

        setApiRoute(null);
        setIsLoading(false);
        setIsUnavailable(true);
      });

    return () => {
      active = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [callsign, feedRoute]);

  if (!flight) return EMPTY_ROUTE;
  if (feedRoute) return feedRoute;

  const origin = apiRoute?.origin ?? null;
  const destination = apiRoute?.destination ?? null;
  const available = !!origin && !!destination;

  const originCode = origin ? formatAirportCode(origin) : null;
  const destCode = destination ? formatAirportCode(destination) : null;
  const routeDisplay =
    originCode && destCode ? `${originCode} → ${destCode}` : null;

  return {
    origin,
    destination,
    loading: isLoading,
    available,
    unavailable: isUnavailable,
    routeDisplay,
    source: apiRoute?.source ?? null,
  };
}

/** Imperatively clear the route lookup cache. */
export function useClearRouteCache() {
  const clear = useCallback(() => {
    // route-lookup cache is module-level; re-import to clear
    void import("@/atc/lib/route-lookup").then((m) => m.clearRouteCache());
  }, []);
  return clear;
}
