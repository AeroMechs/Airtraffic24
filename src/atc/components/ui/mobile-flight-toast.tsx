"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import Image from "next/image";
import {
  ArrowUp,
  ArrowDown,
  Gauge,
  Compass,
  Eye,
  X,
  Building2,
  Globe,
  Navigation,
  Camera,
  ImageOff,
  Plane,
} from "lucide-react";
import { useAircraftPhotos } from "@/atc/hooks/use-aircraft-photos";
import {
  OnGroundBadge,
  PositionSourceBadge,
} from "@/atc/components/ui/flight-badges";
import { useSettings } from "@/atc/hooks/use-settings";
import type { FlightState, FlightTrack } from "@/atc/lib/opensky";
import {
  formatCallsign,
  headingToCardinal,
} from "@/atc/lib/flight-utils";
import { lookupAirline, parseFlightNumber } from "@/atc/lib/airlines";
import { aircraftTypeHint } from "@/atc/lib/aircraft";
import { airlineLogoCandidates } from "@/atc/lib/airline-logos";
import {
  loadedAirlineLogoUrls,
  trackAirlineLogoLoaded,
  markAirlineLogoFailed,
  wasAirlineLogoRecentlyFailed,
} from "@/atc/lib/logo-cache";
import type { NormalizedPhoto } from "@/atc/hooks/use-aircraft-photos";
import {
  formatAltitude,
  formatSpeed,
  formatVerticalSpeedValue,
} from "@/atc/lib/unit-formatters";
import { cn } from "@/atc/lib/utils";

type MobileFlightToastProps = {
  flight: FlightState;
  track?: FlightTrack | null;
  onClose: () => void;
  onToggleFpv?: (icao24: string) => void;
  isFpvActive?: boolean;
};

const EMERGENCY_SQUAWKS = new Set(["7500", "7600", "7700"]);

function isEmergencySquawk(squawk: string | null): boolean {
  if (!squawk) return false;
  return EMERGENCY_SQUAWKS.has(squawk.trim());
}

function squawkLabel(squawk: string): string {
  switch (squawk.trim()) {
    case "7500":
      return "Hijack";
    case "7600":
      return "Radio fail";
    case "7700":
      return "Emergency";
    default:
      return "";
  }
}

function isMilitary(dbFlags?: number | null): boolean {
  return ((dbFlags ?? 0) & 1) !== 0;
}

function isEmergencyStatus(status?: string | null): boolean {
  return !!status && status !== "none";
}

type PhotoCarouselHeroProps = {
  photos: NormalizedPhoto[];
  loading: boolean;
};

