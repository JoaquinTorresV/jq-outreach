import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, pickVariant, requiredVars, validateRendered, contactVars, firstNameOf, type Variant } from '../src/lib/template';

const V = (id: number, body: string, extra: Partial<Variant> = {}): Variant => ({
  id, step: 1, kind: 'normal', campaign: 'web_sales', name: 'v' + id, body, requires: [], weight: 1, active: true, ...extra,
});

test('variables, respaldo y limpieza de puntuación', () => {
  assert.equal(renderTemplate('Hola {nombre}, ¿cómo estás?', { nombre: 'María' }).text, 'Hola María, ¿cómo estás?');
  assert.equal(renderTemplate('Hola {nombre|}, ¿cómo estás?', {}).text, 'Hola, ¿cómo estás?');
  assert.equal(renderTemplate('Hola {nombre|por acá}, te cuento', {}).text, 'Hola por acá, te cuento');
  const r = renderTemplate('Hola {nombre}, vi {negocio}.', { nombre: 'Ana' });
  assert.deepEqual(r.missing, ['negocio']);
});
test('spintax resuelve una opción', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) seen.add(renderTemplate('[[Hola|Buenas|Qué tal]] Ana', {}).text);
  assert.deepEqual([...seen].sort(), ['Buenas Ana', 'Hola Ana', 'Qué tal Ana']);
});
test('requisitos automáticos: solo variables sin respaldo', () => {
  assert.deepEqual(requiredVars('{nombre} {negocio|tu negocio} {saludo}').sort(), ['nombre']);
  assert.deepEqual(requiredVars('hola', ['Dirección']).sort(), ['direccion']);
});
test('pickVariant solo usa variantes con datos disponibles y prefiere las personalizadas', () => {
  const vs = [V(1, 'genérico'), V(2, 'Hola {nombre}'), V(3, 'Hola {nombre} de {negocio}')];
  assert.equal(pickVariant(vs, {}, () => 0.5)?.id, 1);
  const only = new Set<number>();
  for (let i = 0; i < 200; i++) only.add(pickVariant(vs, { nombre: 'Ana' })!.id);
  assert.deepEqual([...only].sort(), [1, 2]);
  assert.ok(pickVariant(vs, { nombre: 'Ana', negocio: 'X' })!.id >= 1);
  assert.equal(pickVariant([V(2, 'Hola {nombre}')], {}), null);
  assert.equal(pickVariant([V(2, 'Hola {nombre}', { active: false })], { nombre: 'A' }), null);
});
test('validador bloquea restos de plantilla y textos vacíos', () => {
  assert.equal(validateRendered('Hola {nombre}').ok, false);
  assert.equal(validateRendered('Hola [[a|b').ok, false);
  assert.equal(validateRendered('').ok, false);
  assert.equal(validateRendered('Hola Ana, ¿cómo estás?').ok, true);
  assert.equal(validateRendered('Hola undefined').ok, false);
});
test('contactVars: persona vs negocio y saludo por hora', () => {
  const v = contactVars({ name: 'Dra. maría josé pérez', business_name: null }, new Date('2026-11-16T14:00:00Z'), 'America/Santiago');
  assert.equal(v.nombre, 'María');
  assert.equal(v.saludo, 'Buenos días'); // 11:00 en Santiago
  const w = contactVars({ name: 'Ferretería Los Amigos SpA' }, new Date('2026-11-16T14:00:00Z'), 'America/Santiago');
  assert.equal(w.nombre, null);
  assert.equal(w.negocio, 'Ferretería Los Amigos SpA');
  assert.equal(firstNameOf('Sr. JUAN carlos'), 'Juan');
  assert.equal(contactVars({ extra: { 'Cantidad de empleados': '12' } }, new Date(), 'UTC').cantidad_de_empleados, '12');
});
