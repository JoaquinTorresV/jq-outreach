import type { Settings } from './settings';
import { localParts, zonedToUtc } from './time';

export type CapAccount = { id: number; status: string; daily_new_cap: number; daily_total_cap: number };

/** Cuentas "caídas": su cupo de contactos nuevos lo absorben las demás (failover de volumen). */
const DOWN = new Set(['baneada', 'qr_requerido', 'pausada_auto', 'desconectada']);

export function effectiveNewCap(self: CapAccount, all: CapAccount[]): number {
  const others = all.filter((a) => a.id !== self.id);
  const down = others.filter((a) => DOWN.has(a.status));
  const up = [self, ...others.filter((a) => !DOWN.has(a.status))];
  const downCap = down.reduce((s, a) => s + a.daily_new_cap, 0);
  const upCap = Math.max(1, up.reduce((s, a) => s + a.daily_new_cap, 0));
  const extra = downCap * (self.daily_new_cap / upCap);
  return Math.min(self.daily_total_cap, Math.round(self.daily_new_cap + extra));
}

export function startOfLocalDay(now: Date, tz: string): Date {
  const p = localParts(now, tz);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
}

export function localDateStr(now: Date, tz: string): string {
  const p = localParts(now, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Cuándo toca el siguiente paso tras enviar el mensaje número `step`. En modo prueba los días pasan a minutos. */
export function nextActionAfter(step: number, s: Settings, now: Date = new Date()): Date {
  const gaps = s.followup_days.length ? s.followup_days : [2, 4, 7];
  const days = step >= 4 ? s.exhaust_after_days : gaps[Math.min(step - 1, gaps.length - 1)];
  const unit = s.dry_run ? 60_000 : 86_400_000;
  const jitter = s.dry_run ? 0 : (Math.random() - 0.5) * 6 * 3_600_000; // ±3 h para no ser predecible
  return new Date(now.getTime() + days * unit + jitter);
}
