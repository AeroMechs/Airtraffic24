import { CITIES, type City } from "@/atc/lib/cities";
import { MAP_STYLES, DEFAULT_STYLE, type MapStyle } from "@/atc/lib/map-styles";
import { ICAO24_REGEX } from "@/atc/lib/flight-api-types";
import { buildCanonicalCityPath, findCityByCode } from "@/atc/lib/city-routing";

export { DEFAULT_STYLE, ICAO24_REGEX };

export const DEFAULT_CITY_ID = "sfo";
export const STYLE_STORAGE_KEY = "atc:mapStyle";
export const DEFAULT_CITY =
  CITIES.find((c) => c.id === DEFAULT_CITY_ID) ?? CITIES[0];

export const subscribeNoop = () => () => {};

let _cachedInitialCity: City | null = null;
let _cachedInitialCityKey: string | null = null;

/** Matches `/city/<3-letter-iata>` (case-insensitive). */
const CITY_PATH_RE = /^\/city\/([A-Za-z]{3})\/?$/;
const RADAR_PATHS = new Set(["/", "/global-traffic-radar"]);

export function resolveInitialCity(): City {
  try {
    const locationKey = `${window.location.pathname}${window.location.search}`;
    if (_cachedInitialCity && _cachedInitialCityKey === locationKey) {
      return _cachedInitialCity;
    }

    // New canonical form: /city/<iata>
    const pathMatch = window.location.pathname.match(CITY_PATH_RE);
    if (pathMatch) {
      const city = findCityByCode(pathMatch[1]);
      if (city) {
        _cachedInitialCity = city;
        _cachedInitialCityKey = locationKey;
        return city;
      }
    }

    // Legacy form (still supported client-side as a safety net; the
    // server-side proxy normally redirects this before hydration).
    const params = new URLSearchParams(window.location.search);
    const code = params.get("city")?.trim();
    if (code) {
      const city = findCityByCode(code);
      if (city) {
        _cachedInitialCity = city;
        _cachedInitialCityKey = locationKey;
        return city;
      }
    }

    _cachedInitialCity = DEFAULT_CITY;
    _cachedInitialCityKey = locationKey;
    return DEFAULT_CITY;
  } catch {
    // Not in a browser environment (SSR) - fall back to default city
    _cachedInitialCity = DEFAULT_CITY;
    _cachedInitialCityKey = null;
    return DEFAULT_CITY;
  }
}

/**
 * Builds the shareable canonical pathname for a city.
 */
function cityPathname(city: City): string {
  return buildCanonicalCityPath(city);
}

function shouldPreserveRadarPath(pathname: string): boolean {
  if (RADAR_PATHS.has(pathname)) return true;

  const [, maybeRadarPath] = pathname.split("/").filter(Boolean);

  return Boolean(maybeRadarPath && RADAR_PATHS.has(`/${maybeRadarPath}`));
}

export function syncCityToUrl(city: City): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    // City pages use canonical pathnames; radar pages preserve ?city= for mode links.
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    url.searchParams.delete("fpv");
    if (shouldPreserveRadarPath(url.pathname)) {
      url.searchParams.set("city", city.iata.toLowerCase());
    } else {
      url.searchParams.delete("city");
      url.pathname = cityPathname(city);
    }
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // URL parsing or history API may fail in non-browser environments
  }
}

export function syncFpvToUrl(icao24: string | null, activeCity?: City): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    const preservePath = shouldPreserveRadarPath(url.pathname);
    if (preservePath) {
      if (activeCity) {
        url.searchParams.set("city", activeCity.iata.toLowerCase());
      }
    } else {
      url.searchParams.delete("city");
    }
    if (icao24) {
      url.searchParams.set("fpv", icao24);
      // Keep the current pathname so the URL still reflects the active city.
    } else {
      url.searchParams.delete("fpv");
      if (activeCity && !preservePath) {
        url.pathname = cityPathname(activeCity);
      }
    }
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // URL parsing or history API may fail in non-browser environments
  }
}

export function resolveInitialFpv(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("fpv")?.trim().toLowerCase();
    return raw && /^[0-9a-f]{6}$/.test(raw) ? raw : null;
  } catch {
    // Not in a browser environment (SSR)
    return null;
  }
}

export function loadMapStyle(): MapStyle {
  try {
    const id = localStorage.getItem(STYLE_STORAGE_KEY);
    if (!id) return DEFAULT_STYLE;
    return MAP_STYLES.find((s) => s.id === id) ?? DEFAULT_STYLE;
  } catch {
    // localStorage unavailable (SSR, private browsing, or quota exceeded)
    return DEFAULT_STYLE;
  }
}

export function saveMapStyle(style: MapStyle): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, style.id);
  } catch {
    // localStorage unavailable (private browsing or quota exceeded)
  }
}
