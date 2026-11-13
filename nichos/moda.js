// Canal "Moda y zapatillas de marca originales al precio mínimo real".
// Fuente: catálogos (feeds) de tiendas oficiales en redes de afiliación (formato CSV de Awin, gzip o no).
// Solo marcas de la lista blanca, solo en stock, y solo se publica un precio que es el MÍNIMO DE 30 DÍAS
// según nuestro propio histórico y además está claramente por debajo de su precio habitual de 90 días.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { http, esc, makePublisher, loadState, saveState, env, sleep } = require('./lib');

const NAME = 'moda';
const LABEL = 'Moda y zapatillas originales';
const HISTORY_FILE = path.join(__dirname, 'state', 'moda-history.json.gz');

const BRANDS = ['nike', 'jordan', 'adidas', 'new balance', 'puma', 'asics', 'vans', 'converse', 'on', 'on running', 'hoka', 'salomon', 'reebok', 'saucony', 'mizuno', 'veja', 'ugg', 'timberland', 'dr. martens', 'dr martens', 'birkenstock', 'clarks', 'levi\'s', 'levis', 'the north face', 'columbia', 'patagonia', 'tommy hilfiger', 'tommy jeans', 'calvin klein', 'lacoste', 'polo ralph lauren', 'ralph lauren', 'carhartt wip', 'carhartt', 'champion', 'fila', 'kappa', 'under armour', 'superdry', 'g-star raw', 'diesel', 'guess', 'hugo', 'boss', 'armani exchange', 'ea7', 'napapijri', 'helly hansen', 'the kooples', 'scalpers', 'el ganso', 'pepe jeans', 'hackett', 'skechers', 'geox', 'camper'];

const CFG = { minPrice: 25, minTrackedDays: 14, minDropVsTypical: 0.15, maxPostsPerRun: 8, maxTracked: 20000, runEveryHours: 20 };

// Alias de columnas (Awin estándar y variantes habituales)
const COLS = {
    id: ['aw_product_id', 'product_id', 'id'],
    name: ['product_name', 'title', 'name'],
    brand: ['brand_name', 'brand'],
    price: ['search_price', 'price', 'sale_price', 'display_price'],
    rrp: ['rrp_price', 'rrp', 'recommended_retail_price'],
    url: ['aw_deep_link', 'deep_link', 'link', 'url'],
    image: ['large_image', 'aw_image_url', 'merchant_image_url', 'image_link', 'image_url'],
    merchant: ['merchant_name', 'merchant', 'store'],
    inStock: ['in_stock', 'stock_status', 'availability'],
    size: ['Fashion:size', 'fashion_size', 'size'],
    category: ['merchant_category', 'category_name', 'product_type'],
    currency: ['currency'],
};

/** Parser CSV en streaming (soporta comillas, comas y saltos de línea dentro de campos). */
function createCsvParser(onRow, { delimiter = ',' } = {}) {
    let field = '';
    let row = [];
    let inQuotes = false;
    let pendingQuote = false;
    const endField = () => {
        row.push(field);
        field = '';
    };
    const endRow = () => {
        endField();
        if (!(row.length === 1 && row[0] === '')) onRow(row);
        row = [];
    };
    return {
        write(chunk) {
            for (let i = 0; i < chunk.length; i++) {
                const c = chunk[i];
                if (inQuotes) {
                    if (pendingQuote) {
                        pendingQuote = false;
                        if (c === '"') {
                            field += '"';
                            continue;
                        }
                        inQuotes = false;
                    } else if (c === '"') {
                        pendingQuote = true;
                        continue;
                    } else {
                        field += c;
                        continue;
                    }
                }
                if (c === '"' && field === '') inQuotes = true;
                else if (c === delimiter) endField();
                else if (c === '\n') endRow();
                else if (c !== '\r') field += c;
            }
        },
        end() {
            if (pendingQuote) inQuotes = false;
            if (field !== '' || row.length) endRow();
        },
    };
}

function pick(obj, keys) {
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== '') return obj[k];
    return '';
}

