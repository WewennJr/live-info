# Live Info

A real-time dashboard with useful info around you: weather, rain radar, air quality, fuel prices, earthquakes, ISS, GPS trip stats, speedtest and more. No API keys needed.

Flask backend (cached proxy to public APIs) + vanilla HTML/CSS/JS frontend.

## Features

- **Weather**: current conditions, 24 h chart, 7-day forecast, rain in the next 2 h, today's summary
- **Alerts & tips**: storms, gusts, heat, frost, UV, fog, rain, pressure drop, air quality, pollen, nearby earthquakes, geomagnetic storms, public holidays
- **Air quality & pollen**, **sun & moon**
- **Live map**: animated rain radar, your position, ISS, earthquakes
- **France focus**: electricity mix & CO₂ intensity (RTE), school holidays (zones A/B/C), public holidays, fuel prices nearby
- **Holidays worldwide** for 18 countries (UK, US, Germany, Spain, Italy, Canada, Japan, China, India, Brazil…) and key dates (clock changes, Black Friday, Halloween…)
- **Sea & waves** near coasts (hidden inland)
- **GPS trip stats**: speed, heading, distance, max/average speed
- **Space weather** (Kp index), **exchange rates & crypto**, **world clocks**, **calendar & French public holidays**
- **Device & network info**, **speedtest**, battery and orientation (on supported devices)
- **Device performance**: live FPS, UI latency, quick CPU benchmark, browser storage (all measured on your own device)

You can also search for a city manually instead of using GPS.

## Quick Start

### Prerequisites

* Python 3.10+
* [uv](https://docs.astral.sh/uv/) (recommended) or pip

### Installation

```
# Clone the repository
git clone https://github.com/WewennJr/live-info.git
cd live-info

# Install dependencies with uv
uv sync

# Or with pip
pip install flask requests
```

### Running the Web App

```
# Using uv
uv run python app.py

# Or directly
python app.py
```

The app will be available at `http://localhost:5003`

To change the host or port, set the `HOST` / `PORT` environment variables (e.g. `HOST=0.0.0.0 PORT=8080`).

## Good to Know

- **GPS, battery and orientation need HTTPS** (or `localhost`). Opening the app from a phone via `http://192.168.x.x:5003` won't work; use a reverse proxy with HTTPS.
- **Location accuracy**: phones use real GPS (a few meters). Desktops have no GPS chip, so the browser relies on Wi-Fi/IP and can be off by hundreds of meters or more. The accuracy is shown in the GPS card.
- Fuel prices, electricity and school holidays cover **France only** (school holidays: metropolitan zones A/B/C).
- Don't run Flask's dev server in production: use something like `gunicorn -b 127.0.0.1:5003 app:app` behind a reverse proxy.

## Project Structure

```
app.py               # Flask app (API proxies + cache)
templates/
└── index.html
static/
├── css/style.css
└── js/app.js
```

## Data Sources

[Open-Meteo](https://open-meteo.com/) (weather, air, geocoding, CC BY 4.0, non-commercial) ·
[Nominatim / OpenStreetMap](https://nominatim.org/) ·
[RainViewer](https://www.rainviewer.com/) (radar, personal/educational use, attribution required) ·
[data.economie.gouv.fr](https://data.economie.gouv.fr/) (fuel) ·
[USGS](https://earthquake.usgs.gov/) ·
[NOAA SWPC](https://www.swpc.noaa.gov/) ·
[wheretheiss.at](https://wheretheiss.at/) ·
[Frankfurter](https://frankfurter.dev/) ·
[CoinGecko](https://www.coingecko.com/) ·
[calendrier.api.gouv.fr](https://calendrier.api.gouv.fr/jours-feries/) ·
[RTE éCO2mix](https://odre.opendatasoft.com/explore/dataset/eco2mix-national-tr/) (electricity) ·
[data.education.gouv.fr](https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/) (school calendar) ·
[Nager.Date](https://date.nager.at/) (worldwide holidays) ·
[Cloudflare Speed Test](https://speed.cloudflare.com/) ·
[Leaflet](https://leafletjs.com/) with © OpenStreetMap © CARTO tiles.

## License

This project is licensed under the [MIT License](LICENSE). Feel free to use, modify, and distribute it!