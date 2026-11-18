import { hostname } from 'node:os';
import { closePool, exec, one, q } from '../src/lib/db';
import { logEvent, purgeOldEvents } from '../src/lib/events';
import { logger } from '../src/lib/logger';
import { migrate } from '../src/lib/migrate';
import { getSettings } from '../src/lib/settings';
import type { AccountRow } from '../src/lib/types';
import { createBaileysClient } from './baileys-client';
import type { ClientFactory } from './session';
import { AccountSession, patchAccount } from './session';
import { FakeClient } from './fake-client';
import { buildAgent, checkProxy } from './proxy';
import { Verifier } from './verifier';

const VERSION = '1.0.0';
const WORKER_ID = `${hostname()}-${process.pid}`;
const only = (process.env.WORKER_ACCOUNT_IDS ?? '').split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite);

export const defaultFactory: ClientFactory = async (handlers, account) => {
  if (account.simulated) return new FakeClient(account.id, handlers, { speed: 0.05, replyRate: 0.15 });
  let agent;
  if (account.proxy_url) {
    agent = buildAgent(account.proxy_url);
    const res = await checkProxy(agent);
    if (!res.ok) throw new Error(`proxy no responde (${res.detail}); la cuenta NO se conecta sin proxy`);
  } else if (process.env.REQUIRE_PROXY === 'true') {
    throw new Error('proxy requerido (REQUIRE_PROXY=true) pero la cuenta no tiene proxy_url');
  }
  return createBaileysClient({ accountId: account.id, handlers, agent });
};

const sessions = new Map<number, AccountSession>();
const verifier = new Verifier();
const timers: NodeJS.Timeout[] = [];
let shuttingDown = false;

function every(ms: number, name: string, fn: () => Promise<void>) {
  let running = false;
  timers.push(setInterval(async () => {
    if (running || shuttingDown) return;
    running = true;
    try { await fn(); } catch (e) { logger.error({ err: (e as Error).message, loop: name }, 'error en tarea periódica'); } finally { running = false; }
  }, ms));
}

async function syncAccounts() {
  const rows = await q<AccountRow>('select * from accounts order by id');
  const ids = new Set(rows.map((r) => r.id));
  for (const a of rows) {
    if (only.length && !only.includes(a.id)) continue;
    let s = sessions.get(a.id);
    if (!s) {
      s = new AccountSession(a.id, defaultFactory);
      sessions.set(a.id, s);
      if (a.status !== 'baneada') void s.start().catch((e) => logger.error({ err: e.message, accountId: a.id }, 'no pude iniciar la cuenta'));
    }
    s.account = a;
  }
  for (const [id, s] of sessions) if (!ids.has(id)) { s.stop(); sessions.delete(id); }
}

async function processCommands() {
  const cmds = await q<{ id: number; account_id: number; type: string; payload: Record<string, unknown> }>(
    `select id, account_id, type, payload from commands where status = 'pending' order by id limit 20`,
  );
  for (const c of cmds) {
    const s = sessions.get(c.account_id);
    if (!s) continue; // lo atiende otro worker (WORKER_ACCOUNT_IDS) o aún no se creó la sesión
    const claimed = await one('update commands set status = $2 where id = $1 and status = $3 returning id', [c.id, 'running', 'pending']);
    if (!claimed) continue;
    try {
      const result = await s.runCommand(c.type, c.payload);
      await exec(`update commands set status = 'done', result = $2, done_at = now() where id = $1`, [c.id, result]);
    } catch (e) {
      await exec(`update commands set status = 'error', result = $2, done_at = now() where id = $1`, [c.id, (e as Error).message]);
      await logEvent('error', 'comando_fallido', { comando: c.type, error: (e as Error).message }, { accountId: c.account_id });
    }
  }
}

async function heartbeat() {
  await exec(
    `insert into worker_status (worker_id, info, last_seen) values ($1, $2::jsonb, now())
     on conflict (worker_id) do update set last_seen = now(), info = worker_status.info || excluded.info`,
    [WORKER_ID, JSON.stringify({ version: VERSION, pid: process.pid, accounts: [...sessions.keys()] })],
  );
  const ids = [...sessions.keys()];
  if (ids.length) await exec('update accounts set last_heartbeat = now() where id = any($1)', [ids]);
}

