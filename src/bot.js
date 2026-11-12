// Bot de juegos gratis: publica en Telegram (y opcionalmente Discord) cada juego gratis nuevo
// y regenera una web estática (docs/index.html) para GitHub Pages. Sin dependencias. Node >= 18.
const fs = require('fs');
const path = require('path');
const { fetchEpic, fetchGamerPower, mergeItems, filterItems } = require('./sources');
const { verifyItems } = require('./verify');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'state.json');
const DOCS_DIR = path.join(ROOT, 'docs');

const env = (k, d = '') => (process.env[k] ?? d).trim();
const CONFIG = {
    brand: env('BRAND_NAME', 'Radar de Juegos Gratis'),
    telegramToken: env('TELEGRAM_BOT_TOKEN'),
    telegramChat: env('TELEGRAM_CHAT_ID'), // @tucanal o id numérico
    ownerChat: env('OWNER_CHAT_ID'), // tu id de usuario: recibes el chollo redactado para Chollometro
    discordWebhook: env('DISCORD_WEBHOOK_URL'),
    siteUrl: env('SITE_URL'), // https://usuario.github.io/repo/
    promoText: env('PROMO_TEXT'), // p. ej. "🎮 Ofertas en claves: "
    promoUrl: env('PROMO_URL'), // tu enlace de afiliado o tu tienda
    promoEvery: Number(env('PROMO_EVERY', '5')) || 5,
    maxPostsPerRun: Number(env('MAX_POSTS_PER_RUN', '8')) || 8,
    country: env('COUNTRY', 'ES'),
    locale: env('LOCALE', 'es-ES'),
    platforms: env('GAMERPOWER_PLATFORMS', 'pc').split(',').map((s) => s.trim()).filter(Boolean),
    minWorth: Number(env('MIN_WORTH', '0')) || 0,
    dryRun: env('DRY_RUN') === '1',
};

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return { seen: [], posts: 0, history: [] };
    }
}

function saveState(state) {
    state.seen = state.seen.slice(-3000);
    state.history = state.history.slice(-500);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtDate(iso, locale = 'es-ES') {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

function fmtPrice(g) {
    if (g.originalPrice == null || g.originalPrice <= 0) return null;
    const cur = g.currency || 'USD';
    try {
        return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(g.originalPrice);
    } catch {
        return `${g.originalPrice} ${cur}`;
    }
}

function buildCaption(g, { withPromo }) {
    const lines = [];
    if (g.status === 'upcoming') {
        lines.push(`🔜 <b>Próximamente gratis en ${esc(g.store)}</b>`);
    } else {
        lines.push(`🎁 <b>GRATIS en ${esc(g.store)}</b>`);
    }
    lines.push(`<b>${esc(g.title)}</b>`);
    const price = fmtPrice(g);
    if (price) lines.push(`💸 Precio normal: <s>${esc(price)}</s> → GRATIS`);
    if (g.status === 'upcoming' && g.startDate) lines.push(`📅 Desde: ${esc(fmtDate(g.startDate))}`);
    if (g.endDate) lines.push(`⏳ Hasta: ${esc(fmtDate(g.endDate))}`);
    if (g.url) lines.push(`\n👉 <a href="${esc(g.url)}">Conseguirlo</a>`);
    if (g.source === 'gamerpower') lines.push('<i>Fuente: GamerPower</i>');
    if (withPromo && CONFIG.promoUrl) lines.push(`\n${esc(CONFIG.promoText || '🎮 Más ofertas:')} <a href="${esc(CONFIG.promoUrl)}">aquí</a>`);
    return lines.join('\n').slice(0, 1020);
}

async function tg(method, payload) {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`Telegram ${method}: ${res.status} ${body.description || ''}`);
    return body;
}

async function postTelegram(g, caption) {
    if (g.image) {
        try {
            return await tg('sendPhoto', { chat_id: CONFIG.telegramChat, photo: g.image, caption, parse_mode: 'HTML' });
        } catch (err) {
            console.warn(`sendPhoto falló (${err.message}); envío solo texto`);
        }
    }
    return tg('sendMessage', { chat_id: CONFIG.telegramChat, text: caption, parse_mode: 'HTML', disable_web_page_preview: false });
}

function fmtShort(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).replace(',', '');
}

