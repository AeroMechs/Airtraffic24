import { FlightTracker } from "@/atc/components/flight-tracker";
import type { City } from "@/atc/lib/cities";
import { findCityByCode } from "@/atc/lib/city-routing";

export const dynamic = "force-dynamic";

const GLOBAL_CITY: City = {
  id: "global-traffic",
  name: "Worldwide traffic",
  country: "Global",
  iata: "GLB",
  coordinates: [18, 24],
  radius: 2.49,
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function initialCity(searchParams?: SearchParams): Promise<City> {
  const resolved = searchParams ? await searchParams : {};
  const rawCity = resolved.city;
  const cityCode = Array.isArray(rawCity) ? rawCity[0] : rawCity;

  if (!cityCode || cityCode.toLowerCase() === "glb") return GLOBAL_CITY;

  return findCityByCode(cityCode) ?? GLOBAL_CITY;
}

export default async function Home({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  return (
    <main className="atc-radar-shell relative h-dvh w-screen overflow-hidden">
      <FlightTracker
        airspaceAvailable
        aircraftShadows={false}
        force2DMarkers
        initialCity={await initialCity(searchParams)}
        initialMapStyleId="satellite"
      />
    </main>
  );
}
