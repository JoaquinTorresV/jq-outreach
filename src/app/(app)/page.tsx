import Link from 'next/link';
import { accountCommand, toggleSwitch } from '@/app/actions';
import AutoRefresh from '@/components/AutoRefresh';
import Flash from '@/components/Flash';
import { AccountBadge, Badge, Card, Meter, PageHeader, Stat } from '@/components/ui';
import { ago, fmtDateTime, pct } from '@/lib/format';
import { getOverview } from '@/lib/queries';
import { PIPELINE, CLOSED, STAGE_LABEL } from '@/lib/stages';

export default async function Overview({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const o = await getOverview();
  const funnel = Object.fromEntries(o.funnel.map((f) => [f.stage, f.n]));
  const total = o.funnel.reduce((a, f) => a + f.n, 0);
  const maxBar = Math.max(1, ...o.funnel.map((f) => f.n));
  const contacted = o.rate?.sent ?? 0;

  return (
    <>
      <AutoRefresh seconds={15} />
      <PageHeader title="Resumen" sub={`${total.toLocaleString('es-CL')} contactos · actualizado automáticamente`}>
        <form action={toggleSwitch}>
          <input type="hidden" name="key" value="dry_run" />
          <button className="btn small">{o.settings.dry_run ? 'Salir del modo prueba' : 'Activar modo prueba'}</button>
        </form>
      </PageHeader>
      <Flash msg={msg} />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Enviados (24 h)" value={o.day?.sent_24h ?? 0} sub={`${pct(o.day?.delivered_24h ?? 0, o.day?.sent_24h ?? 0)} entregados`} />
        <Stat label="Respuestas (24 h)" value={o.day?.replies_24h ?? 0} tone="ok" />
        <Stat label="Tasa de respuesta (1er mensaje)" value={pct(o.rate?.replied ?? 0, contacted)} sub={`${o.rate?.replied ?? 0} de ${contacted} · ${o.rate?.qualified ?? 0} calificados/clientes`} />
        <Stat label="Requieren tu atención" value={(o.day?.needs_action ?? 0) + (o.day?.in_review ?? 0)} tone={(o.day?.needs_action ?? 0) + (o.day?.in_review ?? 0) ? 'bad' : undefined}
          sub={<Link href="/errors">ver errores</Link>} />
      </div>

      <h2 style={{ margin: '0 0 10px' }}>Números de WhatsApp</h2>
      {o.accounts.length === 0 ? (
        <Card><p className="empty">Aún no hay números. <Link href="/accounts">Agrega el primero</Link> y vincúlalo con el QR.</p></Card>
      ) : (
        <div className="grid cols-2">
          {o.accounts.map((a) => {
            const rb = o.rateByAccount.find((r) => r.account_id === a.id);
            const warn = a.cap_info as any;
            return (
              <Card key={a.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                  <div>
                    <h3 style={{ marginBottom: 2 }}>{a.label} {a.simulated ? <Badge tone="info">simulado</Badge> : null}</h3>
                    <div className="muted small">{a.phone ?? 'sin vincular'} · primer mensaje: {a.first_message_mode === 'auto' ? 'automático' : 'manual'}</div>
                  </div>
                  <AccountBadge status={a.status} />
                </div>
                {a.status_reason && a.status !== 'activa' ? <p className="alert warn small">Motivo: <b>{a.status_reason}</b>{a.paused_until ? ` · hasta ${fmtDateTime(a.paused_until, o.settings.timezone)}` : ''}</p> : null}
                {warn?.new_chat_cap?.status && warn.new_chat_cap.status !== 'NONE' ? <p className="alert warn small">WhatsApp: límite de chats nuevos {warn.new_chat_cap.status} ({warn.new_chat_cap.used ?? '?'}/{warn.new_chat_cap.total ?? '?'})</p> : null}
                {!a.proxy_url && !a.simulated ? <p className="muted small">Sin proxy: sale por la IP del servidor.</p> : null}
                <div style={{ display: 'grid', gap: 10, margin: '12px 0' }}>
                  <div><div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Enviados hoy</span><b>{a.today} / {a.daily_total_cap}</b></div><Meter value={a.today} max={a.daily_total_cap} /></div>
                  <div><div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Contactos nuevos hoy</span><b>{a.new_today} / {a.new_cap}</b></div><Meter value={a.new_today} max={a.new_cap} /></div>
                  <div><div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Última hora</span><b>{a.last_hour} / {a.hourly_cap}</b></div><Meter value={a.last_hour} max={a.hourly_cap} /></div>
                </div>
                <div className="muted small">
                  Último envío {ago(a.last_sent_at)} · latido {ago(a.last_heartbeat)} · respuesta {pct(rb?.replied ?? 0, rb?.sent ?? 0)} ({rb?.replied ?? 0}/{rb?.sent ?? 0})
                  {a.consecutive_failures > 0 ? <> · <b style={{ color: 'var(--bad)' }}>{a.consecutive_failures} fallos seguidos</b></> : null}
                </div>
                <form action={accountCommand} style={{ marginTop: 10 }}>
                  <input type="hidden" name="account_id" value={a.id} />
                  <button className="btn small" name="type" value={a.status === 'pausada_manual' ? 'resume' : a.status === 'pausada_auto' ? 'resume' : 'pause'}>
                    {a.status === 'pausada_manual' || a.status === 'pausada_auto' ? 'Reanudar' : 'Pausar este número'}
                  </button>{' '}
                  <Link className="btn small" href="/accounts">Administrar</Link>
                </form>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid cols-2">
        <Card title="Embudo">
          <div className="bars">
            {[...PIPELINE, ...CLOSED].map((st) => (
              <div className="row" key={st}>
                <Link href={`/contacts?stage=${st}`} className="small">{STAGE_LABEL[st]}</Link>
                <Meter value={funnel[st] ?? 0} max={maxBar} tone={st === 'respondio' || st === 'cliente' || st === 'calificado' ? 'ok' : st === 'opt_out' ? 'bad' : undefined} />
                <span className="small" style={{ textAlign: 'right' }}>{funnel[st] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>
        <div>
          <Card title="Cola">
            <div className="grid cols-2" style={{ gap: 10 }}>
              <Stat label="Seguimientos por enviar ahora" value={o.queue?.followups_due ?? 0} />
              <Stat label="Seguimientos en las próximas 24 h" value={o.queue?.followups_24h ?? 0} />
              <Stat label="Válidos listos para el 1er mensaje" value={o.queue?.ready_new ?? 0} tone={(o.queue?.ready_new ?? 0) === 0 ? 'warn' : undefined} />
              <Stat label="Pendientes de verificar" value={o.queue?.unverified ?? 0} />
            </div>
          </Card>
          <Card title="Servicio worker">
            {o.workers.length === 0 ? <p className="alert bad">Nunca se ha conectado ningún worker.</p> : (
              <table><tbody>
                {o.workers.map((w) => (
                  <tr key={w.worker_id}><td className="mono">{w.worker_id}</td><td>{w.age < 60 ? <Badge tone="ok">activo</Badge> : <Badge tone="bad">sin señal</Badge>}</td><td className="muted small">hace {w.age < 90 ? `${w.age}s` : `${Math.round(w.age / 60)} min`}</td></tr>
                ))}
              </tbody></table>
            )}
          </Card>
        </div>
      </div>

      <Card title="Alertas recientes">
        {o.events.length === 0 ? <p className="empty">Sin alertas. Todo tranquilo.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Cuándo</th><th>Nivel</th><th>Evento</th><th>Detalle</th></tr></thead>
            <tbody>
              {o.events.map((e: any) => (
                <tr key={e.id}>
                  <td className="small">{fmtDateTime(e.ts, o.settings.timezone)}</td>
                  <td><Badge tone={e.level === 'warn' ? 'warn' : 'bad'}>{e.level}</Badge></td>
                  <td>{e.type}{e.account_id ? <span className="muted small"> · cuenta #{e.account_id}</span> : null}</td>
                  <td className="small muted">{Object.entries(e.detail ?? {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ').slice(0, 160)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="small"><Link href="/errors">Ver todos los eventos y errores</Link></p>
      </Card>
    </>
  );
}
