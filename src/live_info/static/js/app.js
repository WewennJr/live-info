'use strict';

/* =====================================================================
   Live Info - front
   Sections : utilitaires · état · localisation · météo · air · carburants
   · séismes · ISS · serveur · GPS · appareil · speedtest · batterie · init
   ===================================================================== */

// ============ UTILITAIRES ============
const $ = (sel) => document.querySelector(sel);
const round = Math.round;
const show = (el) => el && el.classList.remove('hidden');
const hide = (el) => el && el.classList.add('hidden');
const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
const fmtTime = (d = new Date()) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = (iso) => iso.slice(11, 16);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cardinal = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][round(deg / 45) % 8];
const ago = (ms) => { const m = round((Date.now() - ms) / 60000); return m < 60 ? `il y a ${m} min` : `il y a ${round(m / 60)} h`; };
const dur = (s) => {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}j ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const every = (ms, fn) => setInterval(() => { if (!document.hidden) fn(); }, ms); // pas de requêtes onglet caché

function haversineKm(lat1, lon1, lat2, lon2) {
    const p = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * p / 2) ** 2 +
        Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin((lon2 - lon1) * p / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

async function api(path, params = {}) {
    const resp = await fetch(`/api/${path}?${new URLSearchParams(params)}`);
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
}

function setStatus(name, kind, text) {
    const el = document.getElementById(`${name}-status`);
    if (!el) return;
    el.className = `status-badge status-${kind}`;
    el.textContent = text;
    if (kind === 'ok' || kind === 'warn') setText(`${name}-time`, fmtTime());
}

/** Remplit une grille de métriques : items = [[label, valeur, pourcentage?, classeBarre?], ...] */
function metrics(id, items) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = items.map(([label, value, pct, cls]) => {
        const small = String(value).length > 9 ? ' small' : '';
        const bar = pct == null ? '' :
            `<div class="progress-bar"><div class="progress-fill ${cls || 'progress-cpu'}" style="width:${Math.min(100, Math.max(0, pct))}%"></div></div>`;
        return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value mono${small}">${esc(value)}</div>${bar}</div>`;
    }).join('');
}

const WMO = {
    0: ['Ciel dégagé', '☀️'], 1: ['Plutôt dégagé', '🌤️'], 2: ['Partiellement nuageux', '⛅'], 3: ['Couvert', '☁️'],
    45: ['Brouillard', '🌫️'], 48: ['Brouillard givrant', '🌫️'],
    51: ['Bruine légère', '🌦️'], 53: ['Bruine modérée', '🌦️'], 55: ['Bruine dense', '🌧️'],
    56: ['Bruine verglaçante', '🌧️'], 57: ['Bruine verglaçante dense', '🌧️'],
    61: ['Pluie légère', '🌦️'], 63: ['Pluie modérée', '🌧️'], 65: ['Pluie forte', '🌧️'],
    66: ['Pluie verglaçante', '🌧️'], 67: ['Pluie verglaçante forte', '🌧️'],
    71: ['Neige légère', '🌨️'], 73: ['Neige modérée', '🌨️'], 75: ['Neige forte', '❄️'], 77: ['Grains de neige', '❄️'],
    80: ['Averses légères', '🌦️'], 81: ['Averses modérées', '🌧️'], 82: ['Averses violentes', '⛈️'],
    85: ['Averses de neige', '🌨️'], 86: ['Fortes averses de neige', '❄️'],
    95: ['Orage', '⛈️'], 96: ['Orage et grêle', '⛈️'], 99: ['Orage et forte grêle', '⛈️'],
};
const wmoDesc = (code) => (WMO[code] || ['Inconnu'])[0];
const wmoIcon = (code, isDay = 1) => (!isDay && (code === 0 || code === 1)) ? '🌙' : (WMO[code] || [0, '❓'])[1];

// ============ ÉTAT ============
const state = {
    lat: null, lon: null,
    mode: 'gps',          // 'gps' = position réelle, 'manual' = ville cherchée
    locSeq: 0,            // invalide les réponses d'une ancienne position
    last: { t: 0, lat: null, lon: null },
    gpsPos: null,
    weather: null, air: null, pollen: {}, quakes: [], rainMsg: null,
};
const MANUAL_KEY = 'live-info:manual';

// ============ LOCALISATION ============
function setLocation(lat, lon, name) {
    state.lat = lat; state.lon = lon;
    state.locSeq++;
    state.last = { t: Date.now(), lat, lon };
    if (name) setText('location-text', `📍 ${name}`); else loadPlace();
    loadWeather(); loadAir(); loadFuel();
    renderQuakes();
}

