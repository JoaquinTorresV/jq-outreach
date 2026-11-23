import { one, q } from './db';
import { effectiveNewCap, startOfLocalDay } from './schedule';
import { getSettings } from './settings';
import type { AccountRow, ContactRow, MessageRow } from './types';

export const PAGE_SIZE = 50;

export async function getAccounts() {
  return q<AccountRow>('select * from accounts order by id');
}

export async function getOverview() {
  const s = await getSettings();
  const dayStart = startOfLocalDay(new Date(), s.timezone);
  const accounts = await getAccounts();
  const usage = await q<{ account_id: number; today: number; new_today: number; last_hour: number }>(
    `select account_id, count(*) filter (where sent_at >= $1)::int as today,
            count(*) filter (where sent_at >= $1 and step = 1)::int as new_today,
            count(*) filter (where sent_at >= now() - interval '1 hour')::int as last_hour
     from messages where direction = 'out' and dry_run = $2 and sent_at >= least($1::timestamptz, now() - interval '1 hour') group by account_id`,
    [dayStart, s.dry_run],
  );
  const perAccount = accounts.map((a) => {
    const u = usage.find((x) => x.account_id === a.id);
    return { ...a, today: u?.today ?? 0, new_today: u?.new_today ?? 0, last_hour: u?.last_hour ?? 0, new_cap: effectiveNewCap(a, accounts) };
  });
  const funnel = await q<{ stage: string; n: number }>('select stage, count(*)::int as n from contacts group by stage');
  const day = await one<any>(
    `select
       (select count(*)::int from messages where direction = 'out' and not dry_run and sent_at > now() - interval '24 hours') as sent_24h,
       (select count(*)::int from messages where direction = 'out' and not dry_run and status in ('delivered','read') and sent_at > now() - interval '24 hours') as delivered_24h,
       (select count(*)::int from messages where direction = 'in' and sent_at > now() - interval '24 hours') as replies_24h,
       (select count(*)::int from messages where direction = 'out' and status in ('failed','unconfirmed','blocked')) as needs_action,
       (select count(*)::int from contacts where stage = 'revision') as in_review,
       (select count(*)::int from messages where direction = 'out' and status = 'retry') as retrying`,
  );
  const rate = await one<any>(
    `select count(*)::int as sent, (count(*) filter (where c.last_inbound_at is not null))::int as replied,
            (count(*) filter (where c.stage in ('calificado','cliente')))::int as qualified
     from messages m join contacts c on c.id = m.contact_id
     where m.direction = 'out' and m.step = 1 and not m.dry_run and m.status in ('sent','delivered','read','unconfirmed')`,
  );
  const rateByAccount = await q<{ account_id: number; sent: number; replied: number }>(
    `select m.account_id, count(*)::int as sent, (count(*) filter (where c.last_inbound_at is not null))::int as replied
     from messages m join contacts c on c.id = m.contact_id
     where m.direction = 'out' and m.step = 1 and not m.dry_run group by m.account_id`,
  );
  const queue = await one<any>(
    `select
       (select count(*)::int from contacts where stage in ('contactado','seguimiento_1','seguimiento_2') and next_action_at <= now() and last_inbound_at is null) as followups_due,
       (select count(*)::int from contacts where stage in ('contactado','seguimiento_1','seguimiento_2') and next_action_at > now() and next_action_at <= now() + interval '24 hours' and last_inbound_at is null) as followups_24h,
       (select count(*)::int from contacts where stage = 'valido' and step = 0) as ready_new,
       (select count(*)::int from contacts where stage = 'nuevo') as unverified`,
  );
  const workers = await q<{ worker_id: string; age: number; info: any }>(
    `select worker_id, extract(epoch from now() - last_seen)::int as age, info from worker_status order by last_seen desc limit 5`,
  );
  const events = await q<any>(`select * from events where level in ('warn','error','critical') order by ts desc limit 12`);
  return { settings: s, accounts: perAccount, funnel, day, rate, rateByAccount, queue, workers, events };
}

export type ContactFilters = { q?: string; stage?: string; account?: string; batch?: string; campaign?: string; page?: number };

function contactWhere(f: ContactFilters) {
  const where: string[] = [];
  const p: unknown[] = [];
  if (f.q) {
    p.push(`%${f.q.trim()}%`);
    where.push(`(c.name ilike $${p.length} or c.business_name ilike $${p.length} or c.phone ilike $${p.length} or c.address ilike $${p.length} or c.instagram ilike $${p.length})`);
  }
  if (f.stage) { p.push(f.stage); where.push(`c.stage = $${p.length}`); }
  if (f.account === 'none') where.push('c.account_id is null');
  else if (f.account) { p.push(Number(f.account)); where.push(`c.account_id = $${p.length}`); }
  if (f.batch) { p.push(Number(f.batch)); where.push(`c.batch_id = $${p.length}`); }
  if (f.campaign) { p.push(f.campaign); where.push(`c.campaign = $${p.length}`); }
  return { sql: where.length ? 'where ' + where.join(' and ') : '', p };
}

