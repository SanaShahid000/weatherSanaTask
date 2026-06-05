const $ = (sel) => document.querySelector(sel);

const form = $("#search-form");
const input = $("#search-input");
const resultsEl = $("#results");
const stateEl = $("#state");
const reportEl = $("#report");
const sourceEl = $("#source-name");

let units = "metric";
let lastPlace = null; // remember selection so unit toggle can refetch

// --- inline SVG icons keyed by condition group --------------------------
const ICONS = {
  clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke-linecap="round"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 18h9a4 4 0 0 0 .5-7.97A6 6 0 0 0 5 11.5 3.5 3.5 0 0 0 7 18z" stroke-linejoin="round"/></svg>',
  rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 14h9a4 4 0 0 0 .5-7.97A6 6 0 0 0 5 7.5 3.5 3.5 0 0 0 7 14z" stroke-linejoin="round"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke-linecap="round"/></svg>',
  snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 14h9a4 4 0 0 0 .5-7.97A6 6 0 0 0 5 7.5 3.5 3.5 0 0 0 7 14z" stroke-linejoin="round"/><circle cx="8" cy="19" r="1" fill="currentColor"/><circle cx="12" cy="20" r="1" fill="currentColor"/><circle cx="16" cy="19" r="1" fill="currentColor"/></svg>',
  storm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 13h9a4 4 0 0 0 .5-7.97A6 6 0 0 0 5 6.5 3.5 3.5 0 0 0 7 13z" stroke-linejoin="round"/><path d="M12 13l-2 4h3l-2 4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 9h16M4 13h16M6 17h12M6 5h12"/></svg>',
};
const icon = (g) => ICONS[g] || ICONS.cloud;

// --- helpers ------------------------------------------------------------
const u = () => (units === "imperial" ? "°F" : "°C");
const wind = () => (units === "imperial" ? "mph" : "km/h");

function setState(msg, isError = false) {
  stateEl.classList.toggle("state--error", isError);
  stateEl.querySelector(".state__hint").textContent = msg;
  stateEl.hidden = false;
  reportEl.hidden = true;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// --- geocoding ----------------------------------------------------------
async function geocode(q) {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Geocoding failed");
  return data.results || [];
}

function showResults(list) {
  resultsEl.innerHTML = "";
  if (!list.length) { resultsEl.hidden = true; return; }
  list.forEach((r) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.innerHTML =
      `<span class="r-name">${r.name}</span>` +
      `<span class="r-meta">${[r.admin, r.country].filter(Boolean).join(" · ")}</span>`;
    li.addEventListener("click", () => {
      resultsEl.hidden = true;
      input.value = r.name;
      lastPlace = r;
      loadWeather(r);
    });
    resultsEl.appendChild(li);
  });
  resultsEl.hidden = false;
}

const onType = debounce(async () => {
  const q = input.value.trim();
  if (q.length < 2) { resultsEl.hidden = true; return; }
  try { showResults(await geocode(q)); }
  catch (e) { resultsEl.hidden = true; }
}, 280);

// --- weather ------------------------------------------------------------
async function loadWeather(place) {
  setState("Reading the sky…");
  try {
    const res = await fetch(
      `/api/weather?lat=${place.lat}&lon=${place.lon}&days=7&units=${units}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Weather request failed");
    render(place, data);
  } catch (e) {
    setState(`Couldn't load weather — ${e.message}`, true);
  }
}

function dayName(dateStr, i) {
  if (i === 0) return "Today";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function render(place, data) {
  document.body.dataset.group = data.current.group || "clear";

  $("#now-city").textContent = place.name;
  $("#now-region").textContent = [place.admin, place.country].filter(Boolean).join(" · ");
  $("#now-icon").innerHTML = icon(data.current.group);
  $("#now-temp").textContent = `${data.current.temp}${u()}`;
  $("#now-label").textContent = data.current.label;
  $("#now-feels").textContent = `${data.current.feelsLike}${u()}`;
  $("#now-humidity").textContent =
    data.current.humidity == null ? "—" : `${data.current.humidity}%`;
  $("#now-wind").textContent = `${data.current.windSpeed} ${wind()}`;

  const fc = $("#forecast");
  fc.innerHTML = "";
  data.daily.forEach((d, i) => {
    const li = document.createElement("li");
    li.style.animationDelay = `${i * 0.05}s`;
    const precip = d.precipProb == null ? "" : `<span class="f-precip">${d.precipProb}%</span>`;
    li.innerHTML =
      `<span class="f-day">${dayName(d.date, i)}</span>` +
      `<span class="f-icon">${icon(d.group)}</span>` +
      `<span class="f-cond">${d.label} ${precip}</span>` +
      `<span class="f-temps"><span class="hi">${d.max}°</span> <span class="lo">${d.min}°</span></span>`;
    fc.appendChild(li);
  });

  sourceEl.textContent = data.source;
  stateEl.hidden = true;
  reportEl.hidden = false;
}

// --- events -------------------------------------------------------------
input.addEventListener("input", onType);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  try {
    const list = await geocode(q);
    if (list.length) { lastPlace = list[0]; resultsEl.hidden = true; loadWeather(list[0]); }
    else setState("No place found by that name.", true);
  } catch (err) { setState(err.message, true); }
});

$("#locate-btn").addEventListener("click", () => {
  if (!navigator.geolocation) return setState("Geolocation not available.", true);
  setState("Finding you…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const place = { name: "Your location", admin: "", country: "",
        lat: pos.coords.latitude, lon: pos.coords.longitude };
      lastPlace = place;
      loadWeather(place);
    },
    () => setState("Location permission denied.", true)
  );
});

document.querySelectorAll(".units__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.units === units) return;
    units = btn.dataset.units;
    document.querySelectorAll(".units__btn").forEach((b) =>
      b.classList.toggle("is-active", b === btn));
    if (lastPlace) loadWeather(lastPlace);
  });
});

// click outside closes the dropdown
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search")) resultsEl.hidden = true;
});
