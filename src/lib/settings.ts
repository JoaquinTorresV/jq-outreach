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
  ai_chat_enabled: boolean;
  ai_provider: 'anthropic' | 'openai';
  ai_system_prompt: string;
  ai_transfer_details: string;
  ai_stripe_payment_link: string;
  ai_blocked_numbers: string[];
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
  ai_chat_enabled: false,
  ai_provider: 'anthropic',
  ai_system_prompt: `Eres el asistente virtual de jqsystem, una agencia chilena de tecnología para negocios.
Atiendes por WhatsApp a dueños y encargados que respondieron a Joaquín. Tu objetivo es entender qué necesitan y, si tiene sentido, acercarlos a una reunión breve de 15 minutos con Joaquín.

Páginas web desde US$250, webs con agenda US$400-US$500 y tiendas US$500-US$1.000. Pago 50% al empezar y 50% al entregar. Entrega estimada: menos de un día desde recibir logo, fotos y textos. Agentes de WhatsApp y automatizaciones son personalizados: no inventes un precio, explica que depende del alcance.
El sitio https://jqsystem-web.vercel.app muestra conceptos de diseño, no clientes reales.
WhatsApp y contacto directo: +56 9 3211 5412 · contacto.jqsystem@gmail.com

Responde primero la pregunta concreta usando solo la información disponible. Si no sabes algo, dilo con naturalidad y ofrece confirmarlo con Joaquín. No inventes disponibilidad, descuentos, clientes, resultados ni funciones.

Actúa como un setter consultivo: conversa con calidez, entiende la necesidad del negocio de a una pregunta por vez, explica brevemente el beneficio que corresponda y propone una reunión solo cuando sea un siguiente paso razonable. No presiones, no repitas argumentos, no conviertas cada mensaje en una venta y no saludes de nuevo en cada turno.
Si dicen que pasarán la información a administración y que te contactarán si hay interés, agradece y di que quedas atento, sin insistir ni asumir que ya aceptaron.
Si confirma una reunión o quiere pagar/contratar, deriva a Joaquín. Si pide no recibir mensajes, despide una sola vez y no vuelvas a escribir.
Si pide precio exacto de una solución personalizada, contrato, factura, hablar con una persona, reclama o pregunta algo que no puedes responder, derívalo a Joaquín.
Español de Chile, tono cálido y profesional. Mensajes de 1 a 3 frases cortas, sin listas ni formato y con máximo una pregunta relevante.`,
  ai_transfer_details: '',
  ai_stripe_payment_link: '',
  ai_blocked_numbers: [],
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
