// Free Games Radar — core logic (no external dependencies, Node >= 18).
// Sources:
//   - Epic Games Store public promotions endpoint (official store backend)
//   - GamerPower public giveaways API (https://www.gamerpower.com) — credit GamerPower in any public output
// The same file is reused by the Telegram bot in 02-bot-juegos-gratis.

const EPIC_URL = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions';
const GAMERPOWER_URL = 'https://www.gamerpower.com/api/giveaways';

const UA = 'Mozilla/5.0 (compatible; FreeGamesRadar/1.0)';

async function getJson(url, { retries = 2, timeoutMs = 20000 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
            // GamerPower answers 201 with an object when nothing matches the filter.
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
            return await res.json();
        } catch (err) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        } finally {
            clearTimeout(t);
        }
    }
    throw lastErr;
}

// ---------- Epic Games Store ----------

function epicSlug(el) {
    const fromMappings = (arr) => (Array.isArray(arr) ? arr.find((m) => m && m.pageSlug && m.pageType === 'productHome') || arr.find((m) => m && m.pageSlug) : null);
    const m = fromMappings(el.offerMappings) || fromMappings(el.catalogNs && el.catalogNs.mappings);
    if (m) return m.pageSlug;
    if (el.productSlug && el.productSlug !== '[]') return String(el.productSlug).replace(/\/home$/, '');
    if (el.urlSlug && !/^[0-9a-f]{32}$/.test(el.urlSlug)) return el.urlSlug;
    return null;
}

function epicImage(el) {
    const imgs = Array.isArray(el.keyImages) ? el.keyImages : [];
    const pref = ['OfferImageWide', 'DieselStoreFrontWide', 'featuredMedia', 'Thumbnail', 'OfferImageTall'];
    for (const type of pref) {
        const hit = imgs.find((i) => i.type === type && i.url);
        if (hit) return hit.url;
    }
    return imgs[0] ? imgs[0].url : null;
}

function firstWindow(groups) {
    // groups: [{ promotionalOffers: [{ startDate, endDate, discountSetting: { discountPercentage } }] }]
    if (!Array.isArray(groups)) return [];
    return groups.flatMap((g) => (g && Array.isArray(g.promotionalOffers) ? g.promotionalOffers : []));
}

/**
 * Parse the Epic promotions payload into normalized items.
 * A game is "free now" when it has an active promotional window AND its discounted price is 0
 * while its original price is > 0 (excludes always-free-to-play titles).
 * "Upcoming" uses discountPercentage === 0, which Epic uses to mean "100% off".
 */
function parseEpic(json, { now = new Date(), locale = 'es-ES' } = {}) {
    const els = (((json || {}).data || {}).Catalog || {}).searchStore;
    const elements = els && Array.isArray(els.elements) ? els.elements : [];
    const out = [];
    for (const el of elements) {
        if (!el || !el.title) continue;
        const price = ((el.price || {}).totalPrice) || {};
        const original = Number(price.originalPrice || 0);
        const discounted = Number(price.discountPrice ?? original);
        const decimals = ((price.currencyInfo || {}).decimals) ?? 2;
        const promos = el.promotions || {};
        const active = firstWindow(promos.promotionalOffers).find((p) => {
            const s = new Date(p.startDate);
            const e = new Date(p.endDate);
            return s <= now && now < e;
        });
        const upcoming = firstWindow(promos.upcomingPromotionalOffers).find((p) => {
            const pct = ((p.discountSetting || {}).discountPercentage);
            return pct === 0 && new Date(p.startDate) > now;
        });

        let status = null;
        let win = null;
        if (active && original > 0 && discounted === 0) {
            status = 'active';
            win = active;
        } else if (upcoming && original > 0) {
            status = 'upcoming';
            win = upcoming;
        }
        if (!status) continue;

        const slug = epicSlug(el);
        out.push({
            id: `epic:${el.namespace || ''}:${el.id}`,
            source: 'epic',
            store: 'Epic Games Store',
            title: String(el.title).trim(),
            description: el.description || null,
            url: slug ? `https://store.epicgames.com/${locale}/p/${slug}` : `https://store.epicgames.com/${locale}/free-games`,
            image: epicImage(el),
            originalPrice: original / Math.pow(10, decimals),
            currency: price.currencyCode || null,
            worthText: null,
            type: el.offerType === 'ADD_ON' || el.offerType === 'DLC' ? 'dlc' : 'game',
            status,
            startDate: win.startDate || null,
            endDate: win.endDate || null,
            platforms: ['PC'],
        });
    }
    return out;
}

async function fetchEpic({ country = 'ES', locale = 'es-ES', now = new Date() } = {}) {
    const url = `${EPIC_URL}?locale=${encodeURIComponent(locale)}&country=${encodeURIComponent(country)}&allowCountries=${encodeURIComponent(country)}`;
    const json = await getJson(url);
    return parseEpic(json, { now, locale });
}

// ---------- GamerPower ----------

