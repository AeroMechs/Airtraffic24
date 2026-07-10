# Airtraffic24

Airtraffic24 is a standalone Next.js worldwide live-flight radar. It renders a full-screen satellite map with live aircraft positions, global and nearby coverage modes, search, route and aircraft details, airport boards, weather, trails, map styles, camera controls, and optional ATC or airspace overlays.

The application contains no SkyLine managed-flight records, role system, airline operations dashboard, or synthetic fleet fallback. If the primary provider is temporarily unavailable, it keeps the latest real snapshot for up to five minutes and clearly marks the feed as degraded.

## Run

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

For a production build:

```bash
npm run build
npm run start -- -p 3007
```

## Deploy to Vercel

Import the repository into Vercel with the Next.js framework preset. The
committed `vercel.json` uses `npm ci` and `npm run build`; no output-directory
override is required. The project targets Node.js 24.

## Routes

- `/` - full-screen worldwide radar.
- `/api/radar/flights?mode=global&limit=8000` - tiled worldwide live traffic.
- `/api/radar/flights?mode=nearby&lat=22.5&lon=79&radiusNm=1400` - live traffic around a selected location.
- `/api/atc/*` - aircraft lookup, route, weather, airport photo, airspace and ATC support endpoints.

## Validation

```bash
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

## Operational Boundary

Airtraffic24 is a situational-awareness display, not a certified air traffic control, separation, dispatch, or navigation system. Provider positions can be delayed, incomplete, rate-limited, or unavailable.

See `THIRD_PARTY_NOTICES.md`, `third_party/atc-radar-upstream/`, and `public/models/aircraft/NOTICE.md` for source, model, map, logo, and data-provider notices.
