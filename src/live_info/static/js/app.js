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
const uniq = (arr) => [...new Set(arr.filter(Boolean))];
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
    gpsPos: null, acc: null,
    weather: null, air: null, pollen: {}, quakes: [], rainMsg: null,
    kp: null, holidays: [], pTrend: null, climate: null,
};
const MANUAL_KEY = 'live-info:manual';

// ============ LOCALISATION ============
function setLocation(lat, lon, name) {
    state.lat = lat; state.lon = lon;
    state.locSeq++;
    state.last = { t: Date.now(), lat, lon, acc: state.mode === 'gps' ? state.acc : null };
    if (name) setText('location-text', `📍 ${name}`); else loadPlace();
    loadWeather(); loadAir(); loadFuel(); loadMarine(); loadCommune(); loadClimate();
    renderQuakes();
    updateMapLocation();
}

function shouldRefresh(lat, lon, acc) {
    const l = state.last;
    const moved = l.lat === null || haversineKm(l.lat, l.lon, lat, lon) > 0.5 || Date.now() - l.t > 10 * 60 * 1000;
    const moreAccurate = acc != null && l.acc != null && acc < l.acc / 2 && acc < 2000; // un fix précis remplace un fix grossier (Wi-Fi/IP)
    return moved || moreAccurate;
}

async function loadPlace() {
    const seq = state.locSeq;
    try {
        const a = (await api('reverse-geocode', { lat: state.lat, lon: state.lon })).address || {};
        if (seq !== state.locSeq) return;
        const town = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb;
        const place = town ? `${a.postcode ? `${a.postcode.split(';')[0]} ` : ''}${town}` : null;
        const parts = uniq([place, a.county, a.state, a.country]); // county = département en France
        const approx = state.mode === 'gps' && state.acc > 3000 ? ' (approx.)' : '';
        setText('location-text', parts.length ? `📍 ${parts.join(', ')}${approx}` : '📍 Position détectée');
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
        const name = uniq([r.name, r.admin2, r.admin1, r.country]).join(', ');
        state.mode = 'manual';
        state.acc = null;
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
                    ? found.map((r, i) => `<button type="button" data-i="${i}">${esc(r.name)} <small>${esc(uniq([r.admin2, r.admin1, r.country]).join(', '))}</small></button>`).join('')
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
        ['Échelle de Beaufort', beaufort(c.wind_speed_10m)],
        ['Pression', `${round(c.pressure_msl)} hPa`],
        ['Précipitations', `${c.precipitation} mm`],
        ['Nuages', `${c.cloud_cover}%`],
        ['Visibilité', vis == null ? '--' : `${(vis / 1000).toFixed(vis >= 10000 ? 0 : 1)} km`],
        ['Indice UV', uv == null ? '--' : uv.toFixed(1)],
    ]);
    const dl = d.daily, p = h.pressure_msl;
    state.pTrend = p && hi >= 3 && p[hi] != null && p[hi - 3] != null ? p[hi] - p[hi - 3] : null;
    const pt = state.pTrend;
    metrics('today-metrics', [
        ['Min / Max', `${round(dl.temperature_2m_min[0])}° / ${round(dl.temperature_2m_max[0])}°`],
        ['Pluie du jour', `${dl.precipitation_sum[0]} mm`],
        ['Proba pluie', `${dl.precipitation_probability_max[0] ?? 0}%`],
        ['Rafales max', `${round(dl.wind_gusts_10m_max[0])} km/h`],
        ['Point de rosée', c.dew_point_2m == null ? '--' : `${round(c.dew_point_2m)}°C`],
        ['Tendance pression', pt == null ? '--' : `${pt > 1 ? '↗' : pt < -1 ? '↘' : '→'} ${pt > 0 ? '+' : ''}${pt.toFixed(1)} hPa/3h`],
    ]);
    renderNowcast(d);
    renderHourly(d, hi);
    renderDaily(d);
    renderSun();
    renderClimate();
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
    else { msg = `🌧️ Pluie dans ~${first * 15} min`; state.rainMsg = `Pluie attendue dans ~${first * 15} min : prévoyez un parapluie.`; }
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
            ['Durée du jour', dur(dl.daylight_duration[0])], ['Soleil prévu', dl.sunshine_duration?.[0] == null ? '--' : dur(dl.sunshine_duration[0])], ['UV max', dl.uv_index_max[0]?.toFixed(1) ?? '--']);
    }
    const w = state.weather;
    if (w) {
        const rad = w.hourly.shortwave_radiation?.[hourIndex(w)];
        items.push(['Rayonnement solaire', rad == null ? '--' : `${round(rad)} W/m²`]);
    }
    items.push(['Lune', `${m.icon} ${m.name}`], ['Illumination', `${m.illum}%`, m.illum, 'progress-ram'],
        ['Prochaine pleine lune', `≈ ${nextPhaseDate(m.age, 14.765)}`], ['Prochaine nouvelle lune', `≈ ${nextPhaseDate(m.age, 0)}`]);
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
            ['Particules fines PM2,5', `${c.pm2_5 ?? '--'} µg/m³`], ['Particules PM10', `${c.pm10 ?? '--'} µg/m³`],
            ["Dioxyde d'azote (NO₂)", `${c.nitrogen_dioxide ?? '--'} µg/m³`], ['Ozone (O₃)', `${c.ozone ?? '--'} µg/m³`], ['Dioxyde de soufre (SO₂)', `${c.sulphur_dioxide ?? '--'} µg/m³`],
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
    if (mapState.quakes) {
        mapState.quakes.clearLayers();
        state.quakes.forEach((q) => L.circleMarker([q.lat, q.lon], { radius: Math.max(4, q.mag * 2.2), color: '#ef4444', weight: 1, fillOpacity: 0.4 })
            .bindTooltip(esc(`M${Number(q.mag).toFixed(1)} · ${q.place}`)).addTo(mapState.quakes));
    }
    if (!state.quakes.length) return;
    list.innerHTML = state.quakes.slice(0, 6).map((q) => {
        const km = state.lat === null ? null : round(haversineKm(state.lat, state.lon, q.lat, q.lon));
        const color = q.mag >= 6 ? 'var(--danger)' : q.mag >= 5 ? 'var(--warning)' : 'inherit';
        return `<div class="row"><div>${esc(q.place)}<small>${ago(q.time)} · profondeur ${round(q.depth)} km${km === null ? '' : ` · à ${km} km`}</small></div><span class="mono" style="color:${color}">M${Number(q.mag).toFixed(1)}</span></div>`;
    }).join('');
}

// ============ ISS ============
async function loadIss() {
    try {
        const d = await api('iss');
        mapState.iss?.setLatLng([d.latitude, d.longitude]);
        const km = state.lat === null ? '--' : `${round(haversineKm(state.lat, state.lon, d.latitude, d.longitude))} km`;
        const vis = { daylight: 'Éclairée', eclipsed: "Dans l'ombre", visible: 'Visible' }[d.visibility] || d.visibility;
        metrics('iss-metrics', [
            ['Latitude', `${d.latitude.toFixed(2)}°`], ['Longitude', `${d.longitude.toFixed(2)}°`],
            ['Altitude', `${round(d.altitude)} km`], ['Vitesse', `${round(d.velocity).toLocaleString('fr-FR')} km/h`],
            ['Distance depuis vous', km], ['Éclairage', vis],
        ]);
        setStatus('iss', 'ok', 'En direct');
    } catch (e) {
        console.error('ISS:', e);
        setStatus('iss', 'error', 'Erreur');
    }
}

