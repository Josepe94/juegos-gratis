// Apps y juegos de Android de pago que están gratis por tiempo limitado.
// Descubrimiento: lista pública "Now Free" de AppSales (app-sales.net).
// Verificación: la ficha oficial de Google Play en España debe mostrar precio 0 y "Antes X €".
// Filtro de calidad: valoración y nº de opiniones mínimos, precio original mínimo y 1 app por desarrollador.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NOWFREE_URL = 'https://www.app-sales.net/nowfree/';

const DEFAULTS = { minRating: 4.0, minRatings: 200, minPrice: 0.99, maxApps: 25 };

async function get(fetchImpl, url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
        const r = await fetchImpl(url, { headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9' }, signal: ctrl.signal });
        return { status: r.status, text: await r.text() };
    } finally {
        clearTimeout(t);
    }
}

/** Ids de Google Play de la lista "Now Free" (sin la propia app de AppSales). */
function parseNowFree(html) {
    const ids = [];
    const re = /sale-list-action"><a[^>]+href="https:\/\/play\.google\.com\/store\/apps\/details\?id=([\w.]+)"/g;
    let m;
    while ((m = re.exec(String(html || '')))) if (!ids.includes(m[1]) && m[1] !== 'net.tsapps.appsales') ids.push(m[1]);
    return ids;
}

const euro = (s) => {
    const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

/** Lee la ficha de Google Play (España). Devuelve null si no es un regalo verificable. */
function parsePlayPage(id, html) {
    const text = String(html || '');
    const ldm = text.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    if (!ldm) return null;
    let ld;
    try {
        ld = JSON.parse(ldm[1]);
    } catch {
        return null;
    }
    const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
    if (!offer || Number(offer.price) !== 0) return null; // no está gratis en España
    // Botón principal de la ficha: "Antes 3,09 € y ahora Descargar"
    const before = text.match(/aria-label="Antes ([\d.,]+)\s?€ y ahora/);
    if (!before) return null; // gratis de siempre, no es un regalo
    const originalPrice = euro(before[1]);
    const rating = ld.aggregateRating ? Number(ld.aggregateRating.ratingValue) : 0;
    const ratingCount = ld.aggregateRating ? Number(ld.aggregateRating.ratingCount) : 0;
    const isGame = String(ld.applicationCategory || '').startsWith('GAME');
    return {
        id: `googleplay:${id}`,
        source: 'googleplay',
        store: 'Google Play',
        title: String(ld.name || id).trim(),
        description: ld.description || null,
        developer: ld.author && ld.author.name ? ld.author.name : null,
        url: `https://play.google.com/store/apps/details?id=${id}`,
        image: ld.image || null,
        originalPrice,
        currency: 'EUR',
        worthText: null,
        type: isGame ? 'mobilegame' : 'app',
        status: 'active',
        startDate: null,
        endDate: null,
        platforms: ['Android'],
        rating: Math.round(rating * 10) / 10,
        ratingCount,
        verified: true,
    };
}

function qualityFilter(apps, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const perDev = new Set();
    const ok = [];
    const rejected = [];
    for (const a of apps.sort((x, y) => y.ratingCount - x.ratingCount)) {
        let reason = null;
        if (a.rating < o.minRating) reason = `valoración ${a.rating} < ${o.minRating}`;
        else if (a.ratingCount < o.minRatings) reason = `solo ${a.ratingCount} opiniones`;
        else if (!(a.originalPrice >= o.minPrice)) reason = `precio original ${a.originalPrice} € demasiado bajo`;
        else if (a.developer && perDev.has(a.developer)) reason = `ya hay otra app de ${a.developer}`;
        if (reason) rejected.push({ title: a.title, store: a.store, reason });
        else {
            ok.push(a);
            if (a.developer) perDev.add(a.developer);
        }
    }
    return { ok, rejected };
}

async function fetchAndroidFreebies({ fetchImpl = fetch, ...opts } = {}) {
    const o = { ...DEFAULTS, ...opts };
    const list = await get(fetchImpl, NOWFREE_URL);
    if (list.status >= 400) throw new Error(`AppSales HTTP ${list.status}`);
    const ids = parseNowFree(list.text).slice(0, o.maxApps);
    const found = [];
    const rejected = [];
    const queue = [...ids];
    async function worker() {
        while (queue.length) {
            const id = queue.shift();
            try {
                const page = await get(fetchImpl, `https://play.google.com/store/apps/details?id=${id}&hl=es&gl=ES`);
                const app = page.status < 400 ? parsePlayPage(id, page.text) : null;
                if (app) found.push(app);
                else rejected.push({ title: id, store: 'Google Play', reason: 'Google Play no confirma que sea de pago y ahora gratis en España' });
            } catch (err) {
                rejected.push({ title: id, store: 'Google Play', reason: `ficha no disponible (${err.message})` });
            }
        }
    }
    await Promise.all([worker(), worker(), worker()]);
    const q = qualityFilter(found, o);
    return { items: q.ok, rejected: [...rejected, ...q.rejected] };
}

module.exports = { fetchAndroidFreebies, parseNowFree, parsePlayPage, qualityFilter, NOWFREE_URL };
