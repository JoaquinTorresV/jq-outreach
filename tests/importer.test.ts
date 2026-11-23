import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseFile, autoMap, buildDrafts } from '../src/lib/importer';

const C = ['CL', 'CO'];
async function run(content: string | Buffer, name: string) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const t = await parseFile(buf, name, { countries: C });
  const m = autoMap(t, C);
  return { t, m, b: buildDrafts(t, m, { countries: C }) };
}

test('CSV completo con encabezados en español', async () => {
  const { m, b } = await run(
    'Nombre,Negocio,Teléfono,Dirección,Instagram\nMaría Pérez,Peluquería Lucía,+56 9 8765 4321,Av. Libertad 123 Viña,@pelu_lucia\nJuan,,976543210,,\n',
    'a.csv',
  );
  assert.deepEqual(m, ['name', 'business_name', 'phone', 'address', 'instagram']);
  assert.equal(b.drafts.length, 2);
  assert.equal(b.drafts[0].first_name, 'María');
  assert.equal(b.drafts[0].business_name, 'Peluquería Lucía');
  assert.equal(b.drafts[1].phone, '+56976543210');
  assert.equal(b.drafts[1].business_name, null);
});

test('separador ; y columna "nombre" que en realidad es negocio', async () => {
  const { b } = await run('Nombre;Celular;Redes sociales\nClínica Dental Sonríe SpA;987654321;https://instagram.com/sonrie.cl facebook.com/sonrie\n', 'b.csv');
  assert.equal(b.drafts[0].name, null);
  assert.equal(b.drafts[0].business_name, 'Clínica Dental Sonríe SpA');
  assert.equal(b.drafts[0].instagram, '@sonrie.cl');
  assert.match(b.drafts[0].facebook ?? '', /facebook\.com/);
});

test('sin encabezados: detecta teléfono por contenido', async () => {
  const { t, m, b } = await run('Ferretería Don Lucho,+56 9 7654 3210\nTaller Los Amigos,941234567\n', 'c.csv');
  assert.equal(t.hasHeader, false);
  assert.ok(m.includes('phone'));
  assert.equal(b.drafts.length, 2);
  assert.equal(b.drafts[0].business_name, 'Ferretería Don Lucho');
});

test('sin encabezados: conserva teléfonos fijos para revisión manual', async () => {
  const { t, b } = await run('Clínica Veterinaria,+56 2 2731 5397\n', 'fixed.csv');
  assert.equal(t.hasHeader, false);
  assert.equal(b.drafts.length, 1);
  assert.equal(b.drafts[0].stage, 'revision');
  assert.equal(b.drafts[0].stage_reason, 'telefono_fijo');
});

test('TXT de una sola columna: "Nombre teléfono" y solo números', async () => {
  const a = await run('Juan Pérez 987654321\nAna Soto +56 9 5876 5432\nsolo texto\n', 'd.txt');
  assert.equal(a.b.drafts.length, 2);
  assert.equal(a.b.drafts[0].first_name, 'Juan');
  assert.equal(a.b.rejected.length, 1);
  const b = await run('987654321\n976543210\n', 'e.txt');
  assert.equal(b.b.drafts.length, 2);
});

test('duplicados dentro del archivo se fusionan y se reportan', async () => {
  const { b } = await run('Nombre,Teléfono,Email\nAna,987654321,\nAna Soto,+56 9 8765 4321,ana@x.cl\n', 'f.csv');
  assert.equal(b.drafts.length, 1);
  assert.equal(b.duplicatesInFile, 1);
  assert.equal(b.drafts[0].email, 'ana@x.cl');
});

test('teléfonos fijos e inválidos quedan en revisión y los que no tienen número se rechazan', async () => {
  const { b } = await run('Nombre,Teléfono\nA,22 123 4567\nB,123\nC,\nD,987654321\n', 'g.csv');
  assert.equal(b.drafts.length, 3);
  assert.equal(b.stats.needsReview, 2);
  assert.equal(b.drafts.find((d) => d.name === 'A')?.stage_reason, 'telefono_fijo');
  assert.equal(b.drafts.find((d) => d.name === 'B')?.stage_reason, 'telefono_invalido');
  assert.equal(b.drafts.find((d) => d.name === 'D')?.stage, 'nuevo');
  const reasons = Object.fromEntries(b.rejected.map((r) => [r.raw[0], r.reason]));
  assert.equal(reasons.C, 'sin_telefono');
});