// ============ PERFORMANCES DE L'APPAREIL (mesurées dans le navigateur) ============
const perf = { fps: null, lag: null, bench: null };

function renderPerf() {
    const items = [
        ['Images par seconde', perf.fps ?? '--', perf.fps == null ? null : (perf.fps / 60) * 100, perf.fps < 30 ? 'progress-gpu' : 'progress-cpu'],
        ['Réactivité (retard)', perf.lag == null ? '--' : `${perf.lag.toFixed(0)} ms`],
        ['Puissance de calcul (1 cœur)', perf.bench == null ? 'Non mesurée' : `${perf.bench} M op./s`],
        ['Cœurs du processeur', navigator.hardwareConcurrency || '--'],
    ];
    if (navigator.deviceMemory) items.push(['Mémoire vive (approx.)', `${navigator.deviceMemory}${navigator.deviceMemory >= 8 ? '+' : ''} Go`]);
    metrics('perf-metrics', items);
}

function runBench() {
    const btn = $('#bench-btn');
    btn.disabled = true; btn.textContent = 'Mesure en cours…';
    setTimeout(() => { // laisse le navigateur afficher le texte avant de bloquer le thread
        let n = 0, x = 0;
        const t0 = performance.now();
        while (performance.now() - t0 < 400) {
            for (let i = 0; i < 20000; i++) x += Math.sqrt(i) * Math.sin(i);
            n += 20000;
        }
        perf.bench = round(n / (performance.now() - t0) / 1000); // millions d'opérations / s
        perf.sink = x; // empêche l'optimiseur de supprimer la boucle
        btn.disabled = false; btn.textContent = 'Refaire le test';
        renderPerf();
    }, 50);
}

function startPerfMonitor() {
    let frames = 0, t0 = performance.now();
    const loop = (t) => {
        frames++;
        if (t - t0 >= 1000) { perf.fps = round((frames * 1000) / (t - t0)); frames = 0; t0 = t; }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    let expected = performance.now() + 500; // retard du timer = fluidité du thread principal
    setInterval(() => {
        const now = performance.now();
        perf.lag = document.hidden ? null : Math.max(0, now - expected);
        expected = now + 500;
    }, 500);

    $('#bench-btn').addEventListener('click', runBench);
    renderPerf(); every(1000, renderPerf);
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
    // 1) fix rapide (Wi-Fi/IP) pour afficher quelque chose tout de suite ; 2) suivi haute précision qui l'affine
    navigator.geolocation.getCurrentPosition((p) => { if (!state.gpsPos) onGpsSuccess(p); }, () => { },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
    watchId = navigator.geolocation.watchPosition(onGpsSuccess, onGpsError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 });
}

function onGpsSuccess(pos) {
    const { latitude: lat, longitude: lon, altitude, accuracy, speed, heading } = pos.coords;
    state.gpsPos = { lat, lon };
    state.acc = accuracy;
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
    setStatus('gps', accuracy > 1000 ? 'warn' : 'ok', accuracy > 1000 ? `Approx. ±${(accuracy / 1000).toFixed(1)} km` : `±${round(accuracy)} m`);

    if (state.mode === 'gps' && shouldRefresh(lat, lon, accuracy)) setLocation(lat, lon);
}

function onGpsError(err) {
    const msg = { 1: 'Permission refusée', 2: 'Position indisponible', 3: 'Timeout' }[err.code] || 'Erreur GPS';
    setStatus('gps', 'error', msg);
    if (state.lat === null) {
        setText('location-text', `${msg}. Autorisez la position (icône 📍 de la barre d'adresse) ou recherchez une ville.`);
        renderAlerts();
    }
}

// ============ ALERTES & CONSEILS ============
function renderAlerts() {
    const items = [];
    const w = state.weather, a = state.air;
    if (state.lat === null) items.push(['info', "Autorisez la géolocalisation ou recherchez une ville pour afficher la météo, la qualité de l'air et les carburants."]);
    if (w) {
        const c = w.current, dl = w.daily, hi = hourIndex(w);
        const vis = w.hourly.visibility?.[hi];
        if (c.weather_code >= 95) items.push(['danger', 'Orage en cours ou imminent : évitez les zones dégagées et les arbres.']);
        if (c.wind_gusts_10m >= 90) items.push(['danger', `Rafales très violentes (${round(c.wind_gusts_10m)} km/h).`]);
        else if (c.wind_gusts_10m >= 60) items.push(['warn', `Rafales fortes (${round(c.wind_gusts_10m)} km/h).`]);
        if (dl.temperature_2m_max[0] >= 35) items.push(['danger', `Forte chaleur aujourd'hui (max ${round(dl.temperature_2m_max[0])}°C) : hydratez-vous et évitez l'effort en plein soleil.`]);
        else if (dl.temperature_2m_max[0] >= 30) items.push(['warn', `Il fera chaud (max ${round(dl.temperature_2m_max[0])}°C).`]);
        if (dl.temperature_2m_min[0] <= 0) items.push(['warn', `Gel possible (min ${round(dl.temperature_2m_min[0])}°C) : risque de verglas.`]);
        if (dl.uv_index_max[0] >= 8) items.push(['danger', `Indice UV très élevé (${dl.uv_index_max[0].toFixed(0)}) : protection solaire indispensable.`]);
        else if (dl.uv_index_max[0] >= 6) items.push(['warn', `Indice UV élevé (${dl.uv_index_max[0].toFixed(0)}).`]);
        if (vis != null && vis < 1000) items.push(['warn', 'Visibilité réduite (brouillard) : soyez prudent sur la route.']);
        if (state.rainMsg) items.push(['info', state.rainMsg]);
        else if ((dl.precipitation_probability_max[0] ?? 0) >= 60) items.push(['info', `Pluie probable aujourd'hui (${dl.precipitation_probability_max[0]}%).`]);
    }
    if (a?.european_aqi > 80) items.push(['danger', `Air de mauvaise qualité (indice ${a.european_aqi}) : limitez les efforts en extérieur.`]);
    else if (a?.european_aqi > 60) items.push(['warn', `Air médiocre (indice ${a.european_aqi}).`]);
    const heavy = Object.entries(state.pollen).filter(([, v]) => v >= 50);
    if (heavy.length) items.push(['warn', `Pollens élevés : ${heavy.map(([n]) => n).join(', ')}.`]);
    if (state.lat !== null) {
        const q = state.quakes.find((q) => q.mag >= 5 && haversineKm(state.lat, state.lon, q.lat, q.lon) < 1000);
        if (q) items.push(['warn', `Séisme M${q.mag.toFixed(1)} à ${round(haversineKm(state.lat, state.lon, q.lat, q.lon))} km (${ago(q.time)}).`]);
    }
    if (state.pTrend != null && state.pTrend <= -6) items.push(['warn', `Pression en chute rapide (${state.pTrend.toFixed(1)} hPa en 3 h) : dégradation probable.`]);
    if (state.kp >= 5) items.push(['info', `Tempête géomagnétique (Kp ${state.kp.toFixed(1)}) : aurores possibles au nord de l'Europe.`]);
    const h0 = state.holidays[0];
    if (h0 && daysUntil(h0.date) <= 1) items.push(['info', `${daysUntil(h0.date) === 0 ? "Aujourd'hui" : 'Demain'} : ${h0.name} (jour férié).`]);
    if (!items.length) items.push(['ok', '✅ Rien à signaler pour le moment.']);
    $('#alerts').innerHTML = items.map(([k, m]) => `<div class="alert ${k}">${esc(m)}</div>`).join('');
}

// ============ APPAREIL & RÉSEAU ============
const deviceExtra = {};
const NET_TYPES = { 'slow-2g': '2G (très lent)', '2g': '2G', '3g': '3G', '4g': '4G ou plus' };

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
        ['Système', navigator.userAgentData?.platform || detectOS(ua)],
        ['Navigateur', detectBrowser(ua)],
        ['Écran', `${screen.width} × ${screen.height} (densité ${window.devicePixelRatio || 1}x)`],
        ['Langue', navigator.language || 'Inconnue'],
        ['Fuseau horaire', Intl.DateTimeFormat().resolvedOptions().timeZone],
        ['Carte graphique', deviceExtra.gpu || '--'],
        ['Connexion', navigator.onLine ? '✅ En ligne' : '❌ Hors ligne'],
        ['Type de réseau', conn ? (NET_TYPES[conn.effectiveType] || conn.effectiveType || 'Inconnu') : 'Non disponible'],
    ];
    if (deviceExtra.arch) items.splice(5, 0, ['Architecture', deviceExtra.arch]);
    if (conn?.downlink != null) items.push(['Débit estimé', `${conn.downlink} Mb/s`], ['Latence estimée', `${conn.rtt} ms`]);
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

