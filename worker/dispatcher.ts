import type { PoolClient } from 'pg';
import { exec, one, q, tx } from '../src/lib/db';
import { logEvent, type Level } from '../src/lib/events';
import { hashText, loadVariants } from '../src/lib/render';
import { effectiveNewCap, localDateStr, nextActionAfter, startOfLocalDay } from '../src/lib/schedule';
import { getSettings, type Settings } from '../src/lib/settings';
import { stageAfterStep } from '../src/lib/stages';
import { contactVars, pickVariant, renderTemplate, validateRendered } from '../src/lib/template';
import { inSendWindow, rand, randInt } from '../src/lib/time';
import type { AccountRow, ContactRow } from '../src/lib/types';
import { aiPersonalize } from './ai';
import { SendError, type WaClient } from './client';

export interface SessionControl {
  pause(reason: string, minutes: number, level?: Level): Promise<void>;
  markLoggedOut(): Promise<void>;
}

export type Job = { contact: ContactRow; step: number; msgId: number; attempts: number; waMessageId: string };

const TERMINAL = ['respondio', 'calificado', 'cliente', 'perdido', 'descartado', 'opt_out'];

const NO_PENDING_OUT = `
  not exists (
    select 1 from messages m
    where m.contact_id = c.id and m.direction = 'out' and m.step = %STEP%
      and not (m.status = 'retry' and (m.retry_at is null or m.retry_at <= now()))
  )`;

async function upsertSending(c: PoolClient, contactId: number, accountId: number, step: number, waId: string, dry: boolean) {
  const r = await c.query(
    `insert into messages (contact_id, account_id, direction, step, source, status, attempts, wa_message_id, dry_run)
     values ($1,$2,'out',$3,'auto','sending',1,$4,$5)
     on conflict (contact_id, step) where direction = 'out' and step is not null do update
       set status = 'sending', attempts = messages.attempts + 1, account_id = excluded.account_id,
           wa_message_id = excluded.wa_message_id, dry_run = excluded.dry_run, error_code = null, error_detail = null, updated_at = now()
       where messages.status = 'retry'
     returning id, attempts`,
    [contactId, accountId, step, waId, dry],
  );
  return r.rows[0] as { id: number; attempts: number } | undefined;
}

/** Seguimiento que ya toca enviar (sin respuesta, fecha vencida). */
export async function claimFollowUp(accountId: number, waId: string, dry: boolean): Promise<Job | null> {
  return tx(async (c) => {
    const r = await c.query(
      `select c.* from contacts c
       where c.account_id = $1 and c.stage in ('contactado','seguimiento_1','seguimiento_2') and c.step between 1 and 3
         and c.next_action_at is not null and c.next_action_at <= now() and c.last_inbound_at is null
         and ${NO_PENDING_OUT.replace('%STEP%', 'c.step + 1')}
       order by c.next_action_at asc limit 1 for update of c skip locked`,
      [accountId],
    );
    const contact = r.rows[0] as ContactRow | undefined;
    if (!contact) return null;
    const step = contact.step + 1;
    const m = await upsertSending(c, contact.id, accountId, step, waId, dry);
    return m ? { contact, step, msgId: m.id, attempts: m.attempts, waMessageId: waId } : null;
  });
}

/** Primer mensaje a un contacto válido (solo cuentas en modo automático). Toma contactos sin asignar. */
export async function claimNew(accountId: number, waId: string, dry: boolean): Promise<Job | null> {
  return tx(async (c) => {
    const r = await c.query(
      `select c.* from contacts c
       where c.stage = 'valido' and c.step = 0 and (c.account_id = $1 or c.account_id is null)
         and ${NO_PENDING_OUT.replace('%STEP%', '1')}
       order by (c.account_id is null), c.id limit 1 for update of c skip locked`,
      [accountId],
    );
    const contact = r.rows[0] as ContactRow | undefined;
    if (!contact) return null;
    const m = await upsertSending(c, contact.id, accountId, 1, waId, dry);
    if (!m) return null;
    if (contact.account_id == null) await c.query('update contacts set account_id = $2 where id = $1', [contact.id, accountId]);
    return { contact: { ...contact, account_id: accountId }, step: 1, msgId: m.id, attempts: m.attempts, waMessageId: waId };
  });
}

export async function getUsage(accountId: number, tz: string, dry: boolean) {
  const dayStart = startOfLocalDay(new Date(), tz);
  const r = await one<{ today: number; new_today: number; last_hour: number }>(
    `select count(*) filter (where sent_at >= $2)::int as today,
            count(*) filter (where sent_at >= $2 and step = 1)::int as new_today,
            count(*) filter (where sent_at >= now() - interval '1 hour')::int as last_hour
     from messages
     where account_id = $1 and direction = 'out' and dry_run = $3 and sent_at >= least($2::timestamptz, now() - interval '1 hour')`,
    [accountId, dayStart, dry],
  );
  return { today: r?.today ?? 0, newToday: r?.new_today ?? 0, lastHour: r?.last_hour ?? 0 };
}

