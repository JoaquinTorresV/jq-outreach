'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { destroySession, requireAuth } from '@/lib/auth';
import { exec, one } from '@/lib/db';
import { notify } from '@/lib/events';
import {
  claimManualDrafts, discardMessage, markManualSent, markMessageSent, rerollDraft, resetDryRun,
  retryAllByCode, retryMessage, setOutcome, skipDraft,
} from '@/lib/maintenance';
import { invalidateVariants } from '@/lib/render';
import { DEFAULTS, getSettings, setSetting, type Settings } from '@/lib/settings';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const int = (fd: FormData, k: string, min: number, max: number, fallback: number) => {
  const n = parseInt(str(fd, k), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (fd: FormData, k: string) => fd.get(k) === 'on' || fd.get(k) === 'true';
const back = (path: string, msg?: string): never => redirect(msg ? `${path}${path.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}` : path);

export async function logout() {
  await destroySession();
  redirect('/login');
}

// ───────── Cuentas ─────────
function validProxy(v: string) {
  return !v || /^(https?|socks5h?|socks4a?):\/\/\S+$/i.test(v);
}

export async function saveAccount(fd: FormData) {
  await requireAuth();
  const id = int(fd, 'id', 0, 1e9, 0);
  const proxy = str(fd, 'proxy_url');
  if (!validProxy(proxy)) return back('/accounts', 'El proxy debe empezar con http://, https:// o socks5://');
  const label = str(fd, 'label') || 'Número';
  const mode = str(fd, 'first_message_mode') === 'auto' ? 'auto' : 'manual';
  const newCap = int(fd, 'daily_new_cap', 0, 1000, 50);
  const totalCap = Math.max(newCap, int(fd, 'daily_total_cap', 1, 2000, 150));
  const hourly = int(fd, 'hourly_cap', 1, 500, 40);
  if (id) {
    await exec(
      `update accounts set label = $2, first_message_mode = $3, daily_new_cap = $4, daily_total_cap = $5, hourly_cap = $6, proxy_url = $7 where id = $1`,
      [id, label, mode, newCap, totalCap, hourly, proxy || null],
    );
  } else {
    await exec(
      `insert into accounts (label, first_message_mode, daily_new_cap, daily_total_cap, hourly_cap, proxy_url, simulated) values ($1,$2,$3,$4,$5,$6,$7)`,
      [label, mode, newCap, totalCap, hourly, proxy || null, bool(fd, 'simulated')],
    );
  }
  revalidatePath('/accounts');
  back('/accounts', id ? 'Cuenta actualizada' : 'Cuenta creada: en unos segundos aparece el QR para vincularla');
}

export async function deleteAccount(fd: FormData) {
  await requireAuth();
  await exec('delete from accounts where id = $1', [int(fd, 'id', 0, 1e9, 0)]);
  back('/accounts', 'Cuenta eliminada');
}

export async function accountCommand(fd: FormData) {
  await requireAuth();
  const id = int(fd, 'account_id', 0, 1e9, 0);
  const type = str(fd, 'type');
  if (!['connect', 'disconnect', 'logout', 'pause', 'resume', 'pairing', 'refresh_caps'].includes(type)) return;
  const payload: Record<string, string> = {};
  const phone = str(fd, 'phone').replace(/\D/g, '');
  if (type === 'pairing' && phone.length < 8) return back('/accounts', 'Ingresa el número con código de país, solo dígitos (ej. 56912345678)');
  if (phone) payload.phone = phone;
  await exec('insert into commands(account_id, type, payload) values ($1,$2,$3::jsonb)', [id, type, JSON.stringify(payload)]);
  revalidatePath('/accounts');
  back('/accounts', 'Orden enviada al worker');
}

// ───────── Plantillas ─────────
export async function saveTemplate(fd: FormData) {
  await requireAuth();
  const id = int(fd, 'id', 0, 1e9, 0);
  const step = int(fd, 'step', 1, 4, 1);
  const kind = str(fd, 'kind') === 'failover' ? 'failover' : 'normal';
  const name = str(fd, 'name') || 'Variante';
  const body = String(fd.get('body') ?? '').replace(/\r/g, '').trim();
  const weight = int(fd, 'weight', 1, 20, 1);
  const requires = str(fd, 'requires').split(',').map((s) => s.trim()).filter(Boolean);
  if (!body) return back('/templates', 'El texto no puede estar vacío');
  if (id) {
    await exec(`update templates set step=$2, kind=$3, name=$4, body=$5, weight=$6, requires=$7, active=$8, updated_at=now() where id=$1`, [id, step, kind, name, body, weight, requires, bool(fd, 'active')]);
  } else {
    await exec(`insert into templates (step, kind, name, body, weight, requires, active) values ($1,$2,$3,$4,$5,$6,true)`, [step, kind, name, body, weight, requires]);
  }
  invalidateVariants();
  revalidatePath('/templates');
  back('/templates', 'Plantilla guardada (el worker la usa en ~5 segundos)');
}

export async function deleteTemplate(fd: FormData) {
  await requireAuth();
  await exec('delete from templates where id = $1', [int(fd, 'id', 0, 1e9, 0)]);
  invalidateVariants();
  back('/templates', 'Plantilla eliminada');
}

// ───────── Ajustes ─────────
export async function saveSettings(fd: FormData) {
  await requireAuth();
  const cur = await getSettings(0);
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => fd.get(`day_${d}`) === 'on');
  const dmin = int(fd, 'delay_min_s', 0, 3600, cur.delay_min_s);
  const bmin = int(fd, 'break_min_s', 0, 7200, cur.break_min_s);
  const next: Partial<Settings> = {
    timezone: str(fd, 'timezone') || cur.timezone,
    send_window: { start_hour: int(fd, 'start_hour', 0, 23, 9), end_hour: int(fd, 'end_hour', 1, 24, 20), days: days.length ? days : [1, 2, 3, 4, 5] },
    delay_min_s: dmin, delay_max_s: Math.max(dmin, int(fd, 'delay_max_s', 0, 3600, cur.delay_max_s)),
    break_every_min: int(fd, 'break_every_min', 2, 100, cur.break_every_min), break_every_max: int(fd, 'break_every_max', 2, 200, cur.break_every_max),
    break_min_s: bmin, break_max_s: Math.max(bmin, int(fd, 'break_max_s', 0, 7200, cur.break_max_s)),
    followup_days: str(fd, 'followup_days').split(',').map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= 60).slice(0, 3),
    exhaust_after_days: int(fd, 'exhaust_after_days', 1, 60, cur.exhaust_after_days),
    max_send_attempts: int(fd, 'max_send_attempts', 1, 5, cur.max_send_attempts),
    circuit_breaker_failures: int(fd, 'circuit_breaker_failures', 2, 50, cur.circuit_breaker_failures),
    verify_per_hour: int(fd, 'verify_per_hour', 10, 2000, cur.verify_per_hour), verify_batch: int(fd, 'verify_batch', 1, 50, cur.verify_batch),
    verify_buffer: int(fd, 'verify_buffer', 10, 5000, cur.verify_buffer),
    duplicate_guard_max: int(fd, 'duplicate_guard_max', 1, 1000, cur.duplicate_guard_max),
    qr_failover_minutes: int(fd, 'qr_failover_minutes', 5, 1440, cur.qr_failover_minutes),
    stop_new_after: /^\d{4}-\d{2}-\d{2}$/.test(str(fd, 'stop_new_after')) ? str(fd, 'stop_new_after') : null,
    notify_replies: bool(fd, 'notify_replies'),
    alert_webhook_url: /^https:\/\//.test(str(fd, 'alert_webhook_url')) ? str(fd, 'alert_webhook_url') : '',
    alert_min_level: (['info', 'warn', 'error', 'critical'] as const).find((l) => l === str(fd, 'alert_min_level')) ?? 'error',
    ai_personalization: bool(fd, 'ai_personalization'),
  };
  if (next.followup_days!.length < 3) next.followup_days = DEFAULTS.followup_days;
  try { new Intl.DateTimeFormat('es', { timeZone: next.timezone }); } catch { return back('/settings', 'Zona horaria inválida (ej. America/Santiago)'); }
  for (const [k, v] of Object.entries(next)) await setSetting(k as keyof Settings, v as never);
  revalidatePath('/', 'layout');
  back('/settings', 'Ajustes guardados');
}

