const assert = require('assert');
const zlib = require('zlib');
const m = require('../moda');

// CSV con comillas, comas y saltos de línea
const rows = [];
const p = m.createCsvParser((r) => rows.push(r));
p.write('a,b,c\n1,"hola, ""mundo""",3\n2,"línea\npartida",4\r\n');
p.end();
assert.deepStrictEqual(rows, [['a', 'b', 'c'], ['1', 'hola, "mundo"', '3'], ['2', 'línea\npartida', '4']]);

// Normalización y lista blanca
const base = { aw_product_id: '1', product_name: 'Nike Air Max 90', brand_name: 'Nike', search_price: '119.99', rrp_price: '149.99', aw_deep_link: 'https://www.awin1.com/pclick.php?p=1', merchant_name: 'Tienda Oficial', in_stock: '1', 'Fashion:size': '42', currency: 'EUR' };
const n = m.normalize(base);
assert.strictEqual(n.price, 119.99); assert.strictEqual(n.brand, 'Nike'); assert.strictEqual(n.size, '42');
assert.strictEqual(m.normalize({ ...base, brand_name: 'Marca Rara', product_name: 'Zapatilla genérica' }), null, 'brand not whitelisted');
assert.strictEqual(m.normalize({ ...base, search_price: '9.99' }), null, 'too cheap');
assert.strictEqual(m.normalize({ ...base, in_stock: '0' }), null, 'out of stock');
assert.strictEqual(m.normalize({ ...base, brand_name: '', product_name: 'New Balance 9060 Grey' }).brand, 'New Balance');
assert.strictEqual(m.normalize({ ...base, search_price: '1.234,50' }).price, 1234.5);

// Histórico: 40 días a 120 €, 10 días a 110 €, hoy 89 € -> chollo (mínimo de 30 y 90 días, -25 %)
const today = 20000;
const hist = { 'Tienda Oficial|1': { first: today - 50, p: [[today - 50, 120], [today - 10, 110]], seen: today - 1 } };
const deals = m.processProducts([{ ...n, price: 89 }], hist, today);
assert.strictEqual(deals.length, 1);
assert.strictEqual(deals[0].ev.isMin90, true);
assert.strictEqual(deals[0].ev.dropPct, 26);
assert.deepStrictEqual(hist['Tienda Oficial|1'].p.slice(-1)[0], [today, 89]);

// Bajada pequeña (-5 %): no es chollo aunque sea mínimo
const h2 = { k: { first: today - 50, p: [[today - 50, 100]], seen: today - 1 } };
assert.strictEqual(m.processProducts([{ ...n, key: 'k', price: 95 }], h2, today).length, 0);
// Producto nuevo (sin histórico suficiente): nunca se publica
const h3 = {};
assert.strictEqual(m.processProducts([{ ...n, key: 'nuevo', price: 50 }], h3, today).length, 0);
assert.ok(h3.nuevo);
// "Rebaja" falsa: subió de precio la semana pasada y ahora vuelve al precio de siempre
const h4 = { k: { first: today - 60, p: [[today - 60, 80], [today - 7, 120]], seen: today - 1 } };
assert.strictEqual(m.processProducts([{ ...n, key: 'k', price: 80 }], h4, today).length, 0, 'inflated-then-discounted is not a deal');

// Lectura de un feed gzip simulado
(async () => {
  const csv = 'aw_product_id,product_name,brand_name,search_price,aw_deep_link,merchant_name,in_stock,currency\n1,Adidas Samba OG,adidas,99.95,https://x/1,Tienda,1,EUR\n2,Calcetines genéricos,Nada,30,https://x/2,Tienda,1,EUR\n';
  const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => zlib.gzipSync(csv) });
  const list = await m.readFeed('https://feed.example/x.csv.gz', { fetchImpl: fakeFetch });
  assert.deepStrictEqual(list.map((x) => x.name), ['Adidas Samba OG']);
  console.log('Moda tests passed\n' + m.buildPost({ ...n, price: 89 }, deals[0].ev).replace(/<[^>]+>/g, ''));
})().catch((e) => { console.error(e); process.exit(1); });