test('mapea perfiles con Google Maps separado del sitio web y conserva campos extra', async () => {
  const { m, b } = await run(
    'title,categoryName,address,city,state,phone,telefono_normalizado,whatsapp_posible,totalScore,reviewsCount,website,url,placeId,segmento,estado_web,web_url,evidencia,red_social\nClínica Veterinaria Municipal Puente Alto,Hospital veterinario,Clavero 330,Puente Alto,Región Metropolitana,+56 2 2731 5397,+56227315397,no,3.9,1299,,https://www.google.com/maps/search/?api=1&query=Clinica,ChIJ123,A_sitio_web,sin_web,,"18 resultados revisados, ninguna web propia",\n',
    'leads.csv',
  );
  assert.equal(m[0], 'business_name');
  assert.equal(m[1], 'category');
  assert.equal(m[5], 'phone_alt');
  assert.equal(m[6], 'phone');
  assert.equal(m[7], 'extra');
  assert.equal(m[11], 'maps_url');
  assert.equal(m[14], 'extra');
  assert.equal(b.drafts.length, 1);
  assert.equal(b.drafts[0].business_name, 'Clínica Veterinaria Municipal Puente Alto');
  assert.equal(b.drafts[0].category, 'Hospital veterinario');
  assert.equal(b.drafts[0].maps_url, 'https://www.google.com/maps/search/?api=1&query=Clinica');
  assert.equal(b.drafts[0].website, null);
  assert.equal(b.drafts[0].stage, 'revision');
  assert.equal(b.drafts[0].extra.whatsapp_posible, 'no');
  assert.equal(b.drafts[0].extra.placeId, 'ChIJ123');
  assert.equal(b.drafts[0].extra.estado_web, 'sin_web');
  assert.equal(b.drafts[0].extra.evidencia, '18 resultados revisados, ninguna web propia');
});

test('dos columnas de teléfono: usa el WhatsApp y cae al alternativo', async () => {
  const { b } = await run('Nombre,Teléfono,WhatsApp\nA,22 123 4567,987654321\nB,976543210,\n', 'h.csv');
  assert.equal(b.drafts[0].phone, '+56987654321');
  assert.equal(b.drafts[1].phone, '+56976543210');
});

test('Excel (.xlsx) con teléfonos numéricos y hoja extra', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');
  ws.addRow(['Empresa', 'Contacto', 'Celular', 'Web']);
  ws.addRow(['Panadería Sol', 'don pedro', 56987654321, { text: 'sol.cl', hyperlink: 'https://sol.cl' }]);
  ws.addRow(['Hotel Vista Mar', '', '9 7654 3210', '']);
  wb.addWorksheet('Otra').addRow(['x']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const { t, b } = await run(buf, 'leads.xlsx');
  assert.equal(t.kind, 'xlsx');
  assert.equal(t.sheet, 'Leads');
  assert.equal(b.drafts.length, 2);
  assert.equal(b.drafts[0].phone, '+56987654321');
  assert.equal(b.drafts[0].first_name, 'Pedro');
  assert.equal(b.drafts[0].website, 'sol.cl');
  assert.equal(b.drafts[1].first_name, null);
});

test('Latin-1 y .xls dan resultado/errores claros', async () => {
  const latin = Buffer.from('Nombre,Teléfono\nJosé Núñez,987654321\n', 'latin1');
  const { b } = await run(latin, 'i.csv');
  assert.equal(b.drafts[0].name, 'José Núñez');
  await assert.rejects(() => parseFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), 'x.xls'), /\.xlsx o \.csv/);
});

test('columnas desconocidas se guardan como extra', async () => {
  const { b } = await run('Nombre,Teléfono,Cantidad de empleados\nAna,987654321,12\n', 'j.csv');
  assert.equal(b.drafts[0].extra['Cantidad de empleados'], '12');
});
