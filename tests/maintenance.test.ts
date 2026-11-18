import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closePool, contact, exec, mkAccount, mkContact, mkDispatcher, msgs, q, resetDb } from './helpers';
import { setSetting } from '../src/lib/settings';
import { claimManualDrafts, discardMessage, manualCapacity, markManualSent, markMessageSent, rerollDraft, resetDryRun, retryAllByCode, retryMessage, skipDraft } from '../src/lib/maintenance';
import { handleMessage } from '../worker/inbound';
import { invalidateVariants } from '../src/lib/render';

before(async () => { await resetDb(); });
after(async () => { await closePool(); });
beforeEach(async () => { await resetDb(); });

describe('mantenimiento', () => {
  test('reintentar un mensaje bloqueado lo devuelve a la cola y se envía', async () => {
    const acct = await mkAccount();
    await exec(`update templates set active = false where step = 1`);
    const cid = await mkContact({ phone: '+56981300001', first_name: null });
    const { run, fake } = mkDispatcher(acct);
    await run();
    assert.equal((await contact(cid)).stage, 'revision');
    const [m] = await msgs(cid);
    assert.equal(m.status, 'blocked');
    // el usuario arregla la plantilla y reintenta
    await exec(`insert into templates (step, name, body) values (1, 'ok', 'Hola, ¿cómo estás?')`);
    invalidateVariants(); // el worker refresca su caché de plantillas cada 5 s
    assert.equal(await retryMessage(m.id), true);
    assert.equal((await contact(cid)).stage, 'valido');
    await run();
    assert.equal(fake.sent.length, 1);
    assert.equal((await contact(cid)).stage, 'contactado');
  });

  test('"sí salió": confirma un sin-confirmar y agenda el seguimiento; descartar saca al contacto', async () => {
    const acct = await mkAccount();
    const a = await mkContact({ phone: '+56981300002' });
    await exec(`insert into messages (contact_id, account_id, direction, step, status, error_code, sent_at) values ($1,$2,'out',1,'unconfirmed','timeout', now())`, [a, acct]);
    const [m] = await msgs(a);
    assert.equal(await markMessageSent(m.id), true);
    const c = await contact(a);
    assert.equal(c.step, 1);
    assert.equal(c.stage, 'contactado');
    assert.ok(c.next_action_at);

    const b = await mkContact({ phone: '+56981300003' });
    await exec(`insert into messages (contact_id, account_id, direction, step, status, error_code) values ($1,$2,'out',1,'failed','send_error')`, [b, acct]);
    const [mb] = await msgs(b);
    assert.equal(await discardMessage(mb.id), true);
    assert.equal((await contact(b)).stage, 'descartado');
  });

  test('reintento masivo por tipo de error', async () => {
    const acct = await mkAccount();
    for (let i = 0; i < 3; i++) {
      const id = await mkContact({ phone: `+5698140000${i}` });
      await exec(`insert into messages (contact_id, account_id, direction, step, status, error_code) values ($1,$2,'out',1,'failed','send_error')`, [id, acct]);
    }
    assert.equal(await retryAllByCode('send_error'), 3);
    assert.equal((await q(`select * from messages where status = 'retry'`)).length, 3);
  });

  test('limpiar modo prueba restaura los contactos sin tocar lo real', async () => {
    const acct = await mkAccount();
    await setSetting('dry_run', true);
    const fresh = await mkContact({ phone: '+56981500001' });
    const real = await mkContact({ phone: '+56981500002', stage: 'contactado', step: 1, account_id: acct, next: new Date(Date.now() - 1000).toISOString() });
    await exec(`insert into messages (contact_id, account_id, direction, step, status, body, sent_at, dry_run) values ($1,$2,'out',1,'sent','real', now(), false)`, [real, acct]);
    const { run } = mkDispatcher(acct);
    await run(2);
    assert.equal((await contact(fresh)).step, 1);
    assert.equal((await contact(real)).step, 2);
    const r = await resetDryRun();
    assert.equal(r.messages, 2);
    const f = await contact(fresh);
    assert.equal(f.step, 0);
    assert.equal(f.stage, 'valido');
    assert.equal(f.next_action_at, null);
    const rl = await contact(real);
    assert.equal(rl.step, 1, 'conserva el paso real');
    assert.equal(rl.stage, 'contactado');
    assert.equal((await msgs(real)).length, 1);
  });
});

describe('cola manual', () => {
  test('reserva un lote, respeta el cupo, permite saltar y detecta el envío real', async () => {
    const acct = await mkAccount({ mode: 'manual', newCap: 3 });
    for (let i = 0; i < 6; i++) await mkContact({ phone: `+5698160000${i}`, first_name: `Nombre${i}` });
    const r = await claimManualDrafts(acct, 10);
    assert.equal(r.taken, 3, 'solo hasta el cupo de nuevos del día');
    assert.equal((await manualCapacity(acct))!.left, 0);
    assert.equal((await claimManualDrafts(acct, 5)).reason, 'sin_cupo');

    const drafts = await q(`select m.*, c.phone from messages m join contacts c on c.id = m.contact_id where m.status = 'queued' order by m.id`);
    assert.equal(drafts.length, 3);
    assert.ok(drafts.every((d: any) => d.body && !/[{}]/.test(d.body)));

    // saltar libera cupo y deja el contacto sin dueño
    await skipDraft(drafts[0].contact_id);
    assert.equal((await contact(drafts[0].contact_id)).account_id, null);
    assert.equal((await manualCapacity(acct))!.left, 1);

    // el usuario envía desde el teléfono: el worker lo detecta y el borrador pasa a enviado
    const phone = drafts[1].phone.replace('+', '');
    const ev = { accountId: acct, fromMe: true, waMessageId: 'M1', phone, lid: null, text: drafts[1].body, kind: 'conversation', timestamp: Date.now() };
    assert.equal(await handleMessage(ev), 'manual');
    const sent = (await msgs(drafts[1].contact_id))[0];
    assert.equal(sent.status, 'sent');
    assert.equal(sent.source, 'manual');
    assert.equal((await contact(drafts[1].contact_id)).stage, 'contactado');

    // respaldo: marcar como enviado a mano
    assert.equal(await markManualSent(drafts[2].contact_id), true);
    assert.equal((await contact(drafts[2].contact_id)).step, 1);
    assert.ok(await rerollDraft(drafts[0].contact_id) === false, 'sin borrador activo no hay qué regenerar');
  });

  test('campaña cerrada (stop_new_after) no reserva más contactos', async () => {
    const acct = await mkAccount({ mode: 'manual' });
    await mkContact();
    await setSetting('stop_new_after', '2000-01-01');
    assert.equal((await claimManualDrafts(acct, 5)).reason, 'campana_cerrada');
  });
});
