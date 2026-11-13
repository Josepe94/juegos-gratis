const assert = require('assert');
const s = require('../super');
const prod = (id, name, brand, price, strike, cat, extra = {}) => ({ objectID: id, name, brandName: brand, isAvailable: true, isRecall: false, hierarchicalCategories: { lvl0: [cat] },
  currentPrice: { priceValue: price, ...(strike ? { strikePrice: { strikePriceValue: strike } } : {}), basePrice: [{ basePriceValue: price * 2, basePriceScale: 'kg' }], priceTagLabels: { promoText1: extra.promo || '-25%' }, validFrom: 1794524400, validUntil: 1794783599 }, ...extra });
const map = { a: prod('a', 'Caldo casero de pollo', 'GALLINA BLANCA®', 1.14, 2.29, 'Despensa', { promo: '2ª ud al -50%' }), b: prod('b', 'Cerveza', 'SAN MIGUEL®', 0.55, 0.74, 'Bebidas'), c: prod('c', 'Manzana', '', 1.99, null, 'Frutas'),
  d: prod('d', 'Aceite', 'X', 5, 5.5, 'Despensa'), e: prod('e', 'Detergente', 'Y', 4, 8, 'Droguería'), f: prod('f', 'Retirado', 'Z', 1, 3, 'Despensa', { isRecall: true }) };
const apiData = JSON.stringify([['OFFER_GET', { req: { week: 'current' }, res: { algoliaDataMap: map } }], ['OTHER', {}]]);
const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page: { x: 1 }, apiData } } })}</script></html>`;
const products = s.parseAldi(html);
assert.strictEqual(products.length, 6);
const top = s.selectTop(products);
assert.deepStrictEqual(top.map((p) => p.id), ['a', 'e', 'b'], 'sorted by discount, no recall, no <20%');
assert.strictEqual(top[0].discount, 50);
const d = s.buildDigest(top);
assert.ok(d.includes('Gallina Blanca'.toUpperCase()) && d.includes('2ª ud al -50%') && d.includes('(−50%)'));
console.log('Super tests passed\n' + d.replace(/<[^>]+>/g, ''));
