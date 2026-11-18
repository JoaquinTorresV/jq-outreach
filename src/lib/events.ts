import { q, one, exec } from './db';
import { getSettings } from './settings';
import { logger } from './logger';

export type Level = 'info' | 'warn' | 'error' | 'critical';
const RANK: Record<Level, number> = { info: 0, warn: 1, error: 2, critical: 3 };

type Ctx = { accountId?: number | null; contactId?: number | null; messageId?: number | null };

/** Registra un evento estructurado. Nada falla en silencio: errores y críticos además generan alerta. */
export async function logEvent(level: Level, type: string, detail: Record<string, unknown> = {}, ctx: Ctx = {}) {
  try {
    await q(
      'insert into events(level, type, account_id, contact_id, message_id, detail) values ($1,$2,$3,$4,$5,$6::jsonb)',
      [level, type, ctx.accountId ?? null, ctx.contactId ?? null, ctx.messageId ?? null, JSON.stringify(detail)],
    );
  } catch (e) {
    logger.error({ err: (e as Error).message, type }, 'no se pudo guardar el evento');
  }
  const log = level === 'info' ? logger.info : level === 'warn' ? logger.warn : logger.error;
  log.call(logger, { type, ...ctx, ...detail }, 'evento');

  try {
    const s = await getSettings();
    if (RANK[level] >= RANK[s.alert_min_level] && s.alert_webhook_url) {
      const icon = level === 'critical' ? '🚨' : level === 'error' ? '❗' : '⚠️';
      const acct = ctx.accountId ? ` (cuenta #${ctx.accountId})` : '';
      await notify(`${icon} ${type}${acct}\n${summarize(detail)}`, `${type}:${ctx.accountId ?? 'x'}`, 30);
    }
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'falló el envío de la alerta');
  }
}

function summarize(d: Record<string, unknown>): string {
  const s = Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  return s.length > 900 ? s.slice(0, 900) + '…' : s;
}

/** Envía un mensaje al webhook (Discord/Slack). `key` + `minMinutes` evitan repetir la misma alerta. */
export async function notify(text: string, key?: string, minMinutes = 0): Promise<boolean> {
  const s = await getSettings();
  if (!s.alert_webhook_url) return false;
  if (key && minMinutes > 0) {
    const row = await one<{ ok: boolean }>(
      `insert into alert_state(key, last_sent) values ($1, now())
       on conflict (key) do update set last_sent = now()
         where alert_state.last_sent < now() - ($2 || ' minutes')::interval
       returning true as ok`,
      [key, String(minMinutes)],
    );
    if (!row) return false; // ya se envió hace poco
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(s.alert_webhook_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text.slice(0, 1900), text: text.slice(0, 1900) }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'webhook de alertas no respondió');
    return false;
  }
}

export async function purgeOldEvents(days = 30) {
  return exec(`delete from events where ts < now() - ($1 || ' days')::interval and level in ('info','warn')`, [String(days)]);
}
