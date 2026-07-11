"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import {
  Check,
  RotateCw,
  Route,
  Layers,
  Palette,
  Globe,
  ArrowLeftRight,
  Ruler,
  Shield,
  Eye,
  CloudRain,
  Cpu,
  Gauge,
  ChevronDown,
  Search,
} from "lucide-react";
import {
  useSettings,
  AIRSPACE_OPACITY_MIN,
  AIRSPACE_OPACITY_MAX,
  WEATHER_RADAR_OPACITY_MIN,
  WEATHER_RADAR_OPACITY_MAX,
  TRAIL_THICKNESS_MIN,
  TRAIL_THICKNESS_MAX,
  TRAIL_DISTANCE_MIN,
  TRAIL_DISTANCE_MAX,
  type OrbitDirection,
  type UnitSystem,
  type Settings,
} from "@/atc/hooks/use-settings";
import { ScrollArea } from "@/atc/components/ui/scroll-area";
import { Slider } from "@/atc/components/ui/slider";
import { SHORTCUTS } from "@/atc/components/ui/keyboard-shortcuts-help";
import {
  getRadarCountryCoverage,
  RADAR_COUNTRY_OPTIONS,
  WORLD_RADAR_COUNTRY,
} from "@/atc/lib/radar-countries";

const ORBIT_SPEED_PRESETS = [
  { label: "Slow", value: 0.06 },
  { label: "Normal", value: 0.15 },
  { label: "Fast", value: 0.35 },
];

const ORBIT_SPEED_MIN = 0.02;
const ORBIT_SPEED_MAX = 0.5;
const ORBIT_SNAP_THRESHOLD = 0.025;
const ORBIT_DIRECTIONS: { label: string; value: OrbitDirection }[] = [
  { label: "Clockwise", value: "clockwise" },
  { label: "Counter", value: "counter-clockwise" },
];

const ALTITUDE_DISPLAY_MODES: {
  label: string;
  value: Settings["altitudeDisplayMode"];
}[] = [
  { label: "Presentation", value: "presentation" },
  { label: "Realistic", value: "realistic" },
];

const UNIT_SYSTEMS: { label: string; value: UnitSystem }[] = [
  { label: "Aviation", value: "aviation" },
  { label: "Metric", value: "metric" },
  { label: "Imperial", value: "imperial" },
];

const RENDER_QUALITY_OPTIONS: {
  label: string;
  value: Settings["renderQuality"];
  description: string;
}[] = [
  {
    label: "Data Saver",
    value: "data-saver",
    description:
      "Reduces aircraft detail and visual effects to keep older and mobile devices smooth.",
  },
  {
    label: "Medium",
    value: "balanced",
    description:
      "Keeps detailed aircraft while adapting the workload for most devices.",
  },
  {
    label: "High",
    value: "high",
    description:
      "Uses the richest aircraft detail and visual effects on capable hardware.",
  },
];

