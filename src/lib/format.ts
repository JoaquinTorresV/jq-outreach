export function fmtDateTime(d: string | Date | null | undefined, tz = 'America/Santiago'): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('es-CL', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}

export function ago(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  const f = s < 0;
  const a = Math.abs(s);
  const t = a < 60 ? `${a}s` : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  return f ? `en ${t}` : `hace ${t}`;
}

export const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');

export function contactLabel(c: { first_name?: string | null; name?: string | null; business_name?: string | null; phone: string }) {
  return c.business_name || c.name || c.first_name || c.phone;
}