function shouldRefresh(lat, lon) {
    const l = state.last;
    return l.lat === null || haversineKm(l.lat, l.lon, lat, lon) > 0.5 || Date.now() - l.t > 10 * 60 * 1000;
}

async function loadPlace() {
    const seq = state.locSeq;
    try {
        const a = (await api('reverse-geocode', { lat: state.lat, lon: state.lon })).address || {};
        if (seq !== state.locSeq) return;
        const parts = [a.city || a.town || a.village || a.hamlet || a.municipality, a.state, a.country].filter(Boolean);
        setText('location-text', parts.length ? `📍 ${parts.join(', ')}` : '📍 Position détectée');
    } catch (e) {
        console.error('Reverse geocode:', e);
        setText('location-text', `📍 ${state.lat.toFixed(3)}, ${state.lon.toFixed(3)}`);
    }
}

function setGpsButton(active) { $('#btn-gps').classList.toggle('active', active); }

function initSearch() {
    const input = $('#search'), box = $('#search-results');
    let timer = null, found = [];

    const close = () => hide(box);
    const pick = (i) => {
        const r = found[i];
        if (!r) return;
        const name = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
        state.mode = 'manual';
        setGpsButton(false);
        try { localStorage.setItem(MANUAL_KEY, JSON.stringify({ lat: r.latitude, lon: r.longitude, name })); } catch { /* stockage indisponible */ }
        input.value = '';
        close();
        setLocation(r.latitude, r.longitude, name);
    };

    input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 2) return close();
        timer = setTimeout(async () => {
            try {
                found = (await api('geocode', { q })).results || [];
                box.innerHTML = found.length
                    ? found.map((r, i) => `<button type="button" data-i="${i}">${esc(r.name)} <small>${esc([r.admin1, r.country].filter(Boolean).join(', '))}</small></button>`).join('')
                    : '<button type="button" disabled>Aucun résultat</button>';
                show(box);
            } catch (e) { console.error('Geocode:', e); close(); }
        }, 300);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') pick(0);
        if (e.key === 'Escape') close();
    });
    box.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) pick(+b.dataset.i); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) close(); });

    $('#btn-gps').addEventListener('click', () => {
        state.mode = 'gps';
        setGpsButton(true);
        try { localStorage.removeItem(MANUAL_KEY); } catch { /* ignore */ }
        if (state.gpsPos) setLocation(state.gpsPos.lat, state.gpsPos.lon);
        else { setText('location-text', 'Localisation en cours...'); startGPS(); }
    });
}

// ============ MÉTÉO ============
async function loadWeather() {
    if (state.lat === null) return;
    const seq = state.locSeq;
    setStatus('weather', 'pending', 'Chargement...');
    try {
        const d = await api('weather', { lat: state.lat, lon: state.lon });
        if (seq !== state.locSeq) return;
        state.weather = d;
        renderWeather(d);
        setStatus('weather', 'ok', 'OK');
    } catch (e) {
        console.error('Weather:', e);
        setStatus('weather', 'error', 'Erreur');
        setText('weather-desc', 'Erreur de chargement');
    }
    renderAlerts();
}

function hourIndex(d) {
    const key = d.current.time.slice(0, 13);
    return Math.max(0, d.hourly.time.findIndex((t) => t >= key));
}

function renderWeather(d) {
    const c = d.current, h = d.hourly, hi = hourIndex(d);
    const vis = h.visibility?.[hi], uv = h.uv_index?.[hi];

    setText('weather-icon', wmoIcon(c.weather_code, c.is_day));
    setText('weather-temp', `${round(c.temperature_2m)}°C`);
    setText('weather-desc', wmoDesc(c.weather_code));
    metrics('weather-metrics', [
        ['Ressenti', `${round(c.apparent_temperature)}°C`],
        ['Humidité', `${c.relative_humidity_2m}%`],
        ['Vent', `${round(c.wind_speed_10m)} km/h ${cardinal(c.wind_direction_10m)}`],
        ['Rafales', `${round(c.wind_gusts_10m)} km/h`],
        ['Pression', `${round(c.pressure_msl)} hPa`],
        ['Précipitations', `${c.precipitation} mm`],
        ['Nuages', `${c.cloud_cover}%`],
        ['Visibilité', vis == null ? '--' : `${(vis / 1000).toFixed(vis >= 10000 ? 0 : 1)} km`],
        ['Indice UV', uv == null ? '--' : uv.toFixed(1)],
    ]);
    renderNowcast(d);
    renderHourly(d, hi);
    renderDaily(d);
    renderSun();
}