export function SettingsContent({
  airspaceAvailable = true,
}: {
  airspaceAvailable?: boolean;
}) {
  const { settings, update, reset } = useSettings();
  const showAirspace = airspaceAvailable && settings.showAirspace;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-0.5 px-2 pb-6 pt-1 sm:px-3">
        {/* ── Camera ── */}
        <SectionHeader title="Camera" />

        <SettingRow
          icon={<RotateCw className="h-4 w-4" />}
          title="Auto-orbit"
          description="Camera slowly rotates around the airport"
          checked={settings.autoOrbit}
          onChange={(v) => update("autoOrbit", v)}
        />

        {settings.autoOrbit && (
          <>
            <OrbitSpeedSlider
              value={settings.orbitSpeed}
              onChange={(v) => update("orbitSpeed", v)}
            />
            <SegmentRow
              icon={<ArrowLeftRight className="h-4 w-4" />}
              title="Direction"
              options={ORBIT_DIRECTIONS}
              value={settings.orbitDirection}
              onChange={(v) => update("orbitDirection", v)}
            />
          </>
        )}

        {/* ── Visuals ── */}
        <SectionHeader title="Visuals" />

        <SettingRow
          icon={<Route className="h-4 w-4" />}
          title="Flight trails"
          description="Altitude-colored trails behind aircraft"
          checked={settings.showTrails}
          onChange={(v) => update("showTrails", v)}
        />
        {settings.showTrails && (
          <>
            <TrailThicknessSlider
              value={settings.trailThickness}
              onChange={(v) => update("trailThickness", v)}
            />
            <TrailDistanceSlider
              value={settings.trailDistance}
              onChange={(v) => update("trailDistance", v)}
            />
          </>
        )}
        <SettingRow
          icon={<Palette className="h-4 w-4" />}
          title="Altitude colors"
          description="Color aircraft and trails by altitude"
          checked={settings.showAltitudeColors}
          onChange={(v) => update("showAltitudeColors", v)}
        />
        <SegmentRow
          icon={<Eye className="h-4 w-4" />}
          title="Altitude mode"
          options={ALTITUDE_DISPLAY_MODES}
          value={settings.altitudeDisplayMode}
          onChange={(v) => update("altitudeDisplayMode", v)}
        />

        {/* ── Units ── */}
        <SectionHeader title="Units" />

        <SegmentRow
          icon={<Ruler className="h-4 w-4" />}
          title="Unit system"
          options={UNIT_SYSTEMS}
          value={settings.unitSystem}
          onChange={(v) => update("unitSystem", v)}
        />

        {/* Traffic */}
        <SectionHeader title="Traffic" />

        <RadarCountrySelect
          value={settings.radarCountry}
          onChange={(v) => update("radarCountry", v)}
        />

        {/* ── Airspace ── */}
        <SectionHeader title="Airspace" />

        <SettingRow
          icon={<Shield className="h-4 w-4" />}
          title="Airspace overlay"
          description={
            airspaceAvailable
              ? "Show classified airspace boundaries (OpenAIP)"
              : "Unavailable on this deployment until OPENAIP_API_KEY is configured"
          }
          checked={showAirspace}
          onChange={(v) => update("showAirspace", v)}
          disabled={!airspaceAvailable}
          badge={airspaceAvailable ? undefined : "SETUP"}
        />

        {showAirspace && (
          <AirspaceOpacitySlider
            value={settings.airspaceOpacity}
            onChange={(v) => update("airspaceOpacity", v)}
          />
        )}

        {/* ── Weather ── */}
        <SectionHeader title="Weather" />

        <SettingRow
          icon={<CloudRain className="h-4 w-4" />}
          title="Weather radar"
          description="Live precipitation radar overlay (RainViewer)"
          checked={settings.showWeatherRadar}
          onChange={(v) => update("showWeatherRadar", v)}
        />

        {settings.showWeatherRadar && (
          <WeatherRadarOpacitySlider
            value={settings.weatherRadarOpacity}
            onChange={(v) => update("weatherRadarOpacity", v)}
          />
        )}

        {/* ── Performance ── */}
        <SectionHeader title="Performance" />

        <RenderQualityControl
          value={settings.renderQuality}
          onChange={(v) => update("renderQuality", v)}
        />

        <SettingRow
          icon={<Globe className="h-4 w-4" />}
          title="Globe mode"
          description="Display earth as a 3D sphere when zoomed out"
          checked={settings.globeMode}
          onChange={(v) => update("globeMode", v)}
          badge="BETA"
        />

        {/* ── Advanced ── */}
        <SectionHeader title="Advanced" />

        <SettingRow
          icon={<Cpu className="h-4 w-4" />}
          title="Show debug data"
          description="Display raw receiver metrics and route source"
          checked={settings.showDebugData}
          onChange={(v) => update("showDebugData", v)}
        />

        <div className="border-t border-foreground/8 px-3 pt-4">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-10 items-center justify-center rounded-lg px-3 text-sm font-medium text-foreground/75 ring-1 ring-foreground/12 hover:bg-foreground/5 hover:text-foreground/90 sm:min-h-8 sm:text-xs"
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </ScrollArea>
  );
}

