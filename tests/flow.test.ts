import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closePool, contact, exec, mkAccount, mkContact, mkDispatcher, msgs, one, q, resetDb } from './helpers';
import { setSetting } from '../src/lib/settings';
import { handleMessage, isOptOut } from '../worker/inbound';
import { isWhatsAppTemplateReply } from '../worker/ai';
import { applyFailover, supervise } from '../worker/index';
import { Verifier } from '../worker/verifier';
import { FakeClient } from '../worker/fake-client';
import { SendError } from '../worker/client';
import { claimFollowUp } from '../worker/dispatcher';

const past = () => new Date(Date.now() - 60_000).toISOString();
const inbound = (accountId: number, phone: string, text: string, id = 'IN' + Math.random()) => ({
  accountId, fromMe: false, waMessageId: id, phone: phone.replace('+', ''), lid: null, text, kind: 'conversation', timestamp: Date.now(),
});

before(async () => { await resetDb(); });
after(async () => { await closePool(); });

describe('flujo completo', () => {
  beforeEach(async () => {
    await resetDb();
  });

  test('primer mensaje automático + 3 seguimientos + agotado', async () => {
    const acct = await mkAccount({ mode: 'auto' });
    // se deja solo la variante personalizada para poder verificar nombre y negocio (la elección entre variantes es aleatoria)
    await exec(`update templates set active = false where step = 1 and name <> 'Primer contacto · nombre + negocio'`);
    const cid = await mkContact({ first_name: 'María', business_name: 'Peluquería Lucía' });
    const { run, fake } = mkDispatcher(acct);

    await run();
    let c = await contact(cid);
    assert.equal(c.step, 1);
    assert.equal(c.stage, 'contactado');
    assert.equal(c.account_id, acct);
    assert.ok(c.next_action_at, 'debe agendar el seguimiento');
    assert.match(fake.sent[0].text, /María/);
    assert.match(fake.sent[0].text, /Peluquería Lucía/);
    assert.ok(!/[{}]|\[\[/.test(fake.sent[0].text));

    // Aún no vence: no envía
    await run();
    assert.equal(fake.sent.length, 1);

    for (const [step, stage] of [[2, 'seguimiento_1'], [3, 'seguimiento_2'], [4, 'seguimiento_3']] as const) {
      await exec('update contacts set next_action_at = $2 where id = $1', [cid, past()]);
      await run();
      c = await contact(cid);
      assert.equal(c.step, step);
      assert.equal(c.stage, stage);
    }
    assert.equal(fake.sent.length, 4);
    // Tras el 4º no hay más envíos aunque pase el tiempo
    await exec('update contacts set next_action_at = $2 where id = $1', [cid, past()]);
    await run();
    assert.equal(fake.sent.length, 4);
    await supervise();
    assert.equal((await contact(cid)).stage, 'agotado');
    const ms = await msgs(cid);
    assert.deepEqual(ms.map((m: any) => [m.step, m.status]), [[1, 'sent'], [2, 'sent'], [3, 'sent'], [4, 'sent']]);
  });

  test('cada seguimiento usa las plantillas de la campaña del contacto', async () => {
    const acct = await mkAccount();
    const cid = await mkContact({ campaign: 'whatsapp_automation', business_name: 'Peluquería Lucía' });
    const { run } = mkDispatcher(acct);

    await run();
    for (const step of [2, 3, 4]) {
      await exec('update contacts set next_action_at = $2 where id = $1', [cid, past()]);
      await run();
    }

    const sent = await q<{ step: number; campaign: string; body: string }>(
      `select m.step, t.campaign, m.body from messages m join templates t on t.id = m.template_id
       where m.contact_id = $1 order by m.step`,
      [cid],
    );
    assert.deepEqual(sent.map((m) => m.campaign), Array(4).fill('whatsapp_automation'));
    assert.match(sent[0].body, /WhatsApp/);
    assert.equal((await contact(cid)).campaign, 'whatsapp_automation');
  });

  test('respuesta cancela los seguimientos; opt-out detectado', async () => {
    const acct = await mkAccount({ mode: 'auto' });
    const a = await mkContact({ phone: '+56981000001' });
    const b = await mkContact({ phone: '+56981000002' });
    const { run, fake } = mkDispatcher(acct);
    await run(2);
    assert.equal(fake.sent.length, 2);

    assert.equal(await handleMessage(inbound(acct, '+56981000001', 'Hola! Sí, me interesa')), 'reply');
    assert.equal(await handleMessage(inbound(acct, '+56981000002', 'No me interesa, gracias')), 'optout');
    assert.equal((await contact(a)).stage, 'respondio');
    assert.equal((await contact(a)).next_action_at, null);
    assert.equal((await contact(b)).stage, 'opt_out');

    await exec('update contacts set next_action_at = $1', [past()]);
    await run(3);
    assert.equal(fake.sent.length, 2, 'no debe seguir escribiéndoles');
    // mismo mensaje entrante dos veces → duplicado
    const dup = inbound(acct, '+56981000001', 'otra cosa', 'DUPID');
    assert.equal(await handleMessage(dup), 'reply');
    assert.equal(await handleMessage(dup), 'duplicate');
    // chats ajenos al pipeline se ignoran
    assert.equal(await handleMessage(inbound(acct, '+56971234567', 'hola, soy tu primo')), 'ignored');
  });

  test('detector de opt-out: casos positivos y negativos', () => {
    for (const t of ['No me interesa', 'no gracias', 'por favor dejen de escribirme', 'STOP', 'número equivocado', 'Elimina mi número', 'me dan de baja']) {
      assert.equal(isOptOut(t), true, t);
    }
    for (const t of ['Hola, sí me interesa', 'cuánto cuesta?', 'Gracias, lo reviso', 'puedes llamarme mañana?', 'no sé todavía, cuéntame más']) {
      assert.equal(isOptOut(t), false, t);
    }
  });

  test('detecta respuestas genéricas de WhatsApp Business', () => {
    for (const t of ['Hola, dime cómo te llamas y qué necesitas', 'Hola, ¿qué necesitas?', 'Hola, ¿en qué podemos ayudarte?']) {
      assert.equal(isWhatsAppTemplateReply(t), true, t);
    }
    for (const t of ['Sí, necesito una página web', '¿Cuánto cuesta?', 'Quiero agendar una reunión']) {
      assert.equal(isWhatsAppTemplateReply(t), false, t);
    }
  });

  test('respuesta que llega por LID se asocia al contacto', async () => {
    const acct = await mkAccount();
    const cid = await mkContact({ phone: '+56981000003', stage: 'contactado', step: 1, account_id: acct, next: past() });
    await exec(`update contacts set lid = '1234567890' where id = $1`, [cid]);
    const ev = { ...inbound(acct, '+56981000003', 'hola'), phone: null, lid: '1234567890' };
    assert.equal(await handleMessage(ev), 'reply');
    assert.equal((await contact(cid)).stage, 'respondio');
  });

  test('primer mensaje MANUAL desde el teléfono arranca el reloj; ecos y chats viejos no', async () => {
    const acct = await mkAccount({ mode: 'manual' });
    const cid = await mkContact({ phone: '+56981000004', account_id: null });
    const { run, fake } = mkDispatcher(acct);
    await run(2);
    assert.equal(fake.sent.length, 0, 'en modo manual el sistema no abre conversaciones');

    const ev = { ...inbound(acct, '+56981000004', 'Hola Ana, ¿cómo estás?'), fromMe: true, waMessageId: 'MANUAL1' };
    assert.equal(await handleMessage(ev), 'manual');
    const c = await contact(cid);
    assert.equal(c.step, 1);
    assert.equal(c.stage, 'contactado');
    assert.equal(c.account_id, acct);
    assert.ok(c.next_action_at);
    assert.equal((await msgs(cid))[0].source, 'manual');
    // el mismo mensaje otra vez es un eco
    assert.equal(await handleMessage(ev), 'own');

    // mensaje anterior a la importación (historial) no cuenta
    const old = await mkContact({ phone: '+56981000005' });
    const oldEv = { ...inbound(acct, '+56981000005', 'hola'), fromMe: true, waMessageId: 'OLD', timestamp: Date.now() - 3 * 86400_000 };
    assert.equal(await handleMessage(oldEv), 'ignored');
    assert.equal((await contact(old)).step, 0);

    // luego el seguimiento sí sale solo, por el mismo número
    await exec('update contacts set next_action_at = $2 where id = $1', [cid, past()]);
    await run();
    assert.equal(fake.sent.length, 1);
    assert.equal((await contact(cid)).step, 2);
  });

  test('envío sin confirmación NO se reenvía solo; sin conexión sí se reintenta', async () => {
    const acct = await mkAccount();
    const a = await mkContact({ phone: '+56981000006' });
    const fake = new FakeClient(acct, { onOpen() {}, onClose() {}, onQr() {}, onMessage() {}, onMessageStatus() {}, onLidMapping() {}, onRestriction() {} }, { speed: 0, replyRate: 0, autoOpen: false });
    fake.opts.failNext = [new SendError('timeout', 'sin ack')];
    const { run } = mkDispatcher(acct, fake);
    await run();
    let m = (await msgs(a))[0];
    assert.equal(m.status, 'unconfirmed');
    assert.equal((await contact(a)).step, 0);
    await run(3);
    assert.equal(fake.sent.length, 0, 'no debe duplicar un mensaje que quizá salió');

    const b = await mkContact({ phone: '+56981000007' });
    fake.opts.failNext = [new SendError('not_open', 'sin conexión')];
    await run();
    m = (await msgs(b))[0];
    assert.equal(m.status, 'retry');
    assert.equal(m.attempts, 0, 'no consume intento');
    await exec(`update messages set retry_at = now() - interval '1 second' where contact_id = $1`, [b]);
    await run();
    assert.equal((await contact(b)).step, 1);
    assert.equal((await msgs(b))[0].status, 'sent');
  });

  test('errores genéricos: reintenta y luego queda "failed"; el circuit breaker pausa la cuenta', async () => {
    const acct = await mkAccount();
    await setSetting('circuit_breaker_failures', 3);
    const ids = [] as number[];
    for (let i = 0; i < 4; i++) ids.push(await mkContact({ phone: `+5698200000${i}` }));
    const fake = new FakeClient(acct, { onOpen() {}, onClose() {}, onQr() {}, onMessage() {}, onMessageStatus() {}, onLidMapping() {}, onRestriction() {} }, { speed: 0, replyRate: 0, autoOpen: false });
    fake.opts.failNext = Array.from({ length: 10 }, () => new SendError('other', 'boom'));
    const { run, calls } = mkDispatcher(acct, fake);
    await run();
    assert.equal((await msgs(ids[0]))[0].status, 'retry');
    await exec(`update messages set retry_at = now() - interval '1 second'`);
    await run(); // 2º intento del mismo contacto
    const failed = await q('select * from messages where status = $1', ['failed']);
    assert.ok(failed.length >= 1, 'tras max intentos queda failed');
    assert.equal(failed[0].error_code, 'send_error');
    await run(2);
    assert.ok(calls.some((c) => c[0] === 'pause' && c[1] === 'circuit_breaker'), 'el breaker debe pausar');
    const ev = await q(`select * from events where type = 'envio_fallido'`);
    assert.ok(ev.length >= 1, 'el error queda registrado');
  });

  test('mensaje sin plantilla aplicable o con datos faltantes se bloquea (no se envía basura)', async () => {
    const acct = await mkAccount();
    await exec(`update templates set active = false where step = 1`);
    await exec(`insert into templates (step, name, body) values (1, 'solo negocio', 'Hola, vi {negocio} y quería escribirte')`);
    const withData = await mkContact({ phone: '+56983000001', business_name: 'Taller Sol' });
    const without = await mkContact({ phone: '+56983000002', first_name: null });
    const { run, fake } = mkDispatcher(acct);
    await run(2);
    assert.equal(fake.sent.length, 1);
    assert.match(fake.sent[0].text, /Taller Sol/);
    const c = await contact(without);
    assert.equal(c.stage, 'revision');
    assert.equal(c.stage_reason, 'sin_plantilla_aplicable');
    assert.equal((await msgs(without))[0].status, 'blocked');
    assert.equal((await contact(withData)).stage, 'contactado');
  });

  test('guarda anti-duplicados: no más de N textos idénticos por cuenta', async () => {
    const acct = await mkAccount();
    await setSetting('duplicate_guard_max', 3);
    await exec(`update templates set active = false where step = 1`);
    await exec(`insert into templates (step, name, body) values (1, 'fija', 'Hola, ¿cómo estás? Quería contarte algo.')`);
    for (let i = 0; i < 5; i++) await mkContact({ phone: `+5698400000${i}`, first_name: null });
    const { run, fake } = mkDispatcher(acct);
    await run(5);
    assert.equal(fake.sent.length, 3);
    const deferred = await q(`select error_code, status from messages where error_code = 'texto_repetido'`);
    assert.ok(deferred.length >= 1);
    assert.equal(deferred[0].status, 'retry', 'se pospone, no se bloquea ni se saca del flujo');
    const stuck = await q(`select stage from contacts where stage = 'revision'`);
    assert.equal(stuck.length, 0, 'ningún contacto debe irse a revisión por esto');
  });

  test('cupos: total diario, nuevos por día y kill switch', async () => {
    const acct = await mkAccount({ totalCap: 3, newCap: 2 });
    for (let i = 0; i < 6; i++) await mkContact({ phone: `+5698500000${i}` });
    const { run, fake } = mkDispatcher(acct);
    await run(8);
    assert.equal(fake.sent.length, 2, 'solo 2 contactos nuevos al día (cupo de nuevos)');

    await setSetting('kill_switch', true);
    await exec(`update accounts set daily_new_cap = 10, daily_total_cap = 10`);
    await run(3);
    assert.equal(fake.sent.length, 2, 'kill switch frena todo');
    await setSetting('kill_switch', false);
    await run(3);
    assert.equal(fake.sent.length, 5);
  });

  test('modo prueba (dry-run): no envía de verdad pero recorre todo el flujo', async () => {
    const acct = await mkAccount();
    await setSetting('dry_run', true);
    const cid = await mkContact({ phone: '+56986000001' });
    const { run, fake } = mkDispatcher(acct);
    await run();
    assert.equal(fake.sent.length, 0);
    const m = (await msgs(cid))[0];
    assert.equal(m.dry_run, true);
    assert.equal(m.status, 'sent');
    assert.equal((await contact(cid)).step, 1);
    // en modo prueba los "días" pasan a minutos
    const c = await contact(cid);
    assert.ok(new Date(c.next_action_at).getTime() - Date.now() < 5 * 60_000);
  });

  test('idempotencia: dos workers reclamando a la vez no duplican el seguimiento', async () => {
    const acct = await mkAccount();
    await mkContact({ phone: '+56987000001', stage: 'contactado', step: 1, account_id: acct, next: past() });
    const [a, b] = await Promise.all([claimFollowUp(acct, 'A1', false), claimFollowUp(acct, 'A2', false)]);
    assert.equal([a, b].filter(Boolean).length, 1);
    assert.equal((await q('select * from messages where step = 2')).length, 1);
  });

  test('envíos colgados al reiniciar quedan "sin confirmar", nunca se reenvían', async () => {
    const acct = await mkAccount();
    const cid = await mkContact({ phone: '+56988000001' });
    await exec(`insert into messages (contact_id, account_id, direction, step, status, updated_at) values ($1,$2,'out',1,'sending', now() - interval '10 minutes')`, [cid, acct]);
    await supervise();
    assert.equal((await msgs(cid))[0].status, 'unconfirmed');
    const ev = await q(`select * from events where type = 'envios_colgados'`);
    assert.equal(ev.length, 1);
  });
});

describe('verificación de números', () => {
  beforeEach(async () => { await resetDb(); });

  test('marca válidos y sin WhatsApp; los dudosos se confirman en una segunda pasada', async () => {
    const acct = await mkAccount();
    await setSetting('verify_batch', 4);
    await setSetting('verify_per_hour', 1000);
    const ids = {
      ok1: await mkContact({ phone: '+56981110001', stage: 'nuevo' }),
      ok2: await mkContact({ phone: '+56981110002', stage: 'nuevo' }),
      no1: await mkContact({ phone: '+56981110010', stage: 'nuevo' }), // termina en 0 → sin WhatsApp (regla del simulador)
      no2: await mkContact({ phone: '+56981110020', stage: 'nuevo' }),
    };
    const fake = new FakeClient(acct, { onOpen() {}, onClose() {}, onQr() {}, onMessage() {}, onMessageStatus() {}, onLidMapping() {}, onRestriction() {} }, { autoOpen: false });
    fake.open = true;
    const v = new Verifier();
    await v.tick(() => ({ client: fake, accountId: acct }));
    assert.equal((await contact(ids.ok1)).stage, 'valido');
    assert.ok((await contact(ids.ok1)).jid);
    assert.equal((await contact(ids.no1)).stage, 'sin_whatsapp');
    assert.equal(fake.verifyCalls.length, 1);

    // lote donde ninguno existe: no se concluye de inmediato (podría ser un fallo), se reintenta una vez
    const x = await mkContact({ phone: '+56981110030', stage: 'nuevo' });
    const y = await mkContact({ phone: '+56981110040', stage: 'nuevo' });
    (v as any).nextAt = 0;
    await v.tick(() => ({ client: fake, accountId: acct }));
    assert.equal((await contact(x)).stage, 'nuevo');
    assert.equal((await contact(x)).verify_attempts, 1);
    (v as any).nextAt = 0;
    await v.tick(() => ({ client: fake, accountId: acct }));
    assert.equal((await contact(y)).stage, 'sin_whatsapp');
  });

  test('respeta el colchón: si ya hay suficientes válidos no consulta', async () => {
    const acct = await mkAccount();
    await setSetting('verify_buffer', 2);
    await mkContact({ stage: 'valido' }); await mkContact({ stage: 'valido' });
    await mkContact({ phone: '+56981120001', stage: 'nuevo' });
    const fake = new FakeClient(acct, { onOpen() {}, onClose() {}, onQr() {}, onMessage() {}, onMessageStatus() {}, onLidMapping() {}, onRestriction() {} }, { autoOpen: false });
    fake.open = true;
    await new Verifier().tick(() => ({ client: fake, accountId: acct }));
    assert.equal(fake.verifyCalls.length, 0);
  });
});

describe('failover entre números', () => {
  beforeEach(async () => { await resetDb(); });

  test('número baneado: sus contactos pasan al otro y usan la plantilla "failover"', async () => {
    const dead = await mkAccount({ label: 'viejo', status: 'baneada', newCap: 70 });
    const live = await mkAccount({ label: 'respaldo', mode: 'auto', newCap: 30 });
    const fresh = await mkContact({ phone: '+56989000001', account_id: dead });
    const contacted = await mkContact({ phone: '+56989000002', stage: 'contactado', step: 1, account_id: dead, next: past() });
    await exec(`insert into messages (contact_id, account_id, direction, step, status, body, sent_at, source) values ($1,$2,'out',1,'sent','x', now(), 'auto')`, [contacted, dead]);
    const later = await mkContact({ phone: '+56989000003', stage: 'seguimiento_1', step: 2, account_id: dead, next: past() });
    await exec(`insert into messages (contact_id, account_id, direction, step, status, body, sent_at, source) values ($1,$2,'out',1,'sent','x', now(), 'auto'), ($1,$2,'out',2,'sent','x', now(), 'auto')`, [later, dead]);
    await applyFailover(60);
    assert.equal((await contact(fresh)).account_id, null);
    const c = await contact(contacted);
    assert.equal(c.account_id, live);
    assert.equal(c.failover_pending, true);

    const { run, fake } = mkDispatcher(live);
    await run(3);
    const text = fake.sent.find((s) => s.jid.startsWith('56989000002'))?.text ?? '';
    assert.match(text, /otro número/i, 'usa la plantilla de failover');
    assert.equal((await contact(contacted)).failover_pending, false);
    assert.ok(fake.sent.some((s) => s.jid.startsWith('56989000001')), 'el contacto sin escribir lo toma el número vivo');
    const t3 = fake.sent.find((s) => s.jid.startsWith('56989000003'))?.text ?? '';
    assert.match(t3, /otro número/i, 'también hay plantilla failover para el paso 3');
  });

  test('cuando cae un número, el otro absorbe su cupo de nuevos', async () => {
    await setSetting('duplicate_guard_max', 1000);
    const live = await mkAccount({ label: 'fuerte', mode: 'auto', newCap: 70, totalCap: 300 });
    await mkAccount({ label: 'débil', mode: 'auto', newCap: 30, status: 'baneada' });
    for (let i = 0; i < 120; i++) await mkContact({ phone: `+5698900${String(10000 + i)}` });
    const { run, fake } = mkDispatcher(live);
    await run(110);
    assert.equal(fake.sent.length, 100, 'asume 70 + 30 = 100 nuevos');
  });
});
