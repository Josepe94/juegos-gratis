// Canal "Vuelos baratos desde Murcia y Alicante".
// Fuente: Aviasales Data API (Travelpayouts), precios en caché de búsquedas recientes.
// Lógica: guarda el histórico de precios por ruta y solo publica cuando el precio está claramente
// por debajo de lo habitual en esa ruta (o es muy barato en términos absolutos).
const { http, esc, makePublisher, loadState, saveState, env, sleep } = require('./lib');

const NAME = 'vuelos';
const LABEL = 'Vuelos baratos desde Murcia y Alicante';
const API = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

const ORIGIN_NAMES = { RMU: 'Murcia (Corvera)', ALC: 'Alicante', VLC: 'Valencia', MAD: 'Madrid', AGP: 'Málaga' };

const AIRLINES = { FR: 'Ryanair', U2: 'easyJet', EC: 'easyJet', VY: 'Vueling', W6: 'Wizz Air', W4: 'Wizz Air', IB: 'Iberia', I2: 'Iberia Express', UX: 'Air Europa', TO: 'Transavia', HV: 'Transavia', LS: 'Jet2', BA: 'British Airways', EW: 'Eurowings', DY: 'Norwegian', D8: 'Norwegian', AF: 'Air France', KL: 'KLM', LH: 'Lufthansa', V7: 'Volotea', NT: 'Binter', SK: 'SAS', AZ: 'ITA Airways', TP: 'TAP', SN: 'Brussels Airlines', LX: 'Swiss', OS: 'Austrian', '5O': 'ASL Airlines', '3O': 'Air Arabia' };

const CFG = {
    minDaysAhead: 5, // no publicar vuelos que salen en menos de 5 días
    maxDaysAhead: 120,
    dropVsMedian: 0.7, // publicar si precio <= 70 % de la mediana de la ruta…
    minSamples: 6, // …con al menos 6 observaciones previas de esa ruta
    absoluteCheap: 20, // o si cuesta 20 € o menos (solo ida)
    repostDays: 7, // no repetir ruta en 7 días salvo que baje otro 15 %
    maxPostsPerRun: 4,
};

function median(nums) {
    const a = [...nums].sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function monthsAhead(n, from = new Date()) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
        out.push(d.toISOString().slice(0, 7));
    }
    return out;
}

/** Mejor oferta por destino (y mes) a partir de la respuesta de prices_for_dates. */
function bestByDestination(data, now = new Date()) {
    const best = new Map();
    for (const f of data || []) {
        if (!f || !f.destination || !(f.price > 0) || !f.departure_at) continue;
        const dep = new Date(f.departure_at);
        const days = (dep - now) / 864e5;
        if (days < CFG.minDaysAhead || days > CFG.maxDaysAhead) continue;
        const key = `${f.origin_airport || f.origin}-${f.destination}`;
        const prev = best.get(key);
        if (!prev || f.price < prev.price) best.set(key, { ...f, route: key, origin: f.origin_airport || f.origin });
    }
    return [...best.values()];
}

/** Decide si una oferta merece publicarse, usando el histórico de la ruta. */
function evaluate(offer, hist, posted, now = new Date()) {
    const prices = (hist || []).map((h) => h.p);
    const med = prices.length >= CFG.minSamples ? median(prices) : null;
    let reason = null;
    if (med && offer.price <= med * CFG.dropVsMedian) reason = 'below-median';
    else if (offer.price <= CFG.absoluteCheap) reason = 'absolute';
    if (!reason) return null;
    const last = posted && posted[offer.route];
    if (last && (now - new Date(last.at)) / 864e5 < CFG.repostDays && offer.price > last.price * 0.85) return null;
    return { reason, median: med ? Math.round(med) : null, dropPct: med ? Math.round((1 - offer.price / med) * 100) : null };
}

function buildLink(link, marker) {
    if (!link) return null;
    const base = link.startsWith('http') ? link : `https://www.aviasales.com${link.startsWith('/') ? '' : '/search/'}${link}`;
    if (!marker) return base;
    return `${base}${base.includes('?') ? '&' : '?'}marker=${encodeURIComponent(marker)}`;
}

const fmtDay = (iso) => new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

