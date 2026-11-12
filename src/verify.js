// Filtro de seguridad: solo se publica un juego si
//   1) el enlace final (tras redirecciones) es de una tienda oficial y de confianza,
//   2) el enlace funciona (no da error ni 404),
//   3) en Steam, la API oficial confirma que ahora mismo está al 100 % de descuento.
// Ante cualquier duda (error de red, tienda desconocida…) el juego NO se publica.

const TRUSTED = [
    { name: 'Epic Games Store', hosts: ['store.epicgames.com'] },
    { name: 'Steam', hosts: ['store.steampowered.com'] },
    { name: 'GOG', hosts: ['gog.com', 'www.gog.com'] },
    { name: 'Ubisoft Connect', hosts: ['store.ubisoft.com', 'www.ubisoft.com'] },
    { name: 'itch.io', hosts: ['itch.io'], subdomains: true },
    { name: 'IndieGala', hosts: ['www.indiegala.com', 'freebies.indiegala.com', 'indiegala.com'] },
    { name: 'EA app', hosts: ['www.ea.com'] },
    { name: 'Battle.net', hosts: ['shop.battle.net', 'us.shop.battle.net', 'eu.shop.battle.net'] },
    { name: 'Prime Gaming', hosts: ['gaming.amazon.com', 'luna.amazon.com', 'luna.amazon.es'] },
    { name: 'PlayStation', hosts: ['store.playstation.com'] },
    { name: 'Xbox', hosts: ['www.xbox.com'] },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function trustedStore(urlString) {
    let host;
    try {
        host = new URL(urlString).hostname.toLowerCase();
    } catch {
        return null;
    }
    for (const s of TRUSTED) {
        if (s.hosts.includes(host)) return s.name;
        if (s.subdomains && s.hosts.some((h) => host.endsWith('.' + h))) return s.name;
    }
    return null;
}

async function fetchWithTimeout(fetchImpl, url, opts = {}, ms = 20000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetchImpl(url, { redirect: 'follow', ...opts, signal: ctrl.signal, headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9', ...(opts.headers || {}) } });
    } finally {
        clearTimeout(t);
    }
}

/** Steam: confirma con la API oficial que el juego está al 100 % de descuento ahora mismo. */
async function steamIsFreeToKeep(fetchImpl, url) {
    const m = String(url).match(/store\.steampowered\.com\/app\/(\d+)/);
    if (!m) return false;
    const res = await fetchWithTimeout(fetchImpl, `https://store.steampowered.com/api/appdetails?appids=${m[1]}&cc=es&filters=price_overview,basic`);
    if (!res.ok) return false;
    const json = await res.json();
    const data = json && json[m[1]] && json[m[1]].success ? json[m[1]].data : null;
    if (!data) return false;
    if (data.is_free) return false; // free-to-play permanente: no es un regalo
    const p = data.price_overview;
    return Boolean(p && p.discount_percent === 100 && p.final === 0 && p.initial > 0);
}

/**
 * Comprueba cada juego. Devuelve { ok: [...], rejected: [{ title, reason }] }.
 * Los juegos de Epic vienen de su API oficial y su enlace se construye a partir de ella,
 * así que solo se comprueba que el dominio sea el oficial (Epic bloquea a los robots en sus páginas).
 */
async function verifyItems(items, { fetchImpl = fetch, concurrency = 4 } = {}) {
    const ok = [];
    const rejected = [];
    const queue = [...items];

    async function check(item) {
        if (item.source === 'epic') {
            return trustedStore(item.url) === 'Epic Games Store' ? { item } : { reason: 'enlace de Epic no oficial' };
        }
        if (!item.url) return { reason: 'sin enlace' };
        let res;
        try {
            res = await fetchWithTimeout(fetchImpl, item.url);
        } catch (err) {
            return { reason: `el enlace no responde (${err.name === 'AbortError' ? 'tiempo agotado' : err.message})` };
        }
        let finalUrl = res.url || item.url;
        // Página intermedia (redirección por HTML o JavaScript): extraer el enlace real.
        if (!trustedStore(finalUrl) && /gamerpower\.com$/i.test(safeHost(finalUrl)) && typeof res.text === 'function') {
            try {
                const target = extractRedirect(await res.text());
                if (target) {
                    finalUrl = target;
                    res = await fetchWithTimeout(fetchImpl, target);
                    finalUrl = res.url || target;
                }
            } catch (err) {
                return { reason: `no se pudo seguir el enlace (${err.message})` };
            }
        }
        const store = trustedStore(finalUrl);
        if (!store) return { reason: `lleva a una web que no es una tienda oficial (${safeHost(finalUrl)})` };
        if (res.status >= 400) return { reason: `el enlace da error ${res.status}` };
        if (store === 'Steam') {
            let free = false;
            try {
                free = await steamIsFreeToKeep(fetchImpl, finalUrl);
            } catch {
                free = false;
            }
            if (!free) return { reason: 'Steam no confirma que esté gratis ahora mismo' };
        }
        return { item: { ...item, url: cleanUrl(finalUrl), store, verified: true } };
    }

    async function worker() {
        while (queue.length) {
            const item = queue.shift();
            const r = await check(item);
            if (r.item) ok.push(r.item);
            else rejected.push({ title: item.title, store: item.store, reason: r.reason });
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
    // conserva el orden original
    const order = new Map(items.map((i, idx) => [i.id, idx]));
    ok.sort((a, b) => order.get(a.id) - order.get(b.id));
    return { ok, rejected };
}

/** Busca el destino en una página de redirección: meta refresh, location JS o el primer enlace a una tienda de confianza. */
function extractRedirect(html) {
    const text = String(html || '');
    const patterns = [
        /http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i,
        /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
        /location\.replace\(\s*["']([^"']+)["']/i,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (m && /^https?:\/\//i.test(m[1])) return m[1].replace(/&amp;/g, '&');
    }
    const links = [...text.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
    return links.find((l) => trustedStore(l)) || null;
}

function safeHost(u) {
    try {
        return new URL(u).hostname;
    } catch {
        return 'desconocida';
    }
}

/** Quita parámetros de seguimiento de terceros del enlace final. */
function cleanUrl(u) {
    try {
        const url = new URL(u);
        for (const k of [...url.searchParams.keys()]) {
            if (/^(utm_|ref$|ref_|affiliate|aff|partner|snr$|curator_clanid)/i.test(k)) url.searchParams.delete(k);
        }
        return url.toString();
    } catch {
        return u;
    }
}

module.exports = { verifyItems, trustedStore, steamIsFreeToKeep, cleanUrl, extractRedirect, TRUSTED };
