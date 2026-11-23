import { exec, one, q, tx } from './db';
import { logEvent } from './events';
import { renderForContact } from './render';
import { effectiveNewCap, localDateStr, nextActionAfter, startOfLocalDay } from './schedule';
import { getSettings } from './settings';
import { stageAfterStep } from './stages';
import type { AccountRow, ContactRow, MessageRow } from './types';

const TERMINAL = ['respondio', 'calificado', 'cliente', 'perdido', 'descartado', 'opt_out'];
export const OUTCOME_STAGES = ['respondio', 'calificado', 'cliente', 'perdido', 'descartado', 'opt_out'] as const;

/** Deja los contactos como estaban antes del modo prueba y borra los mensajes simulados. */
export async function resetDryRun(): Promise<{ contacts: number; messages: number }> {
  return tx(async (c) => {
    const r = await c.query(
      `update contacts ct set
         step = coalesce((select max(step) from messages m where m.contact_id = ct.id and m.direction = 'out' and not m.dry_run and m.status in ('sent','delivered','read','unconfirmed')), 0),
         updated_at = now()
       where ct.id in (select contact_id from messages where dry_run)
         and ct.stage in ('valido','contactado','seguimiento_1','seguimiento_2','seguimiento_3','agotado','revision')
       returning ct.id, ct.step`,
    );
    await c.query(
      `update contacts set
         stage = case step when 0 then 'valido' when 1 then 'contactado' when 2 then 'seguimiento_1' when 3 then 'seguimiento_2' else 'seguimiento_3' end,
         next_action_at = case when step = 0 then null else now() + interval '1 hour' end,
         first_sent_at = case when step = 0 then null else first_sent_at end,
         last_outbound_at = case when step = 0 then null else last_outbound_at end,
         stage_reason = null, failover_pending = false
       where id = any($1)`,
      [r.rows.map((x) => x.id)],
    );
    const d = await c.query('delete from messages where dry_run');
    return { contacts: r.rowCount ?? 0, messages: d.rowCount ?? 0 };
  });
}

/** Vuelve a poner en cola un mensaje fallido, bloqueado o sin confirmar. */
export async function retryMessage(id: number): Promise<boolean> {
  const m = await one<MessageRow>(`select * from messages where id = $1 and direction = 'out' and status in ('failed','blocked','unconfirmed','retry')`, [id]);
  if (!m || !m.step) return false;
  await tx(async (c) => {
    await c.query(`update messages set status = 'retry', retry_at = now(), attempts = 0, error_code = null, error_detail = null, updated_at = now() where id = $1`, [id]);
    const prev = m.step! <= 1 ? 'valido' : stageAfterStep(m.step! - 1);
    await c.query(
      `update contacts set stage = case when stage = any($3) then stage else $2 end, stage_reason = null,
         next_action_at = case when stage = any($3) then next_action_at when $4 > 1 then now() else null end,
         account_id = coalesce(account_id, $5), updated_at = now() where id = $1`,
      [m.contact_id, prev, TERMINAL, m.step, m.account_id],
    );
  });
  await logEvent('info', 'mensaje_reintentado_manual', { paso: m.step }, { accountId: m.account_id, contactId: m.contact_id, messageId: id });
  return true;
}

export async function retryAllByCode(code: string): Promise<number> {
  const rows = await q<{ id: number }>(`select id from messages where direction = 'out' and status in ('failed','blocked','unconfirmed') and error_code = $1`, [code]);
  let n = 0;
  for (const r of rows) if (await retryMessage(r.id)) n++;
  return n;
}

/** "Sí salió": confirma a mano un mensaje sin confirmar y deja correr los seguimientos. */
export async function markMessageSent(id: number): Promise<boolean> {
  const m = await one<MessageRow>(`select * from messages where id = $1 and direction = 'out' and status in ('unconfirmed','failed','blocked')`, [id]);
  if (!m || !m.step) return false;
  const s = await getSettings();
  const next = nextActionAfter(m.step, s);
  await tx(async (c) => {
    await c.query(`update messages set status = 'sent', sent_at = coalesce(sent_at, now()), error_code = null, error_detail = null, updated_at = now() where id = $1`, [id]);
    await c.query(
      `update contacts set step = greatest(step, $2), stage = case when stage = any($5) then stage else $3 end, stage_reason = null,
         next_action_at = case when stage = any($5) then null else $4::timestamptz end,
         last_outbound_at = now(), first_sent_at = coalesce(first_sent_at, now()), updated_at = now() where id = $1`,
      [m.contact_id, m.step, stageAfterStep(m.step!), next, TERMINAL],
    );
  });
  await logEvent('info', 'mensaje_confirmado_manual', { paso: m.step }, { accountId: m.account_id, contactId: m.contact_id, messageId: id });
  return true;
}

export async function discardMessage(id: number): Promise<boolean> {
  const m = await one<MessageRow>(`select * from messages where id = $1 and direction = 'out' and status in ('failed','blocked','unconfirmed','retry','queued')`, [id]);
  if (!m) return false;
  await tx(async (c) => {
    await c.query(`update messages set status = 'cancelled', updated_at = now() where id = $1`, [id]);
    await c.query(
      `update contacts set stage = case when stage = any($3) then stage when $2 <= 1 then 'descartado' else 'agotado' end,
         stage_reason = 'descartado_manual', next_action_at = null, updated_at = now() where id = $1`,
      [m.contact_id, m.step ?? 1, TERMINAL],
    );
  });
  return true;
}

