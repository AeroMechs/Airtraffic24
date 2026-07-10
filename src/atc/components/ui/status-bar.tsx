"use client";

import { useState, useCallback } from "react";
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
  cityName: string;
  cityIata: string;
  cityCoordinates: [number, number];
  flightCount?: number;
  initialLoading?: boolean;
  refreshing?: boolean;
  radarSource?: string | null;
  radarStale?: boolean;
  radarUnavailable?: boolean;
  radarError?: string | null;
  lastUpdatedAt?: number | null;
  rateLimited?: boolean;
  retryIn?: number;
  onNorthUp?: () => void;
  onResetView?: () => void;
  onRandomAirport?: () => void;
  atc: UseAtcStreamReturn;
  /** Incremented externally to toggle the feed dropdown (e.g. from keyboard shortcut) */
  atcToggle?: number;
};

export function StatusBar({
  cityName,
  cityIata,
  cityCoordinates,
  flightCount = 0,
  initialLoading = false,
  refreshing = false,
  radarSource = null,
  radarStale = false,
  radarUnavailable = false,
  radarError = null,
  lastUpdatedAt = null,
  rateLimited = false,
  retryIn = 0,
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
  const formattedFlightCount = flightCount.toLocaleString("en-US");
  const feedLabel = connecting
    ? "Connecting to live traffic"
    : unavailable
      ? "Live traffic unavailable"
      : degraded
        ? `Cached real traffic · ${formattedFlightCount}`
        : refreshing
          ? `Updating · ${formattedFlightCount}`
          : `Live · ${formattedFlightCount}`;
  const feedTitle = [
    radarSource,
    lastUpdatedAt
      ? `Last update ${new Date(lastUpdatedAt).toISOString()}`
      : null,
    radarError,
  ]
    .filter(Boolean)
    .join(" · ");
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

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 25, delay: 0.2 }}
        className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 backdrop-blur-2xl"
        style={{
          borderColor: unavailable
            ? "rgb(251 113 133 / 0.18)"
            : degraded
              ? "rgb(251 191 36 / 0.16)"
              : "rgb(var(--ui-fg) / 0.06)",
          backgroundColor: "rgb(var(--ui-bg) / 0.52)",
        }}
        role="status"
        aria-live="polite"
        title={feedTitle || undefined}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            unavailable
              ? "bg-rose-400"
              : degraded
                ? "bg-amber-400"
                : "bg-emerald-400"
          } ${connecting || refreshing ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />
        <span
          className={`text-[10px] font-semibold tracking-wide ${
            unavailable
              ? "text-rose-300/80"
              : degraded
                ? "text-amber-300/75"
                : "text-foreground/55"
          }`}
        >
          {feedLabel}
        </span>
      </motion.div>

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
