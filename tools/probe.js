// Diagnóstico temporal: comprueba qué fuentes de apps gratis responden desde GitHub Actions.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const urls = [
  'https://appshunter.io/api/ios/applications?discounted=true&sort=BIGGEST_DISCOUNT&per-page=3',
  'https://appshunter.io/api/android/applications?discounted=true&sort=BIGGEST_DISCOUNT&per-page=3',
  'https://appshunter.io/ios/topics/apps-gone-free',
  'https://www.app-sales.net/nowfree/',
  'https://itunes.apple.com/lookup?id=916366645&country=es',
  'https://play.google.com/store/apps/details?id=com.mojang.minecraftpe&hl=es&gl=ES',
];
(async () => {
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9' } });
      const t = await r.text();
      console.log(`\n##### ${u}\nstatus=${r.status} final=${r.url} len=${t.length}`);
      if (u.includes('play.google')) {
        const ld = t.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
        console.log('LDJSON:', ld ? ld[1].slice(0, 800) : 'none');
        console.log('EURO snippets:', (t.match(/.{60}\d+,\d\d\s?€.{60}/g) || []).slice(0, 5));
      } else if (u.includes('app-sales')) {
        console.log((t.match(/play\.google\.com\/store\/apps\/details\?id=[\w.]+/g) || []).slice(0, 10));
        const i = t.indexOf('nowfree'); console.log(t.replace(/\s+/g, ' ').slice(0, 1500));
      } else if (u.includes('/topics/')) {
        console.log((t.match(/apps\.apple\.com\/[^"'\s]+/g) || []).slice(0, 10));
        console.log(t.replace(/\s+/g, ' ').slice(0, 800));
      } else {
        console.log(t.slice(0, 2500));
      }
    } catch (e) { console.log(`\n##### ${u}\nERROR ${e.message}`); }
  }
})();
