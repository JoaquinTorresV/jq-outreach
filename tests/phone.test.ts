import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, splitPhones } from '../src/lib/phone';

const C = ['CL', 'CO'];
test('móviles chilenos en distintos formatos', () => {
  for (const raw of ['+56 9 8765 4321', '987654321', '9 8765 4321', '56987654321', '0056987654321', '(+56) 9-8765-4321', 'tel:+56987654321']) {
    const r = normalizePhone(raw, C);
    assert.ok(r.ok, raw);
    if (r.ok) assert.equal(r.e164, '+56987654321', raw);
  }
});
test('móvil colombiano sin prefijo cae al país alterno', () => {
  const r = normalizePhone('300 123 4567', C);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.e164, '+573001234567');
});
test('rechaza fijos (también los de Chile, que libphonenumber no distingue), cortos y basura', () => {
  for (const n of ['22 345 6789', '+56 2 2345 6789', '412345678', '+57 601 234 5678']) {
    const r = normalizePhone(n, ['CL', 'CO']);
    assert.equal(r.ok, false, n);
    if (!r.ok) assert.equal(r.reason, 'fijo', n);
  }
  assert.equal(normalizePhone('12345', C).ok, false);
  assert.equal(normalizePhone('', C).ok, false);
  assert.equal(normalizePhone('sin telefono', C).ok, false);
});
test('celdas con varios teléfonos', () => {
  const parts = splitPhones('+56 9 1111 2222 / 22 345 6789');
  assert.equal(parts.length, 2);
  assert.deepEqual(splitPhones('912345678, 987654321').length, 2);
  assert.equal(splitPhones('sin numero').length, 0);
});
