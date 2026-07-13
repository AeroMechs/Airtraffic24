"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Dices, ShieldAlert } from "lucide-react";
import {
  AtcTrigger,
  AtcFeedDropdown,
  useAvailableFeeds,
} from "@/atc/components/ui/atc-panel";
import type { UseAtcStreamReturn } from "@/atc/hooks/use-atc-stream";

import {
  resolveDropdownState,
  type StatusBarDropdownState,
} from "./status-bar-state";

type StatusBarProps = {
  cityName?: string | null;
  cityIata: string;
  cityCoordinates: [number, number];
  flightCount?: number;
  initialLoading?: boolean;
  radarSource?: string | null;
  radarStale?: boolean;
  radarUnavailable?: boolean;
  radarError?: string | null;
  radarMode?: "global" | "nearby";
  radarRefreshing?: boolean;
  radarLastUpdatedAt?: number | null;
  radarRequestDurationMs?: number | null;
  rateLimited?: boolean;
  retryIn?: number;
  selectedAircraft?: boolean;
  selectedAircraftLive?: boolean;
  selectedAircraftLastContactAt?: number | null;
  onNorthUp?: () => void;
  onResetView?: () => void;
  onRandomAirport?: () => void;
  atc: UseAtcStreamReturn;
  /** Incremented externally to toggle the feed dropdown (e.g. from keyboard shortcut) */
  atcToggle?: number;
};

type LiveQualityInput = {
  now: number;
  mode: "global" | "nearby";
  initialLoading: boolean;
  radarStale: boolean;
  radarUnavailable: boolean;
  radarError: string | null;
  rateLimited: boolean;
  selectedAircraftLive: boolean;
  aircraftLastContactAt: number | null;
  radarLastUpdatedAt: number | null;
  radarRequestDurationMs: number | null;
};

const MAX_TIMESTAMP_FUTURE_SKEW_MS = 30_000;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function linearQuality(value: number, freshAt: number, zeroAt: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(
    100 * (1 - clamp((value - freshAt) / (zeroAt - freshAt), 0, 1)),
  );
}

function observationAge(now: number, observedAt: number) {
  if (
    !Number.isFinite(observedAt) ||
    observedAt <= 0 ||
    observedAt > now + MAX_TIMESTAMP_FUTURE_SKEW_MS
  ) {
    return null;
  }
  return Math.max(0, now - observedAt);
}

function calculateLiveQuality({
  now,
  mode,
  initialLoading,
  radarStale,
  radarUnavailable,
  radarError,
  rateLimited,
  selectedAircraftLive,
  aircraftLastContactAt,
  radarLastUpdatedAt,
  radarRequestDurationMs,
}: LiveQualityInput) {
  if (initialLoading || radarLastUpdatedAt === null) return 0;

  const snapshotAgeMs = observationAge(now, radarLastUpdatedAt);
  if (snapshotAgeMs === null) return 0;
  const snapshotQuality = linearQuality(
    snapshotAgeMs,
    mode === "global" ? 40_000 : 12_000,
    mode === "global" ? 120_000 : 45_000,
  );
  const deliveryQuality =
    radarRequestDurationMs === null
      ? 50
      : linearQuality(radarRequestDurationMs, 750, 15_000);

  let quality: number;
  const aircraftAgeMs =
    aircraftLastContactAt === null
      ? null
      : observationAge(now, aircraftLastContactAt);
  if (aircraftAgeMs !== null) {
    const aircraftQuality = linearQuality(
      aircraftAgeMs,
      10_000,
      120_000,
    );
    quality = Math.round(
      aircraftQuality * 0.6 +
        snapshotQuality * 0.25 +
        deliveryQuality * 0.15,
    );
  } else {
    quality = Math.min(
      69,
      Math.round(snapshotQuality * 0.75 + deliveryQuality * 0.25),
    );
    if (aircraftLastContactAt !== null) quality = Math.min(quality, 29);
  }

  if (!selectedAircraftLive) quality = Math.min(quality, 29);
  if (radarUnavailable || radarError || rateLimited) {
    quality = Math.min(quality, 29);
  } else if (radarStale) {
    quality = Math.min(quality, 59);
  }

  return clamp(Math.round(quality), 0, 100);
}

