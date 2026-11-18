import Link from 'next/link';
import { notFound } from 'next/navigation';
import { contactOutcome, deleteContact, messageAction, saveNotes } from '@/app/actions';
import Flash from '@/components/Flash';
import { Badge, Card, PageHeader, StageBadge } from '@/components/ui';
import { ago, contactLabel, fmtDateTime } from '@/lib/format';
import { getContactDetail } from '@/lib/queries';
import { OUTCOME_STAGES } from '@/lib/maintenance';
import { STAGE_LABEL } from '@/lib/stages';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'mute'> = {
  sent: 'info', delivered: 'ok', read: 'ok', failed: 'bad', unconfirmed: 'warn', blocked: 'warn', retry: 'warn', queued: 'mute', sending: 'info', cancelled: 'mute', received: 'ok',
};

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const { msg } = await searchParams;
  const d = Number(id) ? await getContactDetail(Number(id)) : null;
  if (!d) notFound();
  const { contact: c, messages, events } = d;
  const fields: [string, string | null][] = [
    ['Nombre', c.name], ['Negocio', c.business_name], ['Dirección', c.address], ['Ciudad', c.city], ['Rubro', c.category],
    ['Instagram', c.instagram], ['Facebook', c.facebook], ['Web', c.website], ['Email', c.email],
    ...Object.entries(c.extra ?? {}).map(([k, v]) => [k, String(v)] as [string, string]),
  ];
  return (
    <>
      <PageHeader title={contactLabel(c)} sub={<><span className="mono">{c.phone}</span> · <StageBadge stage={c.stage} />{c.stage_reason ? <span className="muted"> ({c.stage_reason})</span> : null}</>}>
        <a className="btn small" href={`https://wa.me/${c.phone.replace('+', '')}`} target="_blank" rel="noreferrer">Abrir en WhatsApp</a>
        <Link className="btn small" href="/contacts">← Contactos</Link>
      </PageHeader>
      <Flash msg={msg} />
      <div className="grid cols-2">
        <div>
          <Card title="Conversación">
            {messages.length === 0 ? <p className="empty">Aún no hay mensajes.</p> : (
              <div className="bubbles">
                {messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.direction}`}>
                    {m.body ?? <i className="muted">(sin texto aún)</i>}
                    <div className="meta">
                      <Badge tone={STATUS_TONE[m.status] ?? 'mute'}>{m.status}</Badge>
                      {m.direction === 'out' ? <span>paso {m.step}{m.source === 'manual' ? ' · manual' : ''}{m.dry_run ? ' · PRUEBA' : ''}</span> : null}
                      <span>{fmtDateTime(m.sent_at ?? m.created_at)}</span>
                      {m.template_name ? <span>“{m.template_name}”</span> : null}
                      {m.error_code ? <span style={{ color: 'var(--bad)' }}>{m.error_code}{m.error_detail ? `: ${m.error_detail}` : ''}</span> : null}
                    </div>
                    {m.direction === 'out' && ['failed', 'blocked', 'unconfirmed'].includes(m.status) ? (
                      <form action={messageAction} style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input type="hidden" name="message_id" value={m.id} /><input type="hidden" name="return" value={`/contacts/${c.id}`} />
                        <button className="btn small" name="op" value="retry">Reintentar</button>
                        {m.status === 'unconfirmed' ? <button className="btn small" name="op" value="sent">Sí salió</button> : null}
                        <button className="btn small danger" name="op" value="discard">Descartar</button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Historial de eventos">
            {events.length === 0 ? <p className="empty">Sin eventos.</p> : (
              <table><tbody>
                {events.map((e: any) => (
                  <tr key={e.id}><td className="small muted">{fmtDateTime(e.ts)}</td><td><Badge tone={e.level === 'info' ? 'mute' : e.level === 'warn' ? 'warn' : 'bad'}>{e.type}</Badge></td><td className="small muted">{Object.entries(e.detail ?? {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ').slice(0, 140)}</td></tr>
                ))}
              </tbody></table>
            )}
          </Card>
        </div>
        <div>
          <Card title="Estado">
            <table><tbody>
              <tr><td className="muted">Paso</td><td>{c.step}/4</td></tr>
              <tr><td className="muted">Número asignado</td><td>{c.account_label ?? '—'}</td></tr>
              <tr><td className="muted">Primer envío</td><td>{fmtDateTime(c.first_sent_at)}</td></tr>
              <tr><td className="muted">Último envío</td><td>{ago(c.last_outbound_at)}</td></tr>
              <tr><td className="muted">Última respuesta</td><td>{ago(c.last_inbound_at)}</td></tr>
              <tr><td className="muted">Próxima acción</td><td>{c.next_action_at ? `${fmtDateTime(c.next_action_at)} (${ago(c.next_action_at)})` : '—'}</td></tr>
              <tr><td className="muted">Verificado</td><td>{c.verified_at ? ago(c.verified_at) : 'no'}</td></tr>
            </tbody></table>
            <form action={contactOutcome} className="form-row" style={{ marginTop: 12 }}>
              <input type="hidden" name="contact_id" value={c.id} />
              <label>Mover a (detiene los seguimientos)
                <select name="stage" defaultValue="">
                  <option value="" disabled>Elegir…</option>
                  {OUTCOME_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
              </label>
              <button className="btn primary">Aplicar</button>
            </form>
          </Card>
          <Card title="Datos">
            <table><tbody>
              {fields.filter(([, v]) => v).map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td>{v}</td></tr>)}
              {fields.every(([, v]) => !v) ? <tr><td className="muted">Solo se conoce el teléfono.</td></tr> : null}
            </tbody></table>
          </Card>
          <Card title="Notas">
            <form action={saveNotes} style={{ display: 'grid', gap: 8 }}>
              <input type="hidden" name="contact_id" value={c.id} />
              <textarea name="notes" defaultValue={c.notes ?? ''} placeholder="Apuntes de la conversación, próximos pasos…" />
              <div><button className="btn small">Guardar notas</button></div>
            </form>
          </Card>
          <Card>
            <form action={deleteContact}>
              <input type="hidden" name="contact_id" value={c.id} />
              <button className="btn small danger">Eliminar contacto</button> <span className="muted small">Borra también su historial.</span>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