// ============ CARTE LIVE (Leaflet) ============
const mapState = { map: null, you: null, iss: null, quakes: null, radar: null, frames: [], host: '', playing: null };
const radarUrl = (f) => `${mapState.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
const clock = (unix) => new Date(unix * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function initMap() {
    if (typeof L === 'undefined') return setStatus('map', 'error', 'Leaflet indisponible');
    const m = mapState.map = L.map('map', { minZoom: 2, maxZoom: 10, worldCopyJump: true, zoomControl: false }).setView([46.6, 2.4], 5);
    L.control.zoom({ zoomInTitle: 'Zoom avant', zoomOutTitle: 'Zoom arrière' }).addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    // fond de carte sans clé d'API, étiquettes en français (inversé en mode sombre via le CSS)
    L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        subdomains: 'abc', maxZoom: 19, className: 'base-tiles',
        attribution: '© <a href="https://www.openstreetmap.org/copyright">Contributeurs OpenStreetMap</a> · Tuiles <a href="https://www.openstreetmap.fr">OpenStreetMap France</a>',
    }).addTo(m);
    m.createPane('radar').style.zIndex = 250; // le radar n'est pas inversé par le thème sombre
    mapState.quakes = L.layerGroup().addTo(m);
    mapState.iss = L.marker([0, 0], {
        icon: L.divIcon({ className: 'iss-icon', html: '🛰️', iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 1000,
    }).bindTooltip('ISS').addTo(m);
    $('#radar-toggle').addEventListener('click', toggleRadar);
    $('#radar-play').addEventListener('click', playRadar);
    setTimeout(() => m.invalidateSize(), 300);
    setStatus('map', 'ok', 'En direct');
    loadRadar();
    renderQuakes();
    updateMapLocation();
}

function updateMapLocation() {
    const { map } = mapState;
    if (!map || state.lat === null) return;
    const pos = [state.lat, state.lon];
    if (mapState.you) mapState.you.setLatLng(pos);
    else mapState.you = L.circleMarker(pos, { radius: 8, color: '#00d4aa', fillColor: '#00d4aa', fillOpacity: 0.6, weight: 2 }).bindTooltip('Vous').addTo(map);
    map.setView(pos, 6); // le radar s'arrête au zoom 7
}

async function loadRadar() {
    try {
        const d = await api('radar');
        const past = d.radar?.past || [];
        if (!past.length) throw new Error('aucune image radar');
        mapState.host = d.host; mapState.frames = past;
        if (mapState.playing) return;
        const last = past[past.length - 1];
        if (mapState.radar) mapState.radar.setUrl(radarUrl(last));
        else {
            mapState.radar = L.tileLayer(radarUrl(last), { opacity: 0.65, maxNativeZoom: 7, maxZoom: 10, pane: 'radar' });
            if ($('#radar-toggle').classList.contains('active')) mapState.radar.addTo(mapState.map);
        }
        setText('radar-time', `Radar : ${clock(last.time)}`);
    } catch (e) {
        console.error('Radar:', e);
        setText('radar-time', 'Radar indisponible');
    }
}

function toggleRadar() {
    const { radar, map } = mapState;
    if (!radar) return;
    const on = !map.hasLayer(radar);
    if (on) radar.addTo(map); else radar.remove();
    $('#radar-toggle').classList.toggle('active', on);
}

function playRadar() {
    const s = mapState, btn = $('#radar-play');
    if (!s.radar) return;
    const stop = () => {
        clearInterval(s.playing); s.playing = null; btn.textContent = '▶ Animer 2 h';
        const last = s.frames[s.frames.length - 1];
        s.radar.setUrl(radarUrl(last)); setText('radar-time', `Radar : ${clock(last.time)}`);
    };
    if (s.playing) return stop();
    if (!s.map.hasLayer(s.radar)) { s.radar.addTo(s.map); $('#radar-toggle').classList.add('active'); }
    // 1 image sur 2 pour rester sous la limite de requêtes de RainViewer
    const frames = s.frames.filter((_, i) => (s.frames.length - 1 - i) % 2 === 0);
    let i = 0;
    btn.textContent = '⏹ Stop';
    s.playing = setInterval(() => {
        const f = frames[i++];
        s.radar.setUrl(radarUrl(f)); setText('radar-time', `Radar : ${clock(f.time)}`);
        if (i >= frames.length) { clearInterval(s.playing); setTimeout(() => { if (s.playing) stop(); }, 1500); }
    }, 900);
}

// ============ CALENDRIER & JOURS FÉRIÉS ============
function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const daysUntil = (dateStr) => round((new Date(`${dateStr}T00:00`) - startOfToday()) / 864e5);
const daysTo = (d) => round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startOfToday()) / 864e5);
const whenLabel = (n) => (n < 0 ? 'Passé' : n === 0 ? "Aujourd'hui" : n === 1 ? 'Demain' : `J-${n}`);

function renderCalendar() {
    const now = new Date(), y = now.getFullYear();
    const total = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
    const doy = Math.floor((Date.UTC(y, now.getMonth(), now.getDate()) - Date.UTC(y, 0, 0)) / 864e5);
    setText('date-big', now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    metrics('date-metrics', [
        ['Semaine', `n°${isoWeek(now)}`], ['Jour de l\'année', `${doy} / ${total}`],
        ['Année écoulée', `${((doy / total) * 100).toFixed(0)}%`, (doy / total) * 100, 'progress-ram'], ['Jours restants', total - doy],
    ]);
    if (state.holidays.length) renderHolidays();
}

function renderHolidays() {
    $('#holiday-list').innerHTML = state.holidays.map((h) => {
        const n = daysUntil(h.date);
        const when = whenLabel(n);
        const day = new Date(`${h.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        return `<div class="row"><div>${esc(h.name)}<small>${esc(day)}</small></div><span class="mono">${when}</span></div>`;
    }).join('');
}