function renderNowcast(d) {
    const vals = d.minutely_15?.precipitation;
    const bars = $('#nowcast-bars');
    state.rainMsg = null;
    if (!vals || vals.every((v) => v == null)) {
        bars.innerHTML = '';
        return setText('nowcast-summary', 'Prévision à 15 min indisponible ici');
    }
    const max = Math.max(1, ...vals.map((v) => v || 0));
    bars.innerHTML = vals.map((v) => `<div style="height:${Math.max(4, ((v || 0) / max) * 100)}%" title="${v || 0} mm"></div>`).join('');
    const first = vals.findIndex((v) => (v || 0) >= 0.1);
    let msg;
    if (first === -1) msg = '☀️ Pas de pluie prévue dans les 2 h';
    else if (first === 0) msg = '🌧️ Il pleut en ce moment';
    else { msg = `🌧️ Pluie dans ~${first * 15} min`; state.rainMsg = `Pluie attendue dans ~${first * 15} min : prends un parapluie.`; }
    if (first === 0) state.rainMsg = 'Il pleut en ce moment.';
    setText('nowcast-summary', msg);
}

function renderHourly(d, hi) {
    const t = d.hourly.temperature_2m.slice(hi, hi + 24);
    const p = d.hourly.precipitation_probability.slice(hi, hi + 24);
    const times = d.hourly.time.slice(hi, hi + 24);
    if (t.length < 2) return;
    const W = 700, H = 180, L = 24, R = 24, step = (W - L - R) / (t.length - 1);
    const lo = Math.min(...t), top = Math.max(...t), span = top - lo || 1;
    const x = (i) => L + i * step, y = (v) => 30 + ((top - v) / span) * 70;

    const bars = p.map((v, i) => `<rect x="${(x(i) - step * 0.3).toFixed(1)}" y="${160 - (v || 0) * 0.4}" width="${(step * 0.6).toFixed(1)}" height="${(v || 0) * 0.4}" rx="2" fill="var(--info)" opacity=".35"/>`).join('');
    const line = t.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const marks = t.map((v, i) => i % 3 ? '' :
        `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="var(--accent)"/>` +
        `<text x="${x(i).toFixed(1)}" y="${(y(v) - 9).toFixed(1)}" text-anchor="middle">${round(v)}°</text>` +
        `<text x="${x(i).toFixed(1)}" y="176" text-anchor="middle">${hm(times[i])}</text>`).join('');
    $('#hourly-chart').innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Température et probabilité de pluie sur 24 heures">${bars}<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>${marks}</svg>`;
}

