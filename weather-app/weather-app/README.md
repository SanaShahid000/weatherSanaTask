# Almanac — Weather

A small, production-minded weather app. Search any city (or use your location) to
see current conditions and a 7-day forecast in a calm, editorial interface that
shifts its palette with the sky.

## Why it's built this way

The interesting decision in a weather app isn't the UI — it's **where the API key
lives**. Calling a keyed weather API directly from the browser would leak the key
to anyone who opens devtools. So the browser never talks to a weather provider.
Instead:

```
Browser ──► /api/weather (this server) ──► weather provider
                  │
                  └─ holds the API key, normalizes the response
```

Two consequences fall out of that one decision:

1. **The key stays server-side.** It's read from an environment variable and is
   never shipped to the client.
2. **The provider is swappable.** The server has a small adapter layer. Today it
   ships with two adapters behind one env var (`WEATHER_PROVIDER`):

   | Provider     | Key required | Notes                                        |
   |--------------|--------------|----------------------------------------------|
   | `open-meteo` | No           | Default. Free, real data — the demo runs out of the box. |
   | `weather-ai` | Yes          | Calls the Weather-AI `/v1/weather` endpoint; key kept server-side. |

   Both adapters return the **same normalized JSON shape**, so the frontend
   doesn't know or care which one is active.

Geocoding (city name → coordinates) uses Open-Meteo's free geocoder regardless of
the weather provider, so search works without any key.

## Tech

- **Backend:** Node + Express (single file, ES modules). No database.
- **Frontend:** vanilla HTML/CSS/JS — no build step, so it deploys and reviews
  instantly.
- **Fonts:** Fraunces + IBM Plex.

## Project structure

```
weather-app/
├── server.js          # Express server: static host + /api proxy + adapters
├── package.json
├── .env.example       # copy to .env for local dev
├── .gitignore
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

## Run locally

Requires Node 18+.

```bash
npm install
cp .env.example .env      # optional; defaults work as-is
npm start                 # http://localhost:3000
```

By default it uses Open-Meteo and needs no key. To use the Weather-AI provider:

```bash
# in .env
WEATHER_PROVIDER=weather-ai
WEATHER_AI_KEY=wai_your_key_here
```

## API

| Route                                            | Purpose                          |
|--------------------------------------------------|----------------------------------|
| `GET /api/geocode?q=Nairobi`                     | City search → coordinates        |
| `GET /api/weather?lat=&lon=&days=&units=`        | Normalized current + daily data  |
| `GET /api/health`                                | Provider + key-configured status |

`units` is `metric` (default) or `imperial`.

## Deploy

The app is one Node web service, so any Node host works. **Render** (free tier):

1. Push this repo to GitHub.
2. Render → **New → Web Service** → connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. (Optional) add env vars `WEATHER_PROVIDER` / `WEATHER_AI_KEY`.
5. Deploy, then paste the URL into the **Live demo** line above.

The same `npm install` / `npm start` pair works on Railway and Fly.io. (A pure
static host like Netlify won't run the Node proxy — use it only if you strip the
backend and accept a client-side key, which this project deliberately avoids.)

## Notes / next steps

- The `weather-ai` adapter is written against the documented `/v1/weather`
  contract. The docs share a response "shape" across endpoints without pinning
  every field, so the normalizer is defensive; confirm the exact field paths
  against a real response once a valid key is available.
- Easy extensions: hourly view, °/24h precipitation totals, saved locations,
  response caching.