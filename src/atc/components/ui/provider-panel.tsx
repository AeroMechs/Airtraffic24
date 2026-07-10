"use client";

import { useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Satellite, X, ChevronUp, Circle } from "lucide-react";
import { useDropdownDismiss } from "@/atc/hooks/use-dropdown-dismiss";

interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  badge: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: "FlightRadar24 live feed",
    label: "FlightRadar24 live",
    description: "Primary cached regional live aircraft radar feed",
    badge: "Primary",
  },
  {
    id: "FlightRadar24 cached feed",
    label: "Latest real snapshot",
    description: "Short-lived resilience cache during provider interruptions",
    badge: "Resilience",
  },
];

const SOURCE_LABELS: Record<string, string> = {
  "FlightRadar24 live feed": "Live traffic",
  "FlightRadar24 cached feed": "Cached traffic",
  adsb: "adsb.lol",
  opensky: "OpenSky",
  airplanes: "Airplanes.live",
  none: "Unavailable",
};

const SOURCE_COLORS: Record<string, string> = {
  "FlightRadar24 live feed": "rgb(52, 211, 153)",
  "FlightRadar24 cached feed": "rgb(251, 191, 36)",
  adsb: "rgb(52, 211, 153)",
  opensky: "rgb(251, 191, 36)",
  airplanes: "rgb(96, 165, 250)",
  none: "rgb(248, 113, 113)",
};

export type ProviderDropdownProps = {
  open: boolean;
  onClose: () => void;
  currentSource: string | null;
};

export function ProviderDropdown({
  open,
  onClose,
  currentSource,
}: ProviderDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  useDropdownDismiss(dropdownRef, open, onClose);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute bottom-full left-0 z-50 mb-2 w-[calc(100vw-2rem)] max-w-80 overflow-hidden rounded-xl border shadow-2xl shadow-background/60 backdrop-blur-2xl sm:w-80 sm:max-w-none"
          style={{
            borderColor: "rgb(var(--ui-fg) / 0.08)",
            backgroundColor: "rgb(var(--ui-bg) / 0.75)",
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: "1px solid rgb(var(--ui-fg) / 0.06)" }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Satellite className="h-3 w-3 shrink-0 text-emerald-400/70" />
              <span
                className="truncate text-[10px] font-semibold tracking-wide"
                style={{ color: "rgb(var(--ui-fg) / 0.35)" }}
              >
                Live traffic stack
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-foreground/5 active:bg-foreground/10"
              aria-label="Close provider details"
            >
              <X
                className="h-3 w-3"
                style={{ color: "rgb(var(--ui-fg) / 0.3)" }}
              />
            </button>
          </div>

          <div className="py-1">
            {PROVIDERS.map((provider) => {
              const isActive = currentSource === provider.id;
              const color =
                SOURCE_COLORS[provider.id] ?? "rgb(var(--ui-fg) / 0.3)";

              return (
                <div
                  key={provider.id}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2 ${
                    isActive ? "bg-foreground/6" : ""
                  }`}
                >
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <Circle
                      className="h-2.5 w-2.5"
                      style={{
                        color: isActive ? color : "rgb(var(--ui-fg) / 0.2)",
                      }}
                      fill={isActive ? color : "transparent"}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0">
                    <span
                      className="truncate text-[11px] font-medium leading-snug"
                      style={{
                        color: isActive
                          ? "rgb(var(--ui-fg) / 0.85)"
                          : "rgb(var(--ui-fg) / 0.55)",
                      }}
                    >
                      {provider.label}
                    </span>
                    <span
                      className="truncate text-[9px] leading-snug"
                      style={{ color: "rgb(var(--ui-fg) / 0.25)" }}
                    >
                      {provider.description}
                    </span>
                  </div>
                  <span
                    className="shrink-0 rounded px-1.5 py-px text-[8px] font-bold tracking-wider"
                    style={{
                      backgroundColor: `${color}12`,
                      color,
                    }}
                  >
                    {isActive ? "Active" : provider.badge}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type ProviderTriggerProps = {
  source: string | null;
  loading: boolean;
  rateLimited: boolean;
  onClick: () => void;
};

export function ProviderTrigger({
  source,
  loading,
  rateLimited,
  onClick,
}: ProviderTriggerProps) {
  const label = rateLimited
    ? "Paused"
    : loading && !source
      ? "Connecting..."
      : source
        ? (SOURCE_LABELS[source] ?? source)
        : "Connecting...";

  const dotColor = rateLimited
    ? "text-amber-400/80"
      : source === "none"
        ? "text-red-400/80"
      : source === "opensky"
        ? "text-amber-400/80"
        : source === "airplanes"
          ? "text-blue-400/80"
          : source === "FlightRadar24 cached feed"
            ? "text-amber-400/80"
            : "text-emerald-400/80";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 items-center gap-2"
      aria-label="Show live traffic provider details"
    >
      <Satellite className={`h-3 w-3 shrink-0 ${dotColor}`} />
      <span
        className="truncate text-[11px] font-medium tracking-wide"
        style={{ color: "rgb(var(--ui-fg) / 0.4)" }}
      >
        {label}
      </span>
      <ChevronUp
        className="h-3 w-3 shrink-0"
        style={{ color: "rgb(var(--ui-fg) / 0.35)" }}
      />
    </button>
  );
}