export async function toggleSwitch(fd: FormData) {
  await requireAuth();
  const key = str(fd, 'key');
  if (key !== 'kill_switch' && key !== 'dry_run') return;
  await setSetting(key, !(await getSettings(0))[key]);
  revalidatePath('/', 'layout');
  back(str(fd, 'return') || '/');
}

export async function clearDryRun() {
  await requireAuth();
  const r = await resetDryRun();
  back('/settings', `Datos de prueba eliminados (${r.messages} mensajes, ${r.contacts} contactos restaurados)`);
}

export async function testAlert() {
  await requireAuth();
  const ok = await notify('✅ Alerta de prueba de jq-outreach: el webhook funciona.');
  back('/settings', ok ? 'Alerta de prueba enviada' : 'No se pudo enviar: revisa la URL del webhook');
}

// ───────── Contactos y mensajes ─────────
export async function contactOutcome(fd: FormData) {
  await requireAuth();
  const id = int(fd, 'contact_id', 0, 1e12, 0);
  await setOutcome(id, str(fd, 'stage'));
  revalidatePath(`/contacts/${id}`);
  back(`/contacts/${id}`, 'Etapa actualizada');
}

export async function saveNotes(fd: FormData) {
  await requireAuth();
  const id = int(fd, 'contact_id', 0, 1e12, 0);
  await exec('update contacts set notes = $2, updated_at = now() where id = $1', [id, String(fd.get('notes') ?? '').slice(0, 4000) || null]);
  back(`/contacts/${id}`, 'Notas guardadas');
}