export function ShortcutsContent() {
  return (
    <ScrollArea className="h-full">
      <div className="p-3 pt-1">
        <div className="space-y-1">
          {SHORTCUTS.map(({ key, description }) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-foreground/4"
            >
              <span className="text-[13px] font-medium text-foreground/75">
                {description}
              </span>
              <kbd className="flex h-7 min-w-7 items-center justify-center rounded-md bg-foreground/6 px-2 font-mono text-[11px] font-semibold text-foreground/80 ring-1 ring-foreground/10">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

function RadarCountrySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId().replace(/:/g, "");
  const listboxId = `${id}-radar-countries`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const coverage = getRadarCountryCoverage(value);
  const selectedLabel =
    value === WORLD_RADAR_COUNTRY ? "World" : (coverage?.label ?? "World");
  const detail =
    value === WORLD_RADAR_COUNTRY
      ? "All available live regional tiles"
      : coverage
        ? `${coverage.airportCount.toLocaleString()} indexed airports, ${coverage.radiusNm.toLocaleString()} NM coverage`
        : "All available live regional tiles";

  const options = useMemo(
    () => [
      {
        code: WORLD_RADAR_COUNTRY,
        label: "World",
        airportCount: null,
        radiusNm: null,
      },
      ...RADAR_COUNTRY_OPTIONS,
    ],
    [],
  );
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;
    return options.filter(
      (option) =>
        option.label.toLocaleLowerCase().includes(normalizedQuery) ||
        option.code.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [options, query]);
  const activeOption = filteredOptions[activeIndex] ?? null;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    if (!open || !activeOption) return;
    document
      .getElementById(`${listboxId}-${activeOption.code}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeOption, listboxId, open]);

  const openSelector = () => {
    setQuery("");
    setActiveIndex(
      Math.max(
        0,
        options.findIndex((option) => option.code === value),
      ),
    );
    setOpen(true);
  };

  const selectOption = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (!filteredOptions.length) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (current) =>
          (current + direction + filteredOptions.length) %
          filteredOptions.length,
      );
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : filteredOptions.length - 1);
      return;
    }

    if (event.key === "Enter" && activeOption) {
      event.preventDefault();
      selectOption(activeOption.code);
    }
  };

  return (
    <div
      ref={rootRef}
      className="flex w-full flex-col gap-3 px-3 py-3 text-left"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="flex items-start gap-3">
        <Globe className="size-4 h-lh shrink-0 stroke-foreground/45" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground/90 sm:text-[13px]">
            Radar Country
          </p>
          <p className="text-xs/5 font-medium text-foreground/45 sm:text-[11px]/4">
            Choose worldwide traffic or focus live fetching on one country.
          </p>
        </div>
      </div>

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openSelector())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openSelector();
          }
        }}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-foreground/4 px-3 py-2 text-left ring-1 ring-foreground/9 hover:bg-foreground/6 focus-visible:outline-2 focus-visible:outline-emerald-400/55 sm:min-h-10"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground/85 sm:text-xs">
            {selectedLabel}
          </p>
          <p className="truncate text-xs text-foreground/40 sm:text-[11px]">
            {detail}
          </p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 stroke-foreground/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="overflow-hidden rounded-xl bg-popover ring-1 ring-foreground/10 shadow-[0_16px_40px_rgba(0,0,0,0.28)] dark:shadow-none">
          <label className="flex items-center gap-2 border-b border-foreground/8 px-3">
            <Search className="size-4 shrink-0 stroke-foreground/35" />
            <input
              ref={inputRef}
              type="search"
              name="radar-country-search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              role="combobox"
              aria-label="Search Radar Countries"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={
                activeOption ? `${listboxId}-${activeOption.code}` : undefined
              }
              placeholder="Search countries"
              autoComplete="off"
              className="min-h-12 w-full bg-transparent text-base text-foreground/85 outline-none placeholder:text-foreground/30 sm:min-h-10 sm:text-sm"
            />
          </label>

          <ul
            id={listboxId}
            role="listbox"
            aria-label="Radar Country Coverage"
            className="max-h-32 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]"
          >
            {filteredOptions.map((option, index) => {
              const selected = option.code === value;
              const active = index === activeIndex;
              const optionDetail =
                option.code === WORLD_RADAR_COUNTRY
                  ? "All available regions"
                  : `${(option.airportCount ?? 0).toLocaleString()} airports, ${(option.radiusNm ?? 0).toLocaleString()} NM`;

              return (
                <li
                  key={option.code}
                  id={`${listboxId}-${option.code}`}
                  role="option"
                  aria-selected={selected}
                  onPointerMove={() => setActiveIndex(index)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option.code)}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 outline-none sm:min-h-9 ${
                    active ? "bg-foreground/7" : ""
                  } ${selected ? "text-emerald-700 dark:text-emerald-200" : "text-foreground/75"}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium sm:text-xs">
                      {option.label}
                    </p>
                    <p className="truncate text-xs text-foreground/35 sm:text-[10px]">
                      {option.code === WORLD_RADAR_COUNTRY
                        ? optionDetail
                        : `${option.code}, ${optionDetail}`}
                    </p>
                  </div>
                  {selected && (
                    <Check className="size-4 shrink-0 stroke-emerald-600 dark:stroke-emerald-300" />
                  )}
                </li>
              );
            })}
            {!filteredOptions.length && (
              <li className="px-3 py-6 text-center text-sm text-foreground/40">
                No countries match your search.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function RenderQualityControl({
  value,
  onChange,
}: {
  value: Settings["renderQuality"];
  onChange: (value: Settings["renderQuality"]) => void;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeDescription =
    RENDER_QUALITY_OPTIONS.find((option) => option.value === value)
      ?.description ?? RENDER_QUALITY_OPTIONS[1].description;

  const selectByIndex = (index: number) => {
    const option = RENDER_QUALITY_OPTIONS[index];
    if (!option) return;
    onChange(option.value);
    optionRefs.current[index]?.focus();
  };

  return (
    <div className="flex w-full flex-col gap-3 px-3 py-3 text-left">
      <div className="flex items-start gap-3">
        <Gauge className="size-4 h-lh shrink-0 stroke-foreground/45" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground/90 sm:text-[13px]">
            Render Quality
          </p>
          <p className="text-xs/5 font-medium text-foreground/45 sm:text-[11px]/4">
            Choose how much visual detail the live map renders.
          </p>
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Render Quality"
        className="grid grid-cols-3 gap-1 rounded-xl bg-foreground/4 p-1 ring-1 ring-foreground/8"
      >
        {RENDER_QUALITY_OPTIONS.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => {
                let nextIndex: number | null = null;
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  nextIndex = (index + 1) % RENDER_QUALITY_OPTIONS.length;
                } else if (
                  event.key === "ArrowLeft" ||
                  event.key === "ArrowUp"
                ) {
                  nextIndex =
                    (index - 1 + RENDER_QUALITY_OPTIONS.length) %
                    RENDER_QUALITY_OPTIONS.length;
                } else if (event.key === "Home") {
                  nextIndex = 0;
                } else if (event.key === "End") {
                  nextIndex = RENDER_QUALITY_OPTIONS.length - 1;
                }

                if (nextIndex != null) {
                  event.preventDefault();
                  selectByIndex(nextIndex);
                }
              }}
              className={`min-h-11 rounded-lg px-2 py-2 text-center text-xs font-semibold outline-none focus-visible:outline-2 focus-visible:outline-emerald-400/60 sm:min-h-9 sm:text-[11px] ${
                selected
                  ? "bg-emerald-400/12 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-200 dark:ring-emerald-400/20"
                  : "text-foreground/45 hover:bg-foreground/5 hover:text-foreground/70"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs/5 text-foreground/40 sm:text-[11px]/4">
        {activeDescription}
      </p>
    </div>
  );
}

function OrbitSpeedSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const activeLabel =
    ORBIT_SPEED_PRESETS.find(
      (p) => Math.abs(p.value - value) < ORBIT_SNAP_THRESHOLD,
    )?.label ?? `${value.toFixed(2)}×`;

  function handleChange(vals: number[]) {
    let raw = vals[0];
    for (const preset of ORBIT_SPEED_PRESETS) {
      if (Math.abs(raw - preset.value) < ORBIT_SNAP_THRESHOLD) {
        raw = preset.value;
        break;
      }
    }
    onChange(raw);
  }

  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
        <RotateCw className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/85">
            Orbit speed
          </p>
          <span className="text-[11px] font-semibold text-foreground/55 tabular-nums">
            {activeLabel}
          </span>
        </div>
        <div className="relative">
          <Slider
            min={ORBIT_SPEED_MIN}
            max={ORBIT_SPEED_MAX}
            step={0.01}
            value={[value]}
            onValueChange={handleChange}
            aria-label="Orbit speed"
          />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-0.5">
            {ORBIT_SPEED_PRESETS.map((preset) => {
              const pct =
                ((preset.value - ORBIT_SPEED_MIN) /
                  (ORBIT_SPEED_MAX - ORBIT_SPEED_MIN)) *
                100;
              const isActive =
                Math.abs(preset.value - value) < ORBIT_SNAP_THRESHOLD;
              return (
                <span
                  key={preset.label}
                  className={`absolute h-1.5 w-1.5 rounded-full -translate-x-1/2 -translate-y-1/2 transition-colors ${
                    isActive ? "bg-foreground/55" : "bg-foreground/20"
                  }`}
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrailThicknessSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
        <Layers className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/85">
            Trail thickness
          </p>
          <span className="text-[11px] font-semibold text-foreground/55 tabular-nums">
            {value.toFixed(1)} px
          </span>
        </div>
        <Slider
          min={TRAIL_THICKNESS_MIN}
          max={TRAIL_THICKNESS_MAX}
          step={0.1}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Trail thickness"
        />
      </div>
    </div>
  );
}

function TrailDistanceSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
        <Route className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/85">
            Trail distance
          </p>
          <span className="text-[11px] font-semibold text-foreground/55 tabular-nums">
            {value} pts
          </span>
        </div>
        <Slider
          min={TRAIL_DISTANCE_MIN}
          max={TRAIL_DISTANCE_MAX}
          step={1}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Trail distance"
        />
      </div>
    </div>
  );
}

function AirspaceOpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
        <Eye className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/85">
            Airspace opacity
          </p>
          <span className="text-[11px] font-semibold text-foreground/55 tabular-nums">
            {Math.round(value * 100)}%
          </span>
        </div>
        <Slider
          min={AIRSPACE_OPACITY_MIN}
          max={AIRSPACE_OPACITY_MAX}
          step={0.05}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Airspace opacity"
        />
      </div>
    </div>
  );
}

function WeatherRadarOpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
        <CloudRain className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/85">
            Radar opacity
          </p>
          <span className="text-[11px] font-semibold text-foreground/55 tabular-nums">
            {Math.round(value * 100)}%
          </span>
        </div>
        <Slider
          min={WEATHER_RADAR_OPACITY_MIN}
          max={WEATHER_RADAR_OPACITY_MAX}
          step={0.05}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Weather radar opacity"
        />
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 px-3 pb-1.5 pt-5 first:pt-2">
      <h3 className="text-[10px] font-bold tracking-widest text-foreground/45 uppercase">
        {title}
      </h3>
      <div className="h-px flex-1 bg-foreground/8" />
    </div>
  );
}

