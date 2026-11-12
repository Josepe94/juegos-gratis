// Pruebas del filtro de seguridad con respuestas simuladas (sin red).
const assert = require('assert');
const { verifyItems, trustedStore, cleanUrl } = require('../src/verify');

const responses = {
  'https://www.gamerpower.com/open/1': { url: 'https://store.steampowered.com/app/111/Good_Game/?snr=1_5', status: 200 },
  'https://store.steampowered.com/api/appdetails?appids=111&cc=es&filters=price_overview,basic': { status: 200, json: { 111: { success: true, data: { is_free: false, price_overview: { initial: 999, final: 0, discount_percent: 100 } } } } },
  'https://www.gamerpower.com/open/2': { url: 'https://store.steampowered.com/app/222/Not_Free/', status: 200 },
  'https://store.steampowered.com/api/appdetails?appids=222&cc=es&filters=price_overview,basic': { status: 200, json: { 222: { success: true, data: { is_free: false, price_overview: { initial: 999, final: 999, discount_percent: 0 } } } } },
  'https://www.gamerpower.com/open/3': { url: 'https://www.randomkeysite.example/giveaway', status: 200 },
  'https://www.gamerpower.com/open/4': { url: 'https://freebies.indiegala.com/leaper', status: 200 },
  'https://www.gamerpower.com/open/5': { url: 'https://www.gog.com/en/game/gone', status: 404 },
  'https://www.gamerpower.com/open/6': { throws: true },
  'https://www.gamerpower.com/open/7': { url: 'https://someone.itch.io/cool-game', status: 200 },
  'https://www.gamerpower.com/open/8': { url: 'https://www.gamerpower.com/open/8', status: 200, html: '<html><head><meta http-equiv="refresh" content="0;url=https://www.gog.com/en/game/real_game"></head></html>' },
  'https://www.gog.com/en/game/real_game': { status: 200 },
  'https://www.gamerpower.com/open/9': { url: 'https://www.gamerpower.com/open/9', status: 200, html: '<html><a href="https://shady.example/x">x</a></html>' },
};

const fakeFetch = async (url) => {
  const r = responses[url];
  if (!r || r.throws) throw new Error('network down');
  return { url: r.url || url, status: r.status, ok: r.status < 400, json: async () => r.json, text: async () => r.html || '' };
};

const item = (id, title) => ({ id: `gp:${id}`, source: 'gamerpower', title, store: 'Other', url: `https://www.gamerpower.com/open/${id}` });
const items = [
  { id: 'epic:1', source: 'epic', title: 'Flotsam', store: 'Epic Games Store', url: 'https://store.epicgames.com/es-ES/p/flotsam' },
  item(1, 'Good Game'), item(2, 'Not Free'), item(3, 'Shady Key'), item(4, 'Leaper'), item(5, 'Gone'), item(6, 'Offline'), item(7, 'Itch Game'), item(8, 'Meta Redirect'), item(9, 'Shady Page'),
];

(async () => {
  const { ok, rejected } = await verifyItems(items, { fetchImpl: fakeFetch });
  assert.deepStrictEqual(ok.map((i) => i.title), ['Flotsam', 'Good Game', 'Leaper', 'Itch Game', 'Meta Redirect']);
  assert.strictEqual(ok[1].store, 'Steam');
  assert.strictEqual(ok[1].url, 'https://store.steampowered.com/app/111/Good_Game/', 'tracking param removed');
  assert.strictEqual(ok[2].store, 'IndieGala');
  assert.strictEqual(ok[3].store, 'itch.io');
  const why = Object.fromEntries(rejected.map((r) => [r.title, r.reason]));
  assert.match(why['Not Free'], /Steam no confirma/);
  assert.match(why['Shady Key'], /no es una tienda oficial/);
  assert.match(why['Gone'], /error 404/);
  assert.match(why['Offline'], /no responde/);
  assert.match(why['Shady Page'], /no es una tienda oficial/);
  assert.strictEqual(ok[4].store, 'GOG');
  assert.strictEqual(trustedStore('https://evil.com/store.steampowered.com'), null);
  assert.strictEqual(trustedStore('https://store.steampowered.com.evil.com/'), null);
  assert.strictEqual(cleanUrl('https://www.gog.com/x?utm_source=a&id=3'), 'https://www.gog.com/x?id=3');
  console.log('Verify tests passed:', rejected.map((r) => `${r.title} → ${r.reason}`).join(' | '));
})().catch((e) => { console.error(e); process.exit(1); });
