const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
(async () => {
  const r = await fetch('https://www.aldi.es/ofertas.html', { headers: { 'user-agent': UA, 'accept-language': 'es-ES' } });
  const t = await r.text();
  const m = t.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  console.log('NEXT_DATA', !!m, m ? m[1].length : 0);
  let found = 0;
  const seen = new Set();
  function walk(o, p, depth) {
    if (!o || typeof o !== 'object' || depth > 40) return;
    if (!Array.isArray(o)) {
      const keys = Object.keys(o);
      if (keys.some((k) => /price/i.test(k)) && keys.some((k) => /name|title/i.test(k)) && found < 3) {
        const sig = keys.sort().join(',');
        if (!seen.has(sig)) { seen.add(sig); found++; console.log('\nPATH', p, '\nKEYS', keys.join(','), '\nSAMPLE', JSON.stringify(o).slice(0, 1800)); }
      }
    }
    for (const [k, v] of Object.entries(o)) walk(typeof v === 'string' && v.startsWith('{') ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v, p + '.' + k, depth + 1);
  }
  if (m) walk(JSON.parse(m[1]), '$', 0);
  // también contar ofertas y ver estructura de fechas de validez
  console.log('\nVALID hints', (t.match(/.{60}(validFrom|validTo|startDate|endDate|desde el|hasta el).{60}/gi) || []).slice(0, 6));
})();
