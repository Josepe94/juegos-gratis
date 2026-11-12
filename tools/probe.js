const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = async (u) => { const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9' } }); return [r.status, await r.text()]; };
(async () => {
  const [s, t] = await get('https://www.app-sales.net/nowfree/');
  const flat = t.replace(/\s+/g, ' ');
  const i = flat.indexOf('id=san.si');
  console.log('NOWFREE status', s, '\nBLOCK:', flat.slice(Math.max(0, i - 2500), i + 600));
  const ids = [...new Set((t.match(/details\?id=([\w.]+)/g) || []).map((x) => x.split('=')[1]))].filter((x) => x !== 'net.tsapps.appsales');
  console.log('IDS', ids.length, ids.slice(0, 30));
  for (const id of ids.slice(0, 3)) {
    const [ps, p] = await get(`https://play.google.com/store/apps/details?id=${id}&hl=es&gl=ES`);
    const ld = p.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    console.log(`\n=== ${id} status=${ps}\nLD: ${ld ? ld[1].slice(0, 700) : 'none'}`);
    console.log('PRICE ARRAYS:', (p.match(/\[\[\d+,"EUR","[^"]*"\]\][^\]]{0,200}/g) || []).slice(0, 4));
    console.log('STRIKE:', (p.match(/.{80}(?:<s>|text-decoration: line-through|aria-label="[^"]*precio[^"]*").{120}/gi) || []).slice(0, 4));
    console.log('EURO:', (p.match(/.{50}\d+,\d\d\s?€.{50}/g) || []).slice(0, 6));
  }
})();
