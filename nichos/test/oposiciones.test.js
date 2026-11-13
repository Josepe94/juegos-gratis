const assert = require('assert');
const o = require('../oposiciones');

// Clasificación
assert.strictEqual(o.classify('Resolución del Ayuntamiento de Lorca (Murcia), referente a la convocatoria para proveer dos plazas de Agente de Policía Local.').label, 'Convocatoria');
assert.strictEqual(o.classify('Anuncio de la lista provisional de admitidos y excluidos del proceso selectivo de Auxiliar Administrativo').label, 'Lista de admitidos');
assert.strictEqual(o.classify('Bases de la bolsa de trabajo de Técnico de Educación Infantil').label, 'Bolsa de empleo');
assert.strictEqual(o.classify('Resolución por la que se aprueba la oferta de empleo público para 2026').label, 'Oferta de empleo público');
assert.strictEqual(o.classify('Modificación de la relación de puestos de trabajo 3/2026'), null);
assert.strictEqual(o.classify('Resolución por la que se convoca concurso de traslados de funcionarios'), null);
assert.strictEqual(o.classify('Licitación del contrato de limpieza'), null);
assert.strictEqual(o.classify('Nombramiento de funcionarios de carrera'), null);

// Plazas y organismo
assert.strictEqual(o.extractPlazas('…para proveer dos plazas de Agente de Policía Local.'), '2 plazas de Agente de Policía Local');
assert.strictEqual(o.extractPlazas('…para proveer una plaza de Técnico de Administración General, mediante oposición'), '1 plaza de Técnico de Administración General');
assert.strictEqual(o.extractEntity('Resolución de 3 de noviembre de 2026, del Ayuntamiento de Lorca (Murcia), referente a la convocatoria', 'X'), 'Ayuntamiento de Lorca (Murcia)');

// Plazos: 20 hábiles desde el viernes 13/11/2026 -> lunes 16 cuenta como 1 ... (sin festivos) = 11/12/2026
assert.strictEqual(o.plazoEnd('2026-11-13', 20, 'hábiles'), '2026-12-14', 'skips 6 and 8 Dec holidays');
assert.strictEqual(o.plazoEnd('2026-11-13', 20, 'naturales'), '2026-12-03');
const p = o.extractPlazo('El plazo de presentación de solicitudes será de veinte días hábiles contados a partir del siguiente', '2026-11-13');
assert.deepStrictEqual([p.n, p.tipo], [20, 'hábiles']);

// Sumario BOE (estructura real: arrays u objetos sueltos)
const boe = { data: { sumario: { diario: [{ seccion: [
  { nombre: 'I. Disposiciones generales', departamento: [] },
  { nombre: 'II. Autoridades y personal. - B. Oposiciones y concursos', departamento: [
    { nombre: 'ADMINISTRACIÓN LOCAL', epigrafe: { nombre: 'Personal funcionario y laboral', item: [
      { identificador: 'BOE-A-1', titulo: 'Resolución de 3 de noviembre de 2026, del Ayuntamiento de Lorca (Murcia), referente a la convocatoria para proveer dos plazas de Agente de Policía Local.', url_html: 'https://boe/1', url_xml: 'https://boe/1.xml' },
      { identificador: 'BOE-A-2', titulo: 'Resolución de 3 de noviembre de 2026, del Ayuntamiento de Vigo (Pontevedra), referente a la convocatoria para proveer una plaza de Bombero.', url_html: 'https://boe/2' } ] } },
    { nombre: 'MINISTERIO DE HACIENDA', item: { identificador: 'BOE-A-3', titulo: 'Resolución de 5 de noviembre de 2026, de la Subsecretaría, por la que se convocan procesos selectivos para ingreso en el Cuerpo de Gestión de la Hacienda Pública.', url_html: 'https://boe/3' } },
    { nombre: 'UNIVERSIDADES', item: { identificador: 'BOE-A-4', titulo: 'Resolución de la Universidad de Murcia, por la que se convoca concurso de acceso a plazas de cuerpos docentes universitarios.', url_html: 'https://boe/4' } },
  ] } ] }] } } };
const sel = o.selectBoe(o.parseBoeSumario(boe, '2026-11-13'));
assert.deepStrictEqual(sel.map((x) => [x.id, x.scope]), [['boe:BOE-A-1', 'murcia'], ['boe:BOE-A-3', 'nacional']]);
assert.strictEqual(sel[0].plazas, '2 plazas de Agente de Policía Local');
assert.strictEqual(sel[0].entity, 'Ayuntamiento de Lorca (Murcia)');

// RSS BORM
const rss = `<rss><channel><title>x</title>
<item><title><![CDATA[5578 Anuncio de la Resolución del Rector de la Universidad de Murcia referente a la modificación de la relación de puestos de trabajo 3/2026. (1 página/s - 811.78KB)]]></title><link><![CDATA[https://www.borm.es/services/anuncio/846260/pdf]]></link><description><![CDATA[Consejería X - Universidad de Murcia]]></description><pubDate><![CDATA[Fri, 13 Nov 2026 00:00:00 +0100]]></pubDate><category><![CDATA[I2. Autoridades y Personal]]></category></item>
<item><title><![CDATA[5590 Anuncio de las bases de la convocatoria para la provisión de tres plazas de Auxiliar Administrativo, mediante concurso-oposición. (12 página/s - 300KB)]]></title><link><![CDATA[https://www.borm.es/services/anuncio/846300/pdf]]></link><description><![CDATA[Administración Local - Ayuntamiento de Cieza]]></description><pubDate><![CDATA[Fri, 13 Nov 2026 00:00:00 +0100]]></pubDate><category><![CDATA[V. Administración Local]]></category></item>
<item><title><![CDATA[5600 Licitación del contrato de suministro de vehículos. (2 página/s - 1KB)]]></title><link><![CDATA[https://www.borm.es/services/anuncio/846400/pdf]]></link><description><![CDATA[Ayuntamiento de Murcia]]></description><pubDate><![CDATA[Fri, 13 Nov 2026 00:00:00 +0100]]></pubDate><category><![CDATA[V. Administración Local]]></category></item>
</channel></rss>`;
const b = o.parseBormRss(rss);
assert.strictEqual(b.length, 1);
assert.strictEqual(b[0].entity, 'Ayuntamiento de Cieza');
assert.strictEqual(b[0].plazas, '3 plazas de Auxiliar Administrativo');
assert.strictEqual(b[0].date, '2026-11-13');
const post = o.buildPost({ ...sel[0], plazo: { n: 20, tipo: 'hábiles', end: '2026-12-14' } });
assert.ok(post.includes('14/12/2026') && post.includes('Ayuntamiento de Lorca'));
console.log('Oposiciones tests passed\n' + post.replace(/<[^>]+>/g, ''));
