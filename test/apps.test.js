const assert = require('assert');
const { parseNowFree, parsePlayPage, qualityFilter, fetchAndroidFreebies } = require('../src/apps');

const nowfree = `<a class="playlink" href='https://play.google.com/store/apps/details?id=net.tsapps.appsales&utm_source=x'>
<div class="sale-list-action"><a class="waves-effect" href="https://play.google.com/store/apps/details?id=good.app">View</a></div>
<div class="sale-list-action"><a class="waves-effect" href="https://play.google.com/store/apps/details?id=junk.app">View</a></div>
<div class="sale-list-action"><a class="waves-effect" href="https://play.google.com/store/apps/details?id=always.free">View</a></div>
<div class="sale-list-action"><a class="waves-effect" href="https://play.google.com/store/apps/details?id=good.app">View</a></div>`;
assert.deepStrictEqual(parseNowFree(nowfree), ['good.app', 'junk.app', 'always.free']);

const page = (name, price, before, rating, count, cat = 'PRODUCTIVITY', dev = 'Dev A') => `<script type="application/ld+json" nonce="x">${JSON.stringify({
  '@type': 'SoftwareApplication', name, applicationCategory: cat, image: 'https://play-lh/x', author: { name: dev },
  ...(rating ? { aggregateRating: { ratingValue: String(rating), ratingCount: String(count) } } : {}),
  offers: [{ '@type': 'Offer', price: String(price), priceCurrency: 'EUR' }] })}</script>
${before ? `<button aria-label="Antes ${before} € y ahora Descargar">` : '<button aria-label="Instalar">'}
<span><s>9,99 €</s></span><span>0,00 €</span>`;

const good = parsePlayPage('good.app', page('Good App', 0, '3,09', 4.6, 1520));
assert.strictEqual(good.originalPrice, 3.09);
assert.strictEqual(good.rating, 4.6);
assert.strictEqual(good.type, 'app');
assert.strictEqual(good.url, 'https://play.google.com/store/apps/details?id=good.app');
assert.strictEqual(parsePlayPage('x', page('Paid', 2.99, null, 4.5, 900)), null, 'still paid in Spain');
assert.strictEqual(parsePlayPage('x', page('Always free', 0, null, 4.5, 900)), null, 'free forever is not a giveaway');
assert.strictEqual(parsePlayPage('x', page('Game', 0, '1.234,50', 4.5, 900, 'GAME_PUZZLE')).originalPrice, 1234.5);
assert.strictEqual(parsePlayPage('x', page('Game', 0, '1,99', 4.5, 900, 'GAME_PUZZLE')).type, 'mobilegame');

const mk = (t, r, c, p, dev) => ({ ...good, title: t, rating: r, ratingCount: c, originalPrice: p, developer: dev });
const q = qualityFilter([mk('Low rating', 3.2, 5000, 2, 'D1'), mk('Few reviews', 4.8, 12, 2, 'D2'), mk('Cheap', 4.5, 900, 0.5, 'D3'),
  mk('Best', 4.7, 3000, 4.99, 'D4'), mk('Clone', 4.6, 800, 1.99, 'D4'), mk('Other', 4.2, 300, 1.49, 'D5')]);
assert.deepStrictEqual(q.ok.map((a) => a.title), ['Best', 'Other']);
assert.strictEqual(q.rejected.length, 4);

(async () => {
  const pages = { 'good.app': page('Good App', 0, '3,09', 4.6, 1520), 'junk.app': page('Junk', 0, '0,99', 0, 0), 'always.free': page('Free', 0, null, 4.5, 900) };
  const fakeFetch = async (url) => {
    if (url.includes('app-sales')) return { status: 200, text: async () => nowfree };
    const id = url.match(/id=([\w.]+)/)[1];
    return { status: 200, text: async () => pages[id] };
  };
  const r = await fetchAndroidFreebies({ fetchImpl: fakeFetch });
  assert.deepStrictEqual(r.items.map((a) => a.title), ['Good App']);
  console.log('Apps tests passed. Rechazadas:', r.rejected.map((x) => `${x.title} → ${x.reason}`).join(' | '));
})().catch((e) => { console.error(e); process.exit(1); });
