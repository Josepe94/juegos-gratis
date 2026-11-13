// Ejecuta los canales temáticos indicados (por defecto, todos). Un fallo en uno no para a los demás.
//   node nichos/run.js                 -> todos
//   node nichos/run.js oposiciones     -> solo uno
// Activos. Desactivados el 13/11/2026 para centrar esfuerzos: 'vuelos' (las low cost no pagan comisión) y 'super'.
// Para reactivarlos, añádelos de nuevo a esta lista (el código sigue en nichos/).
const ALL = ['oposiciones', 'moda'];
(async () => {
    const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
    let failed = 0;
    for (const name of wanted) {
        let mod;
        try {
            mod = require(`./${name}`);
        } catch (err) {
            if (err.code === 'MODULE_NOT_FOUND' && err.message.includes(`./${name}`)) continue;
            throw err;
        }
        try {
            await mod.run();
        } catch (err) {
            failed += 1;
            console.error(`[${name}] ERROR: ${err.stack || err.message}`);
        }
    }
    if (failed === wanted.length) process.exit(1);
})();
