// Canal "Ofertas de súper": resumen de las mejores ofertas de la semana.
// Fuente: página pública de ofertas de ALDI España (permitida en su robots.txt), leída 1 vez al día como máximo.
// Se publica un resumen cuando empieza una semana de ofertas nueva, con el % real respecto al precio tachado.
const { http, esc, makePublisher, loadState, saveState, env } = require('./lib');

const NAME = 'super';
const LABEL = 'Ofertas de súper';
const ALDI_URL = 'https://www.aldi.es/ofertas.html';
const CFG = { minDiscount: 20, top: 12, runEveryHours: 20 };

/** Extrae los productos en oferta del HTML de la página de ofertas de ALDI. */
function parseAldi(html) {
    const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('no se encuentra __NEXT_DATA__');
    const next = JSON.parse(m[1]);
    let apiData = null;
    (function find(o, depth) {
        if (apiData || !o || typeof o !== 'object' || depth > 12) return;
        if (typeof o.apiData === 'string') apiData = o.apiData;
        else for (const v of Object.values(o)) find(v, depth + 1);
    })(next, 0);
    if (!apiData) throw new Error('no se encuentra apiData');
    const entries = JSON.parse(apiData);
    const products = [];
    for (const [kind, payload] of entries) {
        if (kind !== 'OFFER_GET' || !payload || !payload.res) continue;
        const week = payload.req && payload.req.week;
        for (const p of Object.values(payload.res.algoliaDataMap || {})) {
            const cp = p.currentPrice || {};
            const price = Number(cp.priceValue);
            const strike = Number(cp.strikePrice && cp.strikePrice.strikePriceValue);
            if (!(price > 0)) continue;
            const base = (cp.basePrice || [])[0] || {};
            products.push({
                id: p.objectID,
                week,
                name: String(p.name || '').trim(),
                brand: String(p.brandName || '').replace(/®|™/g, '').trim(),
                price,
                strike: strike > price ? strike : null,
                discount: strike > price ? Math.round((1 - price / strike) * 100) : 0,
                promo: (cp.priceTagLabels && cp.priceTagLabels.promoText1) || null,
                unit: base.basePriceValue && base.basePriceScale ? `${String(base.basePriceValue).replace('.', ',')} €/${base.basePriceScale}` : null,
                salesUnit: p.salesUnit || null,
                validFrom: cp.validFrom ? cp.validFrom * 1000 : null,
                validUntil: cp.validUntil ? cp.validUntil * 1000 : null,
                category: ((p.hierarchicalCategories && p.hierarchicalCategories.lvl0) || [])[0] || '',
                available: p.isAvailable !== false && !p.isRecall,
            });
        }
    }
    return products;
}

function selectTop(products) {
    const current = products.filter((p) => p.available && (p.week === undefined || p.week === 'current'));
    const good = current.filter((p) => p.discount >= CFG.minDiscount);
    good.sort((a, b) => b.discount - a.discount || a.price - b.price);
    // variedad: como mucho 3 por categoría
    const perCat = {};
    const brands = new Set();
    return good.filter((p) => {
        const b = p.brand.toLowerCase();
        if (b && brands.has(b)) return false;
        if ((perCat[p.category] = (perCat[p.category] || 0) + 1) > 3) return false;
        if (b) brands.add(b);
        return true;
    }).slice(0, CFG.top);
}

const eur = (n) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const day = (ms) => new Date(ms).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' });

function buildDigest(top) {
    const until = top.map((p) => p.validUntil).filter(Boolean).sort((a, b) => a - b)[0];
    const lines = [`🛒 <b>ALDI: las ${top.length} mejores ofertas de esta semana</b>`, until ? `<i>Válidas hasta el ${esc(day(until))} (península)</i>` : '', ''];
    for (const p of top) {
        const what = [p.brand && !/^aldi$/i.test(p.brand) ? p.brand : null, p.name].filter(Boolean).join(' · ');
        let line = `• <b>${esc(what)}</b>: ${eur(p.price)}`;
        if (p.strike) line += ` <s>${eur(p.strike)}</s> (−${p.discount}%)`;
        if (p.promo && !/^-?\d+%$/.test(p.promo.replace(/\s/g, ''))) line += ` · ${esc(p.promo)}`;
        if (p.unit) line += ` · ${esc(p.unit)}`;
        lines.push(line);
    }
    lines.push('', `👉 <a href="${ALDI_URL}">Todas las ofertas en aldi.es</a>`, '<i>Descuentos calculados sobre el precio tachado de la propia tienda. Los precios pueden variar en Baleares y Canarias.</i>');
    return lines.filter((l, i) => !(l === '' && i === 1)).join('\n');
}

async function run({ fetchImpl = fetch } = {}) {
    const state = loadState(NAME, { weeks: [] });
    if (state.lastRun && Date.now() - Date.parse(state.lastRun) < CFG.runEveryHours * 3600e3 && env('DRY_RUN') !== '1') {
        console.log(`[${NAME}] ya se consultó hoy: se omite.`);
        return { skipped: true };
    }
    const pub = makePublisher({ name: NAME, label: LABEL, channelVar: 'SUPER_CHAT_ID', state });
    const products = parseAldi(await http(ALDI_URL, { fetchImpl }));
    const top = selectTop(products);
    const weekKey = `aldi:${top.map((p) => p.validUntil).filter(Boolean).sort((a, b) => a - b)[0] || new Date().toISOString().slice(0, 10)}`;
    console.log(`[${NAME}] ALDI: ${products.length} productos en oferta, ${top.length} destacados, semana ${weekKey} · destino: ${pub.mode}`);
    let sent = 0;
    if (top.length >= 3 && !state.weeks.includes(weekKey)) {
        if (await pub.send(buildDigest(top))) sent += 1;
        state.weeks = [...state.weeks, weekKey].slice(-30);
    }
    state.lastRun = new Date().toISOString();
    saveState(NAME, state);
    console.log(`[${NAME}] enviados: ${sent}`);
    return { products: products.length, top: top.length, sent };
}

module.exports = { run, parseAldi, selectTop, buildDigest };
