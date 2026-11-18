import Link from 'next/link';
import { messageAction, retryByCode } from '@/app/actions';
import AutoRefresh from '@/components/AutoRefresh';
import Flash from '@/components/Flash';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ago, contactLabel, fmtDateTime } from '@/lib/format';
import { getErrors, getEvents } from '@/lib/queries';

const HELP: Record<string, string> = {
  timeout: 'WhatsApp no confirmó el envío. Puede haber salido: míralo en el chat y usa “Sí salió”; si no salió, reintenta.',
  send_error: 'Falló el envío tras los reintentos automáticos.',
  sin_plantilla_aplicable: 'Ninguna variante activa sirve con los datos de este contacto. Agrega una variante “sin datos” en Plantillas y reintenta.',
  variable_sin_reemplazar: 'El texto quedó con una variable sin reemplazar (llaves {}). Revisa la plantilla.',
  texto_vacio: 'El texto resultó vacío.',
  worker_reinicio: 'El worker se reinició en pleno envío. Verifica en WhatsApp si salió.',
  colgado: 'El envío quedó sin respuesta. Verifica en WhatsApp si salió.',
  entrega_fallida: 'WhatsApp reportó un error de entrega.',
};

export default async function Errors({ searchParams }: { searchParams: Promise<{ msg?: string; level?: string }> }) {
  const sp = await searchParams;
  const [{ actionable, retrying, review }, events] = await Promise.all([getErrors(), getEvents(sp.level)]);
  const codes = Object.entries(actionable.reduce((a: Record<string, number>, m: any) => ((a[m.error_code ?? 'otro'] = (a[m.error_code ?? 'otro'] ?? 0) + 1), a), {}));
  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader title="Errores y revisión" sub="Nada falla en silencio: todo lo que requiere una decisión tuya aparece aquí." />
      <Flash msg={sp.msg} />

      <Card title={`Mensajes que requieren acción (${actionable.length})`}>
        {actionable.length === 0 ? <Empty>Nada pendiente. ✔</Empty> : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {codes.map(([code, n]) => (
                <form key={code} action={retryByCode}><input type="hidden" name="code" value={code} /><button className="btn small">Reintentar los {n} con “{code}”</button></form>
              ))}
            </div>
            <div className="table-wrap"><table>
              <thead><tr><th>Contacto</th><th>Paso</th><th>Estado</th><th>Motivo</th><th>Cuándo</th><th></th></tr></thead>
              <tbody>{actionable.map((m: any) => (
                <tr key={m.id}>
                  <td><Link href={`/contacts/${m.contact_id}`}><b>{contactLabel(m)}</b></Link><div className="muted small mono">{m.phone}{m.account_label ? ` · ${m.account_label}` : ''}</div></td>
                  <td>{m.step}</td>
                  <td><Badge tone={m.status === 'failed' ? 'bad' : 'warn'}>{m.status}</Badge></td>
                  <td className="small"><b>{m.error_code}</b><div className="muted">{HELP[m.error_code] ?? m.error_detail}</div></td>
                  <td className="small">{ago(m.updated_at)}</td>
                  <td>
                    <form action={messageAction} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <input type="hidden" name="message_id" value={m.id} />
                      <button className="btn small" name="op" value="retry">Reintentar</button>
                      {m.status === 'unconfirmed' ? <button className="btn small" name="op" value="sent">Sí salió</button> : null}
                      <button className="btn small danger" name="op" value="discard">Descartar</button>
                    </form>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}
      </Card>

      <div className="grid cols-2">
        <Card title={`Contactos en revisión (${review.length})`}>
          {review.length === 0 ? <Empty>Ninguno.</Empty> : (
            <table><tbody>{review.map((c: any) => (
              <tr key={c.id}><td><Link href={`/contacts/${c.id}`}>{contactLabel(c)}</Link></td><td className="small muted">{c.stage_reason}</td><td className="small">{ago(c.updated_at)}</td></tr>
            ))}</tbody></table>
          )}
        </Card>
        <Card title={`Reintentos automáticos en espera (${retrying.length})`}>
          {retrying.length === 0 ? <Empty>Ninguno.</Empty> : (
            <table><tbody>{retrying.map((m: any) => (
              <tr key={m.id}><td><Link href={`/contacts/${m.contact_id}`}>{contactLabel(m)}</Link></td><td className="small muted">{m.error_code}</td><td className="small">reintenta {ago(m.retry_at)}</td></tr>
            ))}</tbody></table>
          )}
        </Card>
      </div>

      <Card title="Registro de eventos">
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[['error', 'Errores'], ['warn', 'Errores y avisos'], ['all', 'Todo']].map(([k, label]) => (
            <Link key={k} href={`/errors?level=${k}`} className={`btn small ${(sp.level ?? 'error') === k ? 'primary' : ''}`}>{label}</Link>
          ))}
        </div>
        {events.length === 0 ? <Empty>Sin eventos.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Cuándo</th><th>Nivel</th><th>Evento</th><th>Cuenta</th><th>Detalle</th></tr></thead>
            <tbody>{events.map((e: any) => (
              <tr key={e.id}>
                <td className="small">{fmtDateTime(e.ts)}</td>
                <td><Badge tone={e.level === 'info' ? 'mute' : e.level === 'warn' ? 'warn' : 'bad'}>{e.level}</Badge></td>
                <td>{e.contact_id ? <Link href={`/contacts/${e.contact_id}`}>{e.type}</Link> : e.type}</td>
                <td className="small">{e.account_label ?? '—'}</td>
                <td className="small muted">{Object.entries(e.detail ?? {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ').slice(0, 200)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
