import { q, exec } from './db';
import { env } from './env';

export type SendWindow = { start_hour: number; end_hour: number; days: number[] }; // days: 0=dom … 6=sáb

export type Settings = {
  kill_switch: boolean;
  dry_run: boolean;
  timezone: string;
  send_window: SendWindow;
  delay_min_s: number;
  delay_max_s: number;
  break_every_min: number;
  break_every_max: number;
  break_min_s: number;
  break_max_s: number;
  followup_days: number[];     // espera tras el paso 1, 2 y 3 antes del siguiente seguimiento
  exhaust_after_days: number;  // tras el último seguimiento, días hasta marcar "agotado"
  max_send_attempts: number;
  circuit_breaker_failures: number;
  verify_per_hour: number;
  verify_batch: number;
  verify_buffer: number;       // cuántos contactos "válidos" listos se mantienen de reserva
  duplicate_guard_max: number; // máx. de mensajes idénticos por cuenta en 24 h
  qr_failover_minutes: number;
  stop_new_after: string | null; // YYYY-MM-DD: desde esa fecha no se inician contactos nuevos
  notify_replies: boolean;
  alert_webhook_url: string;
  alert_min_level: 'info' | 'warn' | 'error' | 'critical';
  ai_personalization: boolean;
};

export const DEFAULTS: Settings = {
  kill_switch: false,
  dry_run: false,
  timezone: 'America/Santiago',
  send_window: { start_hour: 9, end_hour: 20, days: [1, 2, 3, 4, 5, 6] },
  delay_min_s: 40,
  delay_max_s: 150,
  break_every_min: 8,
  break_every_max: 15,
  break_min_s: 240,
  break_max_s: 600,
  followup_days: [2, 4, 7],
  exhaust_after_days: 7,
  max_send_attempts: 2,
  circuit_breaker_failures: 5,
  verify_per_hour: 200,
  verify_batch: 10,
  verify_buffer: 200,
  duplicate_guard_max: 3,
  qr_failover_minutes: 60,
  stop_new_after: null,
  notify_replies: true,
  alert_webhook_url: '',
  alert_min_level: 'error',
  ai_personalization: false,
};

let cache: { at: number; value: Settings } | null = null;

export async function getSettings(maxAgeMs = 3000): Promise<Settings> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.value;
  const rows = await q<{ key: string; value: unknown }>('select key, value from settings');
  const merged: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) merged[r.key] = r.value;
  const value = merged as Settings;
  if (!value.alert_webhook_url) value.alert_webhook_url = env('ALERT_WEBHOOK_URL');
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateSettings() {
  cache = null;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await exec(
    'insert into settings(key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value',
    [key, JSON.stringify(value)],
  );
  invalidateSettings();
}
