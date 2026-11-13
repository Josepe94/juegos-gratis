// Canal "Oposiciones Región de Murcia": convocatorias, bolsas, listas y exámenes.
// Fuentes oficiales y públicas: API de datos abiertos del BOE (sumario diario) y RSS del BORM.
const { http, esc, makePublisher, loadState, saveState, madridDate, fmtDateEs, sleep } = require('./lib');

const NAME = 'oposiciones';
const LABEL = 'Oposiciones Región de Murcia';

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);

const MURCIA_RE = /\(Murcia\)|Regi[oó]n de Murcia|Universidad de Murcia|Universidad Polit[eé]cnica de Cartagena|Servicio Murciano de Salud|Comunidad Aut[oó]noma de la Regi[oó]n de Murcia/i;
const EXCLUDE_RE = /libre designaci[oó]n|concurso de traslados|concurso espec[ií]fico|concurso general de m[eé]ritos|provisi[oó]n de puestos|relaci[oó]n de puestos|\bRPT\b|nombramiento|cese\b|jubilaci[oó]n|comisi[oó]n de servicios|permuta|reingreso|compatibilidad|licitaci[oó]n|contrato|subvenci|premio|beca\b|catedr[aá]tic|profesor(?:es)? titular|cuerpos docentes universitarios/i;
const PERSONNEL_RE = /plaza|proceso selectivo|procesos selectivos|oposici[oó]n|concurso-oposici[oó]n|bolsa|lista de espera|oferta de empleo|empleo p[uú]blico|personal laboral|funcionari|estabilizaci[oó]n/i;

/** Tipo de anuncio (emoji + etiqueta) o null si no interesa a un opositor. */
function classify(text) {
    const t = String(text);
    if (EXCLUDE_RE.test(t)) return null;
    if (!PERSONNEL_RE.test(t) && !/admitidos|excluidos|aprobados|tribunal|ejercicio|examen/i.test(t)) return null;
    if (/lista[s]? (provisional|definitiva)?\s*(de )?(personas )?(admitid|excluid)|admitidos y excluidos|admitidas y excluidas/i.test(t)) return { emoji: '📋', label: 'Lista de admitidos' };
    if (/fecha|lugar y hora|celebraci[oó]n del (primer|segundo|tercer)? ?ejercicio|convoca a las personas aspirantes|calendario/i.test(t)) return { emoji: '📅', label: 'Fecha de examen' };
    if (/aprobad|calificaciones|puntuaciones|propuesta de nombramiento|superado/i.test(t)) return { emoji: '✅', label: 'Resultados' };
    if (/bolsa|lista de espera/i.test(t)) return { emoji: '🗂', label: 'Bolsa de empleo' };
    if (/oferta de empleo p[uú]blico/i.test(t)) return { emoji: '📢', label: 'Oferta de empleo público' };
    if (/convoca|bases|proceso selectivo|procesos selectivos|plaza/i.test(t)) return { emoji: '🆕', label: 'Convocatoria' };
    return null;
}

const NUM_WORDS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30 };