export async function deleteContact(fd: FormData) {
  await requireAuth();
  await exec('delete from contacts where id = $1', [int(fd, 'contact_id', 0, 1e12, 0)]);
  back('/contacts', 'Contacto eliminado');
}

export async function messageAction(fd: FormData) {
  await requireAuth();
  const id = int(fd, 'message_id', 0, 1e12, 0);
  const op = str(fd, 'op');
  const ok = op === 'retry' ? await retryMessage(id) : op === 'sent' ? await markMessageSent(id) : op === 'discard' ? await discardMessage(id) : false;
  const ret = str(fd, 'return') || '/errors';
  back(ret, ok ? 'Listo' : 'No se pudo (¿ya cambió de estado?)');
}

export async function retryByCode(fd: FormData) {
  await requireAuth();
  const n = await retryAllByCode(str(fd, 'code'));
  back('/errors', `${n} mensajes puestos en cola de nuevo`);
}

// ───────── Cola manual ─────────
export async function claimManual(fd: FormData) {
  await requireAuth();
  const acct = int(fd, 'account_id', 0, 1e9, 0);
  const r = await claimManualDrafts(acct, int(fd, 'count', 1, 100, 20));
  const msg = r.taken
    ? `${r.taken} contactos listos para enviar${r.skipped ? ` (${r.skipped} fueron a revisión por falta de datos)` : ''}`
    : r.reason === 'sin_cupo' ? 'Ya alcanzaste el cupo de contactos nuevos de hoy para este número'
    : r.reason === 'campana_cerrada' ? 'La campaña está cerrada para contactos nuevos (ver Ajustes)' : 'No hay contactos válidos disponibles: importa más o espera la verificación';
  back(`/manual?account=${acct}`, msg);
}

export async function manualAction(fd: FormData) {
  await requireAuth();
  const contact = int(fd, 'contact_id', 0, 1e12, 0);
  const acct = int(fd, 'account_id', 0, 1e9, 0);
  const op = str(fd, 'op');
  if (op === 'reroll') await rerollDraft(contact);
  else if (op === 'skip') await skipDraft(contact);
  else if (op === 'sent') await markManualSent(contact);
  revalidatePath('/manual');
  back(`/manual?account=${acct}`);
}

export async function deleteBatch(fd: FormData) {
  await requireAuth();
  const id = int(fd, 'id', 0, 1e9, 0);
  // solo borra contactos que nunca recibieron mensajes
  const r = await one<{ n: number }>(`with d as (delete from contacts where batch_id = $1 and step = 0 and stage in ('nuevo','valido','sin_whatsapp','revision') returning 1) select count(*)::int as n from d`, [id]);
  back('/import', `${r?.n ?? 0} contactos sin contactar eliminados de ese lote`);
}