function renderDaily(d) {
    const dl = d.daily;
    $('#daily').innerHTML = dl.time.map((date, i) => {
        const name = i === 0 ? "Auj." : new Date(`${date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'short' });
        return `<div class="day"><div class="day-name">${esc(name)}</div><div class="day-icon">${wmoIcon(dl.weather_code[i])}</div>` +
            `<div class="day-temp">${round(dl.temperature_2m_max[i])}° <span>${round(dl.temperature_2m_min[i])}°</span></div>` +
            `<div class="day-rain">💧 ${dl.precipitation_probability_max[i] ?? 0}% · ${dl.precipitation_sum[i]} mm</div></div>`;
    }).join('');
}

// ============ SOLEIL & LUNE ============
function moonPhase(date = new Date()) {
    const synodic = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14); // nouvelle lune de référence
    const age = (((date - ref) / 86400000) % synodic + synodic) % synodic;
    const phases = [['Nouvelle lune', '🌑'], ['Premier croissant', '🌒'], ['Premier quartier', '🌓'], ['Gibbeuse croissante', '🌔'],
    ['Pleine lune', '🌕'], ['Gibbeuse décroissante', '🌖'], ['Dernier quartier', '🌗'], ['Dernier croissant', '🌘']];
    const [name, icon] = phases[Math.floor((age / synodic) * 8 + 0.5) % 8];
    return { name, icon, age, illum: round(((1 - Math.cos(2 * Math.PI * age / synodic)) / 2) * 100) };
}

function renderSun() {
    const m = moonPhase();
    const items = [];
    const dl = state.weather?.daily;
    if (dl) {
        items.push(['Lever', hm(dl.sunrise[0])], ['Coucher', hm(dl.sunset[0])],
            ['Durée du jour', dur(dl.daylight_duration[0])], ['UV max', dl.uv_index_max[0]?.toFixed(1) ?? '--']);
    }
    items.push(['Lune', `${m.icon} ${m.name}`], ['Illumination', `${m.illum}%`, m.illum, 'progress-ram']);
    metrics('sun-metrics', items);
}

// ============ AIR & POLLENS ============
const AQI_BANDS = [[20, 'Bon'], [40, 'Correct'], [60, 'Moyen'], [80, 'Médiocre'], [100, 'Mauvais'], [Infinity, 'Très mauvais']];
const POLLENS = { alder_pollen: 'Aulne', birch_pollen: 'Bouleau', grass_pollen: 'Graminées', mugwort_pollen: 'Armoise', olive_pollen: 'Olivier', ragweed_pollen: 'Ambroisie' };

async function loadAir() {
    if (state.lat === null) return;
    const seq = state.locSeq;
    setStatus('air', 'pending', 'Chargement...');
    try {
        const d = await api('air', { lat: state.lat, lon: state.lon });
        if (seq !== state.locSeq) return;
        state.air = d.current;
        const c = d.current, aqi = c.european_aqi;
        const label = aqi == null ? 'N/D' : AQI_BANDS.find(([max]) => aqi <= max)[1];
        metrics('air-metrics', [
            ['Indice européen', aqi ?? '--', aqi == null ? null : Math.min(100, aqi), aqi > 60 ? 'progress-gpu' : 'progress-cpu'],
            ['PM2.5', `${c.pm2_5 ?? '--'} µg/m³`], ['PM10', `${c.pm10 ?? '--'} µg/m³`],
            ['NO₂', `${c.nitrogen_dioxide ?? '--'} µg/m³`], ['Ozone', `${c.ozone ?? '--'} µg/m³`], ['SO₂', `${c.sulphur_dioxide ?? '--'} µg/m³`],
        ]);
        const idx = Math.max(0, (d.hourly.time || []).findIndex((t) => t >= c.time.slice(0, 13)));
        state.pollen = {};
        let known = false;
        for (const [key, name] of Object.entries(POLLENS)) {
            const v = d.hourly[key]?.[idx];
            if (v != null) known = true;
            if (v >= 1) state.pollen[name] = round(v);
        }
        const list = Object.entries(state.pollen).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${v}`);
        setText('pollen-text', !known ? 'Pollens : données indisponibles ici (Europe uniquement).'
            : list.length ? `Pollens (grains/m³) : ${list.join(' · ')}` : 'Pollens : rien de significatif.');
        setStatus('air', aqi == null ? 'warn' : aqi <= 40 ? 'ok' : aqi <= 80 ? 'warn' : 'error', label);
    } catch (e) {
        console.error('Air:', e);
        setStatus('air', 'error', 'Erreur');
    }
    renderAlerts();
}

// ============ CARBURANTS ============
const FUEL_NAMES = { gazole: 'Gazole', e10: 'SP95-E10', sp95: 'SP95', sp98: 'SP98', e85: 'E85', gplc: 'GPLc' };

async function loadFuel() {
    if (state.lat === null) return;
    const seq = state.locSeq;
    setStatus('fuel', 'pending', 'Chargement...');
    try {
        const d = await api('fuel', { lat: state.lat, lon: state.lon });
        if (seq !== state.locSeq) return;
        const rows = Object.entries(d.best);
        $('#fuel-list').innerHTML = rows.length
            ? rows.map(([k, s]) => `<div class="row"><div><strong>${FUEL_NAMES[k]}</strong><small>${esc(s.ville)} · ${esc(s.adresse)} · ${s.dist_km} km</small></div><span class="mono">${Number(s.prix).toFixed(3)} €</span></div>`).join('')
            : '<div class="empty">Aucune station trouvée (France uniquement).</div>';
        setText('fuel-hint', `${d.count} stations dans ${d.radius_km} km${d.truncated ? ' (liste tronquée à 100)' : ''}.`);
        setStatus('fuel', rows.length ? 'ok' : 'warn', rows.length ? 'OK' : 'Aucune');
    } catch (e) {
        console.error('Fuel:', e);
        setStatus('fuel', 'error', 'Erreur');
    }
}

// ============ SÉISMES ============
async function loadQuakes() {
    try {
        state.quakes = (await api('quakes')).quakes;
        renderQuakes();
        setStatus('quake', 'ok', 'OK');
    } catch (e) {
        console.error('Quakes:', e);
        setStatus('quake', 'error', 'Erreur');
    }
    renderAlerts();
}

function renderQuakes() {
    const list = $('#quake-list');
    if (!state.quakes.length) return;
    list.innerHTML = state.quakes.slice(0, 6).map((q) => {
        const km = state.lat === null ? null : round(haversineKm(state.lat, state.lon, q.lat, q.lon));
        const color = q.mag >= 6 ? 'var(--danger)' : q.mag >= 5 ? 'var(--warning)' : 'inherit';
        return `<div class="row"><div>${esc(q.place)}<small>${ago(q.time)} · prof. ${round(q.depth)} km${km === null ? '' : ` · à ${km} km`}</small></div><span class="mono" style="color:${color}">M${Number(q.mag).toFixed(1)}</span></div>`;
    }).join('');
}

// ============ ISS ============
async function loadIss() {
    try {
        const d = await api('iss');
        const km = state.lat === null ? '--' : `${round(haversineKm(state.lat, state.lon, d.latitude, d.longitude))} km`;
        const vis = { daylight: 'Éclairée', eclipsed: "Dans l'ombre", visible: 'Visible' }[d.visibility] || d.visibility;
        metrics('iss-metrics', [
            ['Latitude', `${d.latitude.toFixed(2)}°`], ['Longitude', `${d.longitude.toFixed(2)}°`],
            ['Altitude', `${round(d.altitude)} km`], ['Vitesse', `${round(d.velocity).toLocaleString('fr-FR')} km/h`],
            ['Distance de toi', km], ['Éclairage', vis],
        ]);
        setStatus('iss', 'ok', 'Live');
    } catch (e) {
        console.error('ISS:', e);
        setStatus('iss', 'error', 'Erreur');
    }
}

// ============ HEURES DU MONDE ============
const ZONES = [['Ici', undefined], ['UTC', 'UTC'], ['New York', 'America/New_York'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney'], ['Dubaï', 'Asia/Dubai']];
function renderClocks() {
    metrics('clocks', ZONES.map(([label, timeZone]) =>
        [label, new Date().toLocaleTimeString('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' })]));
}

// ============ SERVEUR (psutil) ============
let serverTimer = null;
async function loadServer() {
    try {
        const s = await api('server');
        show($('#server-card'));
        metrics('server-metrics', [
            ['CPU', `${s.cpu.toFixed(0)}%`, s.cpu, 'progress-cpu'],
            ['RAM', `${s.ram_percent.toFixed(0)}%`, s.ram_percent, 'progress-ram'],
            ['RAM utilisée', `${s.ram_used_mb} / ${s.ram_total_mb} Mo`],
            ['Disque', `${s.disk_percent.toFixed(0)}%`, s.disk_percent, 'progress-gpu'],
            ['Libre', `${s.disk_free_gb} Go`], ['Cœurs', s.cores],
            ['Uptime', dur(s.uptime_s)], ['Charge 1/5/15 min', s.load ? s.load.map((v) => v.toFixed(1)).join(' ') : '--'],
        ]);
    } catch (e) {
        if (String(e.message).includes('psutil')) { clearInterval(serverTimer); hide($('#server-card')); }
    }
}

// ============ GPS / TRAJET ============
let watchId = null;
const trip = { dist: 0, max: 0, last: null, start: null };

function startGPS() {
    if (!navigator.geolocation) {
        setStatus('gps', 'error', 'Non supporté');
        return setText('location-text', 'Géolocalisation non supportée par ce navigateur');
    }
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(onGpsSuccess, onGpsError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 });
}

function onGpsSuccess(pos) {
    const { latitude: lat, longitude: lon, altitude, accuracy, speed, heading } = pos.coords;
    state.gpsPos = { lat, lon };
    const kmh = speed == null ? null : speed * 3.6;

    if (accuracy <= 50) {
        if (!trip.start) trip.start = pos.timestamp;
        if (trip.last) {
            const d = haversineKm(trip.last.lat, trip.last.lon, lat, lon);
            if (d * 1000 > Math.max(5, accuracy / 2)) { trip.dist += d; trip.last = { lat, lon }; }
        } else trip.last = { lat, lon };
        if (kmh != null) trip.max = Math.max(trip.max, kmh);
    }
    const hours = trip.start ? (pos.timestamp - trip.start) / 3600000 : 0;

    setText('gps-speed', kmh == null ? '--' : kmh.toFixed(1));
    setText('gps-heading', heading == null || Number.isNaN(heading) ? '--' : `${round(heading)}° ${cardinal(heading)}`);
    metrics('gps-metrics', [
        ['Altitude', altitude == null ? '--' : `${round(altitude)} m`], ['Précision', `±${round(accuracy)} m`],
        ['Distance', `${trip.dist.toFixed(2)} km`], ['Vitesse max', `${trip.max.toFixed(0)} km/h`],
        ['Vitesse moy.', hours > 0.005 ? `${(trip.dist / hours).toFixed(1)} km/h` : '--'], ['Position', `${lat.toFixed(4)}, ${lon.toFixed(4)}`],
    ]);
    setStatus('gps', 'ok', 'Actif');

    if (state.mode === 'gps' && shouldRefresh(lat, lon)) setLocation(lat, lon);
}

function onGpsError(err) {
    const msg = { 1: 'Permission refusée', 2: 'Position indisponible', 3: 'Timeout' }[err.code] || 'Erreur GPS';
    setStatus('gps', 'error', msg);
    if (state.lat === null) {
        setText('location-text', `${msg}. Autorise la position (icône 📍 de la barre d'adresse) ou cherche une ville.`);
        renderAlerts();
    }
}

// ============ ALERTES & CONSEILS ============
function renderAlerts() {
    const items = [];
    const w = state.weather, a = state.air;
    if (state.lat === null) items.push(['info', 'Autorise la géolocalisation ou cherche une ville pour afficher météo, air et carburants.']);
    if (w) {
        const c = w.current, dl = w.daily, hi = hourIndex(w);
        const vis = w.hourly.visibility?.[hi];
        if (c.weather_code >= 95) items.push(['danger', 'Orage en cours ou imminent : évite les zones dégagées et les arbres.']);
        if (c.wind_gusts_10m >= 90) items.push(['danger', `Rafales très violentes (${round(c.wind_gusts_10m)} km/h).`]);
        else if (c.wind_gusts_10m >= 60) items.push(['warn', `Rafales fortes (${round(c.wind_gusts_10m)} km/h).`]);
        if (dl.temperature_2m_max[0] >= 35) items.push(['danger', `Forte chaleur aujourd'hui (max ${round(dl.temperature_2m_max[0])}°C) : hydrate-toi, évite l'effort en plein soleil.`]);
        else if (dl.temperature_2m_max[0] >= 30) items.push(['warn', `Il fera chaud (max ${round(dl.temperature_2m_max[0])}°C).`]);
        if (dl.temperature_2m_min[0] <= 0) items.push(['warn', `Gel possible (min ${round(dl.temperature_2m_min[0])}°C) : risque de verglas.`]);
        if (dl.uv_index_max[0] >= 8) items.push(['danger', `Indice UV très élevé (${dl.uv_index_max[0].toFixed(0)}) : protection solaire indispensable.`]);
        else if (dl.uv_index_max[0] >= 6) items.push(['warn', `Indice UV élevé (${dl.uv_index_max[0].toFixed(0)}).`]);
        if (vis != null && vis < 1000) items.push(['warn', 'Visibilité réduite (brouillard) : prudence sur la route.']);
        if (state.rainMsg) items.push(['info', state.rainMsg]);
        else if ((dl.precipitation_probability_max[0] ?? 0) >= 60) items.push(['info', `Pluie probable aujourd'hui (${dl.precipitation_probability_max[0]}%).`]);
    }
    if (a?.european_aqi > 80) items.push(['danger', `Air de mauvaise qualité (indice ${a.european_aqi}) : limite les efforts en extérieur.`]);
    else if (a?.european_aqi > 60) items.push(['warn', `Air médiocre (indice ${a.european_aqi}).`]);
    const heavy = Object.entries(state.pollen).filter(([, v]) => v >= 50);
    if (heavy.length) items.push(['warn', `Pollens élevés : ${heavy.map(([n]) => n).join(', ')}.`]);
    if (state.lat !== null) {
        const q = state.quakes.find((q) => q.mag >= 5 && haversineKm(state.lat, state.lon, q.lat, q.lon) < 1000);
        if (q) items.push(['warn', `Séisme M${q.mag.toFixed(1)} à ${round(haversineKm(state.lat, state.lon, q.lat, q.lon))} km (${ago(q.time)}).`]);
    }
    if (!items.length) items.push(['ok', '✅ Rien à signaler pour le moment.']);
    $('#alerts').innerHTML = items.map(([k, m]) => `<div class="alert ${k}">${esc(m)}</div>`).join('');
}

// ============ APPAREIL & RÉSEAU ============
const deviceExtra = {};

function detectOS(ua) {
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Windows/.test(ua)) return 'Windows';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Mac OS X|macOS/.test(ua)) return 'macOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Inconnu';
}

