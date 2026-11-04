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

let currentLocation = DEFAULT_LOCATION;
let lastData = null;

async function loadWeather(location) {
  const { name, lat, lon } = location;
  currentLocation = location;
  $("location").textContent = name;
  $("condition").textContent = "Loading…";

  const tilt = Number($("tilt").value) || 0;
  const azimuth = lat >= 0 ? 0 : 180; // panels face the equator (0 = south)
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
    "&hourly=temperature_2m,weather_code,global_tilted_irradiance" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max" +
    `&tilt=${tilt}&azimuth=${azimuth}&forecast_days=16` +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto";

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.statusText);
    lastData = await res.json();
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

// Hourly MWh for the plant, summed into on-peak and off-peak per day.
// Open-Meteo hourly values average the preceding hour, so "08:00" is hour ending 8 (7–8 AM).
function solarByDay(hourly, plantMW) {
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

    const day = (days[date] ||= { onPeak: 0, offPeak: 0 });
    day[onPeak ? "onPeak" : "offPeak"] += mwh;
  });
  return Object.entries(days).map(([date, d]) => ({ date, ...d, total: d.onPeak + d.offPeak }));
}

function renderSolar(data) {
  const plantMW = Number($("plant-mw").value) || 0;
  const days = solarByDay(data.hourly, plantMW);
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
      return `<div class="solar-day">
        <div class="solar-top"><span>${label}</span><strong>${d.total.toFixed(1)} MWh</strong></div>
        <div class="bar"><span style="width:${(d.total / max) * 100}%"></span></div>
        <div class="solar-sub">On-peak ${d.onPeak.toFixed(1)} · Off-peak ${d.offPeak.toFixed(1)} · CF ${cf(d.total).toFixed(1)}%</div>
      </div>`;
    })
    .join("");
}

// Plant size only rescales; tilt changes the irradiance, so refetch
$("plant-mw").addEventListener("input", () => lastData && renderSolar(lastData));
$("tilt").addEventListener("change", () => loadWeather(currentLocation));

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
