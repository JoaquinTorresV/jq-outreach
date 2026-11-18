export const STAGES = [
  'nuevo', 'valido', 'contactado', 'seguimiento_1', 'seguimiento_2', 'seguimiento_3',
  'respondio', 'calificado', 'cliente', 'agotado', 'perdido',
  'opt_out', 'sin_whatsapp', 'invalido', 'revision', 'descartado',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<string, string> = {
  nuevo: 'Nuevo (sin verificar)',
  valido: 'Válido (listo para 1er mensaje)',
  contactado: 'Contactado',
  seguimiento_1: 'Seguimiento 1',
  seguimiento_2: 'Seguimiento 2',
  seguimiento_3: 'Seguimiento 3',
  respondio: 'Respondió',
  calificado: 'Calificado',
  cliente: 'Cliente',
  agotado: 'Agotado (sin respuesta)',
  perdido: 'Perdido',
  opt_out: 'Opt-out',
  sin_whatsapp: 'Sin WhatsApp',
  invalido: 'Número inválido',
  revision: 'Requiere revisión',
  descartado: 'Descartado',
};

/** Columnas del tablero, en orden. */
export const PIPELINE: Stage[] = [
  'nuevo', 'valido', 'contactado', 'seguimiento_1', 'seguimiento_2', 'seguimiento_3', 'respondio', 'calificado', 'cliente',
];
export const CLOSED: Stage[] = ['agotado', 'perdido', 'opt_out', 'sin_whatsapp', 'invalido', 'revision', 'descartado'];

/** Etapas en las que el sistema todavía puede escribirle al contacto. */
export const ACTIVE_OUTREACH: Stage[] = ['contactado', 'seguimiento_1', 'seguimiento_2'];

export function stageAfterStep(step: number): Stage {
  return step <= 1 ? 'contactado' : (`seguimiento_${Math.min(step - 1, 3)}` as Stage);
}

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  desconectada: 'Desconectada',
  conectando: 'Conectando…',
  activa: 'Activa',
  qr_requerido: 'Requiere QR',
  pausada_auto: 'Pausada (auto)',
  pausada_manual: 'Pausada (manual)',
  baneada: 'Baneada',
};
