"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import {
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
  ChevronDown,
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

export function SettingsContent({
  airspaceAvailable = true,
}: {
  airspaceAvailable?: boolean;
}) {
  const { settings, update, reset } = useSettings();
  const showAirspace = airspaceAvailable && settings.showAirspace;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-0.5 p-3 pt-1">
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

        <div className="mx-3 my-2 h-px bg-foreground/8" />

        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-[12px] font-medium text-foreground/75 ring-1 ring-foreground/12 transition-colors hover:bg-foreground/5 hover:text-foreground/90"
          >
            Reset to defaults
          </button>
        </div>

        <div className="mx-3 my-2 h-px bg-foreground/8" />
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
  const coverage = getRadarCountryCoverage(value);
  const selectedLabel =
    value === WORLD_RADAR_COUNTRY ? "World" : (coverage?.label ?? "World");
  const detail =
    value === WORLD_RADAR_COUNTRY
      ? "All available live regional tiles"
      : coverage
        ? `${coverage.airportCount.toLocaleString()} indexed airports, ${coverage.radiusNm.toLocaleString()} NM coverage`
        : "All available live regional tiles";

  return (
    <div
      className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
        <Globe className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground/85">
          Radar country
        </p>
        <p className="mt-0.5 truncate text-[11px] font-medium text-foreground/40">
          {detail}
        </p>
      </div>
      <div className="inline-grid w-40 shrink-0 grid-cols-[1fr_--spacing(8)]">
        <select
          name="radar-country"
          aria-label="Radar country coverage"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="col-span-full row-start-1 h-8 appearance-none truncate rounded-lg bg-foreground/4 px-2.5 pr-8 text-[11px] font-semibold text-foreground/75 ring-1 ring-foreground/8 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/45"
          title={selectedLabel}
        >
          <option value={WORLD_RADAR_COUNTRY}>World</option>
          {RADAR_COUNTRY_OPTIONS.map((country) => (
            <option key={country.code} value={country.code}>
              {country.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none col-start-2 row-start-1 h-3 w-3 place-self-center text-foreground/40"
        />
      </div>
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
    <div className="flex items-center gap-2 px-3 pt-3 pb-1">
      <span className="text-[10px] font-bold tracking-widest text-foreground/45 uppercase">
        {title}
      </span>
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
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:bg-foreground/4 active:bg-foreground/6"
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] font-medium text-foreground/85">{title}</p>
          {badge && (
            <span className="inline-flex items-center rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-indigo-300 ring-1 ring-indigo-400/20">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-foreground/40">
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
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/50 ring-1 ring-foreground/8">
        {icon}
      </div>
      <p className="flex-1 min-w-0 text-[13px] font-medium text-foreground/85">
        {title}
      </p>
      <div
        role="radiogroup"
        aria-label={title}
        className="flex shrink-0 rounded-md bg-foreground/4 p-0.5 ring-1 ring-foreground/8"
      >
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(opt.value)}
              className={`relative rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
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
