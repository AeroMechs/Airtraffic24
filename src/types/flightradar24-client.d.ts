declare module "flightradar24-client" {
  export interface FlightRadar24Options {
    FAA?: boolean;
    FLARM?: boolean;
    MLAT?: boolean;
    ADSB?: boolean;
    inAir?: boolean;
    onGround?: boolean;
    inactive?: boolean;
    gliders?: boolean;
    estimatedPositions?: boolean;
  }

  export interface FlightRadar24Aircraft {
    id: string;
    registration: string | null;
    flight: string | null;
    callsign: string | null;
    origin: string | null;
    destination: string | null;
    latitude: number;
    longitude: number;
    altitude: number;
    bearing: number;
    speed: number | null;
    rateOfClimb: number;
    isOnGround: boolean;
    squawkCode: string | null;
    model: string | null;
    modeSCode: string | null;
    radar: string | null;
    isGlider: boolean;
    timestamp: number | null;
  }

  export function fetchFromRadar(
    north: number,
    west: number,
    south: number,
    east: number,
    when?: number,
    options?: FlightRadar24Options,
  ): Promise<FlightRadar24Aircraft[]>;

  export function fetchFlight(id: string): Promise<unknown>;
}
