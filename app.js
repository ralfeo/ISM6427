// Default location: Boca Raton, FL
const DEFAULT_LOCATION = { name: "Boca Raton", lat: 26.3683, lon: -80.1289 };

// WMO weather codes -> [description, icon]
const WEATHER_CODES = {
  0: ["Clear", "☀️"],
  1: ["Mostly Clear", "🌤️"],
  2: ["Partly Cloudy", "⛅"],
  3: ["Cloudy", "☁️"],
  45: ["Fog", "🌫️"],
  48: ["Fog", "🌫️"],
  51: ["Light Drizzle", "🌦️"],
  53: ["Drizzle", "🌦️"],
  55: ["Heavy Drizzle", "🌧️"],
  61: ["Light Rain", "🌦️"],
  63: ["Rain", "🌧️"],
  65: ["Heavy Rain", "🌧️"],
  71: ["Light Snow", "🌨️"],
  73: ["Snow", "🌨️"],
  75: ["Heavy Snow", "❄️"],
  80: ["Showers", "🌦️"],
  81: ["Showers", "🌧️"],
  82: ["Heavy Showers", "⛈️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Thunderstorm", "⛈️"],
  99: ["Thunderstorm", "⛈️"],
};

const weather = (code) => WEATHER_CODES[code] || ["Unknown", "🌡️"];
const $ = (id) => document.getElementById(id);

// Solar projection assumptions
const PERFORMANCE_RATIO = 0.8; // inverter, wiring and soiling losses
const TEMP_COEFF = 0.004; // output lost per °C of panel temperature above 25 °C

// Agreement threshold for the NOAA cloud cover check, in percentage points
const NOAA_AGREE_POINTS = 20;

// How many days the solar card shows, and how much to trust each range
let solarHorizon = 7;
const CONFIDENCE = (i) => (i < 3 ? "High" : i < 7 ? "Moderate" : "Low");

let currentLocation = DEFAULT_LOCATION;
let lastData = null;
let noaaSky = null; // Map of UTC hour -> NWS sky cover %
let noaaRequest = 0;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function loadWeather(location, { refreshNoaa = true } = {}) {
  const { name, lat, lon } = location;
  currentLocation = location;
  lastData = null;
  $("location").textContent = name;
  $("condition").textContent = "Loading…";
  if (refreshNoaa) loadNoaa(location);

  const tilt = Number($("tilt").value) || 0;
  const azimuth = lat >= 0 ? 0 : 180; // panels face the equator (0 = south)
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
    "&hourly=temperature_2m,weather_code,global_tilted_irradiance,cloud_cover" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max" +
    `&tilt=${tilt}&azimuth=${azimuth}&forecast_days=16` +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto";

  try {
    lastData = await getJson(url);
    render(lastData);
    renderSolar(lastData);
  } catch (err) {
    $("condition").textContent = "Unable to load weather";
    console.error(err);
  }
}

function render(data) {
  const { current, hourly, daily } = data;
  const [desc] = weather(current.weather_code);

  $("temp").textContent = `${Math.round(current.temperature_2m)}°`;
  $("condition").textContent = desc;
  $("hi-lo").textContent =
    `H:${Math.round(daily.temperature_2m_max[0])}°  L:${Math.round(daily.temperature_2m_min[0])}°`;
  $("feels").textContent = `${Math.round(current.apparent_temperature)}°`;
  $("humidity").textContent = `${current.relative_humidity_2m}%`;
  $("wind").textContent = `${Math.round(current.wind_speed_10m)} mph`;
  $("uv").textContent = Math.round(daily.uv_index_max[0]);

  // Next 24 hours starting from the current hour
  const start = hourly.time.findIndex((t) => t >= current.time.slice(0, 13));
  $("hourly").innerHTML = hourly.time
    .slice(start, start + 24)
    .map((t, i) => {
      const idx = start + i;
      const hour = new Date(t).toLocaleTimeString([], { hour: "numeric" });
      return `<div class="hour">
        <span>${i === 0 ? "Now" : hour}</span>
        <span class="icon">${weather(hourly.weather_code[idx])[1]}</span>
        <span>${Math.round(hourly.temperature_2m[idx])}°</span>
      </div>`;
    })
    .join("");

  $("daily").innerHTML = daily.time
    .slice(0, 7)
    .map((t, i) => {
      const day = i === 0 ? "Today" : new Date(t + "T00:00").toLocaleDateString([], { weekday: "short" });
      return `<div class="day">
        <span>${day}</span>
        <span class="icon">${weather(daily.weather_code[i])[1]}</span>
        <span class="range">
          <span class="lo">${Math.round(daily.temperature_2m_min[i])}°</span>
          <span>${Math.round(daily.temperature_2m_max[i])}°</span>
        </span>
      </div>`;
    })
    .join("");
}