/** Nº de plazas y puesto a partir del título ("…para proveer dos plazas de Agente de Policía Local"). */
function extractPlazas(title) {
    const m = String(title).match(/\b(\d+|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|varias)\s+plazas?\s+de\s+([^.,;(]{3,90})/i);
    if (!m) return null;
    const n = m[1].toLowerCase() === 'varias' ? 'Varias' : NUM_WORDS[m[1].toLowerCase()] || Number(m[1]);
    const puesto = m[2].trim().replace(/\s+/g, ' ');
    return `${n} plaza${n === 1 ? '' : 's'} de ${puesto}`;
}

/** Organismo convocante a partir del título del BOE ("…del Ayuntamiento de Lorca (Murcia), referente…"). */
function extractEntity(title, fallback) {
    const m = String(title).match(/\b(?:del|de la)\s+((?:Ayuntamiento|Diputaci[oó]n|Universidad|Mancomunidad|Consejer[ií]a|Servicio|Consorcio|Cabildo|Instituto)[^,]*?)(?:,|\s+referente|\s+por la que|\s+sobre)/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : fallback;
}

const HOLIDAYS_MMDD = ['01-01', '01-06', '05-01', '06-09', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25'];

/** Fecha aproximada de fin de plazo contando desde el día siguiente a la publicación. */
function plazoEnd(pubIso, n, tipo) {
    const d = new Date(`${pubIso}T12:00:00Z`);
    let left = n;
    while (left > 0) {
        d.setUTCDate(d.getUTCDate() + 1);
        if (tipo === 'naturales') left -= 1;
        else {
            const wd = d.getUTCDay();
            const mmdd = d.toISOString().slice(5, 10);
            if (wd !== 0 && wd !== 6 && !HOLIDAYS_MMDD.includes(mmdd)) left -= 1;
        }
    }
    return d.toISOString().slice(0, 10);
}

/** Busca "plazo … de veinte días hábiles/naturales" en el texto de la disposición. */
function extractPlazo(text, pubIso) {
    const m = String(text).match(/plazo[^.]{0,120}?\b(\d+|diez|quince|veinte|treinta)\s+d[ií]as\s+(h[aá]biles|naturales)/i);
    if (!m) return null;
    const n = NUM_WORDS[m[1].toLowerCase()] || Number(m[1]);
    const tipo = /h[aá]biles/i.test(m[2]) ? 'hábiles' : 'naturales';
    return { n, tipo, end: pubIso ? plazoEnd(pubIso, n, tipo) : null };
}

/** Recorre el sumario JSON del BOE y devuelve los anuncios de "Oposiciones y concursos". */
function parseBoeSumario(json, pubIso) {
    const out = [];
    const diarios = arr(json && json.data && json.data.sumario && json.data.sumario.diario);
    for (const diario of diarios) {
        for (const sec of arr(diario.seccion)) {
            if (!/oposiciones y concursos/i.test(sec.nombre || '')) continue;
            for (const dep of arr(sec.departamento)) {
                const groups = [...arr(dep.epigrafe).map((e) => ({ epi: e.nombre, items: arr(e.item) })), { epi: null, items: arr(dep.item) }];
                for (const g of groups) {
                    for (const it of g.items) {
                        if (!it || !it.identificador) continue;
                        out.push({
                            id: `boe:${it.identificador}`,
                            source: 'BOE',
                            department: dep.nombre || '',
                            epigrafe: g.epi || '',
                            title: it.titulo || '',
                            url: it.url_html || `https://www.boe.es/diario_boe/txt.php?id=${it.identificador}`,
                            xml: it.url_xml || null,
                            date: pubIso,
                        });
                    }
                }
            }
        }
    }
    return out;
}

function selectBoe(items) {
    const out = [];
    for (const it of items) {
        const blob = `${it.department} ${it.title}`;
        const type = classify(it.title);
        if (!type) continue;
        const murcia = MURCIA_RE.test(blob);
        const national = !murcia && /convoca(n)? (el )?procesos? selectivos? para (el )?ingreso/i.test(it.title) && !/ADMINISTRACI[OÓ]N LOCAL|UNIVERSIDADES/i.test(it.department);
        if (!murcia && !national) continue;
        out.push({ ...it, type, scope: murcia ? 'murcia' : 'nacional', entity: murcia ? extractEntity(it.title, it.department) : it.department, plazas: extractPlazas(it.title) });
    }
    return out;
}

/** RSS del BORM → anuncios relevantes para opositores. */
function parseBormRss(xml) {
    const out = [];
    const items = String(xml).split('<item>').slice(1);
    const cdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    for (const raw of items) {
        const title = cdata((raw.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
        const link = cdata((raw.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
        const desc = cdata((raw.match(/<description>([\s\S]*?)<\/description>/) || [])[1]);
        const cats = [...raw.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) => cdata(m[1]));
        const pub = cdata((raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]);
        const cleanTitle = title.replace(/^\d+\s+/, '').replace(/\s*\(\d+ p[aá]gina\/s[^)]*\)\s*$/i, '').trim();
        const isPersonnelSection = cats.some((c) => /Autoridades y Personal/i.test(c));
        const type = classify(cleanTitle);
        if (!type) continue;
        if (!isPersonnelSection && !PERSONNEL_RE.test(cleanTitle)) continue;
        const d = pub ? new Date(pub) : new Date();
        out.push({
            id: `borm:${link}`,
            source: 'BORM',
            title: cleanTitle,
            url: link,
            entity: (desc.split(' - ').pop() || desc || 'Región de Murcia').trim(),
            type,
            scope: 'murcia',
            plazas: extractPlazas(cleanTitle),
            date: madridDate(d),
        });
    }
    return out;
}

function shorten(s, n = 260) {
    s = String(s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
}

function buildPost(a) {
    const lines = [`${a.type.emoji} <b>${esc(a.type.label)}</b>${a.scope === 'nacional' ? ' · 🇪🇸 Estatal' : ''}`, `🏛 <b>${esc(a.entity)}</b>`];
    if (a.plazas) lines.push(`👥 ${esc(a.plazas)}`);
    if (a.plazo) lines.push(`⏳ Plazo: ${a.plazo.n} días ${a.plazo.tipo}${a.plazo.end ? ` → hasta el <b>${fmtDateEs(a.plazo.end)}</b> (aprox.)` : ''}`);
    lines.push('', `<i>${esc(shorten(a.title))}</i>`, '', `📄 <a href="${esc(a.url)}">${a.source} del ${fmtDateEs(a.date)}</a>`);
    return lines.join('\n');
}

async function run({ fetchImpl = fetch } = {}) {
    const state = loadState(NAME, { seen: [], lastBoe: null });
    const pub = makePublisher({ name: NAME, label: LABEL, channelVar: 'OPOS_CHAT_ID', state });
    const seen = new Set(state.seen);
    const found = [];

    // BOE: hoy (y ayer, por si una ejecución se saltó)
    for (const offset of [1, 0]) {
        const day = madridDate(new Date(Date.now() - offset * 864e5));
        try {
            const json = await http(`https://www.boe.es/datosabiertos/api/boe/sumario/${day.replace(/-/g, '')}`, { as: 'json', headers: { accept: 'application/json' }, fetchImpl });
            const all = parseBoeSumario(json, day);
            if (process.env.DEBUG === '1') {
                const secs = arr(json && json.data && json.data.sumario && json.data.sumario.diario).flatMap((d) => arr(d.seccion).map((x) => `${x.codigo}:${x.nombre}`));
                console.log(`[debug] BOE ${day} secciones: ${secs.join(' | ')} · items oposiciones: ${all.length}`);
                for (const x of all.slice(0, 40)) console.log(`[debug] BOE ${x.department} :: ${x.title.slice(0, 170)}`);
            }
            found.push(...selectBoe(all));
        } catch (err) {
            if (!/HTTP 404/.test(err.message)) console.warn(`[${NAME}] BOE ${day}: ${err.message}`);
        }
    }
    try {
        const rss = await http('https://www.borm.es/rss/boletin.xml', { fetchImpl });
        if (process.env.DEBUG === '1') {
            for (const raw of rss.split('<item>').slice(1, 60)) {
                const t = (raw.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
                const c = [...raw.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) => m[1]).join(' / ');
                console.log(`[debug] BORM ${c.replace(/<!\[CDATA\[|\]\]>/g, '').slice(0, 80)} :: ${t.replace(/<!\[CDATA\[|\]\]>/g, '').slice(0, 150)}`);
            }
        }
        found.push(...parseBormRss(rss));
    } catch (err) {
        console.warn(`[${NAME}] BORM: ${err.message}`);
    }

    const fresh = found.filter((a) => !seen.has(a.id));
    console.log(`[${NAME}] ${found.length} anuncios relevantes, ${fresh.length} nuevos · destino: ${pub.mode}`);

    let sent = 0;
    for (const a of fresh) {
        if (a.source === 'BOE' && a.xml && a.type.label === 'Convocatoria') {
            try {
                const xml = await http(a.xml, { fetchImpl });
                a.plazo = extractPlazo(xml.replace(/<[^>]+>/g, ' '), a.date);
                if (!a.plazas) a.plazas = extractPlazas(xml.replace(/<[^>]+>/g, ' ').slice(0, 3000));
            } catch (err) {
                console.warn(`[${NAME}] texto ${a.id}: ${err.message}`);
            }
        }
        const ok = await pub.send(buildPost(a));
        seen.add(a.id); // se marca aunque no se envíe (vista previa agotada) para no inundar el canal al crearlo
        if (ok) sent += 1;
        await sleep(1200);
        if (sent >= 15) break; // tope por ejecución
    }
    state.seen = [...seen].slice(-3000);
    state.lastRun = new Date().toISOString();
    saveState(NAME, state);
    console.log(`[${NAME}] enviados: ${sent}`);
    return { found: found.length, fresh: fresh.length, sent };
}

module.exports = { run, classify, extractPlazas, extractEntity, extractPlazo, plazoEnd, parseBoeSumario, selectBoe, parseBormRss, buildPost };