async function loadHolidays() {
    try {
        state.holidays = (await api('holidays')).holidays;
        renderHolidays();
    } catch (e) {
        console.error('Holidays:', e);
        $('#holiday-list').innerHTML = '<div class="empty">Jours fériés indisponibles.</div>';
    }
    renderAlerts();
}

// ============ MÉTÉO SPATIALE (Kp) ============
const KP_LABELS = { 4: 'Actif', 5: 'Tempête G1', 6: 'Tempête G2', 7: 'Tempête G3', 8: 'Tempête G4', 9: 'Tempête G5' };

async function loadSpace() {
    try {
        const list = (await api('space')).kp;
        const kp = list[list.length - 1].kp, max = Math.max(...list.map((r) => r.kp));
        state.kp = kp;
        const label = kp < 3.5 ? 'Calme' : KP_LABELS[Math.min(9, round(kp))];
        const t = list[list.length - 1].time;
        metrics('space-metrics', [
            ['Indice Kp actuel', kp.toFixed(1), (kp / 9) * 100, kp >= 5 ? 'progress-gpu' : 'progress-cpu'],
            ['État', label], ['Max sur 24 h', max.toFixed(1)],
            ['Mesure', t ? ago(Date.parse(t.endsWith('Z') ? t : `${t}Z`)) : '--'],
        ]);
        setText('space-hint', kp >= 7 ? "Aurores possibles à basse latitude (jusqu'en France)."
            : kp >= 5 ? "Aurores probables en Scandinavie, possibles plus au sud."
                : 'Activité calme : aurores limitées aux régions polaires.');
        setStatus('space', kp >= 7 ? 'error' : kp >= 5 ? 'warn' : 'ok', label);
    } catch (e) {
        console.error('Space:', e);
        setStatus('space', 'error', 'Erreur');
    }
    renderAlerts();
}

// ============ MARCHÉS ============
async function loadMarkets() {
    try {
        const d = await api('markets');
        const items = [];
        if (d.fx) for (const [cur, rate] of Object.entries(d.fx)) items.push([currencyName(cur), `${rate.toFixed(cur === 'JPY' ? 2 : 4)} ${cur}`]);
        if (d.crypto) {
            for (const [id, name] of [['bitcoin', 'Bitcoin'], ['ethereum', 'Ethereum']]) {
                const c = d.crypto[id];
                if (!c) continue;
                const chg = c.eur_24h_change;
                items.push([name, `${round(c.eur).toLocaleString('fr-FR')} €${chg == null ? '' : ` (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%)`}`]);
            }
        }
        metrics('markets-metrics', items);
        setStatus('markets', d.fx && d.crypto ? 'ok' : 'warn', d.fx && d.crypto ? 'OK' : 'Partiel');
    } catch (e) {
        console.error('Markets:', e);
        setStatus('markets', 'error', 'Erreur');
    }
}

// ============ ÉLECTRICITÉ EN FRANCE (RTE éCO2mix) ============
async function loadPower() {
    try {
        const d = await api('power'), m = d.mix, total = d.total || 0, co2 = d.co2;
        const share = (v) => (total ? (v / total) * 100 : 0);
        const renew = m.eolien + m.solaire + m.hydraulique + m.bioenergies, fossil = m.gaz + m.charbon + m.fioul;
        const label = co2 < 30 ? 'Très bas carbone' : co2 < 60 ? 'Bas carbone' : co2 < 100 ? 'Moyen' : 'Carboné';
        metrics('power-metrics', [
            ['Consommation', d.consommation == null ? '--' : `${(d.consommation / 1000).toFixed(1)} GW`],
            ['Production', `${(total / 1000).toFixed(1)} GW`],
            ['Nucléaire', `${round(share(m.nucleaire))}%`, share(m.nucleaire), 'progress-ram'],
            ['Renouvelables', `${round(share(renew))}%`, share(renew), 'progress-cpu'],
            ['Fossiles', `${round(share(fossil))}%`, share(fossil), 'progress-gpu'],
            ['Intensité CO₂', `${co2} g/kWh`],
        ]);
        const tip = co2 <= 40 ? 'Bon moment pour consommer : électricité très bas carbone.'
            : co2 >= 100 ? 'Électricité carbonée : décalez les gros usages si possible.' : 'Mix électrique dans la moyenne.';
        setText('power-hint', `${tip} Mesure ${ago(Date.parse(d.time))}.`);
        setStatus('power', co2 < 60 ? 'ok' : co2 < 100 ? 'warn' : 'error', label);
    } catch (e) {
        console.error('Power:', e);
        setStatus('power', 'error', 'Erreur');
    }
}