function detectBrowser(ua) {
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Inconnu';
}

function gpuName() {
    try {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        let r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
        const m = r.match(/^ANGLE \((.*)\)$/);
        if (m) {
            const p = m[1].split(',');
            r = (p[1] || p[0]).trim()
                .replace(/\s*(\(0x[0-9a-f]+\)|Direct3D.*|OpenGL.*|vs_.*)$/i, '')
                .replace(/^ANGLE Metal Renderer:\s*/, '');
        }
        return r;
    } catch { return 'Inconnu'; }
}

function renderDevice() {
    const ua = navigator.userAgent, conn = navigator.connection;
    const items = [
        ['OS', navigator.userAgentData?.platform || detectOS(ua)],
        ['Navigateur', detectBrowser(ua)],
        ['Écran', `${screen.width} × ${screen.height} (${window.devicePixelRatio || 1}x)`],
        ['Langue', navigator.language || 'Inconnue'],
        ['Fuseau', Intl.DateTimeFormat().resolvedOptions().timeZone],
        ['Cœurs logiques', navigator.hardwareConcurrency || '--'],
        ['GPU', deviceExtra.gpu || '--'],
        ['En ligne', navigator.onLine ? '✅ Oui' : '❌ Non'],
        ['Réseau', conn ? (conn.effectiveType || conn.type || 'Inconnu') : 'API non supportée'],
    ];
    if (navigator.deviceMemory) items.splice(6, 0, ['Mémoire (approx.)', `${navigator.deviceMemory} Go`]);
    if (deviceExtra.arch) items.splice(6, 0, ['Architecture', deviceExtra.arch]);
    if (conn?.downlink != null) items.push(['Débit estimé', `${conn.downlink} Mbps`], ['Latence estimée', `${conn.rtt} ms`]);
    if (performance.memory) {
        const used = round(performance.memory.usedJSHeapSize / 1048576), lim = round(performance.memory.jsHeapSizeLimit / 1048576);
        items.push(['Mémoire JS', `${used} / ${lim} Mo`, (used / lim) * 100, 'progress-ram']);
    }
    metrics('device-metrics', items);
}

