"""Live Info - real-time dashboard (Flask).

The server is a cached proxy to public APIs that need no key.
"""
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from zoneinfo import ZoneInfo

import requests
from flask import Flask, jsonify, render_template, request

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
RAINVIEWER = "https://api.rainviewer.com/public/weather-maps.json"
SWPC_KP = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
FX_API = "https://api.frankfurter.dev/v1/latest"
COINGECKO = "https://api.coingecko.com/api/v3/simple/price"
HOLIDAYS = "https://calendrier.api.gouv.fr/jours-feries/metropole"
MARINE = "https://marine-api.open-meteo.com/v1/marine"
ECO2MIX = "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records"
SCHOOL = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records"
NAGER = "https://date.nager.at/api/v3"
PARIS = ZoneInfo("Europe/Paris")

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
                   "weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,dew_point_2m",
        "hourly": "temperature_2m,precipitation_probability,weather_code,uv_index,visibility,pressure_msl",
        "past_hours": 3,
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
                 "precipitation_probability_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset,daylight_duration,sunshine_duration",
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
                             "accept-language": "fr", "zoom": 14}, ttl=86400)


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


# ---------- radar / météo spatiale / marchés / calendrier ----------
@app.route("/api/radar")
def radar():
    return proxy(RAINVIEWER, {}, ttl=300)


@app.route("/api/space")
def space():
    try:
        rows = cached_get(SWPC_KP, {}, ttl=600)
        if rows and isinstance(rows[0], list):  # ancien format : 1re ligne = en-têtes
            rows = [dict(zip(rows[0], r)) for r in rows[1:]]
        kp = []
        for r in rows[-8:]:
            v = r.get("Kp", r.get("kp_index"))
            kp.append({"time": r.get("time_tag"), "kp": float(v)})
        return jsonify({"kp": kp})
    except (requests.RequestException, ValueError, TypeError, AttributeError) as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/markets")
def markets():
    out = {"fx": None, "crypto": None}
    try:
        out["fx"] = cached_get(FX_API, {"base": "EUR", "symbols": "USD,GBP,CHF,JPY"}, ttl=3600)["rates"]
    except (requests.RequestException, ValueError, KeyError):
        pass
    try:
        out["crypto"] = cached_get(COINGECKO, {"ids": "bitcoin,ethereum", "vs_currencies": "eur",
                                               "include_24hr_change": "true"}, ttl=300)
    except (requests.RequestException, ValueError):
        pass
    if out["fx"] is None and out["crypto"] is None:
        return jsonify({"error": "Sources indisponibles"}), 502
    return jsonify(out)


@app.route("/api/holidays")
def holidays():
    today = date.today()
    found = {}
    for year in (today.year, today.year + 1):
        try:
            found.update(cached_get(f"{HOLIDAYS}/{year}.json", {}, ttl=86400))
        except (requests.RequestException, ValueError):
            pass
    if not found:
        return jsonify({"error": "Jours fériés indisponibles"}), 502
    upcoming = sorted((d, n) for d, n in found.items() if d >= today.isoformat())[:4]
    return jsonify({"holidays": [{"date": d, "name": n} for d, n in upcoming]})


# ---------- mer (Open-Meteo Marine) ----------
@app.route("/api/marine")
def marine():
    c = get_coords(2)
    if not c:
        return bad_coords()
    return proxy(MARINE, {"latitude": c[0], "longitude": c[1], "timezone": "auto",
                          "current": "wave_height,wave_direction,wave_period,sea_surface_temperature"}, ttl=1800)


# ---------- électricité en France (RTE éCO2mix, temps réel) ----------
@app.route("/api/power")
def power():
    try:
        data = cached_get(ECO2MIX, {"where": "taux_co2 is not null", "order_by": "date_heure desc", "limit": 1}, ttl=300)
        rec = (data.get("results") or [None])[0]
        if not rec:
            raise ValueError("aucune donnée")
    except (requests.RequestException, ValueError) as e:
        return jsonify({"error": str(e)}), 502
    sources = ["nucleaire", "eolien", "solaire", "hydraulique", "gaz", "charbon", "fioul", "bioenergies"]
    mix = {k: max(0, rec.get(k) or 0) for k in sources}
    return jsonify({"time": rec.get("date_heure"), "consommation": rec.get("consommation"),
                    "co2": rec.get("taux_co2"), "mix": mix, "total": sum(mix.values())})


# ---------- vacances scolaires (zones A/B/C) ----------
SCHOOL_ZONES = {"A": "Lyon", "B": "Lille", "C": "Paris"}  # une académie représentative par zone


def paris_date(value):
    """Date locale (Paris) d'un champ date/datetime de l'API (souvent minuit Paris exprimé en UTC)."""
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return (dt.astimezone(PARIS) if dt.tzinfo else dt).date()


@app.route("/api/school-holidays")
def school_holidays():
    today = datetime.now(PARIS).date()
    merged = {}
    try:
        for zone, academy in SCHOOL_ZONES.items():
            data = cached_get(SCHOOL, {"where": f'end_date>="{today.isoformat()}"', "order_by": "end_date",
                                       "limit": 30, "refine": f"location:{academy}"}, ttl=21600)
            seen = set()
            for rec in data.get("results", []):
                if rec.get("population") == "Enseignants":
                    continue
                start, end = paris_date(rec.get("start_date")), paris_date(rec.get("end_date"))
                if not start or not end or end < today or (rec["description"], start) in seen:
                    continue
                seen.add((rec["description"], start))
                if len(seen) > 3:  # 3 prochaines périodes par zone suffisent
                    break
                key = (rec["description"], start.isoformat(), end.isoformat())
                merged.setdefault(key, []).append(zone)
    except (requests.RequestException, ValueError, KeyError) as e:
        return jsonify({"error": str(e)}), 502
    rows = [{"name": n, "start": s_, "end": e_, "zones": z} for (n, s_, e_), z in sorted(merged.items(), key=lambda kv: kv[0][1])]
    return jsonify({"holidays": rows[:6]})


# ---------- jours fériés dans le monde (Nager.Date) ----------
@app.route("/api/world-holidays")
def world_holidays():
    codes = [c for c in request.args.get("countries", "").upper().split(",") if re.fullmatch(r"[A-Z]{2}", c)][:20]
    if not codes:
        return jsonify({"error": "Aucun pays"}), 400

    def one(cc):
        try:
            data = cached_get(f"{NAGER}/NextPublicHolidays/{cc}", {}, ttl=86400)
        except (requests.RequestException, ValueError):
            return cc, None
        pub = [h for h in data if "Public" in (h.get("types") or ["Public"])]
        return cc, [{"date": h["date"], "name": h.get("name"), "local": h.get("localName")} for h in pub[:3]]

    with ThreadPoolExecutor(max_workers=6) as ex:
        return jsonify(dict(ex.map(one, codes)))


def main():
    app.run(host="127.0.0.1", port=5003)


if __name__ == "__main__":
    main()