function SettingRow({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled = false,
  badge,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`flex min-h-15 w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left ${
        disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:bg-foreground/4 active:bg-foreground/6"
      }`}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-foreground/85 sm:text-[13px]">
            {title}
          </p>
          {badge && (
            <div className="rounded-md bg-foreground/6 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-foreground/45 ring-1 ring-foreground/10">
              {badge}
            </div>
          )}
        </div>
        <p className="text-xs/5 font-medium text-foreground/40 sm:text-[11px]/4">
          {description}
        </p>
      </div>
      <Toggle checked={checked} />
    </button>
  );
}

function SegmentRow<T extends string | number>({
  icon,
  title,
  options,
  value,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex w-full flex-col items-stretch gap-2.5 rounded-xl px-3 py-2.5 text-left sm:flex-row sm:items-center sm:gap-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
          {icon}
        </div>
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground/85 sm:text-[13px]">
          {title}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label={title}
        className="flex w-full shrink-0 rounded-lg bg-foreground/4 p-0.5 ring-1 ring-foreground/8 sm:w-auto"
      >
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(opt.value)}
              className={`relative min-h-10 flex-1 rounded-md px-2 py-1 text-xs font-semibold outline-none focus-visible:outline-2 focus-visible:outline-emerald-400/55 sm:min-h-7 sm:flex-none sm:text-[11px] ${
                isActive
                  ? "text-foreground/90"
                  : "text-foreground/45 hover:text-foreground/65"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId={`seg-${title}`}
                  className="absolute inset-0 rounded-md bg-foreground/10"
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 35,
                  }}
                />
              )}
              <span className="relative">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toggle({ checked }: { checked: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-foreground/25" : "bg-foreground/8"
      }`}
    >
      <motion.div
        animate={{ x: checked ? 17 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`absolute top-0.75 h-3.5 w-3.5 rounded-full shadow-sm transition-colors duration-200 ${
          checked ? "bg-foreground" : "bg-foreground/35"
        }`}
      />
    </div>
  );
}
