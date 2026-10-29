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

async function loadWeather({ name, lat, lon }) {
  $("location").textContent = name;
  $("condition").textContent = "Loading…";

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
    "&hourly=temperature_2m,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max" +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto";

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.statusText);
    render(await res.json());
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