// ============ VACANCES SCOLAIRES ============
const fmtDay = (iso) => new Date(`${iso}T12:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

async function loadSchool() {
    const box = $('#school-list');
    try {
        const list = (await api('school-holidays')).holidays;
        box.innerHTML = list.length ? list.map((h) => {
            const s = daysUntil(h.start), e = daysUntil(h.end);
            const when = s <= 0 && e > 0 ? 'En cours' : s > 0 ? `J-${s}` : 'Terminé';
            const zones = h.zones.length === 3 ? 'Toutes zones' : `Zone ${h.zones.join(', ')}`;
            return `<div class="row"><div>${esc(h.name)}<small>${esc(zones)} · départ ${esc(fmtDay(h.start))} · reprise ${esc(fmtDay(h.end))}</small></div><span class="mono">${when}</span></div>`;
        }).join('') : '<div class="empty">Aucune période à venir.</div>';
    } catch (e) {
        console.error('School:', e);
        box.innerHTML = '<div class="empty">Vacances scolaires indisponibles.</div>';
    }
}

// ============ JOURS IMPORTANTS (calculés localement) ============
function easter(y) { // algorithme de Meeus/Jones/Butcher
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
}
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** n-ième jour de semaine d'un mois (wd: 0 = dimanche) ; n = -1 pour le dernier. */
function nthWeekday(y, m, wd, n) {
    if (n > 0) return new Date(y, m, 1 + ((wd - new Date(y, m, 1).getDay() + 7) % 7) + (n - 1) * 7);
    const last = new Date(y, m + 1, 0);
    return new Date(y, m, last.getDate() - ((last.getDay() - wd + 7) % 7));
}

function observances(y) {
    const E = easter(y), pentecost = addDays(E, 49), thanksgiving = nthWeekday(y, 10, 4, 4);
    let mothers = nthWeekday(y, 4, 0, -1); // dernier dimanche de mai, sauf Pentecôte -> 1er dimanche de juin
    if (+mothers === +pentecost) mothers = nthWeekday(y, 5, 0, 1);
    return [
        ['Jour des Rois (galette)', new Date(y, 0, 6)], ['Chandeleur (crêpes)', new Date(y, 1, 2)],
        ['Saint-Valentin', new Date(y, 1, 14)], ['Mardi gras', addDays(E, -47)],
        ['Journée internationale des droits des femmes', new Date(y, 2, 8)], ['Saint-Patrick', new Date(y, 2, 17)],
        ["Passage à l'heure d'été (Europe)", nthWeekday(y, 2, 0, -1)], ["Heure d'été aux États-Unis", nthWeekday(y, 2, 0, 2)],
        ["Poisson d'avril", new Date(y, 3, 1)], ['Fête des mères (France)', mothers],
        ['Fête des pères (France)', nthWeekday(y, 5, 0, 3)], ['Fête de la musique', new Date(y, 5, 21)],
        ['Halloween', new Date(y, 9, 31)], ["Passage à l'heure d'hiver (Europe)", nthWeekday(y, 9, 0, -1)],
        ['Bonfire Night (Royaume-Uni)', new Date(y, 10, 5)], ["Heure d'hiver aux États-Unis", nthWeekday(y, 10, 0, 1)],
        ['Beaujolais nouveau', nthWeekday(y, 10, 4, 3)], ['Black Friday', addDays(thanksgiving, 1)],
        ['Cyber Monday', addDays(thanksgiving, 4)], ['Réveillon de Noël', new Date(y, 11, 24)],
        ['Réveillon du Nouvel An', new Date(y, 11, 31)],
    ].map(([name, date]) => ({ name, date }));
}

function renderObservances() {
    const y = new Date().getFullYear();
    const list = [...observances(y), ...observances(y + 1)]
        .map((o) => ({ ...o, n: daysTo(o.date) })).filter((o) => o.n >= 0).sort((a, b) => a.n - b.n).slice(0, 6);
    $('#obs-list').innerHTML = list.map((o) => {
        const day = o.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        return `<div class="row"><div>${esc(o.name)}<small>${esc(day)}</small></div><span class="mono">${whenLabel(o.n)}</span></div>`;
    }).join('');
}

// ============ JOURS FÉRIÉS DANS LE MONDE (Nager.Date) ============
const COUNTRIES = ['GB', 'US', 'DE', 'ES', 'IT', 'CA', 'JP', 'CN', 'IN', 'BR', 'AU', 'MX', 'KR', 'CH', 'BE', 'NL', 'PT', 'IE'];
const COUNTRIES_KEY = 'live-info:countries';
let selected = ['GB', 'US', 'DE', 'ES', 'IT', 'CA', 'JP', 'CN', 'IN', 'BR'];
try {
    const saved = JSON.parse(localStorage.getItem(COUNTRIES_KEY));
    if (Array.isArray(saved)) selected = saved.filter((c) => COUNTRIES.includes(c));
} catch { /* stockage indisponible */ }

const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { /* non supporté */ }
const countryName = (cc) => { try { return regionNames?.of(cc) || cc; } catch { return cc; } };

function renderChips() {
    $('#country-chips').innerHTML = COUNTRIES.map((cc) =>
        `<button type="button" class="chip${selected.includes(cc) ? ' on' : ''}" data-cc="${cc}" aria-pressed="${selected.includes(cc)}">${flag(cc)} ${esc(countryName(cc))}</button>`).join('');
}

async function loadWorld() {
    const box = $('#world-list'), asked = selected.join(',');
    if (!selected.length) { box.innerHTML = '<div class="empty">Sélectionnez au moins un pays.</div>'; return; }
    setStatus('world', 'pending', 'Chargement...');
    try {
        const d = await api('world-holidays', { countries: asked });
        if (asked !== selected.join(',')) return; // la sélection a changé entre-temps
        box.innerHTML = selected.map((cc) => {
            const list = d[cc];
            const rows = !list ? '<div class="empty">Indisponible</div>' : list.map((h) => {
                const n = daysUntil(h.date);
                return `<div class="h" title="${esc(h.local)}"><span>${esc(frName(h.name))}<br><small class="empty">${esc(fmtDay(h.date))}</small></span><span class="mono${n === 0 ? ' today-flag' : ''}">${n === 0 ? '🎉 ' : ''}${whenLabel(n)}</span></div>`;
            }).join('');
            return `<div class="country"><h3>${flag(cc)} ${esc(countryName(cc))}</h3>${rows}</div>`;
        }).join('');
        setStatus('world', 'ok', 'OK');
    } catch (e) {
        console.error('World holidays:', e);
        setStatus('world', 'error', 'Erreur');
    }
}

function initWorld() {
    renderChips();
    $('#country-chips').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-cc]');
        if (!b) return;
        const cc = b.dataset.cc;
        selected = selected.includes(cc) ? selected.filter((c) => c !== cc) : [...selected, cc];
        try { localStorage.setItem(COUNTRIES_KEY, JSON.stringify(selected)); } catch { /* ignore */ }
        renderChips();
        loadWorld();
    });
    loadWorld(); every(6 * 3600e3, loadWorld);
}

// ============ MER (masquée loin des côtes) ============
async function loadMarine() {
    if (state.lat === null) return;
    const seq = state.locSeq, card = $('#marine-card');
    try {
        const c = (await api('marine', { lat: state.lat, lon: state.lon })).current || {};
        if (seq !== state.locSeq) return;
        if (c.wave_height == null && c.sea_surface_temperature == null) throw new Error('pas de données marines ici');
        const f = (v, unit, d = 1) => (v == null ? '--' : `${v.toFixed(d)} ${unit}`);
        metrics('marine-metrics', [
            ['Température de la mer', f(c.sea_surface_temperature, '°C')], ['Hauteur des vagues', f(c.wave_height, 'm')],
            ['Période', f(c.wave_period, 's')], ['Vagues venant du', c.wave_direction == null ? '--' : `${cardinal(c.wave_direction)} (${round(c.wave_direction)}°)`],
        ]);
        show(card);
        setStatus('marine', 'ok', 'OK');
    } catch (e) {
        if (seq === state.locSeq) hide(card); // pas de côte à proximité
    }
}

// ============ THÈME CLAIR / SOMBRE ============
const THEME_KEY = 'live-info:theme';

function initTheme() {
    const root = document.documentElement, btn = $('#theme-toggle');
    const apply = (t) => {
        root.dataset.theme = t;
        btn.textContent = t === 'dark' ? '☀️ Mode clair' : '🌙 Mode sombre';
        btn.setAttribute('aria-label', t === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');
    };
    apply(root.dataset.theme === 'light' ? 'light' : 'dark');
    btn.addEventListener('click', () => {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        apply(next);
        try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    });
}

// ============ HEURES DANS LE MONDE (villes personnalisables) ============
const CLOCKS_KEY = 'live-info:clocks';
const DEFAULT_CLOCKS = [
    { label: 'Ici', tz: null }, { label: 'UTC', tz: 'UTC' }, { label: 'Londres', tz: 'Europe/London' },
    { label: 'New York', tz: 'America/New_York' }, { label: 'Tokyo', tz: 'Asia/Tokyo' },
    { label: 'Sydney', tz: 'Australia/Sydney' }, { label: 'Dubaï', tz: 'Asia/Dubai' },
];
let clocks = DEFAULT_CLOCKS;
try {
    const saved = JSON.parse(localStorage.getItem(CLOCKS_KEY));
    if (Array.isArray(saved)) clocks = saved.filter((c) => c && typeof c.label === 'string' && (c.tz === null || typeof c.tz === 'string'));
} catch { /* ignore */ }
const saveClocks = () => { try { localStorage.setItem(CLOCKS_KEY, JSON.stringify(clocks)); } catch { /* ignore */ } };

function tzOffsetMin(tz, d) {
    const t = new Date(Math.floor(d.getTime() / 1000) * 1000);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(t);
    const p = Object.fromEntries(parts.map((x) => [x.type, +x.value]));
    return round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t.getTime()) / 60000);
}

function diffLabel(min) {
    if (min === 0) return 'même heure';
    const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
    return `${min > 0 ? '+' : '−'}${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

function renderClockList() {
    $('#clocks').innerHTML = clocks.length
        ? clocks.map((c, i) => `<div class="row"><div>${esc(c.label)}<small data-clock-meta="${i}"></small></div>` +
            `<div class="clock-time"><span class="mono" data-clock-time="${i}">--:--:--</span>` +
            `<button class="x" type="button" data-clock-del="${i}" aria-label="Retirer ${esc(c.label)}">✕</button></div></div>`).join('')
        : '<div class="empty">Aucune horloge. Ajoutez une ville ci-dessus.</div>';
    tickClocks();
}

function tickClocks() {
    const now = new Date(), localOff = -now.getTimezoneOffset();
    clocks.forEach((c, i) => {
        try {
            const opts = c.tz ? { timeZone: c.tz } : {};
            const time = now.toLocaleTimeString('fr-FR', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const day = now.toLocaleDateString('fr-FR', { ...opts, weekday: 'short', day: 'numeric', month: 'short' });
            const diff = c.tz ? diffLabel(tzOffsetMin(c.tz, now) - localOff) : 'votre fuseau';
            const t = document.querySelector(`[data-clock-time="${i}"]`), m = document.querySelector(`[data-clock-meta="${i}"]`);
            if (t) t.textContent = time;
            if (m) m.textContent = `${day} · ${diff}`;
        } catch { /* fuseau invalide : ignoré */ }
    });
}

function initClocks() {
    renderClockList();
    every(1000, tickClocks);
    const input = $('#clock-search'), box = $('#clock-results');
    let timer = null, found = [];
    const close = () => hide(box);

    const add = (i) => {
        const r = found[i];
        if (!r?.timezone) return;
        const label = uniq([r.name, r.country]).join(', ');
        if (clocks.length < 12 && !clocks.some((c) => c.tz === r.timezone && c.label === label)) {
            clocks = [...clocks, { label, tz: r.timezone }];
            saveClocks();
            renderClockList();
        }
        input.value = '';
        close();
    };

    input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 2) return close();
        timer = setTimeout(async () => {
            try {
                found = ((await api('geocode', { q })).results || []).filter((r) => r.timezone);
                box.innerHTML = found.length
                    ? found.map((r, i) => `<button type="button" data-i="${i}">${esc(r.name)} <small>${esc(uniq([r.admin1, r.country]).join(', '))} · ${esc(r.timezone)}</small></button>`).join('')
                    : '<button type="button" disabled>Aucun résultat</button>';
                show(box);
            } catch (e) { console.error('Horloges:', e); close(); }
        }, 300);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(0); if (e.key === 'Escape') close(); });
    box.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) add(+b.dataset.i); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#clocks-card .search')) close(); });
    $('#clocks').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-clock-del]');
        if (!b) return;
        clocks = clocks.filter((_, i) => i !== +b.dataset.clockDel);
        saveClocks();
        renderClockList();
    });
}