export async function listContacts(f: ContactFilters, limit = PAGE_SIZE) {
  const { sql, p } = contactWhere(f);
  const total = (await one<{ n: number }>(`select count(*)::int as n from contacts c ${sql}`, p))?.n ?? 0;
  const page = Math.max(1, f.page ?? 1);
  const rows = await q<ContactRow & { account_label: string | null }>(
    `select c.*, a.label as account_label from contacts c left join accounts a on a.id = c.account_id ${sql}
     order by c.updated_at desc, c.id desc limit ${limit} offset ${(page - 1) * limit}`,
    p,
  );
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function exportContacts(f: ContactFilters) {
  const { sql, p } = contactWhere(f);
  return q<any>(
    `select c.phone, c.name, c.business_name, c.address, c.city, c.category, c.instagram, c.facebook, c.website, c.maps_url, c.email, c.campaign,
            c.stage, c.step, a.label as numero, c.first_sent_at, c.last_outbound_at, c.last_inbound_at, c.next_action_at, c.notes
     from contacts c left join accounts a on a.id = c.account_id ${sql} order by c.id`,
    p,
  );
}

export async function getContactDetail(id: number) {
  const contact = await one<ContactRow & { account_label: string | null }>(
    'select c.*, a.label as account_label from contacts c left join accounts a on a.id = c.account_id where c.id = $1', [id],
  );
  if (!contact) return null;
  const messages = await q<MessageRow & { template_name: string | null }>(
    `select m.*, t.name as template_name from messages m left join templates t on t.id = m.template_id
     where m.contact_id = $1 order by coalesce(m.sent_at, m.created_at), m.id`, [id],
  );
  const events = await q<any>('select * from events where contact_id = $1 order by ts desc limit 40', [id]);
  return { contact, messages, events };
}

export async function getPipeline(perColumn = 12) {
  const counts = await q<{ stage: string; n: number }>('select stage, count(*)::int as n from contacts group by stage');
  const cards = await q<Pick<ContactRow, 'id' | 'first_name' | 'name' | 'business_name' | 'phone' | 'stage' | 'step' | 'account_id' | 'campaign' | 'last_inbound_at' | 'next_action_at' | 'updated_at'>>(
    `select * from (
       select c.id, c.first_name, c.name, c.business_name, c.phone, c.stage, c.step, c.account_id, c.campaign, c.last_inbound_at, c.next_action_at, c.updated_at,
              row_number() over (partition by c.stage order by (c.stage = 'respondio') desc, c.updated_at desc) as rn
       from contacts c) t where rn <= $1`,
    [perColumn],
  );
  return { counts, cards };
}

export async function getErrors() {
  const actionable = await q<any>(
    `select m.*, c.first_name, c.name, c.business_name, c.phone, a.label as account_label
     from messages m join contacts c on c.id = m.contact_id left join accounts a on a.id = m.account_id
     where m.direction = 'out' and m.status in ('failed','unconfirmed','blocked') order by m.updated_at desc limit 200`,
  );
  const retrying = await q<any>(
    `select m.*, c.first_name, c.name, c.business_name, c.phone from messages m join contacts c on c.id = m.contact_id
     where m.direction = 'out' and m.status = 'retry' order by m.retry_at limit 100`,
  );
  const review = await q<any>(
    `select id, first_name, name, business_name, phone, stage, stage_reason, updated_at
     from contacts where stage in ('revision','sin_whatsapp','invalido') order by updated_at desc limit 100`,
  );
  return { actionable, retrying, review };
}

export async function getEvents(level: string | undefined, limit = 100) {
  const levels = level === 'all' ? ['info', 'warn', 'error', 'critical'] : level === 'warn' ? ['warn', 'error', 'critical'] : ['error', 'critical'];
  return q<any>(
    `select e.*, a.label as account_label from events e left join accounts a on a.id = e.account_id
     where e.level = any($1) order by e.ts desc limit $2`,
    [levels, limit],
  );
}

export async function getTemplates() {
  return q<any>(
    `select t.*,
       (select count(*)::int from messages m where m.template_id = t.id and m.direction = 'out' and not m.dry_run and m.status in ('sent','delivered','read')) as sent,
       (select count(*)::int from messages m join contacts c on c.id = m.contact_id
          where m.template_id = t.id and m.direction = 'out' and not m.dry_run and c.last_inbound_at is not null) as replied
     from templates t order by t.step, t.kind, t.id`,
  );
}

export async function getBatches() {
  return q<any>(`select b.*, (select count(*)::int from contacts c where c.batch_id = b.id) as contacts from import_batches b order by b.id desc limit 15`);
}

export async function getManualQueue(accountId: number) {
  return q<any>(
    `select m.id as message_id, m.body, c.id as contact_id, c.first_name, c.name, c.business_name, c.phone, c.address, c.instagram, c.website
     from messages m join contacts c on c.id = m.contact_id
     where m.direction = 'out' and m.step = 1 and m.status = 'queued' and m.account_id = $1 order by m.id`,
    [accountId],
  );
}

export async function getCommands(accountId: number) {
  return q<any>('select * from commands where account_id = $1 order by id desc limit 4', [accountId]);
}
