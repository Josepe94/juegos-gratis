// Prueba offline: simula una ejecución con datos de ejemplo (no publica nada).
process.env.DRY_RUN = '1';
process.env.PROMO_URL = 'https://example.com/afiliado';
process.env.PROMO_EVERY = '2';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const statePath = path.join(__dirname, '..', 'state.json');
const backup = fs.existsSync(statePath) ? fs.readFileSync(statePath) : null;
if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

const { run, buildCaption } = require('../src/bot');

const items = [
    { id: 'epic:1', source: 'epic', store: 'Epic Games Store', title: 'Flotsam <test>', url: 'https://store.epicgames.com/es-ES/p/flotsam', image: null, originalPrice: 24.99, currency: 'EUR', type: 'game', status: 'active', startDate: '2026-11-05T16:00:00Z', endDate: '2026-11-12T16:00:00Z' },
    { id: 'gamerpower:9', source: 'gamerpower', store: 'Steam', title: 'Cool Shooter', url: 'https://gp/open/9', image: null, originalPrice: 14.99, currency: 'USD', type: 'game', status: 'active', startDate: null, endDate: '2026-11-20T23:59:00Z' },
    { id: 'epic:2', source: 'epic', store: 'Epic Games Store', title: 'Next Game', url: 'https://store.epicgames.com/es-ES/p/next', image: null, originalPrice: 19.99, currency: 'EUR', type: 'game', status: 'upcoming', startDate: '2026-11-12T16:00:00Z', endDate: '2026-11-19T16:00:00Z' },
];

(async () => {
    const cap = buildCaption(items[0], { withPromo: false });
    assert.ok(cap.includes('Flotsam &lt;test&gt;'), 'HTML escaped');
    assert.ok(cap.length <= 1024);
    const r1 = await run({ items });
    assert.strictEqual(r1.posted, 3);
    const r2 = await run({ items });
    assert.strictEqual(r2.fresh, 0, 'second run posts nothing new');
    const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
    assert.ok(html.includes('Próximamente gratis') && html.includes('Cool Shooter'));
    console.log('Bot tests passed');
    // restaurar
    fs.unlinkSync(statePath);
    if (backup) fs.writeFileSync(statePath, backup);
})().catch((e) => { console.error(e); process.exit(1); });