function buildPost(o, ev, cityName, marker) {
    const from = ORIGIN_NAMES[o.origin] || o.origin;
    const to = cityName || o.destination;
    const stops = o.transfers === 0 ? 'Directo' : `${o.transfers} escala${o.transfers > 1 ? 's' : ''}`;
    const lines = [
        `✈️ <b>${esc(from)} → ${esc(to)}</b> desde <b>${Math.round(o.price)} €</b> (solo ida)`,
        `📅 ${esc(fmtDay(o.departure_at))} a las ${esc(fmtTime(o.departure_at))} · ${stops}${o.airline ? ` · ${esc(AIRLINES[o.airline] || o.airline)}` : ''}`,
    ];
    if (ev.reason === 'below-median') lines.push(`📉 <b>${ev.dropPct}% más barato</b> de lo habitual en esta ruta (suele estar en ~${ev.median} €)`);
    else lines.push('💸 Precio muy bajo para esta ruta');
    const url = buildLink(o.link, marker);
    if (url) lines.push('', `👉 <a href="${esc(url)}">Ver vuelo y fechas cercanas</a>`);
    lines.push('', '<i>Precio visto en búsquedas recientes: puede cambiar. Equipaje de mano grande normalmente no incluido.</i>');
    return lines.join('\n');
}

async function cityNames(state, codes, { fetchImpl = fetch } = {}) {
    state.cities = state.cities || {};
    const missing = codes.filter((c) => !state.cities[c]);
    if (missing.length) {
        try {
            const list = await http('https://api.travelpayouts.com/data/es/cities.json', { as: 'json', timeoutMs: 60000, fetchImpl });
            for (const c of list) if (codes.includes(c.code)) state.cities[c.code] = c.name || c.code;
        } catch (err) {
            console.warn(`[${NAME}] nombres de ciudades: ${err.message}`);
        }
    }
    return state.cities;
}

async function run({ fetchImpl = fetch } = {}) {
    const token = env('TP_TOKEN');
    if (!token) {
        console.log(`[${NAME}] falta TP_TOKEN (registro en Travelpayouts pendiente): no se hace nada.`);
        return { skipped: true };
    }
    const marker = env('TP_MARKER');
    const origins = (env('VUELOS_ORIGINS') || 'RMU,ALC').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const state = loadState(NAME, { history: {}, posted: {} });
    const pub = makePublisher({ name: NAME, label: LABEL, channelVar: 'VUELOS_CHAT_ID', state });

    // Como mucho una consulta completa cada 6 h (los datos de la API son de caché)
    if (state.lastFetch && Date.now() - Date.parse(state.lastFetch) < 6 * 3600e3 && env('DRY_RUN') !== '1') {
        console.log(`[${NAME}] última consulta hace menos de 6 h: se omite.`);
        return { skipped: true };
    }

    const now = new Date();
    const offers = [];
    for (const origin of origins) {
        for (const month of monthsAhead(4, now)) {
            const url = `${API}?origin=${origin}&departure_at=${month}&one_way=true&direct=false&sorting=price&unique=false&limit=1000&page=1&currency=eur&market=es&token=${token}`;
            try {
                const json = await http(url, { as: 'json', fetchImpl });
                if (json && json.success === false) throw new Error(json.error || 'respuesta sin éxito');
                offers.push(...bestByDestination(json.data, now));
            } catch (err) {
                console.warn(`[${NAME}] ${origin} ${month}: ${err.message}`);
            }
            await sleep(400);
        }
    }

    // Mejor precio por ruta en esta consulta
    const byRoute = new Map();
    for (const o of offers) if (!byRoute.has(o.route) || o.price < byRoute.get(o.route).price) byRoute.set(o.route, o);

    const candidates = [];
    const today = now.toISOString().slice(0, 10);
    for (const o of byRoute.values()) {
        const hist = (state.history[o.route] || []).filter((h) => (now - new Date(h.d)) / 864e5 <= 45);
        const ev = evaluate(o, hist, state.posted, now);
        if (ev) candidates.push({ o, ev });
        if (!hist.some((h) => h.d === today)) hist.push({ d: today, p: Math.round(o.price) });
        state.history[o.route] = hist.slice(-60);
    }
    candidates.sort((a, b) => (b.ev.dropPct || 0) - (a.ev.dropPct || 0) || a.o.price - b.o.price);
    const names = await cityNames(state, candidates.map((c) => c.o.destination), { fetchImpl });

    console.log(`[${NAME}] ${byRoute.size} rutas vistas, ${candidates.length} chollos · destino: ${pub.mode}`);
    let sent = 0;
    for (const { o, ev } of candidates.slice(0, CFG.maxPostsPerRun)) {
        if (await pub.send(buildPost(o, ev, names[o.destination], marker))) sent += 1;
        state.posted[o.route] = { at: now.toISOString(), price: o.price };
        await sleep(1200);
    }
    state.lastFetch = now.toISOString();
    saveState(NAME, state);
    console.log(`[${NAME}] enviados: ${sent}`);
    return { routes: byRoute.size, candidates: candidates.length, sent };
}

module.exports = { run, bestByDestination, evaluate, buildLink, buildPost, median, monthsAhead, CFG };