// ============ NOMS FRANÇAIS (jours fériés, devises) ============
const HOLIDAY_FR = {
    "New Year's Day": "Jour de l'An", 'Epiphany': 'Épiphanie', 'Good Friday': 'Vendredi saint', 'Holy Thursday': 'Jeudi saint',
    'Maundy Thursday': 'Jeudi saint', 'Holy Saturday': 'Samedi saint', 'Easter Saturday': 'Samedi de Pâques',
    'Easter Sunday': 'Dimanche de Pâques', 'Easter Monday': 'Lundi de Pâques', 'Labour Day': 'Fête du Travail',
    'Labor Day': 'Fête du Travail', 'May Day': 'Fête du Travail', "International Workers' Day": 'Fête du Travail',
    'Ascension Day': 'Ascension', 'Whit Monday': 'Lundi de Pentecôte', 'Pentecost Monday': 'Lundi de Pentecôte',
    'Pentecost': 'Pentecôte', 'Corpus Christi': 'Fête-Dieu', 'Assumption Day': 'Assomption',
    'Assumption of Mary': 'Assomption', "All Saints' Day": 'Toussaint', "All Souls' Day": 'Jour des défunts',
    'Immaculate Conception': 'Immaculée Conception', 'Christmas Eve': 'Veille de Noël', 'Christmas Day': 'Noël',
    'Boxing Day': 'Lendemain de Noël', "St. Stephen's Day": 'Lendemain de Noël', 'Second Day of Christmas': 'Lendemain de Noël',
    "New Year's Eve": 'Réveillon du Nouvel An', 'Independence Day': "Fête de l'Indépendance",
    'Thanksgiving Day': "Thanksgiving (action de grâce)", 'Thanksgiving': "Thanksgiving (action de grâce)",
    'Memorial Day': 'Memorial Day (hommage aux soldats)', 'Veterans Day': 'Journée des anciens combattants',
    'Columbus Day': 'Jour de Christophe Colomb', "Washington's Birthday": 'Fête des Présidents', "Presidents' Day": 'Fête des Présidents',
    'Martin Luther King, Jr. Day': 'Jour de Martin Luther King', 'Juneteenth': "Juneteenth (fin de l'esclavage)",
    'Juneteenth National Independence Day': "Juneteenth (fin de l'esclavage)", 'Victoria Day': 'Fête de la reine Victoria',
    'Canada Day': 'Fête du Canada', 'Civic Holiday': 'Congé civique', 'Remembrance Day': 'Jour du Souvenir',
    'National Day for Truth and Reconciliation': 'Journée nationale de la vérité et de la réconciliation',
    'Early May Bank Holiday': 'Jour férié de début mai', 'Spring Bank Holiday': 'Jour férié de fin mai',
    'Summer Bank Holiday': 'Jour férié de fin août', "St Patrick's Day": 'Saint-Patrick', 'German Unity Day': "Jour de l'Unité allemande",
    'Reformation Day': 'Fête de la Réforme', 'Day of Repentance and Prayer': 'Jour de pénitence et de prière',
    "International Women's Day": 'Journée internationale des droits des femmes', 'Constitution Day': 'Jour de la Constitution',
    'Liberation Day': 'Fête de la Libération', 'Republic Day': 'Fête de la République', 'National Day': 'Fête nationale',
    'Coming of Age Day': 'Jour de la majorité', 'National Foundation Day': 'Fête de la fondation nationale',
    "The Emperor's Birthday": "Anniversaire de l'empereur", 'Vernal Equinox Day': 'Équinoxe de printemps', 'Showa Day': 'Jour de Shōwa',
    'Constitution Memorial Day': 'Jour de la Constitution', 'Greenery Day': 'Jour de la verdure', "Children's Day": 'Jour des enfants',
    'Marine Day': 'Jour de la mer', 'Mountain Day': 'Jour de la montagne', 'Respect for the Aged Day': 'Jour du respect des aînés',
    'Autumnal Equinox Day': "Équinoxe d'automne", 'Sports Day': 'Jour des sports', 'Culture Day': 'Jour de la culture',
    'Labor Thanksgiving Day': "Jour d'action de grâce du travail", 'Spring Festival': 'Fête du Printemps (Nouvel An chinois)',
    'Qingming Festival': 'Fête de Qingming', 'Tomb-Sweeping Day': 'Fête de Qingming', 'Dragon Boat Festival': 'Fête des bateaux-dragons',
    'Mid-Autumn Festival': 'Fête de la mi-automne', 'Gandhi Jayanti': 'Anniversaire de Gandhi', 'Diwali': 'Diwali (fête des lumières)',
    'Holi': 'Holi (fête des couleurs)', "Tiradentes' Day": 'Jour de Tiradentes', 'Carnival': 'Carnaval',
    'Republic Proclamation Day': 'Proclamation de la République', 'Black Awareness Day': 'Journée de la conscience noire',
    'Anzac Day': "Journée de l'Anzac", 'Australia Day': "Fête de l'Australie", "King's Birthday": 'Anniversaire du roi',
    "Queen's Birthday": 'Anniversaire de la reine',
};
const frName = (name) => HOLIDAY_FR[name] || name;