const num = (s) => {
    const n = Number(String(s).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

function brandOf(rawBrand, name) {
    const b = String(rawBrand || '').toLowerCase().trim();
    if (BRANDS.includes(b)) return rawBrand.trim();
    // Marca en el nombre ("Nike Air Max 90") solo si empieza por ella
    const n = String(name || '').toLowerCase();
    const hit = BRANDS.filter((x) => x.length > 3).find((x) => n.startsWith(x + ' '));
    return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

function normalize(rec) {
    const name = pick(rec, COLS.name).trim();
    const brand = brandOf(pick(rec, COLS.brand), name);
    if (!brand) return null;
    const price = num(pick(rec, COLS.price));
    if (!(price >= CFG.minPrice)) return null;
    const cur = pick(rec, COLS.currency);
    if (cur && cur.toUpperCase() !== 'EUR') return null;
    const stock = String(pick(rec, COLS.inStock)).toLowerCase();
    if (stock && /^(0|false|no|out|out of stock|agotado)$/.test(stock)) return null;
    const url = pick(rec, COLS.url);
    if (!/^https:\/\//.test(url)) return null;
    const merchant = pick(rec, COLS.merchant).trim();
    return {
        key: `${merchant}|${pick(rec, COLS.id) || name}`.slice(0, 160),
        name,
        brand,
        price,
        rrp: num(pick(rec, COLS.rrp)),
        url,
        image: pick(rec, COLS.image) || null,
        merchant,
        size: pick(rec, COLS.size) || null,
        category: pick(rec, COLS.category) || '',
    };
}

/** Descarga y lee un feed; devuelve productos de la lista blanca. */
async function readFeed(url, { fetchImpl = fetch } = {}) {
    let buf = await http(url, { as: 'buffer', timeoutMs: 300000, fetchImpl });
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    const text = buf.toString('utf8');
    let header = null;
    const products = [];
    const delimiter = (text.slice(0, 2000).split('\n')[0].match(/\|/g) || []).length > (text.slice(0, 2000).split('\n')[0].match(/,/g) || []).length ? '|' : ',';
    const parser = createCsvParser((row) => {
        if (!header) {
            header = row.map((h) => h.trim().replace(/^﻿/, ''));
            return;
        }
        const rec = {};
        header.forEach((h, i) => (rec[h] = row[i] ?? ''));
        const p = normalize(rec);
        if (p) products.push(p);
    }, { delimiter });
    parser.write(text);
    parser.end();
    return products;
}

const dayNum = (d = new Date()) => Math.floor(d.getTime() / 864e5);

/** Precio vigente cada día en una ventana, a partir de los puntos de cambio [[día, precio], …]. */
function dailySeries(changes, fromDay, toDay) {
    const out = [];
    let i = 0;
    let current = null;
    for (let d = fromDay; d <= toDay; d++) {
        while (i < changes.length && changes[i][0] <= d) current = changes[i++][1];
        if (current !== null) out.push(current);
    }
    return out;
}

function median(a) {
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
}

/** ¿Es este precio un chollo real según el histórico? */
function evaluate(entry, price, today) {
    if (!entry || today - entry.first < CFG.minTrackedDays) return null;
    const prev30 = dailySeries(entry.p, today - 30, today - 1);
    const prev90 = dailySeries(entry.p, today - 90, today - 1);
    if (!prev30.length || !prev90.length) return null;
    const min30 = Math.min(...prev30);
    const typical = median(prev90);
    if (!(price < min30)) return null; // tiene que ser un nuevo mínimo de 30 días
    if (price > typical * (1 - CFG.minDropVsTypical)) return null;
    const min90 = Math.min(...prev90);
    return { typical, min30, isMin90: price < min90, dropPct: Math.round((1 - price / typical) * 100) };
}

const eur = (n) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

function buildPost(p, ev) {
    const lines = [
        `👟 <b>${esc(p.brand)}</b> · ${esc(p.name.replace(new RegExp(`^${p.brand}\\s+`, 'i'), ''))}`,
        `💶 <b>${eur(p.price)}</b>  ·  habitual ~${eur(ev.typical)}  (−${ev.dropPct}%)`,
        ev.isMin90 ? '🔻 <b>Precio más bajo de los últimos 90 días</b>' : '🔻 <b>Precio más bajo de los últimos 30 días</b>',
    ];
    if (p.size) lines.push(`📏 Talla: ${esc(p.size)}`);
    lines.push(`🏬 ${esc(p.merchant)} · tienda oficial, producto original`, '', `👉 <a href="${esc(p.url)}">Ver en la tienda</a>`, '', '<i>#publi · enlace de afiliado: si compras, el canal recibe una comisión sin coste para ti. El precio puede cambiar.</i>');
    return lines.join('\n');
}

function loadHistory() {
    try {
        return JSON.parse(zlib.gunzipSync(fs.readFileSync(HISTORY_FILE)).toString('utf8'));
    } catch {
        return {};
    }
}

function saveHistory(h) {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, zlib.gzipSync(JSON.stringify(h)));
}

/** Actualiza el histórico con los precios de hoy y devuelve los chollos. */
function processProducts(products, hist, today = dayNum()) {
    const deals = [];
    const seenToday = new Set();
    for (const p of products) {
        if (seenToday.has(p.key)) continue;
        seenToday.add(p.key);
        let e = hist[p.key];
        const ev = evaluate(e, p.price, today);
        if (ev) deals.push({ p, ev });
        if (!e) e = hist[p.key] = { first: today, p: [] };
        const last = e.p[e.p.length - 1];
        if (!last || last[1] !== p.price) e.p.push([today, p.price]);
        e.seen = today;
        e.p = e.p.filter((x, i, a) => x[0] >= today - 120 || i === a.length - 1 || (a[i + 1] && a[i + 1][0] > today - 120));
    }
    // Olvidar productos que no aparecen hace más de 60 días y limitar tamaño
    for (const [k, e] of Object.entries(hist)) if (today - (e.seen || e.first) > 60) delete hist[k];
    const keys = Object.keys(hist);
    if (keys.length > CFG.maxTracked) keys.sort((a, b) => (hist[a].seen || 0) - (hist[b].seen || 0)).slice(0, keys.length - CFG.maxTracked).forEach((k) => delete hist[k]);
    deals.sort((a, b) => b.ev.dropPct - a.ev.dropPct);
    // Una publicación por producto y tienda; como mucho 2 por marca
    const perBrand = {};
    return deals.filter(({ p }) => (perBrand[p.brand] = (perBrand[p.brand] || 0) + 1) <= 2);
}

async function run({ fetchImpl = fetch } = {}) {
    const feeds = env('MODA_FEEDS').split(/[\s,]+/).filter((u) => /^https:\/\//.test(u));
    if (!feeds.length) {
        console.log(`[${NAME}] sin feeds configurados (MODA_FEEDS): pendiente de aprobación en programas de afiliados.`);
        return { skipped: true };
    }
    const state = loadState(NAME, { posted: {} });
    if (state.lastRun && Date.now() - Date.parse(state.lastRun) < CFG.runEveryHours * 3600e3 && env('DRY_RUN') !== '1') {
        console.log(`[${NAME}] ya se ejecutó hoy: se omite.`);
        return { skipped: true };
    }
    const pub = makePublisher({ name: NAME, label: LABEL, channelVar: 'MODA_CHAT_ID', state });
    const products = [];
    for (const f of feeds) {
        try {
            const list = await readFeed(f, { fetchImpl });
            console.log(`[${NAME}] feed ${new URL(f).hostname}: ${list.length} productos de marcas seleccionadas`);
            products.push(...list);
        } catch (err) {
            console.warn(`[${NAME}] feed falló: ${err.message}`);
        }
    }
    const hist = loadHistory();
    const deals = processProducts(products, hist);
    console.log(`[${NAME}] ${Object.keys(hist).length} productos en seguimiento, ${deals.length} chollos · destino: ${pub.mode}`);
    let sent = 0;
    const today = dayNum();
    for (const { p, ev } of deals) {
        if (sent >= CFG.maxPostsPerRun) break;
        const last = state.posted[p.key];
        if (last && today - last.day < 14 && p.price >= last.price * 0.95) continue;
        if (await pub.send(buildPost(p, ev), { photo: p.image })) sent += 1;
        state.posted[p.key] = { day: today, price: p.price };
        await sleep(1500);
    }
    for (const [k, v] of Object.entries(state.posted)) if (today - v.day > 60) delete state.posted[k];
    if (env('DRY_RUN') !== '1') saveHistory(hist);
    state.lastRun = new Date().toISOString();
    saveState(NAME, state);
    console.log(`[${NAME}] enviados: ${sent}`);
    return { tracked: Object.keys(hist).length, deals: deals.length, sent };
}

module.exports = { run, createCsvParser, normalize, brandOf, evaluate, dailySeries, processProducts, buildPost, readFeed, dayNum, CFG };