function initDevice() {
    deviceExtra.gpu = gpuName();
    renderDevice();
    navigator.userAgentData?.getHighEntropyValues(['architecture', 'bitness'])
        .then((v) => { if (v.architecture) { deviceExtra.arch = `${v.architecture}${v.bitness ? `-${v.bitness}` : ''}`; renderDevice(); } })
        .catch(() => { /* non dispo */ });
    window.addEventListener('online', renderDevice);
    window.addEventListener('offline', renderDevice);
    navigator.connection?.addEventListener('change', renderDevice);
    every(5000, renderDevice); // met à jour la mémoire JS
}

// ============ SPEEDTEST (Cloudflare) ============
let speedtestRunning = false;
const CF = 'https://speed.cloudflare.com';

async function measureDownload() {
    let best = 0;
    for (const size of [1e6, 5e6, 25e6]) {
        const t0 = performance.now();
        const resp = await fetch(`${CF}/__down?bytes=${size}&t=${Date.now()}`, { cache: 'no-store' });
        await resp.arrayBuffer();
        const sec = (performance.now() - t0) / 1000;
        best = Math.max(best, (size * 8) / sec / 1e6);
        if (sec > 3) break; // assez long pour être précis
    }
    return best;
}

async function measureUpload() {
    const bytes = 4 * 1024 * 1024;
    const t0 = performance.now();
    await fetch(`${CF}/__up`, { method: 'POST', body: new Uint8Array(bytes), cache: 'no-store' });
    return (bytes * 8) / ((performance.now() - t0) / 1000) / 1e6;
}