type Built = { ok: true; text: string; variantId: number; hash: string } | { ok: false; reason: string };

/** Arma el texto final: variante según datos disponibles, variables, (IA opcional), validación y control de duplicados. */
export async function buildText(contact: ContactRow, step: number, accountId: number, s: Settings): Promise<Built> {
  const kind = step > 1 && contact.failover_pending ? 'failover' : 'normal';
  let variants = await loadVariants(step, kind);
  if (!variants.length && kind === 'failover') variants = await loadVariants(step, 'normal');
  const vars = contactVars(contact, new Date(), s.timezone);
  for (let attempt = 0; attempt < 8; attempt++) {
    const v = pickVariant(variants, vars);
    if (!v) return { ok: false, reason: 'sin_plantilla_aplicable' };
    let text = renderTemplate(v.body, vars).text;
    if (s.ai_personalization) text = (await aiPersonalize(text)) ?? text;
    const val = validateRendered(text);
    if (!val.ok) return { ok: false, reason: val.reason };
    const hash = hashText(text);
    const dup = await one<{ n: number }>(
      `select count(*)::int as n from messages
       where account_id = $1 and direction = 'out' and body_hash = $2 and sent_at > now() - interval '24 hours'`,
      [accountId, hash],
    );
    if ((dup?.n ?? 0) < s.duplicate_guard_max) return { ok: true, text, variantId: v.id, hash };
  }
  return { ok: false, reason: 'texto_repetido' };
}

export class Dispatcher {
  private nextSendAt = Date.now() + rand(5, 25) * 1000;
  private sinceBreak = 0;
  private breakAfter = randInt(8, 15);
  private busy = false;

