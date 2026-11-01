"""Live Info - dashboard temps réel (Flask).

Le serveur sert de proxy avec cache vers des APIs publiques sans clé :
Open-Meteo, Nominatim, data.economie.gouv.fr, USGS, wheretheiss.at.
"""
import math
import os
import time

import requests
from flask import Flask, jsonify, render_template, request

try:
    import psutil
    psutil.cpu_percent()  # amorce : le 1er appel renvoie toujours 0.0
except ImportError:
    psutil = None

app = Flask(__name__)

session = requests.Session()
session.headers["User-Agent"] = "live-info/2.0 (https://github.com/WewennJr/live-info)"

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
AIR_QUALITY = "https://air-quality-api.open-meteo.com/v1/air-quality"
GEOCODING = "https://geocoding-api.open-meteo.com/v1/search"
NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
FUEL_API = ("https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
            "prix-des-carburants-en-france-flux-instantane-v2/records")
USGS_QUAKES = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"
ISS_API = "https://api.wheretheiss.at/v1/satellites/25544"

FUELS = ["gazole", "e10", "sp95", "sp98", "e85", "gplc"]

_cache = {}


# ---------- utilitaires ----------
def cached_get(url, params, ttl):
    """GET JSON avec cache mémoire (TTL en secondes)."""
    key = (url, tuple(sorted(params.items())))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    resp = session.get(url, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = (time.time(), data)
    return data


def proxy(url, params, ttl):
    try:
        return jsonify(cached_get(url, params, ttl))
    except (requests.RequestException, ValueError) as e:
        return jsonify({"error": str(e)}), 502


def get_coords(digits):
    """Lit lat/lon, valide les bornes et arrondit (sert aussi de clé de cache)."""
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return round(lat, digits), round(lon, digits)


def bad_coords():
    return jsonify({"error": "Latitude et longitude valides requises"}), 400


def haversine_km(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(a))


# ---------- pages ----------
@app.route("/")
def index():
    return render_template("index.html")


# ---------- météo / air ----------
@app.route("/api/weather")
def weather():
    c = get_coords(2)  # ~1 km
    if not c:
        return bad_coords()
    return proxy(OPEN_METEO, {
        "latitude": c[0], "longitude": c[1],
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,"
                   "weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl",
        "hourly": "temperature_2m,precipitation_probability,weather_code,uv_index,visibility",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
                 "precipitation_probability_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset,daylight_duration",
        "minutely_15": "precipitation",
        "forecast_minutely_15": 8,
        "wind_speed_unit": "kmh",
        "timezone": "auto",
        "forecast_days": 7,
    }, ttl=600)


@app.route("/api/air")
def air():
    c = get_coords(2)
    if not c:
        return bad_coords()
    return proxy(AIR_QUALITY, {
        "latitude": c[0], "longitude": c[1],
        "current": "european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,sulphur_dioxide",
        "hourly": "alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen",
        "forecast_days": 1,
        "timezone": "auto",
    }, ttl=1800)


# ---------- géocodage ----------
@app.route("/api/geocode")
def geocode():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify({"error": "Requête trop courte"}), 400
    return proxy(GEOCODING, {"name": q, "count": 5, "language": "fr", "format": "json"}, ttl=3600)


@app.route("/api/reverse-geocode")
def reverse_geocode():
    c = get_coords(3)
    if not c:
        return bad_coords()
    return proxy(NOMINATIM, {"lat": c[0], "lon": c[1], "format": "jsonv2",
                             "accept-language": "fr", "zoom": 10}, ttl=86400)


# ---------- carburants (France) ----------
@app.route("/api/fuel")
def fuel():
    c = get_coords(3)
    if not c:
        return bad_coords()
    lat, lon = c
    radius = max(1, min(request.args.get("radius", 8, type=int), 30))
    params = {"where": f"within_distance(geom, GEOM'POINT({lon} {lat})', {radius}km)", "limit": 100}
    try:
        data = cached_get(FUEL_API, params, ttl=600)
    except (requests.RequestException, ValueError) as e:
        return jsonify({"error": str(e)}), 502

    results = data.get("results", [])
    stations = []
    for rec in results:
        g = rec.get("geom") or {}
        prix = {f: rec[f"{f}_prix"] for f in FUELS if rec.get(f"{f}_prix") is not None}
        if "lat" not in g or not prix:
            continue
        stations.append({
            "ville": rec.get("ville"), "adresse": rec.get("adresse"), "prix": prix,
            "dist_km": round(haversine_km(lat, lon, g["lat"], g["lon"]), 1),
        })

    best = {}
    for f in FUELS:
        cands = [s for s in stations if f in s["prix"]]
        if cands:
            s = min(cands, key=lambda s: s["prix"][f])
            best[f] = {"prix": s["prix"][f], "ville": s["ville"], "adresse": s["adresse"], "dist_km": s["dist_km"]}
    return jsonify({"radius_km": radius, "count": len(stations), "truncated": len(results) >= 100, "best": best})


# ---------- séismes / ISS ----------
@app.route("/api/quakes")
def quakes():
    try:
        data = cached_get(USGS_QUAKES, {}, ttl=300)
    except (requests.RequestException, ValueError) as e:
        return jsonify({"error": str(e)}), 502
    out = []
    for f in data.get("features", [])[:10]:
        p, (lon, lat, depth) = f["properties"], f["geometry"]["coordinates"]
        out.append({"mag": p.get("mag"), "place": p.get("place"), "time": p.get("time"),
                    "lat": lat, "lon": lon, "depth": depth, "url": p.get("url")})
    return jsonify({"quakes": out})


@app.route("/api/iss")
def iss():
    return proxy(ISS_API, {}, ttl=5)


# ---------- stats de la machine qui héberge l'app ----------
@app.route("/api/server")
def server_stats():
    if psutil is None:
        return jsonify({"error": "psutil non installé"}), 501
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage(os.path.abspath(os.sep))
    return jsonify({
        "cpu": psutil.cpu_percent(interval=None),
        "cores": psutil.cpu_count(),
        "ram_percent": vm.percent,
        "ram_used_mb": round(vm.used / 1048576),
        "ram_total_mb": round(vm.total / 1048576),
        "disk_percent": disk.percent,
        "disk_free_gb": round(disk.free / 1073741824, 1),
        "uptime_s": int(time.time() - psutil.boot_time()),
        "load": os.getloadavg() if hasattr(os, "getloadavg") else None,
    })


def main():
    app.run(host="127.0.0.1", port=5003)

if __name__ == "__main__":
    main()