const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
(async () => {
  for (const u of ['https://www.lidl.es/es/ofertas', 'https://www.lidl.es/c/ofertas-de-la-semana/a10008735', 'https://www.lidl.es/static/sitemap.xml', 'https://www.aldi.es/ofertas.html', 'https://www.aldi.es/robots.txt', 'https://www.carrefour.es/supermercado/ofertas', 'https://www.eroski.es/robots.txt', 'https://www.alcampo.es/robots.txt', 'https://www.consum.es/robots.txt']) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'es-ES' } });
      const t = await r.text();
      const flat = t.replace(/\s+/g, ' ');
      console.log(`\n##### ${u}\nstatus=${r.status} final=${r.url} len=${t.length}`);
      if (u.includes('robots') ) console.log(flat.slice(0, 700));
      else if (u.includes('sitemap')) console.log((t.match(/<loc>[^<]*(oferta|semana|c\/)[^<]*<\/loc>/gi) || []).slice(0, 20));
      else {
        console.log('TITLE', (flat.match(/<title>([^<]*)/) || [])[1]);
        console.log('JSON hints', (flat.match(/(__NEXT_DATA__|__NUXT__|data-grid-data|application\/ld\+json|"price"|data-price|product-grid)/g) || []).slice(0, 10));
        console.log('PRICES', (flat.match(/.{80}\d+,\d\d\s?€.{40}/g) || []).slice(0, 4));
      }
    } catch (e) { console.log(`\n##### ${u}\nERROR ${e.message}`); }
  }
})();
