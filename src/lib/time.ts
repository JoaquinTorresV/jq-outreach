import type { SendWindow } from './settings';

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(date: Date, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const part of fmt(tz).formatToParts(date)) p[part.type] = part.value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, weekday: WD[p.weekday] ?? 0,
  };
}

/** Diferencia (ms) entre la hora "de pared" en tz y UTC para un instante dado. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const sec = +(fmt(tz).formatToParts(date).find((x) => x.type === 'second')?.value ?? 0);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, sec);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convierte una hora local (en tz) a instante UTC. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz); // segunda pasada por cambios de horario
  return new Date(t);
}

export function inSendWindow(date: Date, tz: string, w: SendWindow): boolean {
  const p = localParts(date, tz);
  if (!w.days.includes(p.weekday)) return false;
  return p.hour >= w.start_hour && p.hour < w.end_hour;
}

/** Próximo inicio de ventana de envío (o la misma fecha si ya está dentro). */
export function nextWindowStart(from: Date, tz: string, w: SendWindow): Date {
  if (inSendWindow(from, tz, w)) return from;
  const p = localParts(from, tz);
  for (let add = 0; add < 9; add++) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + add));
    const cand = zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), w.start_hour, 0, tz);
    const wd = localParts(cand, tz).weekday;
    if (cand.getTime() > from.getTime() && w.days.includes(wd)) return cand;
  }
  return new Date(from.getTime() + 24 * 3600_000);
}

export function greeting(date: Date, tz: string): string {
  const h = localParts(date, tz).hour;
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);
export const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