let currencyNames = null;
try { currencyNames = new Intl.DisplayNames(['fr'], { type: 'currency' }); } catch { /* non supporté */ }
const currencyName = (code) => {
    try { const n = currencyNames?.of(code) || code; return n.charAt(0).toUpperCase() + n.slice(1); } catch { return code; }
};

// ============ CHRONOMÈTRE ET MINUTEUR ============
const pad2 = (n) => String(n).padStart(2, '0');

// --- Chronomètre et minuteur
function beep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.35, 0.7].forEach((t) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = 880; g.gain.value = 0.2;
            o.connect(g); g.connect(ctx.destination);
            o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
        });
    } catch { /* audio indisponible */ }
}

function initTimers() {
    // chronomètre
    const sw = { running: false, start: 0, base: 0, laps: [] };
    let swTimer = null;
    const elapsed = () => sw.base + (sw.running ? performance.now() - sw.start : 0);
    const fmtSw = (ms) => { const t = Math.floor(ms / 100); return `${pad2(Math.floor(t / 600))}:${pad2(Math.floor(t / 10) % 60)}.${t % 10}`; };
    const paintSw = () => setText('sw-display', fmtSw(elapsed()));
    const paintLaps = () => setText('sw-laps', sw.laps.slice(-5).reverse().join('  ·  '));
    $('#sw-toggle').addEventListener('click', () => {
        if (sw.running) {
            sw.base = elapsed(); sw.running = false; clearInterval(swTimer);
            $('#sw-toggle').textContent = 'Reprendre'; $('#sw-lap').disabled = true;
        } else {
            sw.start = performance.now(); sw.running = true; swTimer = setInterval(paintSw, 100);
            $('#sw-toggle').textContent = 'Pause'; $('#sw-lap').disabled = false;
        }
        paintSw();
    });
    $('#sw-lap').addEventListener('click', () => {
        const total = elapsed(), prev = sw.lastLap || 0;
        sw.lastLap = total;
        sw.laps.push(`Tour ${sw.laps.length + 1} : ${fmtSw(total - prev)} (total ${fmtSw(total)})`);
        paintLaps();
    });
    $('#sw-reset').addEventListener('click', () => {
        clearInterval(swTimer);
        Object.assign(sw, { running: false, base: 0, laps: [], lastLap: 0 });
        $('#sw-toggle').textContent = 'Démarrer'; $('#sw-lap').disabled = true;
        paintSw(); paintLaps();
    });

    // minuteur
    const tm = { running: false, end: 0, remaining: 0 };
    let tmTimer = null;
    const readTm = () => ((Math.max(0, parseInt($('#tm-min').value, 10) || 0) * 60) + Math.min(59, Math.max(0, parseInt($('#tm-sec').value, 10) || 0))) * 1000;
    const paintTm = (ms) => { const s = Math.ceil(ms / 1000); setText('tm-display', `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`); };
    const resetTm = () => {
        clearInterval(tmTimer); tm.running = false; tm.remaining = readTm();
        paintTm(tm.remaining); $('#tm-toggle').textContent = 'Démarrer';
    };
    ['#tm-min', '#tm-sec'].forEach((sel) => $(sel).addEventListener('input', () => { if (!tm.running) resetTm(); }));
    $('#tm-reset').addEventListener('click', resetTm);
    $('#tm-toggle').addEventListener('click', () => {
        if (tm.running) {
            tm.remaining = Math.max(0, tm.end - Date.now()); tm.running = false; clearInterval(tmTimer);
            $('#tm-toggle').textContent = 'Reprendre';
            return;
        }
        if (tm.remaining <= 0) tm.remaining = readTm();
        if (tm.remaining <= 0) return;
        tm.end = Date.now() + tm.remaining; tm.running = true;
        $('#tm-toggle').textContent = 'Pause';
        tmTimer = setInterval(() => {
            const left = tm.end - Date.now();
            if (left > 0) return paintTm(left);
            clearInterval(tmTimer); tm.running = false; tm.remaining = 0;
            setText('tm-display', '⏰ Terminé !'); $('#tm-toggle').textContent = 'Démarrer';
            beep();
        }, 200);
    });
    resetTm();
}

// ============ MA COMMUNE (geo.api.gouv.fr) ============
async function loadCommune() {
    if (state.lat === null) return;
    const seq = state.locSeq, card = $('#commune-card');
    try {
        const c = await api('commune', { lat: state.lat, lon: state.lon });
        if (seq !== state.locSeq) return;
        const km2 = c.surface ? c.surface / 100 : null; // la surface est donnée en hectares
        metrics('commune-metrics', [
            ['Commune', c.nom], ['Code INSEE', c.code],
            ['Code postal', (c.codesPostaux || []).slice(0, 3).join(', ') || '--'],
            ['Département', c.departement ? `${c.departement.nom} (${c.departement.code})` : '--'],
            ['Région', c.region?.nom || '--'],
            ['Population', c.population == null ? '--' : `${c.population.toLocaleString('fr-FR')} hab.`],
            ['Superficie', km2 == null ? '--' : `${km2.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km²`],
            ['Densité', km2 && c.population ? `${round(c.population / km2).toLocaleString('fr-FR')} hab./km²` : '--'],
        ]);
        show(card);
    } catch (e) {
        if (seq === state.locSeq) hide(card); // hors de France : pas de commune
    }
}

