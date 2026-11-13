// Utilidades comunes de los canales temáticos: estado, Telegram y modo vista previa.
const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, 'state');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const env = (k, d = '') => (process.env[k] ?? d).trim();

function loadState(name, fallback = {}) {
    try {
        return JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${name}.json`), 'utf8'));
    } catch {
        return JSON.parse(JSON.stringify(fallback));
    }
}

function saveState(name, state) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, `${name}.json`), JSON.stringify(state, null, 1) + '\n');
}

async function http(url, { as = 'text', timeoutMs = 30000, headers = {}, fetchImpl = fetch } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, { headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9', ...headers }, signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.replace(/token=[^&]+/, 'token=***')}`);
        return as === 'json' ? await res.json() : as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } finally {
        clearTimeout(t);
    }
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function tg(method, payload, token = env('TELEGRAM_BOT_TOKEN')) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`Telegram ${method}: ${res.status} ${body.description || ''}`);
    return body;
}

/**
 * Publicador de un canal temático.
 * - Con canal configurado: publica en el canal.
 * - Sin canal: manda como mucho `maxPreviews` vistas previas al dueño (en total) y no publica nada más.
 * - DRY_RUN=1: solo muestra por consola.
 */
function makePublisher({ name, label, channelVar, state, maxPreviews = 5 }) {
    const token = env('TELEGRAM_BOT_TOKEN');
    const channel = env(channelVar);
    const owner = env('OWNER_CHAT_ID');
    const dry = env('DRY_RUN') === '1' || !token;
    state.previews = state.previews || 0;
    const mode = dry ? 'simulación' : channel ? `canal ${channel}` : owner ? 'vista previa privada' : 'sin destino';

    async function send(html, { photo = null, preview = false } = {}) {
        if (dry) {
            console.log(`--- [${name}] (simulado)\n${html.replace(/<[^>]+>/g, '')}`);
            return true;
        }
        let chat = channel;
        let text = html;
        if (!chat) {
            if (!owner || state.previews >= maxPreviews) return false;
            chat = owner;
            state.previews += 1;
            text = `👀 <b>VISTA PREVIA · ${esc(label)}</b> (${state.previews}/${maxPreviews})\n<i>Así se publicará cuando crees el canal.</i>\n\n${html}`;
        }
        if (photo) {
            try {
                await tg('sendPhoto', { chat_id: chat, photo, caption: text.slice(0, 1024), parse_mode: 'HTML' });
                return true;
            } catch (err) {
                console.warn(`[${name}] sendPhoto falló (${err.message}); envío texto`);
            }
        }
        await tg('sendMessage', { chat_id: chat, text: text.slice(0, 4096), parse_mode: 'HTML', disable_web_page_preview: !preview });
        return true;
    }

    return { send, mode, hasChannel: Boolean(channel), dry };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fecha de hoy en Madrid como YYYY-MM-DD. */
function madridDate(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function fmtDateEs(isoDate) {
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
}

module.exports = { loadState, saveState, http, esc, tg, makePublisher, sleep, env, madridDate, fmtDateEs, UA };