export async function setOutcome(contactId: number, stage: string, note?: string): Promise<boolean> {
  if (!(OUTCOME_STAGES as readonly string[]).includes(stage)) return false;
  await exec(
    `update contacts set stage = $2, stage_reason = $3, next_action_at = null, updated_at = now() where id = $1`,
    [contactId, stage, note ?? 'manual'],
  );
  await exec(`update messages set status = 'cancelled', updated_at = now() where contact_id = $1 and direction = 'out' and status in ('retry','queued')`, [contactId]);
  return true;
}

// ───────── Cola manual (primer mensaje enviado por una persona) ─────────

export async function manualCapacity(accountId: number) {
  const s = await getSettings();
  const all = await q<AccountRow>('select * from accounts');
  const acct = all.find((a) => a.id === accountId);
  if (!acct) return null;
  const dayStart = startOfLocalDay(new Date(), s.timezone);
  const u = await one<{ new_today: number }>(
    `select count(*) filter (where step = 1 and sent_at >= $2)::int as new_today from messages where account_id = $1 and direction = 'out' and not dry_run`,
    [accountId, dayStart],
  );
  const queued = await one<{ n: number }>(`select count(*)::int as n from messages where account_id = $1 and direction = 'out' and status = 'queued' and step = 1`, [accountId]);
  const cap = effectiveNewCap(acct, all);
  const stopped = !!s.stop_new_after && localDateStr(new Date(), s.timezone) >= s.stop_new_after;
  return { cap, sentToday: u?.new_today ?? 0, queued: queued?.n ?? 0, left: stopped ? 0 : Math.max(0, cap - (u?.new_today ?? 0) - (queued?.n ?? 0)), stopped };
}

/** Reserva el siguiente lote de contactos válidos para una cuenta y deja un texto listo para cada uno. */
export async function claimManualDrafts(accountId: number, count: number, onlyIfQueueEmpty = false): Promise<{ taken: number; skipped: number; reason?: string }> {
  const cap = await manualCapacity(accountId);
  if (!cap) return { taken: 0, skipped: 0, reason: 'cuenta_inexistente' };
  const take = Math.min(count, cap.left);
  if (take <= 0) return { taken: 0, skipped: 0, reason: cap.stopped ? 'campana_cerrada' : 'sin_cupo' };
  const s = await getSettings();
  let taken = 0, skipped = 0;
  await tx(async (c) => {
    await c.query('select pg_advisory_xact_lock(91827, $1)', [accountId]);
    if (onlyIfQueueEmpty) {
      const queued = await c.query(
        `select exists (select 1 from messages where account_id = $1 and direction = 'out' and status = 'queued' and step = 1) as has_queue`,
        [accountId],
      );
      if (queued.rows[0]?.has_queue) return;
    }
    const rows = (await c.query(
      `select ct.* from contacts ct
       where ct.stage = 'valido' and ct.step = 0 and (ct.account_id is null or ct.account_id = $1)
         and not exists (select 1 from messages m where m.contact_id = ct.id and m.direction = 'out' and m.step = 1)
       order by (ct.account_id is null), ct.id limit $2 for update of ct skip locked`,
      [accountId, take],
    )).rows as ContactRow[];
    for (const ct of rows) {
      const r = await renderForContact(ct, 1, { tz: s.timezone });
      if (!r.ok) {
        skipped++;
        await c.query(`update contacts set stage = 'revision', stage_reason = $2, updated_at = now() where id = $1`, [ct.id, r.reason]);
        continue;
      }
      await c.query(`update contacts set account_id = $2, updated_at = now() where id = $1`, [ct.id, accountId]);
      await c.query(
        `insert into messages (contact_id, account_id, direction, step, source, body, body_hash, template_id, status)
         values ($1,$2,'out',1,'manual',$3,$4,$5,'queued')`,
        [ct.id, accountId, r.text, r.hash, r.variantId],
      );
      taken++;
    }
  });
  return { taken, skipped };
}

export async function ensureManualDrafts(accountId: number, count: number): Promise<number> {
  return (await claimManualDrafts(accountId, count, true)).taken;
}

export async function rerollDraft(contactId: number): Promise<boolean> {
  const ct = await one<ContactRow>('select * from contacts where id = $1', [contactId]);
  if (!ct) return false;
  const s = await getSettings();
  const r = await renderForContact(ct, 1, { tz: s.timezone });
  if (!r.ok) return false;
  return (await exec(`update messages set body = $2, body_hash = $3, template_id = $4, updated_at = now() where contact_id = $1 and direction = 'out' and step = 1 and status = 'queued'`, [contactId, r.text, r.hash, r.variantId])) > 0;
}

/** Devuelve el contacto al pozo común (otro número o más tarde). */
export async function skipDraft(contactId: number): Promise<void> {
  await tx(async (c) => {
    await c.query(`delete from messages where contact_id = $1 and direction = 'out' and step = 1 and status = 'queued'`, [contactId]);
    await c.query(`update contacts set account_id = null, updated_at = now() where id = $1 and step = 0`, [contactId]);
  });
}

/** Respaldo por si el envío manual no fue detectado automáticamente. */
export async function markManualSent(contactId: number): Promise<boolean> {
  const s = await getSettings();
  const next = nextActionAfter(1, s);
  const r = await exec(`update messages set status = 'sent', sent_at = now(), attempts = 1, updated_at = now() where contact_id = $1 and direction = 'out' and step = 1 and status = 'queued'`, [contactId]);
  if (!r) return false;
  await exec(`update contacts set step = 1, stage = 'contactado', stage_reason = null, first_sent_at = coalesce(first_sent_at, now()), last_outbound_at = now(), next_action_at = $2, updated_at = now() where id = $1 and step = 0`, [contactId, next]);
  return true;
}