// ============ NORMALES DE SAISON ============
async function loadClimate() {
    if (state.lat === null) return;
    const seq = state.locSeq;
    try {
        const d = await api('climate', { lat: state.lat, lon: state.lon });
        if (seq !== state.locSeq) return;
        state.climate = d;
    } catch (e) {
        console.error('Normales:', e);
        state.climate = null;
    }
    renderClimate();
}

function renderClimate() {
    const c = state.climate, w = state.weather, card = $('#climate-card');
    if (!c || c.tmax == null || c.tmin == null) return hide(card);
    const sgn = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}°C`;
    const items = [['Maximale normale', `${c.tmax.toFixed(1)}°C`], ['Minimale normale', `${c.tmin.toFixed(1)}°C`]];
    let verdict = '';
    if (w) {
        const dmax = w.daily.temperature_2m_max[0] - c.tmax, dmin = w.daily.temperature_2m_min[0] - c.tmin, avg = (dmax + dmin) / 2;
        items.push(['Écart du jour (maximale)', sgn(dmax)], ['Écart du jour (minimale)', sgn(dmin)]);
        verdict = avg >= 3 ? 'Nettement plus chaud que la normale.' : avg >= 1 ? 'Un peu plus chaud que la normale.'
            : avg <= -3 ? 'Nettement plus frais que la normale.' : avg <= -1 ? 'Un peu plus frais que la normale.' : 'Conforme à la normale de saison.';
    }
    if (c.rain != null) items.push(['Pluie normale', `${c.rain.toFixed(1)} mm/jour`]);
    if (w) items.push(['Pluie prévue', `${w.daily.precipitation_sum[0]} mm`]);
    metrics('climate-metrics', items);
    setText('climate-hint', `${verdict} Normale = moyenne des ${c.years} dernières années à cette période (±3 jours).`.trim());
    show(card);
}

// ============ À LA UNE (franceinfo) ============
const safeLink = (url, label) => (/^https:\/\//.test(url || '')
    ? `<a class="link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label));

async function loadNews() {
    const box = $('#news-list');
    try {
        const items = (await api('news')).items;
        box.innerHTML = items.length
            ? items.map((n) => `<div class="row"><div>${safeLink(n.link, n.title)}${n.time ? `<small>${ago(n.time)}</small>` : ''}</div></div>`).join('')
            : '<div class="empty">Aucune actualité disponible.</div>';
        setStatus('news', 'ok', 'En direct');
    } catch (e) {
        console.error('Actualités:', e);
        box.innerHTML = '<div class="empty">Actualités indisponibles pour le moment.</div>';
        setStatus('news', 'error', 'Erreur');
    }
}

// ============ WIKIPÉDIA : CE JOUR-LÀ ET TENDANCES ============
async function loadHistory() {
    const box = $('#history-list');
    try {
        const events = (await api('history')).events;
        box.innerHTML = events.length
            ? events.map((e) => `<div class="row"><div>${safeLink(e.url, e.text)}</div><span class="mono">${esc(e.year)}</span></div>`).join('')
            : '<div class="empty">Rien à afficher pour aujourd\'hui.</div>';
    } catch (e) {
        console.error('Histoire:', e);
        box.innerHTML = '<div class="empty">Indisponible pour le moment.</div>';
    }
}

async function loadTrends() {
    const box = $('#trends-list');
    try {
        const d = await api('wiki-trends');
        box.innerHTML = d.articles.map((a) => `<div class="row"><div>${safeLink(a.url, a.title)}${a.description ? `<small>${esc(a.description)}</small>` : ''}</div>` +
            `<span class="mono">${a.views == null ? '' : `${a.views.toLocaleString('fr-FR')} vues`}</span></div>`).join('');
        const day = new Date(`${d.date}T12:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
        setText('trends-hint', `Articles les plus consultés le ${day} (Wikipédia en français).`);
    } catch (e) {
        console.error('Tendances:', e);
        box.innerHTML = '<div class="empty">Indisponible pour le moment.</div>';
    }
}

// ============ PROCHAINS LANCEMENTS DE FUSÉES ============
const LAUNCH_STATUS = { Go: 'Prévu', TBC: 'À confirmer', TBD: 'Date non définie', Hold: 'Suspendu', 'In Flight': 'En vol', Success: 'Réussi', Failure: 'Échec', 'Partial Failure': 'Échec partiel' };

async function loadLaunches() {
    const box = $('#launch-list');
    try {
        const list = (await api('launches')).launches;
        box.innerHTML = list.length ? list.map((l) => {
            const d = l.net ? new Date(l.net) : null;
            const when = d ? d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Date inconnue';
            const n = d ? daysTo(d) : null;
            const detail = [when, LAUNCH_STATUS[l.status] || l.status, l.place].filter(Boolean).join(' · ');
            return `<div class="row"><div>${esc(l.name)}<small>${esc(detail)}</small></div><span class="mono">${n == null ? '' : whenLabel(n)}</span></div>`;
        }).join('') : '<div class="empty">Aucun lancement annoncé.</div>';
    } catch (e) {
        console.error('Lancements:', e);
        box.innerHTML = '<div class="empty">Indisponible pour le moment.</div>';
    }
}

// ============ ÉCHELLE DE BEAUFORT ============
const BEAUFORT = [[1, 'Calme'], [6, 'Très légère brise'], [12, 'Légère brise'], [20, 'Petite brise'], [29, 'Jolie brise'], [39, 'Bonne brise'],
[50, 'Vent frais'], [62, 'Grand frais'], [75, 'Coup de vent'], [89, 'Fort coup de vent'], [103, 'Tempête'], [118, 'Violente tempête'], [Infinity, 'Ouragan']];
const beaufort = (kmh) => { const i = BEAUFORT.findIndex(([max]) => kmh < max); return `Force ${i} · ${BEAUFORT[i][1]}`; };

function nextPhaseDate(age, target) { // prochaine pleine lune (target 14,77 j) ou nouvelle lune (0)
    const synodic = 29.530588853, days = (((target - age) % synodic) + synodic) % synodic;
    return new Date(Date.now() + days * 864e5).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ============ INITIALISATION ============
function init() {
    initDevice();
    initTheme();
    initClocks();
    initTimers();
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
    startPerfMonitor();
    loadPower(); every(5 * 60e3, loadPower);
    loadSchool(); every(6 * 3600e3, loadSchool);
    renderObservances(); every(3600e3, renderObservances);
    initWorld();
    loadNews(); every(10 * 60e3, loadNews);
    loadHistory(); every(6 * 3600e3, loadHistory);
    loadTrends(); every(3600e3, loadTrends);
    loadLaunches(); every(3600e3, loadLaunches);
    every(30 * 60e3, loadMarine);
    every(10 * 60e3, () => { loadWeather(); loadFuel(); });
    every(30 * 60e3, loadAir);
    initMap(); every(10 * 60e3, loadRadar);
    renderCalendar(); every(5 * 60e3, renderCalendar);
    loadHolidays(); every(6 * 3600e3, loadHolidays);
    loadSpace(); every(15 * 60e3, loadSpace);
    loadMarkets(); every(5 * 60e3, loadMarkets);
    renderAlerts();
}

init();