/** Tareas de mantenimiento y vigilancia (cada minuto). */
export async function supervise() {
  const s = await getSettings();

  // Reanudar pausas automáticas vencidas
  await exec(
    `update accounts set status = case when connection = 'open' then 'activa' else 'conectando' end, paused_until = null, status_reason = null
     where status = 'pausada_auto' and paused_until is not null and paused_until <= now()`,
  );

  // Cerrar contactos que agotaron los seguimientos sin responder
  await exec(
    `update contacts set stage = 'agotado', next_action_at = null, updated_at = now()
     where stage = 'seguimiento_3' and next_action_at is not null and next_action_at <= now() and last_inbound_at is null`,
  );

  // Envíos "en curso" que quedaron colgados
  const stuck = await q<{ id: number; contact_id: number; account_id: number }>(
    `update messages set status = 'unconfirmed', sent_at = coalesce(sent_at, now()), error_code = 'colgado',
       error_detail = 'Quedó en envío sin confirmación; revisa en WhatsApp si salió', updated_at = now()
     where direction = 'out' and status = 'sending' and updated_at < now() - interval '3 minutes' returning id, contact_id, account_id`,
  );
  if (stuck.length) await logEvent('error', 'envios_colgados', { cantidad: stuck.length, ids: stuck.slice(0, 10).map((x) => x.id) });

  await applyFailover(s.qr_failover_minutes);

  // Cuentas desconectadas demasiado tiempo
  const down = await q<AccountRow>(
    `select * from accounts where connection <> 'open' and status not in ('baneada','pausada_manual','desconectada','qr_requerido')
       and disconnected_since is not null and disconnected_since < now() - interval '5 minutes'`,
  );
  for (const a of down) await logEvent('error', 'cuenta_desconectada', { desde: a.disconnected_since, estado: a.status, motivo: a.status_reason }, { accountId: a.id });

  // Posible shadow-ban: mensajes viejos sin una sola entrega confirmada
  const shadow = await q<{ account_id: number; total: number }>(
    `select account_id, count(*)::int as total from messages
     where direction = 'out' and dry_run = false and sent_at between now() - interval '24 hours' and now() - interval '2 hours'
     group by account_id having count(*) >= 20 and count(*) filter (where status in ('delivered','read')) = 0`,
  );
  for (const r of shadow) await logEvent('warn', 'posible_shadowban', { enviados: r.total, entregados: 0 }, { accountId: r.account_id });

  // Tasa de respuesta muy baja (solo avisa; no pausa por sí solo)
  const low = await q<{ account_id: number; sent: number; replied: number }>(
    `select m.account_id, count(*)::int as sent, (count(*) filter (where c.last_inbound_at is not null))::int as replied
     from messages m join contacts c on c.id = m.contact_id
     where m.direction = 'out' and m.step = 1 and m.dry_run = false and m.sent_at > now() - interval '3 days'
     group by m.account_id having count(*) >= 80 and count(*) filter (where c.last_inbound_at is not null) * 200 < count(*)`,
  );
  for (const r of low) await logEvent('warn', 'tasa_respuesta_baja', { enviados: r.sent, respuestas: r.replied }, { accountId: r.account_id });

  if (new Date().getUTCHours() === 7 && new Date().getUTCMinutes() === 0) await purgeOldEvents(30);
}

/**
 * Failover: si un número está baneado (o sin sesión por mucho rato), sus contactos pendientes pasan a los
 * números activos. Los que ya habían recibido mensajes se marcan para usar la plantilla "failover".
 */