function buildDealDraft(g) {
    const price = fmtPrice(g);
    const end = g.endDate ? fmtDate(g.endDate) : null;
    const startIso = g.startDate && Date.parse(g.startDate) > Date.now() - 864e5 ? g.startDate : new Date().toISOString();
    const plat = g.store === 'Epic Games Store' || g.store === 'Steam' || g.store === 'GOG' || g.store === 'IndieGala' || g.store === 'itch.io' || g.store === 'Ubisoft Connect' ? 'PC' : (g.platforms || []).join(', ') || 'PC';
    const title = `${g.title} GRATIS para ${plat} (${g.store})`.slice(0, 140);
    const desc = [
        `${g.store} regala ${g.title}${price ? ` (precio normal ${price})` : ''}.`,
        end ? `Disponible gratis hasta el ${end}.` : 'Gratis por tiempo limitado.',
        'Una vez canjeado, se queda en tu biblioteca para siempre.',
    ].filter(Boolean).join(' ');
    return [
        g.status === 'upcoming'
            ? `⏰ <b>PREPÁRALO: este chollo se activa el ${esc(fmtDate(g.startDate))}</b>\nChollometro no lo acepta antes. Pon una alarma 2 minutos antes, ten esto abierto y publícalo en cuanto den las ${esc(new Date(g.startDate).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }))}: en los juegos de Epic gana el primero.`
            : '📝 <b>Chollo listo para Chollometro</b> (toca cada bloque para copiarlo)',
        '',
        '<b>Enlace:</b>',
        `<code>${esc(g.url || '')}</code>`,
        '',
        '<b>Título:</b>',
        `<code>${esc(title)}</code>`,
        '',
        '<b>Precio:</b> 0 €' + (price ? `  ·  <b>Precio anterior:</b> ${esc(price)}` : ''),
        `<b>Fecha de inicio:</b> <code>${esc(fmtShort(startIso))}</code>`,
        g.endDate ? `<b>Fecha de fin:</b> <code>${esc(fmtShort(g.endDate))}</code>` : '<b>Fecha de fin:</b> la tienda no la indica; déjala vacía',
        '<b>Categoría:</b> Juego gratis / Juegos de PC',
        '',
        '<b>Descripción:</b>',
        `<code>${esc(desc)}</code>`,
        '',
        '👉 Publícalo en https://www.chollometro.com (botón + o «Publicar»)',
    ].filter((l) => l !== null).join('\n').slice(0, 4000);
}

async function postDiscord(g) {
    const price = fmtPrice(g);
    const res = await fetch(CONFIG.discordWebhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username: CONFIG.brand,
            embeds: [{
                title: `${g.status === 'upcoming' ? '🔜 Próximamente gratis' : '🎁 Gratis'}: ${g.title}`.slice(0, 250),
                url: g.url || undefined,
                description: [`Tienda: **${g.store}**`, price ? `Precio normal: ~~${price}~~` : null, g.endDate ? `Hasta: ${fmtDate(g.endDate)}` : null].filter(Boolean).join('\n'),
                image: g.image ? { url: g.image } : undefined,
                footer: g.source === 'gamerpower' ? { text: 'Fuente: GamerPower' } : undefined,
            }],
        }),
    });
    if (!res.ok) throw new Error(`Discord: HTTP ${res.status}`);
}