const STORE_NAMES = {
    steam: 'Steam',
    'epic-games-store': 'Epic Games Store',
    gog: 'GOG',
    ubisoft: 'Ubisoft Connect',
    itchio: 'itch.io',
    battlenet: 'Battle.net',
    origin: 'EA app',
    'drm-free': 'DRM-free',
    ps4: 'PlayStation',
    ps5: 'PlayStation',
    'xbox-one': 'Xbox',
    'xbox-series-xs': 'Xbox',
    switch: 'Nintendo Switch',
    android: 'Android',
    ios: 'iOS',
};

function guessStore(platformsText) {
    const p = String(platformsText || '').toLowerCase();
    if (p.includes('steam')) return 'Steam';
    if (p.includes('epic')) return 'Epic Games Store';
    if (p.includes('gog')) return 'GOG';
    if (p.includes('ubisoft')) return 'Ubisoft Connect';
    if (p.includes('itch')) return 'itch.io';
    if (p.includes('prime') || p.includes('amazon')) return 'Prime Gaming';
    if (p.includes('playstation') || p.includes('ps4') || p.includes('ps5')) return 'PlayStation';
    if (p.includes('xbox')) return 'Xbox';
    if (p.includes('android')) return 'Android';
    if (p.includes('ios')) return 'iOS';
    return 'Other';
}

function parseMoney(text) {
    const m = String(text || '').match(/([\d.,]+)/);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

function parseGpDate(text) {
    if (!text || text === 'N/A') return null;
    // "2026-11-19 23:59:00" (no timezone given by the API; treated as UTC)
    const iso = String(text).trim().replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? '' : 'Z');
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseGamerPower(arr, { now = new Date() } = {}) {
    if (!Array.isArray(arr)) return []; // the API returns an object (status 201) when there are no results
    const out = [];
    for (const g of arr) {
        if (!g || !g.title) continue;
        if (g.status && String(g.status).toLowerCase() !== 'active') continue;
        const end = parseGpDate(g.end_date);
        if (end && new Date(end) <= now) continue;
        const type = String(g.type || '').toLowerCase();
        out.push({
            id: `gamerpower:${g.id}`,
            source: 'gamerpower',
            store: guessStore(g.platforms),
            title: String(g.title).replace(/\s*\((Steam|Epic Games|GOG|PC|Ubisoft|itch\.io)[^)]*\)\s*Giveaway\s*$/i, '').replace(/\s*Giveaway\s*$/i, '').trim(),
            description: g.description || null,
            url: g.open_giveaway_url || g.open_giveaway || g.gamerpower_url || null,
            image: g.image || g.thumbnail || null,
            originalPrice: parseMoney(g.worth),
            currency: parseMoney(g.worth) != null ? 'USD' : null,
            worthText: g.worth && g.worth !== 'N/A' ? g.worth : null,
            type: type.includes('dlc') || type.includes('loot') ? 'dlc' : type.includes('beta') ? 'beta' : 'game',
            status: 'active',
            startDate: parseGpDate(g.published_date),
            endDate: end,
            platforms: String(g.platforms || '').split(',').map((s) => s.trim()).filter(Boolean),
            sourceUrl: g.gamerpower_url || null,
        });
    }
    return out;
}

async function fetchGamerPower({ platforms = ['pc'], types = ['game'], now = new Date() } = {}) {
    const results = [];
    for (const type of types) {
        const url = `${GAMERPOWER_URL}?platform=${encodeURIComponent(platforms.join('.'))}&type=${encodeURIComponent(type)}&sort-by=date`;
        // multi-platform uses the /filter endpoint
        const finalUrl = platforms.length > 1
            ? `https://www.gamerpower.com/api/filter?platform=${encodeURIComponent(platforms.join('.'))}&type=${encodeURIComponent(type)}&sort-by=date`
            : url;
        const json = await getJson(finalUrl);
        results.push(...parseGamerPower(json, { now }));
    }
    return results;
}

// ---------- Merge ----------

function normTitle(t) {
    return String(t || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

/** Merge sources, preferring official Epic data when the same game appears twice. */
function mergeItems(lists) {
    const map = new Map();
    for (const item of lists.flat()) {
        const key = `${item.store}|${normTitle(item.title)}`;
        const prev = map.get(key);
        if (!prev || (prev.source !== 'epic' && item.source === 'epic')) map.set(key, item);
    }
    return [...map.values()].sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        const ea = a.endDate ? Date.parse(a.endDate) : Infinity;
        const eb = b.endDate ? Date.parse(b.endDate) : Infinity;
        return ea - eb;
    });
}

function filterItems(items, { includeUpcoming = true, includeDlc = false, minWorth = 0, stores = [] } = {}) {
    const storeSet = new Set(stores.map((s) => s.toLowerCase()));
    return items.filter((i) =>
        (includeUpcoming || i.status === 'active') &&
        (includeDlc || i.type === 'game') &&
        (minWorth <= 0 || (i.originalPrice || 0) >= minWorth) &&
        (storeSet.size === 0 || storeSet.has(i.store.toLowerCase())));
}

module.exports = {
    EPIC_URL,
    GAMERPOWER_URL,
    STORE_NAMES,
    getJson,
    parseEpic,
    fetchEpic,
    parseGamerPower,
    fetchGamerPower,
    mergeItems,
    filterItems,
    normTitle,
    epicSlug,
};