  constructor(
    private accountId: number,
    private getClient: () => WaClient | null,
    private ctl: SessionControl,
  ) {}

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.run();
    } catch (e) {
      await logEvent('error', 'dispatcher_error', { error: (e as Error).message }, { accountId: this.accountId });
    } finally {
      this.busy = false;
    }
  }

  private async run() {
    const client = this.getClient();
    if (!client || !client.isOpen()) return;
    if (Date.now() < this.nextSendAt) return;
    const acct = await one<AccountRow>('select * from accounts where id = $1', [this.accountId]);
    if (!acct || acct.status !== 'activa') return;
    const s = await getSettings();
    if (s.kill_switch) return;
    const now = new Date();
    if (!s.dry_run && !inSendWindow(now, s.timezone, s.send_window)) return;

    const usage = await getUsage(acct.id, s.timezone, s.dry_run);
    if (usage.today >= acct.daily_total_cap || usage.lastHour >= acct.hourly_cap) return;

    const waId = client.newMessageId();
    let job = await claimFollowUp(acct.id, waId, s.dry_run);
    if (!job && acct.first_message_mode === 'auto') {
      const stopped = s.stop_new_after && localDateStr(now, s.timezone) >= s.stop_new_after;
      if (!stopped) {
        const all = await q<AccountRow>('select id, status, daily_new_cap, daily_total_cap from accounts');
        if (usage.newToday < effectiveNewCap(acct, all)) job = await claimNew(acct.id, waId, s.dry_run);
      }
    }
    if (!job) return;
    await this.execute(acct, client, job, s);
  }

  private pace(s: Settings, fast: boolean) {
    let wait = (fast ? rand(1.5, 4) : rand(s.delay_min_s, s.delay_max_s)) * 1000;
    this.sinceBreak++;
    if (!fast && this.sinceBreak >= this.breakAfter) {
      wait += rand(s.break_min_s, s.break_max_s) * 1000; // pausa larga, como una persona
      this.sinceBreak = 0;
      this.breakAfter = randInt(s.break_every_min, s.break_every_max);
    }
    this.nextSendAt = Date.now() + wait;
  }

  private async execute(acct: AccountRow, client: WaClient, job: Job, s: Settings) {
    const ctx = { accountId: acct.id, contactId: job.contact.id, messageId: job.msgId };
    const built = await buildText(job.contact, job.step, acct.id, s);
    if (!built.ok && built.reason === 'texto_repetido') {
      // No es un problema del contacto: todos los textos posibles ya se usaron hoy. Se pospone y se prueba con otro contacto.
      await exec(
        `update messages set status = 'retry', retry_at = now() + interval '30 minutes', error_code = 'texto_repetido',
           error_detail = 'Ya se envió este mismo texto el máximo de veces en 24 h; se pospone. Agrega más variantes o spintax.',
           attempts = greatest(0, attempts - 1), updated_at = now() where id = $1`,
        [job.msgId],
      );
      await logEvent('warn', 'texto_repetido_pospuesto', { paso: job.step }, ctx);
      this.nextSendAt = Date.now() + 2000;
      return;
    }
    if (!built.ok) {
      await this.block(job, built.reason);
      this.nextSendAt = Date.now() + 3000;
      return;
    }
    await exec('update messages set body = $2, body_hash = $3, template_id = $4, updated_at = now() where id = $1', [job.msgId, built.text, built.hash, built.variantId]);

    const fast = s.dry_run || acct.simulated;
    if (s.dry_run) {
      await this.markSent(job, acct.id, s);
      this.pace(s, true);
      return;
    }
    const jid = job.contact.jid ?? `${job.contact.phone.replace('+', '')}@s.whatsapp.net`;
    const typingMs = Math.min(9000, Math.max(1500, built.text.length * rand(35, 70)));
    try {
      await client.sendText(jid, built.text, { messageId: job.waMessageId, typingMs });
    } catch (e) {
      await this.onSendError(e, acct, job, s, ctx);
      return;
    }
    await this.markSent(job, acct.id, s);
    this.pace(s, fast);
  }

  private async markSent(job: Job, accountId: number, s: Settings) {
    const next = nextActionAfter(job.step, s);
    await tx(async (c) => {
      await c.query(`update messages set status = 'sent', sent_at = now(), error_code = null, error_detail = null, updated_at = now() where id = $1`, [job.msgId]);
      await c.query(
        `update contacts set step = $2, last_outbound_at = now(), first_sent_at = coalesce(first_sent_at, now()),
           failover_pending = false, account_id = $6, stage_reason = null, updated_at = now(),
           stage = case when stage = any($5) then stage else $3 end,
           next_action_at = case when stage = any($5) then null else $4::timestamptz end
         where id = $1`,
        [job.contact.id, job.step, stageAfterStep(job.step), next, TERMINAL, accountId],
      );
      await c.query('update accounts set last_sent_at = now(), consecutive_failures = 0 where id = $1', [accountId]);
    });
  }

  private async block(job: Job, reason: string) {
    await tx(async (c) => {
      await c.query(`update messages set status = 'blocked', error_code = $2, error_detail = 'El mensaje no se pudo armar o no pasó la validación', updated_at = now() where id = $1`, [job.msgId, reason]);
      await c.query(`update contacts set stage = 'revision', stage_reason = $2, next_action_at = null, updated_at = now() where id = $1`, [job.contact.id, reason]);
    });
    await logEvent('warn', 'mensaje_bloqueado', { motivo: reason, paso: job.step }, { accountId: this.accountId, contactId: job.contact.id, messageId: job.msgId });
  }

  private async countFailure(acct: AccountRow, s: Settings) {
    const r = await one<{ consecutive_failures: number }>(
      'update accounts set consecutive_failures = consecutive_failures + 1 where id = $1 returning consecutive_failures',
      [acct.id],
    );
    if ((r?.consecutive_failures ?? 0) >= s.circuit_breaker_failures) {
      await this.ctl.pause('circuit_breaker', 30, 'critical');
    }
  }

  private async onSendError(e: unknown, acct: AccountRow, job: Job, s: Settings, ctx: { accountId: number; contactId: number; messageId: number }) {
    const err = e instanceof SendError ? e : new SendError('other', (e as Error)?.message ?? String(e));
    this.nextSendAt = Date.now() + rand(20, 45) * 1000;
    const retryIn = async (minutes: number, consume: boolean) =>
      exec(
        `update messages set status = 'retry', retry_at = now() + ($2 || ' minutes')::interval, error_code = $3, error_detail = $4,
           attempts = greatest(0, attempts - $5), updated_at = now() where id = $1`,
        [job.msgId, String(minutes), err.code, err.message.slice(0, 500), consume ? 0 : 1],
      );

    switch (err.code) {
      case 'not_open':
        await retryIn(2, false);
        await logEvent('warn', 'envio_sin_conexion', { detalle: err.message }, ctx);
        return;
      case 'timeout':
        // Puede haberse enviado: no se reenvía solo para no duplicar. Queda para revisión.
        await exec(`update messages set status = 'unconfirmed', sent_at = now(), error_code = 'timeout', error_detail = $2, updated_at = now() where id = $1`, [job.msgId, err.message.slice(0, 500)]);
        await logEvent('error', 'envio_sin_confirmacion', { detalle: err.message, paso: job.step }, ctx);
        await this.countFailure(acct, s);
        return;
      case 'logged_out':
        await retryIn(60, false);
        await this.ctl.markLoggedOut();
        return;
      case 'forbidden':
        await retryIn(60, false);
        await logEvent('critical', 'envio_prohibido_403', { detalle: err.message }, ctx);
        await this.ctl.pause('forbidden_403', 60, 'critical');
        return;
      default: {
        const final = job.attempts >= s.max_send_attempts;
        if (final) {
          await exec(`update messages set status = 'failed', error_code = 'send_error', error_detail = $2, updated_at = now() where id = $1`, [job.msgId, err.message.slice(0, 500)]);
          await logEvent('error', 'envio_fallido', { detalle: err.message, intentos: job.attempts }, ctx);
        } else {
          await retryIn(5, true);
          await logEvent('warn', 'envio_reintento', { detalle: err.message, intentos: job.attempts }, ctx);
        }
        await this.countFailure(acct, s);
      }
    }
  }
}