function LiveQualityMeter({
  active,
  mode,
  initialLoading,
  radarStale,
  radarUnavailable,
  radarError,
  rateLimited,
  refreshing,
  selectedAircraftLive,
  aircraftLastContactAt,
  radarLastUpdatedAt,
  radarRequestDurationMs,
}: {
  active: boolean;
  mode: "global" | "nearby";
  initialLoading: boolean;
  radarStale: boolean;
  radarUnavailable: boolean;
  radarError: string | null;
  rateLimited: boolean;
  refreshing: boolean;
  selectedAircraftLive: boolean;
  aircraftLastContactAt: number | null;
  radarLastUpdatedAt: number | null;
  radarRequestDurationMs: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const updateNow = () => setNow(Date.now());
    const kickoff = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, 1_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [active]);

  const quality = useMemo(
    () =>
      calculateLiveQuality({
        now,
        mode,
        initialLoading,
        radarStale,
        radarUnavailable,
        radarError,
        rateLimited,
        selectedAircraftLive,
        aircraftLastContactAt,
        radarLastUpdatedAt,
        radarRequestDurationMs,
      }),
    [
      aircraftLastContactAt,
      initialLoading,
      mode,
      now,
      radarError,
      radarLastUpdatedAt,
      radarRequestDurationMs,
      radarStale,
      radarUnavailable,
      rateLimited,
      selectedAircraftLive,
    ],
  );

  if (!active) return null;

  const band =
    quality >= 70
      ? {
          label: "Live",
          text: "text-emerald-700 dark:text-emerald-400",
          dot: "bg-emerald-500",
        }
      : quality >= 40
        ? {
            label: "Delayed",
            text: "text-amber-700 dark:text-amber-300",
            dot: "bg-amber-500",
          }
        : {
            label: "Poor",
            text: "text-red-700 dark:text-red-400",
            dot: "bg-red-500",
          };

  return (
    <div
      role="meter"
      aria-label="Live data quality"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={quality}
      aria-valuetext={`${quality} percent, ${band.label}`}
      title="Live data quality based on radar position freshness and response delivery"
      className={`flex min-w-10 shrink-0 items-center justify-end gap-1.5 font-mono text-[0.6875rem] font-semibold tabular-nums ${band.text}`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${band.dot} ${refreshing ? "motion-safe:animate-pulse" : ""}`}
      />
      <span>{quality}%</span>
    </div>
  );
}

export function StatusBar({
  cityName,
  cityIata,
  cityCoordinates,
  flightCount = 0,
  initialLoading = false,
  radarSource = null,
  radarStale = false,
  radarUnavailable = false,
  radarError = null,
  radarMode = "global",
  radarRefreshing = false,
  radarLastUpdatedAt = null,
  radarRequestDurationMs = null,
  rateLimited = false,
  retryIn = 0,
  selectedAircraft = false,
  selectedAircraftLive = false,
  selectedAircraftLastContactAt = null,
  onNorthUp,
  onResetView,
  onRandomAirport,
  atc,
  atcToggle,
}: StatusBarProps) {
  const [dropdownState, setDropdownState] = useState<StatusBarDropdownState>(
    () => ({
      feedDropdownOpen: false,
      handledAtcToggle: atcToggle,
    }),
  );
  const availableFeeds = useAvailableFeeds(cityIata, cityCoordinates);

  const { feedDropdownOpen } = resolveDropdownState(
    dropdownState,
    atcToggle,
  );

  const toggleFeedDropdown = useCallback(() => {
    setDropdownState((state) => {
      const resolved = resolveDropdownState(state, atcToggle);
      return {
        feedDropdownOpen: !resolved.feedDropdownOpen,
        handledAtcToggle: atcToggle ?? state.handledAtcToggle,
      };
    });
  }, [atcToggle]);

  const closeFeedDropdown = useCallback(() => {
    setDropdownState((state) => {
      const resolved = resolveDropdownState(state, atcToggle);
      return {
        ...state,
        ...resolved,
        feedDropdownOpen: false,
        handledAtcToggle: atcToggle ?? state.handledAtcToggle,
      };
    });
  }, [atcToggle]);

  const isAtcPlaying = atc.status === "playing";
  const connecting =
    initialLoading || (!radarSource && flightCount === 0 && !radarError);
  const unavailable =
    flightCount === 0 &&
    (radarUnavailable || (!!radarError && !connecting));
  const degraded =
    flightCount > 0 && (radarStale || radarUnavailable || !!radarError);
  const showFeedWarning = !rateLimited && (unavailable || degraded);

  return (
    <div className="relative flex flex-col items-start gap-2">
      <AnimatePresence>
        {(rateLimited || showFeedWarning) && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="flex items-center gap-2.5 rounded-xl border border-amber-500/15 bg-amber-500/6 px-3.5 py-2 backdrop-blur-2xl"
            role="alert"
          >
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400/80" />
            <span className="text-[11px] font-medium tracking-wide text-amber-300/70">
              {rateLimited
                ? "Rate limited"
                : unavailable
                  ? "Live traffic temporarily unavailable"
                  : "Refresh delayed · showing last real positions"}
            </span>
            {retryIn > 0 && (
              <>
                <div className="h-3 w-px bg-amber-400/10" />
                <span className="font-mono text-[11px] font-semibold tabular-nums text-amber-400/60">
                  {retryIn}s
                </span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:items-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 24,
            delay: 0.48,
          }}
          className="flex items-center gap-3 rounded-xl border px-3.5 py-2 backdrop-blur-2xl"
          style={{
            borderColor: "rgb(var(--ui-fg) / 0.06)",
            backgroundColor: "rgb(var(--ui-bg) / 0.5)",
          }}
        >
          <button
            type="button"
            onClick={onNorthUp}
            aria-label="North up"
            title="North up"
            className="text-[11px] font-medium tracking-wide transition-colors"
            style={{ color: "rgb(var(--ui-fg) / 0.55)" }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="currentColor"
            >
              <path d="M12 3L4 21l8-4 8 4L12 3z" />
            </svg>
          </button>
          <div
            className="h-3 w-px"
            style={{ backgroundColor: "rgb(var(--ui-fg) / 0.08)" }}
          />
          <button
            type="button"
            onClick={onResetView}
            className="text-[11px] font-medium tracking-wide transition-colors"
            style={{ color: "rgb(var(--ui-fg) / 0.55)" }}
          >
            Reset
          </button>
          <div
            className="h-3 w-px"
            style={{ backgroundColor: "rgb(var(--ui-fg) / 0.08)" }}
          />
          <button
            type="button"
            onClick={onRandomAirport}
            aria-label="Random airport"
            title="Random airport"
            className="inline-flex items-center gap-1 text-[11px] font-medium tracking-wide transition-colors"
            style={{ color: "rgb(var(--ui-fg) / 0.55)" }}
          >
            <Dices className="h-3 w-3" />
            Random
          </button>
          {selectedAircraft && (
            <>
              <div
                className="h-3 w-px"
                style={{ backgroundColor: "rgb(var(--ui-fg) / 0.08)" }}
              />
              <LiveQualityMeter
                active={selectedAircraft}
                mode={radarMode}
                initialLoading={initialLoading}
                radarStale={radarStale}
                radarUnavailable={radarUnavailable}
                radarError={radarError}
                rateLimited={rateLimited}
                refreshing={radarRefreshing}
                selectedAircraftLive={selectedAircraftLive}
                aircraftLastContactAt={selectedAircraftLastContactAt}
                radarLastUpdatedAt={radarLastUpdatedAt}
                radarRequestDurationMs={radarRequestDurationMs}
              />
            </>
          )}
          {cityName && (
            <>
              <div
                className="h-3 w-px"
                style={{ backgroundColor: "rgb(var(--ui-fg) / 0.08)" }}
              />
              <span
                className="max-w-28 truncate text-[11px] font-medium tracking-wide sm:max-w-40"
                style={{ color: "rgb(var(--ui-fg) / 0.42)" }}
                title={cityName}
              >
                {cityName}
              </span>
            </>
          )}
          <AtcTrigger
            hasFeeds={availableFeeds.length > 0}
            isPlaying={isAtcPlaying}
            isError={atc.status === "error" || atc.status === "blocked"}
            onClick={toggleFeedDropdown}
          />
        </motion.div>
      </div>

      {/* Dropdowns - positioned above entire status bar */}
      <AtcFeedDropdown
        feeds={availableFeeds}
        atc={atc}
        open={feedDropdownOpen}
        onClose={closeFeedDropdown}
      />
    </div>
  );
}