// NOAA / National Weather Service forecast for U.S. locations: an official
// current forecast plus hourly sky cover to cross-check the solar projection
async function loadNoaa({ lat, lon }) {
  const request = ++noaaRequest;
  noaaSky = null;
  $("noaa-now").textContent = "";
  $("noaa-status").textContent = "NOAA check: loading…";
  try {
    const points = await getJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    const [grid, hourly] = await Promise.all([
      getJson(points.properties.forecastGridData),
      getJson(points.properties.forecastHourly),
    ]);
    if (request !== noaaRequest) return;
    noaaSky = expandGridSeries(grid.properties.skyCover.values);
    const now = hourly.properties.periods[0];
    $("noaa-now").textContent = `NOAA forecast: ${now.temperature}°${now.temperatureUnit} · ${now.shortForecast}`;
    $("noaa-status").textContent = "NOAA check: daytime cloud cover compared with the National Weather Service.";
  } catch (err) {
    if (request !== noaaRequest) return;
    $("noaa-status").textContent = "NOAA check unavailable (U.S. locations only).";
    console.error(err);
  }
  if (lastData) renderSolar(lastData);
}

// NWS grid values cover ISO 8601 intervals such as "2026-11-04T10:00:00+00:00/PT3H"
function expandGridSeries(values) {
  const byHour = new Map();
  values.forEach(({ validTime, value }) => {
    if (value == null) return;
    const [start, duration] = validTime.split("/");
    const [, days = 0, hours = 0] = duration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?)?/);
    const first = Date.parse(start) / 3600000;
    for (let i = 0; i < Number(days) * 24 + Number(hours); i++) byHour.set(first + i, value);
  });
  return byHour;
}

// Hourly MWh for the plant, summed into on-peak and off-peak per day.
// Open-Meteo hourly values average the preceding hour, so "08:00" is hour ending 8 (7–8 AM).
function solarByDay(data, plantMW) {
  const { hourly } = data;
  const days = {};
  hourly.time.forEach((t, i) => {
    const g = hourly.global_tilted_irradiance[i] || 0; // W/m²
    const airC = ((hourly.temperature_2m[i] - 32) * 5) / 9;
    const cellC = airC + 0.03 * g;
    const heatLoss = 1 - TEMP_COEFF * Math.max(0, cellC - 25);
    const mwh = plantMW * (g / 1000) * PERFORMANCE_RATIO * heatLoss;

    const date = t.slice(0, 10);
    const hourEnding = Number(t.slice(11, 13)) || 24;
    const weekday = new Date(date + "T00:00").getDay() % 6 !== 0;
    const onPeak = weekday && hourEnding >= 8 && hourEnding <= 23;

    const day = (days[date] ||= { onPeak: 0, offPeak: 0, checkHours: 0, noaaCloud: 0, modelCloud: 0 });
    day[onPeak ? "onPeak" : "offPeak"] += mwh;

    // Compare cloud cover during daylight hours where NOAA has data
    const utcHour = (Date.parse(t + "Z") - data.utc_offset_seconds * 1000) / 3600000;
    const noaa = noaaSky && noaaSky.get(utcHour);
    if (g > 0 && noaa != null) {
      day.checkHours++;
      day.noaaCloud += noaa;
      day.modelCloud += hourly.cloud_cover[i];
    }
  });
  return Object.entries(days).map(([date, d]) => ({ date, ...d, total: d.onPeak + d.offPeak }));
}