async function measurePing() {
    const times = [];
    for (let i = 0; i < 6; i++) {
        const t0 = performance.now();
        await fetch(`${CF}/__down?bytes=0&t=${Date.now()}${i}`, { cache: 'no-store' });
        times.push(performance.now() - t0);
    }
    times.shift(); // la 1re requête inclut la poignée de main TLS
    return times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
}

async function runSpeedtest() {
    if (speedtestRunning) return;
    speedtestRunning = true;
    const btn = $('#speedtest-btn');
    btn.classList.add('running'); btn.disabled = true;
    setText('speedtest-btn-text', 'Test en cours...');
    show($('#speedtest-loader')); hide($('#speedtest-result'));
    setStatus('speedtest', 'pending', 'Test...');
    try {
        const ping = await measurePing();
        const dl = await measureDownload();
        const ul = await measureUpload();
        setText('dl-speed', dl.toFixed(1)); setText('ul-speed', ul.toFixed(1)); setText('ping-speed', ping.toFixed(0));
        show($('#speedtest-result'));
        setStatus('speedtest', 'ok', 'Terminé');
    } catch (e) {
        console.error('Speedtest:', e);
        setStatus('speedtest', 'error', 'Erreur');
    } finally {
        speedtestRunning = false;
        btn.classList.remove('running'); btn.disabled = false;
        setText('speedtest-btn-text', 'Relancer le test');
        hide($('#speedtest-loader'));
    }
}