export async function applyFailover(qrMinutes = 60) {
  const dead = await q<AccountRow>(
    `select * from accounts where status = 'baneada'
        or (status in ('qr_requerido','desconectada') and disconnected_since is not null and disconnected_since < now() - ($1 || ' minutes')::interval)`,
    [String(qrMinutes)],
  );
  if (!dead.length) return;
  const alive = await q<AccountRow>(`select * from accounts where status = 'activa' order by id`);
  for (const d of dead) {
    // Contactos sin escribir: vuelven al pozo común; borradores manuales de esa cuenta se descartan
    const free = await exec(`update contacts set account_id = null, updated_at = now() where account_id = $1 and step = 0 and stage in ('nuevo','valido')`, [d.id]);
    await exec(`delete from messages where direction = 'out' and status = 'queued' and account_id = $1`, [d.id]);
    let moved = 0;
    if (alive.length) {
      const pending = await q<{ id: number }>(
        `select id from contacts where account_id = $1 and step >= 1 and stage in ('contactado','seguimiento_1','seguimiento_2','seguimiento_3') and last_inbound_at is null`,
        [d.id],
      );
      const weights = alive.map((a) => a.daily_total_cap);
      const total = weights.reduce((x, y) => x + y, 0);
      let idx = 0;
      const buckets = alive.map(() => [] as number[]);
      const acc = alive.map(() => 0);
      for (const p of pending) {
        // reparto proporcional al cupo diario de cada número (round-robin ponderado)
        idx = acc.reduce((best, v, i) => (v / weights[i] < acc[best] / weights[best] ? i : best), 0);
        acc[idx]++;
        buckets[idx].push(p.id);
      }
      for (let i = 0; i < alive.length; i++) {
        if (!buckets[i].length) continue;
        moved += buckets[i].length;
        await exec(`update contacts set account_id = $2, failover_pending = true, updated_at = now() where id = any($1)`, [buckets[i], alive[i].id]);
      }
      void total;
    }
    if (free || moved) await logEvent('warn', 'failover_aplicado', { cuenta_caida: d.id, sin_escribir_liberados: free, seguimientos_reasignados: moved }, { accountId: d.id });
  }
}

async function recoverOnBoot() {
  const stuck = await q<{ id: number }>(
    `update messages set status = 'unconfirmed', sent_at = coalesce(sent_at, now()), error_code = 'worker_reinicio',
       error_detail = 'El worker se reinició mientras se enviaba; revisa en WhatsApp si salió', updated_at = now()
     where direction = 'out' and status = 'sending' returning id`,
  );
  if (stuck.length) await logEvent('error', 'envios_interrumpidos_por_reinicio', { cantidad: stuck.length, ids: stuck.slice(0, 10).map((x) => x.id) });

  // Alerta si el worker se está reiniciando en bucle
  const row = await one<{ info: { boots?: number[] } }>('select info from worker_status where worker_id = $1', [WORKER_ID]);
  void row;
  const boots = await q<{ n: number }>(`select count(*)::int as n from events where type = 'worker_iniciado' and ts > now() - interval '10 minutes'`);
  if ((boots[0]?.n ?? 0) >= 2) await logEvent('critical', 'worker_reinicios_repetidos', { reinicios_10min: (boots[0]?.n ?? 0) + 1 });
  await logEvent('info', 'worker_iniciado', { version: VERSION, workerId: WORKER_ID });
}

async function main() {
  logger.info({ workerId: WORKER_ID, only }, 'iniciando worker');
  const applied = await migrate((m) => logger.info(m));
  if (applied.length) logger.info({ applied }, 'migraciones aplicadas');
  await recoverOnBoot();
  await heartbeat();
  await syncAccounts();

  every(10_000, 'heartbeat', heartbeat);
  every(10_000, 'sync', syncAccounts);
  every(2_000, 'commands', processCommands);
  every(5_000, 'dispatch', async () => { await Promise.all([...sessions.values()].map((s) => s.dispatcher.tick())); });
  every(20_000, 'verify', async () => {
    await verifier.tick(() => {
      const open = [...sessions.values()]
        .filter((s) => s.client?.isOpen() && s.account && !['baneada', 'pausada_manual'].includes(s.account.status))
        .sort((a, b) => (a.account!.daily_new_cap - b.account!.daily_new_cap));
      const s = open[0];
      return s?.client ? { client: s.client, accountId: s.id } : null;
    });
  });
  every(60_000, 'supervisor', supervise);
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'apagando worker…');
  timers.forEach(clearInterval);
  for (const s of sessions.values()) s.stop();
  await exec(`update worker_status set last_seen = now() - interval '1 hour' where worker_id = $1`, [WORKER_ID]).catch(() => {});
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (e) => logger.error({ err: (e as Error)?.message ?? String(e) }, 'unhandledRejection'));
process.on('uncaughtException', (e) => {
  logger.fatal({ err: e.message, stack: e.stack }, 'uncaughtException; el contenedor se reiniciará');
  void logEvent('critical', 'worker_crash', { error: e.message }).finally(() => process.exit(1));
});

if (process.argv[1] && /worker[\\/]index\.[tj]s$/.test(process.argv[1])) {
  main().catch((e) => {
    logger.fatal({ err: e.message }, 'el worker no pudo iniciar');
    process.exit(1);
  });
}
