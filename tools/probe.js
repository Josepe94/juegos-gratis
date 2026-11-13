const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = async (u, accept = '*/*') => { try { const r = await fetch(u, { headers: { 'user-agent': UA, accept, 'accept-language': 'es-ES,es;q=0.9' } }); return [r.status, await r.text(), r.headers.get('content-type')]; } catch (e) { return [0, 'ERR ' + e.message, '']; } };
const show = (u, s, t, ct, n = 1500) => console.log(`\n##### ${u}\nstatus=${s} type=${ct} len=${t.length}\n${t.replace(/\s+/g, ' ').slice(0, n)}`);
(async () => {
  const d = new Date(Date.now() - 864e5); const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  for (const [u, a, n] of [
    [`https://www.boe.es/datosabiertos/api/boe/sumario/${ymd}`, 'application/json', 3000],
    ['https://www.borm.es/services/boletin/ultimo', 'application/json', 1500],
    ['https://www.borm.es/#/home/sumario', 'text/html', 600],
    ['https://www.borm.es/rss/boletin.xml', '*/*', 1500],
    ['https://www.borm.es/services/rss/boletin', '*/*', 1500],
    ['https://www.borm.es/robots.txt', '*/*', 600],
    ['https://tienda.mercadona.es/api/categories/', 'application/json', 600],
    ['https://tienda.mercadona.es/robots.txt', '*/*', 800],
    ['https://www.dia.es/robots.txt', '*/*', 800],
    ['https://www.lidl.es/robots.txt', '*/*', 800],
    ['https://www.carrefour.es/robots.txt', '*/*', 800],
    ['https://www.awin.com/es', 'text/html', 200],
  ]) { const [s, t, ct] = await get(u, a); show(u, s, t, ct, n); }
})();
