# Repository Instructions

## Product Boundary

- Airtraffic24 is a standalone worldwide external-traffic radar.
- Do not add SkyLine managed-flight records, airline-management modules, role portals, or internal operations enrichment.
- Do not silently invent aircraft when the live provider is unavailable. Use the latest real cache or a clear unavailable state.
- Keep global rendering efficient enough for several thousand aircraft.
- Preserve third-party notices and model attribution.

## Validation

Run TypeScript, ESLint, production build, live API checks, and rendered-map checks for radar changes.
