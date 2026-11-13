const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
(async () => {
  const r = await fetch('https://www.aldi.es/ofertas.html', { headers: { 'user-agent': UA, 'accept-language': 'es-ES' } });
  const t = (await r.text()).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const i = t.indexOf('basePriceValue');
  console.log('CTX1', t.slice(Math.max(0, i - 2500), i + 700));
  const j = t.indexOf('basePriceValue', i + 3000);
  console.log('\nCTX2', t.slice(Math.max(0, j - 1500), j + 400));
  console.log('\nCOUNT basePriceValue', (t.match(/basePriceValue/g) || []).length, 'productName', (t.match(/"productName"/g) || []).length);
})();