function renderSolar(data) {
  const plantMW = Number($("plant-mw").value) || 0;
  const days = solarByDay(data, plantMW).slice(0, solarHorizon);
  $("solar-title").textContent = `Solar Projection · ${days.length} Days`;
  const max = Math.max(...days.map((d) => d.total), 0.001);
  const cf = (mwh) => (plantMW ? (mwh / (plantMW * 24)) * 100 : 0);
  const total = days.reduce((sum, d) => sum + d.total, 0);

  $("solar-summary").innerHTML = `
    <div><span class="label-sm">Total</span><strong>${total.toFixed(0)} MWh</strong></div>
    <div><span class="label-sm">Avg / day</span><strong>${(total / days.length).toFixed(1)} MWh</strong></div>
    <div><span class="label-sm">Capacity factor</span><strong>${cf(total / days.length).toFixed(1)}%</strong></div>`;

  $("solar").innerHTML = days
    .map((d, i) => {
      const date = new Date(d.date + "T00:00");
      const label = i === 0 ? "Today" : date.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
      const confidence = CONFIDENCE(i);
      const low = confidence === "Low";
      const mwh = (n) => n.toFixed(low ? 0 : 1); // whole numbers where the forecast is rough
      const divider = i === 7 ? `<div class="solar-divider">Outlook · days 8–16 · low confidence</div>` : "";
      return `${divider}<div class="solar-day${low ? " low" : ""}">
        <div class="solar-top"><span>${label}<em class="confidence">${confidence}</em></span><strong>${mwh(d.total)} MWh</strong></div>
        <div class="bar"><span style="width:${(d.total / max) * 100}%"></span></div>
        <div class="solar-sub">On-peak ${mwh(d.onPeak)} · Off-peak ${mwh(d.offPeak)} · CF ${cf(d.total).toFixed(low ? 0 : 1)}%</div>
        ${noaaCheck(d)}
      </div>`;
    })
    .join("");
}

function noaaCheck(d) {
  if (d.checkHours < 3) return "";
  const noaa = Math.round(d.noaaCloud / d.checkHours);
  const model = Math.round(d.modelCloud / d.checkHours);
  const diff = noaa - model;
  const clouds = `Daytime clouds: NOAA ${noaa}% · Open-Meteo ${model}%`;
  if (Math.abs(diff) <= NOAA_AGREE_POINTS) return `<div class="solar-check">✓ ${clouds}</div>`;
  const hint = diff > 0 ? "output may be lower" : "output may be higher";
  return `<div class="solar-check warn">⚠ ${clouds}: ${hint}</div>`;
}

document.querySelectorAll("[data-horizon]").forEach((btn) => {
  btn.addEventListener("click", () => {
    solarHorizon = Number(btn.dataset.horizon);
    document.querySelectorAll("[data-horizon]").forEach((b) => b.setAttribute("aria-checked", b === btn));
    if (lastData) renderSolar(lastData);
  });
});

// Plant size only rescales; tilt changes the irradiance, so refetch (same location, so NOAA data stays)
$("plant-mw").addEventListener("input", () => lastData && renderSolar(lastData));
$("tilt").addEventListener("change", () => loadWeather(currentLocation, { refreshNoaa: false }));

// City search via Open-Meteo geocoding API
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("search-input").value.trim();
  if (!query) return;

  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`
    );
    const { results } = await res.json();
    if (!results || !results.length) {
      alert("City not found");
      return;
    }
    const { name, latitude, longitude } = results[0];
    $("search-input").value = "";
    $("tilt").value = Math.round(Math.abs(latitude)); // tilt ≈ latitude is a common default
    loadWeather({ name, lat: latitude, lon: longitude });
  } catch (err) {
    alert("Search failed");
    console.error(err);
  }
});

// Time-of-day greeting
const USER_NAME = "Romina Alfeo";
const hour = new Date().getHours();
const timeOfDay = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
$("greeting").textContent = `${timeOfDay}, ${USER_NAME}`;

// Theme switcher: light, dark, or system (follows the OS setting)
function applyTheme(choice) {
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  document.querySelectorAll("[data-theme-option]").forEach((btn) => {
    btn.setAttribute("aria-checked", btn.dataset.themeOption === choice);
  });
  try {
    localStorage.setItem("theme", choice);
  } catch (e) {}
}

document.querySelectorAll("[data-theme-option]").forEach((btn) => {
  btn.addEventListener("click", () => applyTheme(btn.dataset.themeOption));
});

let savedTheme = "system";
try {
  savedTheme = localStorage.getItem("theme") || "system";
} catch (e) {}
applyTheme(savedTheme);

loadWeather(DEFAULT_LOCATION);