// ============ BATTERIE ============
async function initBattery() {
    if (!('getBattery' in navigator)) return;
    try {
        const b = await navigator.getBattery();
        const t = (s) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
        const render = () => {
            const level = round(b.level * 100);
            let time = '--';
            if (b.charging && Number.isFinite(b.chargingTime)) time = b.chargingTime ? `${t(b.chargingTime)} avant 100%` : 'Chargée';
            else if (!b.charging && Number.isFinite(b.dischargingTime)) time = `${t(b.dischargingTime)} restantes`;
            metrics('battery-metrics', [['Niveau', `${level}%`, level, level < 20 ? 'progress-gpu' : 'progress-cpu'],
            ['État', b.charging ? '🔌 En charge' : '🔋 Sur batterie'], ['Autonomie', time]]);
        };
        show($('#battery-card'));
        render();
        ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => b.addEventListener(ev, render));
    } catch (e) { console.error('Batterie:', e); }
}

// ============ ORIENTATION / MOUVEMENT ============
const motion = { a: null, b: null, g: null, x: null, y: null, z: null };

function renderMotion() {
    const f = (v, n = 1) => (v == null ? '--' : v.toFixed(n));
    metrics('orient-metrics', [['Alpha (Z)', `${f(motion.a)}°`], ['Beta (X)', `${f(motion.b)}°`], ['Gamma (Y)', `${f(motion.g)}°`],
    ['Accél. X', `${f(motion.x, 2)} m/s²`], ['Accél. Y', `${f(motion.y, 2)} m/s²`], ['Accél. Z', `${f(motion.z, 2)} m/s²`]]);
}

function startMotion() {
    let last = 0;
    window.addEventListener('deviceorientation', (e) => {
        if (e.alpha == null && e.beta == null) return; // desktop : l'évènement existe mais sans données
        Object.assign(motion, { a: e.alpha, b: e.beta, g: e.gamma });
        show($('#orientation-card'));
        if (Date.now() - last > 100) { last = Date.now(); renderMotion(); }
    });
    window.addEventListener('devicemotion', (e) => {
        if (e.acceleration) Object.assign(motion, { x: e.acceleration.x, y: e.acceleration.y, z: e.acceleration.z });
    });
}

function initOrientation() {
    if (!('DeviceOrientationEvent' in window)) return;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') { // iOS 13+ : geste utilisateur requis
        const card = $('#orientation-card');
        show(card); // visible, sinon impossible de cliquer pour accorder la permission
        setStatus('orient', 'warn', 'Touche pour activer');
        card.addEventListener('click', async () => {
            try {
                if (await DeviceOrientationEvent.requestPermission() === 'granted') { setStatus('orient', 'ok', 'Actif'); startMotion(); }
            } catch (e) { console.error('Orientation:', e); }
        }, { once: true });
        return;
    }
    startMotion();
}

// ============ INITIALISATION ============
function init() {
    initDevice();
    renderClocks(); every(1000, renderClocks);
    renderSun(); every(3600e3, renderSun);
    initSearch();
    initBattery();
    initOrientation();
    $('#speedtest-btn').addEventListener('click', runSpeedtest);

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(MANUAL_KEY)); } catch { /* ignore */ }
    if (saved?.lat != null) {
        state.mode = 'manual';
        setGpsButton(false);
        setLocation(saved.lat, saved.lon, saved.name);
    }
    startGPS();

    loadQuakes(); every(5 * 60e3, loadQuakes);
    loadIss(); every(10e3, loadIss);
    loadServer(); serverTimer = every(3000, loadServer);
    every(10 * 60e3, () => { loadWeather(); loadFuel(); });
    every(30 * 60e3, loadAir);
    renderAlerts();
}

init();