function PhotoCarouselHero({ photos, loading }: PhotoCarouselHeroProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideLoadState, setSlideLoadState] = useState<
    Record<number, "loaded" | "error">
  >({});
  const [mountedSlides, setMountedSlides] = useState<Set<number>>(
    () => new Set([0]),
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0 || photos.length === 0) return;

    const idx = Math.max(
      0,
      Math.min(photos.length - 1, Math.round(el.scrollLeft / el.clientWidth)),
    );

    setActiveSlide(idx);
    setMountedSlides((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }, [photos.length]);

  const handleSlideLoad = useCallback((index: number) => {
    setSlideLoadState((current) => ({ ...current, [index]: "loaded" }));
  }, []);

  const handleSlideError = useCallback((index: number) => {
    setSlideLoadState((current) => ({ ...current, [index]: "error" }));
  }, []);

  const hasPhotos = photos.length > 0;
  const showPhotos = !loading && hasPhotos;

  return (
    <div className="relative h-48 w-full overflow-hidden bg-foreground/[0.04]">
      {loading && !hasPhotos && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/[0.04] via-foreground/[0.08] to-foreground/[0.04]"
        />
      )}

      {!loading && !hasPhotos && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-foreground/15">
          <ImageOff className="h-4 w-4" />
          <span className="text-[9px] font-medium">No photo</span>
        </div>
      )}

      {showPhotos && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex h-full snap-x snap-mandatory overflow-x-auto scrollbar-none"
          style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none" }}
        >
          {photos.map((photo, i) => (
            <div
              key={photo.id}
              className="relative h-full w-full shrink-0 snap-center"
            >
              {slideLoadState[i] !== "loaded" &&
                slideLoadState[i] !== "error" && (
                  <span
                    aria-hidden
                    className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/5 via-foreground/8 to-foreground/5"
                  />
                )}
              {slideLoadState[i] === "error" ? (
                <div className="flex h-full w-full items-center justify-center text-foreground/15">
                  <ImageOff className="h-5 w-5" />
                </div>
              ) : mountedSlides.has(i) ? (
                <Image
                  src={photo.url}
                  alt={`Aircraft photo ${i + 1}`}
                  fill
                  sizes="100vw"
                  unoptimized
                  onLoad={() => handleSlideLoad(i)}
                  onError={() => handleSlideError(i)}
                  className={`object-cover transition-opacity duration-300 ${
                    slideLoadState[i] === "loaded" ? "opacity-100" : "opacity-0"
                  }`}
                  draggable={false}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {showPhotos && (
        <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-background/50 via-background/5 to-transparent" />
      )}

      {showPhotos && photos[activeSlide]?.photographer && (
        <span className="absolute bottom-1.5 right-2 z-10 flex items-center gap-0.5 rounded-full bg-background/45 px-1.5 py-0.5 text-[8px] font-medium text-foreground/55 backdrop-blur-sm">
          <Camera className="h-2 w-2" />
          {photos[activeSlide].photographer}
        </span>
      )}

      {showPhotos && photos.length > 1 && (
        <div className="absolute bottom-1.5 left-1/2 z-10 flex -translate-x-1/2 gap-1">
          {photos.slice(0, 10).map((_, i) => (
            <span
              key={i}
              className={`h-1 w-1 rounded-full transition-colors duration-200 ${
                i === activeSlide ? "bg-foreground/80" : "bg-foreground/30"
              }`}
            />
          ))}
          {photos.length > 10 && (
            <span className="text-[7px] leading-none text-foreground/30">
              +{photos.length - 10}
            </span>
          )}
        </div>
      )}

      {showPhotos && photos.length > 1 && (
        <span className="absolute top-1.5 right-2 z-10 rounded-full bg-background/45 px-1.5 py-0.5 text-[8px] font-semibold tabular-nums text-foreground/60 backdrop-blur-sm">
          {activeSlide + 1}/{photos.length}
        </span>
      )}
    </div>
  );
}

export function MobileFlightToast({
  flight,
  onClose,
  onToggleFpv,
  isFpvActive = false,
}: MobileFlightToastProps) {
  const { settings } = useSettings();
  const airline = lookupAirline(flight.callsign);
  const flightNum = parseFlightNumber(flight.callsign);
  const company = airline ?? `${flight.originCountry} operator`;
  const model = aircraftTypeHint(flight.category);
  const heading = flight.trueTrack;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;
  const skylineInternal = flight.skylineInternal ?? null;
  const canEnterFpv =
    flight.longitude != null && flight.latitude != null && !flight.onGround;

  // Airline logo fallback chain.
  const logoCandidates = airlineLogoCandidates(airline, flight.callsign);
  const [logoIndexByAirline, setLogoIndexByAirline] = useState<
    Record<string, number>
  >({});
  const [logoLoadedByKey, setLogoLoadedByKey] = useState<
    Record<string, boolean>
  >({});
  const [genericLogoFailed, setGenericLogoFailed] = useState(false);

  const airlineKey = airline ?? "__none__";
  const baseLogoIndex = logoIndexByAirline[airlineKey] ?? 0;
  const resolvedLogoIndex = useMemo(() => {
    let idx = baseLogoIndex;
    while (
      idx < logoCandidates.length &&
      wasAirlineLogoRecentlyFailed(logoCandidates[idx] ?? "")
    ) {
      idx += 1;
    }
    return idx;
  }, [baseLogoIndex, logoCandidates]);

  const logoLoadKey = `${airlineKey}:${resolvedLogoIndex}`;
  const logoUrl = logoCandidates[resolvedLogoIndex] ?? null;
  const logoLoaded =
    (logoUrl ? loadedAirlineLogoUrls.has(logoUrl) : false) ||
    (logoLoadedByKey[logoLoadKey] ?? false);
  const showLogo = Boolean(logoUrl);
  const genericLogoUrl = "/airline-logos/envoy-air.png";

  // Aircraft photos and details.
  const {
    photos,
    aircraft: aircraftDetails,
    loading: photosLoading,
  } = useAircraftPhotos(flight.icao24, flight.registration);
  const photoKey = photos.map((p) => p.id).join(",");

  return (
    <div className="scrollbar-none relative max-h-[calc(100dvh-1rem)] w-full overflow-y-auto overflow-x-hidden rounded-[28px] border border-foreground/[0.08] bg-background/82 shadow-[0_22px_70px_rgba(0,0,0,0.44)] overscroll-contain backdrop-blur-2xl supports-[backdrop-filter]:bg-background/72">
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-2 z-20 h-1 w-9 -translate-x-1/2 rounded-full bg-foreground/28 shadow-sm"
      />
      <PhotoCarouselHero
        key={photoKey}
        photos={photos}
        loading={photosLoading}
      />

      <div className="p-4 pt-3.5">
        {/* Header row: logo + callsign + close */}
        <div className="flex items-center gap-3">
          {/* Airline logo */}
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border border-foreground/[0.08] bg-foreground/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_22px_rgba(0,0,0,0.18)]">
            {showLogo ? (
              <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-[14px] border border-black/5 bg-white/95 p-2.5 shadow-sm">
                {!logoLoaded && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 animate-pulse bg-linear-to-br from-white/85 via-neutral-200/65 to-white/80"
                  />
                )}
                <Image
                  src={logoUrl ?? undefined}
                  alt={company ? `${company} logo` : "Airline logo"}
                  width={40}
                  height={40}
                  className={`relative h-9 w-9 object-contain transition-opacity duration-200 ${
                    logoLoaded ? "opacity-100" : "opacity-0"
                  }`}
                  unoptimized
                  onLoad={() => {
                    if (logoUrl) trackAirlineLogoLoaded(logoUrl);
                    setLogoLoadedByKey((current) => ({
                      ...current,
                      [logoLoadKey]: true,
                    }));
                  }}
                  onError={() => {
                    if (logoUrl) markAirlineLogoFailed(logoUrl);
                    if (resolvedLogoIndex + 1 < logoCandidates.length) {
                      setLogoIndexByAirline((current) => ({
                        ...current,
                        [airlineKey]: resolvedLogoIndex + 1,
                      }));
                      return;
                    }
                    setLogoIndexByAirline((current) => ({
                      ...current,
                      [airlineKey]: logoCandidates.length,
                    }));
                  }}
                />
              </span>
            ) : (
              <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-[14px] border border-black/5 bg-white/95 p-2.5 shadow-sm">
                {genericLogoFailed ? (
                  <span className="text-[16px] font-semibold text-background/25">
                    -
                  </span>
                ) : (
                  <Image
                    src={genericLogoUrl}
                    alt="Generic airline logo"
                    width={40}
                    height={40}
                    className="h-9 w-9 object-contain grayscale opacity-80"
                    unoptimized
                    onError={() => setGenericLogoFailed(true)}
                  />
                )}
              </span>
            )}
          </div>

          {/* Callsign + identifiers */}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-[18px] font-semibold leading-tight tracking-tight text-foreground">
                {formatCallsign(flight.callsign)}
              </p>
              <PositionSourceBadge source={flight.positionSource} />
              <OnGroundBadge onGround={flight.onGround} />
            </div>
            <p className="mt-1 truncate text-[11px] font-medium tracking-wide text-foreground/42 uppercase">
              {flight.icao24}
              {flightNum ? ` · #${flightNum}` : ""}
            </p>
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/[0.06] bg-foreground/[0.05] text-foreground/50 transition-colors active:bg-foreground/10"
            aria-label="Close flight details"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Airline / model */}
        <div className="mt-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          {company && (
            <MobileGroupedRow icon={<Building2 className="h-3.5 w-3.5" />}>
              <p className="truncate text-[13px] font-medium text-foreground/74">
                {company}
                {flight?.typeDescription ? (
                  <span className="text-foreground/40">
                    {" "}
                    · {flight.typeDescription}
                  </span>
                ) : model ? (
                  <span className="text-foreground/40"> · {model}</span>
                ) : null}
              </p>
            </MobileGroupedRow>
          )}
          {/* Aircraft details (registration, type, owner) */}
          {aircraftDetails &&
            (aircraftDetails.registration ||
              aircraftDetails.type ||
              aircraftDetails.typeCode ||
              aircraftDetails.owner) && (
              <MobileGroupedRow
                icon={<Plane className="h-3.5 w-3.5" />}
                divided={Boolean(company)}
              >
                <p className="truncate text-[13px] text-foreground/58">
                {[
                  aircraftDetails.registration,
                  aircraftDetails.type ?? aircraftDetails.typeCode,
                  aircraftDetails.owner,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                </p>
              </MobileGroupedRow>
            )}
          {/* Registration fallback from flight data */}
          {!aircraftDetails?.registration && flight?.registration && (
            <MobileGroupedRow
              icon={<Plane className="h-3.5 w-3.5" />}
              divided={Boolean(company)}
            >
              <p className="truncate font-mono text-[13px] text-foreground/58">
                {flight.registration}
                {flight.typeCode && !flight.typeDescription ? (
                  <span className="ml-1 text-foreground/30">
                    [{flight.typeCode}]
                  </span>
                ) : null}
              </p>
            </MobileGroupedRow>
          )}
        </div>
        {/* Military / Emergency indicators */}
        {(isMilitary(flight.dbFlags) ||
          isEmergencyStatus(flight.emergencyStatus)) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isMilitary(flight.dbFlags) && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-amber-300/85">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" />
                Military
              </span>
            )}
            {isEmergencyStatus(flight.emergencyStatus) && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/25 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-red-300/90">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                {flight.emergencyStatus}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Metrics 4-column grid */}
      <div className="mx-4 mb-4 grid grid-cols-4 gap-1.5 rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <MiniMetric
          icon={<ArrowUp className="h-2.5 w-2.5" />}
          label="ALT"
          value={formatAltitude(flight.baroAltitude, settings.unitSystem)}
        />
        <MiniMetric
          icon={<Gauge className="h-2.5 w-2.5" />}
          label="SPD"
          value={formatSpeed(flight.velocity, settings.unitSystem)}
        />
        <MiniMetric
          icon={<Compass className="h-2.5 w-2.5" />}
          label="HDG"
          value={
            heading !== null && Number.isFinite(heading)
              ? `${Math.round(heading)}° ${cardinal}`
              : "-"
          }
        />
        <MiniMetric
          icon={<ArrowDown className="h-2.5 w-2.5" />}
          label="V/S"
          value={formatVerticalSpeedValue(
            flight.verticalRate,
            settings.unitSystem,
          ).text}
        />
      </div>

      {/* Info section: origin, heading + coords, squawk */}
      <div className="mx-4 mb-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        {/* Origin country */}
        <MobileGroupedRow icon={<Globe className="h-3.5 w-3.5" />}>
          <p className="text-[13px] text-foreground/65">
            {flight.originCountry}
          </p>
        </MobileGroupedRow>

        {/* Heading direction + coordinates */}
        {cardinal && (
          <MobileGroupedRow
            icon={
              <Navigation
                className="h-3.5 w-3.5"
                style={{
                  transform:
                    heading !== null && Number.isFinite(heading)
                      ? `rotate(${heading}deg)`
                      : undefined,
                }}
              />
            }
            divided
          >
            <p className="text-[13px] text-foreground/65">
              Heading {cardinal}
              {flight.latitude !== null &&
                flight.longitude !== null &&
                Number.isFinite(flight.latitude) &&
                Number.isFinite(flight.longitude) && (
                  <span className="text-foreground/35">
                    {" "}
                    · {Math.abs(flight.latitude).toFixed(2)}°
                    {flight.latitude >= 0 ? "N" : "S"},{" "}
                    {Math.abs(flight.longitude).toFixed(2)}°
                    {flight.longitude >= 0 ? "E" : "W"}
                  </span>
                )}
            </p>
          </MobileGroupedRow>
        )}

        {/* Squawk code */}
        {flight.squawk && (
          <MobileGroupedRow
            icon={
              <span
                className={`text-[9px] font-bold leading-none ${
                  isEmergencySquawk(flight.squawk)
                    ? "text-red-300"
                    : "text-foreground/45"
                }`}
              >
                SQ
              </span>
            }
            divided
          >
            <p
              className={`font-mono text-[13px] tabular-nums ${
                isEmergencySquawk(flight.squawk)
                  ? "text-red-300"
                  : "text-foreground/65"
              }`}
            >
              {flight.squawk}
              {isEmergencySquawk(flight.squawk) && (
                <span className="ml-2 font-sans text-[11px] font-medium tracking-wide text-red-300/85">
                  {squawkLabel(flight.squawk)}
                </span>
              )}
            </p>
          </MobileGroupedRow>
        )}
      </div>

      {skylineInternal ? <MobileSkylineOperationsSection flight={flight} /> : null}

      {/* Aircraft follow camera */}
      {onToggleFpv && (
        <div className="mx-4 mb-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <button
            type="button"
            onClick={() =>
              (isFpvActive || canEnterFpv) && onToggleFpv(flight.icao24)
            }
            disabled={!isFpvActive && !canEnterFpv}
            className={`flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-foreground/[0.07] ${
              !isFpvActive && !canEnterFpv
                ? "cursor-not-allowed opacity-30"
                : ""
            }`}
            aria-label={
              isFpvActive
                ? "Stop following aircraft"
                : "Open aircraft follow camera"
            }
          >
            <MobileIconCell active={isFpvActive}>
              <Eye
                className={`h-3.5 w-3.5 ${isFpvActive ? "text-emerald-300" : ""}`}
              />
            </MobileIconCell>
            <span
              className={`min-w-0 flex-1 text-[13px] font-medium ${
                isFpvActive ? "text-emerald-300/90" : "text-foreground/72"
              }`}
            >
              {isFpvActive ? "Stop Following" : "Follow Aircraft"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function MobileSkylineOperationsSection({ flight }: { flight: FlightState }) {
  const internal = flight.skylineInternal;
  if (!internal) return null;

  const title = flight.skylineFlightNumber ?? formatCallsign(flight.callsign);
  const route = flight.skylineRoute ? ` ${flight.skylineRoute}` : "";
  const shortTime = (value?: string) =>
    value?.match(/T(\d{2}:\d{2})/)?.[1] ?? "-";
  const utcTime = (value?: string) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return `${new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(parsed)}Z`;
  };
  const boardingStatus = internal.passengerBoardingStatus.toLowerCase();
  const boardingBarClass = boardingStatus.includes("held")
    ? "bg-amber-300"
    : boardingStatus.includes("closed")
      ? "bg-emerald-300"
      : internal.boardedPassengers > 0
        ? "bg-sky-300"
        : "bg-foreground/35";
  const boardingPercent = Math.max(
    0,
    Math.min(internal.boardingCompletionPercent, 100),
  );
  const movementPercent = Math.max(
    0,
    Math.min(internal.movementProgressPercent, 100),
  );

  return (
    <div className="mx-4 mb-4 overflow-hidden rounded-[22px] border border-sky-400/15 bg-sky-400/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="border-b border-foreground/[0.06] px-3.5 py-3">
        <p className="text-[9px] font-semibold tracking-wide text-sky-300/85 uppercase">
          SkyLine operations
        </p>
        <p className="mt-1 truncate text-[13px] font-semibold text-foreground/88">
          {title}
          {route}
        </p>
      </div>
      <div className="grid gap-3 border-b border-foreground/[0.06] px-3.5 py-3">
        <div className="min-w-0">
          <p className="truncate text-[8px] font-semibold tracking-wide text-foreground/35 uppercase">
            Aircraft position
          </p>
          <p className="mt-1 truncate text-[13px] font-semibold text-foreground/86">
            {internal.aircraftLocationSummary}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-foreground/42">
            {internal.aircraftLocationDetail}
          </p>
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[8px] font-semibold tracking-wide text-foreground/35 uppercase">
              Live movement
            </p>
            <span className="shrink-0 rounded-md border border-foreground/[0.08] bg-background/35 px-2 py-0.5 text-[9px] font-semibold text-foreground/70">
              {internal.operationType}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
            aria-label={`Route movement ${movementPercent}% complete`}
          >
            <span
              className={`block h-full rounded-full ${internal.movementActive ? "bg-sky-300" : "bg-emerald-300"}`}
              style={{ width: `${movementPercent}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-foreground/42">
            {internal.movementPhase} - {movementPercent}% route progress
            {internal.movementActive ? ` - ETA ${utcTime(internal.estimatedArrival)}` : ""}
          </p>
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[8px] font-semibold tracking-wide text-foreground/35 uppercase">
              Passenger boarding
            </p>
            <span className="shrink-0 rounded-md border border-foreground/[0.08] bg-background/35 px-2 py-0.5 text-[9px] font-semibold text-foreground/70">
              {internal.passengerBoardingStatus}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
            aria-label={`Passenger boarding ${boardingPercent}% complete`}
          >
            <span
              className={`block h-full rounded-full ${boardingBarClass}`}
              style={{ width: `${boardingPercent}%` }}
            />
          </div>
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-foreground/42">
            {internal.passengerBoardingDetail}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-px bg-foreground/[0.06]">
        {[
          ["Position", `${internal.airport} ${internal.stand}`],
          ["Boarding", `${internal.boardingCompletionPercent}%`],
          ["PAX", `${internal.boardedPassengers}/${internal.bookedPassengers}`],
          ["Bags", `${internal.loadedBags}/${internal.acceptedBags}`],
        ].map(([label, value]) => (
          <div key={label} className="bg-background/35 px-2 py-2.5">
            <p className="truncate text-[8px] font-semibold tracking-wide text-foreground/35 uppercase">
              {label}
            </p>
            <p className="mt-1 truncate text-[12px] font-semibold text-foreground/86">
              {value}
            </p>
          </div>
        ))}
      </div>
      <MobileGroupedRow icon={<Plane className="h-3.5 w-3.5" />}>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            {internal.gateProcessStatus}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            {internal.gateProcessDetail}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Plane className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            {internal.boardingState} - {internal.boardedPassengers} boarded
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            {internal.checkedInPassengers} checked in - {internal.boardingGroup}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Plane className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            DCS {internal.dcsStatus} - {internal.passengerReconciliationStatus}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            {internal.passengerExceptionSummary} - close {shortTime(internal.boardingCloseTarget)}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Navigation className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            Documents {internal.documentCheckStatus} - Security {internal.securityStatus}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            {internal.gateAgent}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Gauge className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            Readiness {internal.departureReadinessStatus} - {internal.departureReadinessOpenItems} open
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            {internal.departureBoardingClosed ? "Boarding closed" : "Boarding not closed"} - off-block {shortTime(internal.estimatedOffBlock)}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Navigation className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            OFP {internal.operationalFlightPlanStatus} - Release {internal.dispatchReleaseStatus}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            Loadsheet {internal.finalLoadsheetStatus} - BRS {internal.baggageReconciliationStatus}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Gauge className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            Release {internal.aircraftReleaseState} - MEL {internal.aircraftMelStatus}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            Base {internal.aircraftHomeBase} - next maintenance {internal.aircraftNextMaintenanceDue}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Gauge className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            Checklist {internal.turnaroundChecklistStatus} - {internal.turnaroundChecklistOpenItems} open
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            Parts {internal.partsToolingStatus} - {internal.latestReleaseEvent}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Gauge className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            Fuel {internal.fuelStatus} - Loadsheet {internal.loadSheetStatus}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            Bags {internal.baggageStatus} - Doors {internal.doorsStatus}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Gauge className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            Ground {internal.groundServiceStatus} - {internal.groundServiceOpenItems} open
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            {internal.groundServiceBlockedItem ?? internal.groundServiceSummary}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Navigation className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            {internal.turnaroundStatus} - {internal.readyToClose ? "Ready to close" : "Not ready"}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            TOBT {shortTime(internal.tobt)} - TSAT {shortTime(internal.tsat)}
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Gauge className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            {internal.delayCause === "None"
              ? flight.skylineStatus ?? "Normal"
              : `${internal.delayCause} - ${internal.delayOwner}`}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            Delay owner
          </p>
        </div>
      </MobileGroupedRow>
      <MobileGroupedRow icon={<Navigation className="h-3.5 w-3.5" />} divided>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/76">
            {internal.notificationState}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-foreground/42">
            Passenger notifications
          </p>
        </div>
      </MobileGroupedRow>
      <div className="border-t border-foreground/[0.06] px-3.5 py-3">
        <p className="text-[9px] font-semibold tracking-wide text-foreground/35 uppercase">
          Next action
        </p>
        <p className="mt-1 text-[12px] leading-5 text-foreground/72">
          {internal.nextReadinessAction}
        </p>
        <p className="mt-1 truncate text-[11px] text-foreground/40">
          {internal.readinessController} - {internal.flightPlanRevision}
        </p>
        {internal.crew.length > 0 ? (
          <p className="mt-2 truncate text-[11px] text-foreground/40">
            Crew: {internal.crew.slice(0, 4).join(", ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MobileIconCell({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-foreground/[0.06] bg-background/45 text-foreground/36 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
        active &&
          "border-emerald-300/20 bg-emerald-400/10 text-emerald-300/90",
      )}
    >
      {children}
    </span>
  );
}

function MobileGroupedRow({
  icon,
  children,
  divided = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  divided?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center gap-3 px-3.5 py-2.5",
        divided && "border-t border-foreground/[0.06]",
      )}
    >
      <MobileIconCell>{icon}</MobileIconCell>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function MiniMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[16px] border border-foreground/[0.055] bg-background/35 px-1.5 py-2">
      <div className="flex items-center gap-1 text-foreground/38">
        {icon}
        <span className="text-[8px] font-semibold tracking-wide uppercase">
          {label}
        </span>
      </div>
      <p className="max-w-full text-center text-[11px] font-semibold leading-tight tabular-nums text-foreground/90 [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}
