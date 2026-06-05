import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

const PROVIDER = (process.env.WEATHER_PROVIDER || "open-meteo").toLowerCase();
const WEATHER_AI_KEY = process.env.WEATHER_AI_KEY || "";
const WEATHER_AI_BASE = process.env.WEATHER_AI_BASE || "https://api.weather-ai.co";

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// WMO weather-code -> human label + condition group (used for theming/icons)
// ---------------------------------------------------------------------------
const WMO = {
  0: ["Clear sky", "clear"],
  1: ["Mainly clear", "clear"],
  2: ["Partly cloudy", "cloud"],
  3: ["Overcast", "cloud"],
  45: ["Fog", "fog"],
  48: ["Rime fog", "fog"],
  51: ["Light drizzle", "rain"],
  53: ["Drizzle", "rain"],
  55: ["Heavy drizzle", "rain"],
  56: ["Freezing drizzle", "rain"],
  57: ["Freezing drizzle", "rain"],
  61: ["Light rain", "rain"],
  63: ["Rain", "rain"],
  65: ["Heavy rain", "rain"],
  66: ["Freezing rain", "rain"],
  67: ["Freezing rain", "rain"],
  71: ["Light snow", "snow"],
  73: ["Snow", "snow"],
  75: ["Heavy snow", "snow"],
  77: ["Snow grains", "snow"],
  80: ["Rain showers", "rain"],
  81: ["Rain showers", "rain"],
  82: ["Violent showers", "rain"],
  85: ["Snow showers", "snow"],
  86: ["Snow showers", "snow"],
  95: ["Thunderstorm", "storm"],
  96: ["Thunderstorm + hail", "storm"],
  99: ["Thunderstorm + hail", "storm"],
};
const describe = (code) => WMO[code] || ["Unknown", "cloud"];

// ---------------------------------------------------------------------------
// Provider adapters. Each returns the SAME normalized shape so the frontend
// is provider-agnostic.
// ---------------------------------------------------------------------------
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Upstream ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function openMeteoWeather({ lat, lon, days, units }) {
  const tempUnit = units === "imperial" ? "fahrenheit" : "celsius";
  const windUnit = units === "imperial" ? "mph" : "kmh";
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.search = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: String(days),
    temperature_unit: tempUnit,
    wind_speed_unit: windUnit,
  }).toString();

  const d = await fetchJson(u);
  const [curLabel] = describe(d.current.weather_code);

  return {
    source: "open-meteo",
    units,
    current: {
      temp: Math.round(d.current.temperature_2m),
      feelsLike: Math.round(d.current.apparent_temperature),
      humidity: d.current.relative_humidity_2m,
      windSpeed: Math.round(d.current.wind_speed_10m),
      code: d.current.weather_code,
      label: curLabel,
      group: describe(d.current.weather_code)[1],
    },
    daily: d.daily.time.map((date, i) => {
      const [label, group] = describe(d.daily.weather_code[i]);
      return {
        date,
        min: Math.round(d.daily.temperature_2m_min[i]),
        max: Math.round(d.daily.temperature_2m_max[i]),
        code: d.daily.weather_code[i],
        label,
        group,
        precipProb: d.daily.precipitation_probability_max[i] ?? null,
      };
    }),
  };
}

async function weatherAiWeather({ lat, lon, days, units }) {
  if (!WEATHER_AI_KEY) {
    const e = new Error("WEATHER_AI_KEY is not set on the server.");
    e.status = 401;
    throw e;
  }
  const u = new URL("/v1/weather", WEATHER_AI_BASE);
  u.search = new URLSearchParams({
    lat, lon, days: String(days), units, ai: "false",
  }).toString();

  const d = await fetchJson(u, {
    headers: { Authorization: `Bearer ${WEATHER_AI_KEY}` },
  });

  // Defensive mapping — tolerate a few plausible field names.
  const cur = d.current || d.now || {};
  const daily = d.daily || d.forecast || [];
  const curCode = cur.weather_code ?? cur.code ?? 0;

  return {
    source: "weather-ai",
    units,
    current: {
      temp: Math.round(cur.temp ?? cur.temperature ?? cur.temperature_2m ?? 0),
      feelsLike: Math.round(cur.feels_like ?? cur.apparent_temperature ?? cur.temp ?? 0),
      humidity: cur.humidity ?? cur.relative_humidity_2m ?? null,
      windSpeed: Math.round(cur.wind_speed ?? cur.wind_speed_10m ?? 0),
      code: curCode,
      label: cur.summary || describe(curCode)[0],
      group: describe(curCode)[1],
    },
    daily: (Array.isArray(daily) ? daily : []).slice(0, days).map((day) => {
      const code = day.weather_code ?? day.code ?? 0;
      const [label, group] = describe(code);
      return {
        date: day.date || day.time,
        min: Math.round(day.min ?? day.temp_min ?? day.temperature_2m_min ?? 0),
        max: Math.round(day.max ?? day.temp_max ?? day.temperature_2m_max ?? 0),
        code,
        label: day.summary || label,
        group,
        precipProb: day.precip_prob ?? day.precipitation_probability_max ?? null,
      };
    }),
  };
}

const PROVIDERS = {
  "open-meteo": openMeteoWeather,
  "weather-ai": weatherAiWeather,
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Geocoding stays keyless via Open-Meteo regardless of weather provider.
app.get("/api/geocode", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query ?q=" });
    const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
    u.search = new URLSearchParams({ name: q, count: "5", language: "en" }).toString();
    const d = await fetchJson(u);
    const results = (d.results || []).map((r) => ({
      name: r.name,
      admin: r.admin1 || "",
      country: r.country || "",
      countryCode: r.country_code || "",
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone,
    }));
    res.json({ results });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/weather", async (req, res) => {
  try {
    const lat = req.query.lat;
    const lon = req.query.lon;
    if (lat == null || lon == null) {
      return res.status(400).json({ error: "lat and lon are required" });
    }
    const days = Math.min(Math.max(parseInt(req.query.days || "7", 10), 1), 16);
    const units = req.query.units === "imperial" ? "imperial" : "metric";

    const provider = PROVIDERS[PROVIDER] || openMeteoWeather;
    const data = await provider({ lat, lon, days, units });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", provider: PROVIDER, keyConfigured: Boolean(WEATHER_AI_KEY) });
});

app.listen(PORT, () => {
  console.log(`Almanac running on http://localhost:${PORT}  (provider: ${PROVIDER})`);
});
