process.env.DATABASE_URL ??= 'postgres://postgres@127.0.0.1:54329/jqtest';
import { closePool, exec, one, pool, q } from '../src/lib/db';
import { migrate } from '../src/lib/migrate';
import { invalidateSettings, setSetting } from '../src/lib/settings';
import { invalidateVariants } from '../src/lib/render';
import { Dispatcher, type SessionControl } from '../worker/dispatcher';
import { FakeClient } from '../worker/fake-client';
import type { ClientHandlers } from '../worker/client';

export { closePool, exec, one, q };

export async function resetDb() {
  await pool().query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  invalidateSettings();
  invalidateVariants();
  // ventana abierta 24/7 y sin esperas para que los tests sean rápidos
  await setSetting('send_window', { start_hour: 0, end_hour: 24, days: [0, 1, 2, 3, 4, 5, 6] });
  await setSetting('delay_min_s', 0);
  await setSetting('delay_max_s', 0);
  await setSetting('break_min_s', 0);
  await setSetting('break_max_s', 0);
  await setSetting('timezone', 'America/Santiago');
}

export async function mkAccount(o: Partial<{ label: string; mode: 'auto' | 'manual'; newCap: number; totalCap: number; hourly: number; status: string }> = {}) {
  const r = await one<{ id: number }>(
    `insert into accounts (label, status, connection, first_message_mode, daily_new_cap, daily_total_cap, hourly_cap, simulated)
     values ($1,$2,'open',$3,$4,$5,$6,true) returning id`,
    [o.label ?? 'test', o.status ?? 'activa', o.mode ?? 'auto', o.newCap ?? 100, o.totalCap ?? 300, o.hourly ?? 1000],
  );
  return r!.id;
}

let n = 0;
export async function mkContact(o: Partial<{ phone: string; first_name: string | null; business_name: string | null; stage: string; account_id: number | null; step: number; next: string | null }> = {}) {
  n++;
  const phone = o.phone ?? `+5698${String(1000000 + n)}`;
  const r = await one<{ id: number }>(
    `insert into contacts (phone, jid, first_name, name, business_name, stage, account_id, step, next_action_at)
     values ($1,$2,$3,$3,$4,$5,$6,$7,$8) returning id`,
    [phone, phone.replace('+', '') + '@s.whatsapp.net', o.first_name === undefined ? 'Ana' : o.first_name, o.business_name ?? null, o.stage ?? 'valido', o.account_id ?? null, o.step ?? 0, o.next ?? null],
  );
  return r!.id;
}

export function stubControl(accountId: number) {
  const calls: unknown[][] = [];
  const ctl: SessionControl = {
    async pause(reason, minutes) {
      calls.push(['pause', reason, minutes]);
      await exec(`update accounts set status = 'pausada_auto', status_reason = $2 where id = $1`, [accountId, reason]);
    },
    async markLoggedOut() { calls.push(['loggedOut']); },
  };
  return { ctl, calls };
}

const noHandlers: ClientHandlers = {
  onOpen() {}, onClose() {}, onQr() {}, onMessage() {}, onMessageStatus() {}, onLidMapping() {}, onRestriction() {},
};

export function mkDispatcher(accountId: number, client?: FakeClient) {
  const fake = client ?? new FakeClient(accountId, noHandlers, { speed: 0, replyRate: 0, autoOpen: false });
  fake.open = true;
  const { ctl, calls } = stubControl(accountId);
  const d = new Dispatcher(accountId, () => fake, ctl);
  /** Ejecuta n ciclos del dispatcher saltándose la espera entre envíos. */
  const run = async (times = 1) => {
    for (let i = 0; i < times; i++) {
      (d as unknown as { nextSendAt: number }).nextSendAt = 0;
      await d.tick();
    }
  };
  return { d, fake, run, calls };
}

export const contact = (id: number) => one<any>('select * from contacts where id = $1', [id]);
export const msgs = (contactId: number) => q<any>('select * from messages where contact_id = $1 order by step nulls last, id', [contactId]);
