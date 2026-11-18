import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSendWindow, nextWindowStart, zonedToUtc, localParts } from '../src/lib/time';

const TZ = 'America/Santiago';
const W = { start_hour: 9, end_hour: 20, days: [1, 2, 3, 4, 5, 6] };

test('zonedToUtc respeta el huso (verano e invierno de Chile)', () => {
  assert.equal(zonedToUtc(2026, 1, 15, 9, 0, TZ).toISOString(), '2026-01-15T12:00:00.000Z'); // UTC-3
  assert.equal(zonedToUtc(2026, 7, 15, 9, 0, TZ).toISOString(), '2026-07-15T13:00:00.000Z'); // UTC-4
});
test('ventana de envío', () => {
  assert.equal(inSendWindow(new Date('2026-11-16T15:00:00Z'), TZ, W), true);  // lun 12:00
  assert.equal(inSendWindow(new Date('2026-11-16T05:00:00Z'), TZ, W), false); // lun 02:00
  assert.equal(inSendWindow(new Date('2026-11-15T15:00:00Z'), TZ, W), false); // domingo
});
test('próximo inicio salta al siguiente día hábil', () => {
  const sat = new Date('2026-11-14T23:30:00Z'); // sáb 20:30 → fuera de horario
  const n = nextWindowStart(sat, TZ, W);
  const p = localParts(n, TZ);
  assert.equal(p.weekday, 1); // lunes
  assert.equal(p.hour, 9);
});
