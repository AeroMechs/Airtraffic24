"use client";

import { useState } from "react";
import { Cloud, Loader2 } from "lucide-react";
import type { UnitSystem } from "@/atc/hooks/use-settings";
import type { FlightRouteInfo } from "@/atc/hooks/use-route-info";
import {
  useMetar,
  useTaf,
} from "@/atc/components/ui/airport-info-card/use-airport-data";
import { WeatherSection } from "@/atc/components/ui/airport-info-card/weather-section";
import { TafSection } from "@/atc/components/ui/airport-info-card/taf-section";

type FlightWeatherSectionProps = {
  routeInfo: FlightRouteInfo;
  unitSystem: UnitSystem;
};

function AirportWeatherCompact({
  icao,
  label,
  unitSystem,
}: {
  icao: string | null;
  label: string;
  unitSystem: UnitSystem;
}) {
  const [tafOpen, setTafOpen] = useState(false);
  const { metar, loading: metarLoading } = useMetar(icao);
  const { taf, loading: tafLoading } = useTaf(tafOpen ? icao : null);

  if (!icao) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-foreground/[0.06] bg-background/45 text-foreground/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <Cloud className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/72">
          {label}
        </span>
        {metarLoading && !metar && (
          <Loader2 className="h-3 w-3 animate-spin text-foreground/30" />
        )}
      </div>

      <WeatherSection
        metar={metar}
        loading={metarLoading}
        hasIcao={!!icao}
        unitSystem={unitSystem}
      />

      <TafSection
        taf={taf}
        loading={tafLoading}
        expanded={tafOpen}
        onExpandedChange={setTafOpen}
        alwaysVisible
      />
    </div>
  );
}

/**
 * Weather section for FlightCard.
 * Fetches and displays METAR/TAF for origin and destination airports.
 * Returns null if no verified route is available.
 */
export function FlightWeatherSection({
  routeInfo,
  unitSystem,
}: FlightWeatherSectionProps) {
  if (!routeInfo.available) return null;

  const originIcao = routeInfo.origin?.icao ?? null;
  const destIcao = routeInfo.destination?.icao ?? null;

  if (!originIcao && !destIcao) return null;

  return (
    <div className="space-y-3 rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      {originIcao && (
        <AirportWeatherCompact
          icao={originIcao}
          label={`${routeInfo.origin?.iata || routeInfo.origin?.icao || "Origin"} Weather`}
          unitSystem={unitSystem}
        />
      )}
      {destIcao && (
        <AirportWeatherCompact
          icao={destIcao}
          label={`${routeInfo.destination?.iata || routeInfo.destination?.icao || "Dest"} Weather`}
          unitSystem={unitSystem}
        />
      )}
    </div>
  );
}