function renderSite(items, generatedAt) {
    const active = items.filter((g) => g.status === 'active');
    const upcoming = items.filter((g) => g.status === 'upcoming');
    const total = active.reduce((s, g) => s + (g.currency === 'EUR' || g.currency === 'USD' ? g.originalPrice || 0 : 0), 0);
    const card = (g) => `
      <article class="card">
        ${g.image ? `<img src="${esc(g.image)}" alt="${esc(g.title)}" loading="lazy">` : ''}
        <div class="body">
          <span class="store">${esc(g.store)}</span>
          <h3>${esc(g.title)}</h3>
          ${fmtPrice(g) ? `<p class="price"><s>${esc(fmtPrice(g))}</s> <b>0 €</b></p>` : ''}
          <p class="date">${g.status === 'upcoming' ? `Gratis desde ${esc(fmtDate(g.startDate) || '')}` : g.endDate ? `Gratis hasta ${esc(fmtDate(g.endDate))}` : 'Gratis por tiempo limitado'}</p>
          ${g.url ? `<a class="btn" href="${esc(g.url)}" rel="nofollow noopener" target="_blank">${g.status === 'upcoming' ? 'Ver en la tienda' : 'Conseguir gratis'}</a>` : ''}
        </div>
      </article>`;
    const promo = CONFIG.promoUrl ? `<p class="promo"><a href="${esc(CONFIG.promoUrl)}" rel="sponsored noopener" target="_blank">${esc(CONFIG.promoText || 'Ofertas en claves de juegos')}</a> · enlace de afiliado: si compras, el canal recibe una pequeña comisión sin coste para ti.</p>` : '';
    const tgLink = CONFIG.telegramChat && CONFIG.telegramChat.startsWith('@') ? `https://t.me/${CONFIG.telegramChat.slice(1)}` : '';
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Juegos gratis hoy (Epic, Steam, GOG) — ${esc(CONFIG.brand)}</title>
<meta name="description" content="Lista actualizada cada pocas horas de todos los juegos de PC gratis ahora mismo en Epic Games Store, Steam, GOG y más, con fecha de fin y el juego gratis de la próxima semana.">
${CONFIG.siteUrl ? `<link rel="canonical" href="${esc(CONFIG.siteUrl)}">` : ''}
<style>
:root{--bg:#0f1115;--fg:#e9ecf1;--muted:#9aa3af;--card:#181b22;--accent:#3ddc97;--line:#262a33}
@media (prefers-color-scheme: light){:root{--bg:#f6f7f9;--fg:#14161a;--muted:#5b6370;--card:#fff;--accent:#0a8f5a;--line:#e3e6ea}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header,main,footer{max-width:1100px;margin:0 auto;padding:16px}
h1{font-size:clamp(1.6rem,4vw,2.4rem);margin:.4em 0 .1em}h2{margin-top:1.6em}
.sub{color:var(--muted);margin:0}.stat{display:inline-block;margin-top:12px;padding:6px 12px;border:1px solid var(--line);border-radius:999px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}.body{padding:12px 14px 16px;display:flex;flex-direction:column;gap:4px;flex:1}
.store{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}h3{margin:0;font-size:1.05rem}
.price,.date{margin:0;color:var(--muted);font-size:.9rem}.price b{color:var(--accent)}
.btn{margin-top:auto;align-self:flex-start;background:var(--accent);color:#06130d;text-decoration:none;font-weight:600;padding:8px 14px;border-radius:8px}
.promo{margin-top:24px;padding:12px;border:1px dashed var(--line);border-radius:10px;color:var(--muted)}.promo a{color:var(--accent)}
footer{color:var(--muted);font-size:.85rem}footer a{color:inherit}
</style>
</head>
<body>
<header>
  <h1>Juegos gratis ahora mismo</h1>
  <p class="sub">Epic Games Store, Steam, GOG, Ubisoft e itch.io · actualizado ${esc(fmtDate(generatedAt))}</p>
  <span class="stat">${active.length} juegos gratis${total > 0 ? ` · valor aprox. ${Math.round(total)} €/$` : ''}</span>
  ${tgLink ? `<p><a class="btn" href="${esc(tgLink)}">Avisos al instante en Telegram</a></p>` : ''}
</header>
<main>
  <h2>Gratis hoy</h2>
  <section class="grid">${active.map(card).join('') || '<p>Ahora mismo no hay juegos gratis. Vuelve en unas horas.</p>'}</section>
  ${upcoming.length ? `<h2>Próximamente gratis</h2><section class="grid">${upcoming.map(card).join('')}</section>` : ''}
  ${promo}
</main>
<footer>
  <p>Datos: Epic Games Store y <a href="https://www.gamerpower.com" rel="noopener">GamerPower</a>. Web no afiliada a ninguna tienda. Comprueba siempre las condiciones en la tienda antes de canjear.</p>
</footer>
</body>
</html>
`;
}

async function collect() {
    const now = new Date();
    const lists = [];
    const errors = [];
    try { lists.push(await fetchEpic({ country: CONFIG.country, locale: CONFIG.locale, now })); } catch (e) { errors.push(`epic: ${e.message}`); }
    try { lists.push(await fetchGamerPower({ platforms: CONFIG.platforms, types: ['game'], now })); } catch (e) { errors.push(`gamerpower: ${e.message}`); }
    if (!lists.length) throw new Error(`Todas las fuentes fallaron: ${errors.join(' | ')}`);
    if (errors.length) console.warn('Fuentes con error:', errors.join(' | '));
    const candidates = filterItems(mergeItems(lists), { includeUpcoming: true, includeDlc: false, minWorth: CONFIG.minWorth });
    const { ok, rejected } = await verifyItems(candidates);
    for (const r of rejected) console.log(`Descartado "${r.title}": ${r.reason}`);
    console.log(`Verificados ${ok.length} de ${candidates.length} juegos.`);
    return ok;
}

async function run({ items: injected } = {}) {
    const items = injected || (await collect());
    const state = loadState();
    const seen = new Set(state.seen);
    const fresh = items.filter((g) => !seen.has(`${g.id}|${g.status}`));
    const canPost = !CONFIG.dryRun && CONFIG.telegramToken && CONFIG.telegramChat;
    console.log(`${items.length} juegos, ${fresh.length} nuevos. Telegram: ${canPost ? 'sí' : 'no (falta token/chat o DRY_RUN)'}`);

    let posted = 0;
    for (const g of fresh.slice(0, CONFIG.maxPostsPerRun)) {
        const withPromo = (state.posts + 1) % CONFIG.promoEvery === 0;
        const caption = buildCaption(g, { withPromo });
        try {
            if (canPost) await postTelegram(g, caption);
            if (canPost && CONFIG.ownerChat && g.source !== 'epic' && g.store !== 'Epic Games Store' && g.status === 'active' && (!g.startDate || Date.parse(g.startDate) > Date.now() - 7 * 864e5)) {
                try {
                    if (g.image) {
                        try {
                            await tg('sendPhoto', { chat_id: CONFIG.ownerChat, photo: g.image, caption: `🖼 Imagen para el chollo de ${g.title}: mantén pulsado → Guardar` });
                        } catch (err) {
                            await tg('sendMessage', { chat_id: CONFIG.ownerChat, text: `🖼 Imagen: ${g.image}`, disable_web_page_preview: false });
                        }
                    }
                    await tg('sendMessage', { chat_id: CONFIG.ownerChat, text: buildDealDraft(g), parse_mode: 'HTML', disable_web_page_preview: true });
                } catch (err) {
                    console.warn(`No se pudo enviar el borrador privado: ${err.message}`);
                }
            }
            if (!CONFIG.dryRun && CONFIG.discordWebhook) await postDiscord(g);
            if (!canPost) console.log('--- (simulado)\n' + caption.replace(/<[^>]+>/g, ''));
            seen.add(`${g.id}|${g.status}`);
            state.posts += 1;
            state.history.push({ at: new Date().toISOString(), title: g.title, store: g.store, status: g.status });
            posted += 1;
            await new Promise((r) => setTimeout(r, 1500)); // respeta límites de Telegram
        } catch (err) {
            console.error(`No se pudo publicar "${g.title}": ${err.message}`);
        }
    }

    state.seen = [...seen];
    state.lastRun = new Date().toISOString();
    saveState(state);
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), renderSite(items, state.lastRun));
    fs.writeFileSync(path.join(DOCS_DIR, 'juegos.json'), JSON.stringify({ updated: state.lastRun, items }, null, 2));
    console.log(`Publicados: ${posted}. Web regenerada en docs/.`);
    return { posted, fresh: fresh.length };
}

if (require.main === module) {
    run().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { run, buildCaption, buildDealDraft, renderSite, CONFIG };
