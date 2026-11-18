import type { ReactNode } from 'react';
import { STAGE_LABEL, ACCOUNT_STATUS_LABEL } from '@/lib/stages';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute';

export function Badge({ tone = 'mute', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

const STAGE_TONE: Record<string, Tone> = {
  nuevo: 'mute', valido: 'info', contactado: 'info', seguimiento_1: 'info', seguimiento_2: 'info', seguimiento_3: 'warn',
  respondio: 'ok', calificado: 'ok', cliente: 'ok', agotado: 'mute', perdido: 'mute', opt_out: 'bad',
  sin_whatsapp: 'mute', invalido: 'mute', revision: 'warn', descartado: 'mute',
};
export const StageBadge = ({ stage }: { stage: string }) => <Badge tone={STAGE_TONE[stage] ?? 'mute'}>{STAGE_LABEL[stage] ?? stage}</Badge>;

const ACC_TONE: Record<string, Tone> = {
  activa: 'ok', conectando: 'info', desconectada: 'mute', qr_requerido: 'warn', pausada_auto: 'warn', pausada_manual: 'mute', baneada: 'bad',
};
export const AccountBadge = ({ status }: { status: string }) => <Badge tone={ACC_TONE[status] ?? 'mute'}>{ACCOUNT_STATUS_LABEL[status] ?? status}</Badge>;

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {children ? <div className="actions">{children}</div> : null}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: Tone }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="meter" aria-label={`${value} de ${max}`}>
      <div className={`meter-fill ${tone ?? (p >= 100 ? 'warn' : 'info')}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
