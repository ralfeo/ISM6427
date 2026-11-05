# Weather

A simple glassmorphic weather app powered by the [Open-Meteo API](https://open-meteo.com/). Defaults to Boca Raton, FL; search any city.

Static site (index.html, style.css, app.js) with no build step. Deploy the repo root to Netlify as-is.

## Solar projection

Estimates daily output (MWh) for a solar plant at the selected location over 16 days, split into on-peak (7 AM-11 PM weekdays) and off-peak, with capacity factor. Uses Open-Meteo tilted irradiance with 20% system losses and temperature derating. Plant size and panel tilt are editable. This is a planning estimate, not a bankable forecast.

## NOAA check

For U.S. locations the app also pulls the National Weather Service forecast (api.weather.gov, no key needed). It shows the official NOAA forecast under current conditions and compares daytime cloud cover with Open-Meteo for each solar day (about 7 days), flagging days that differ by more than 20 points.
