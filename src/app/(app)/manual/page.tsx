import Link from 'next/link';
import { claimManual, manualAction } from '@/app/actions';
import AutoRefresh from '@/components/AutoRefresh';
import CopyButton from '@/components/CopyButton';
import Flash from '@/components/Flash';
import { AccountBadge, Card, Meter, PageHeader } from '@/components/ui';
import { contactLabel } from '@/lib/format';
import { manualCapacity } from '@/lib/maintenance';
import { getAccounts, getManualQueue } from '@/lib/queries';

export default async function ManualQueue({ searchParams }: { searchParams: Promise<{ account?: string; msg?: string }> }) {
  const sp = await searchParams;
  const accounts = (await getAccounts()).filter((a) => a.first_message_mode === 'manual');
  const sel = accounts.find((a) => a.id === Number(sp.account)) ?? accounts[0];
  if (!sel) {
    return (
      <>
        <PageHeader title="Cola manual" />
        <Card><p className="empty">Ningún número está en modo “primer mensaje manual”. Cambia el modo en <Link href="/accounts">Números</Link>.</p></Card>
      </>
    );
  }
  const [cap, queue] = await Promise.all([manualCapacity(sel.id), getManualQueue(sel.id)]);
  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHeader title="Cola manual" sub="Tú envías el primer mensaje (más seguro contra baneos); el sistema detecta el envío y se encarga de los seguimientos.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {accounts.map((a) => <Link key={a.id} href={`/manual?account=${a.id}`} className={`btn small ${a.id === sel.id ? 'primary' : ''}`}>{a.label}</Link>)}
        </div>
      </PageHeader>
      <Flash msg={sp.msg} />
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div>
            <b>{sel.label}</b> <AccountBadge status={sel.status} /> <span className="muted small">{sel.phone ?? 'sin vincular'}</span>
            <div className="muted small" style={{ marginTop: 4 }}>
              Hoy enviaste <b>{cap?.sentToday}</b> de <b>{cap?.cap}</b> contactos nuevos · <b>{cap?.queued}</b> esperando en esta lista · quedan <b>{cap?.left}</b> por reservar.
            </div>
            <div style={{ width: 260, marginTop: 6 }}><Meter value={(cap?.sentToday ?? 0) + (cap?.queued ?? 0)} max={cap?.cap ?? 1} /></div>
          </div>
          <form action={claimManual} className="form-row" style={{ minWidth: 260 }}>
            <input type="hidden" name="account_id" value={sel.id} />
            <label>Reservar siguientes<input type="number" name="count" min={1} max={100} defaultValue={20} /></label>
            <button className="btn primary" disabled={!cap || cap.left <= 0}>Traer contactos</button>
          </form>
        </div>
        <p className="alert info small" style={{ marginBottom: 0 }}>
          Abre cada chat con “Abrir WhatsApp” <b>usando el WhatsApp de {sel.phone ?? 'este número'}</b>; el texto ya viene escrito. Revísalo, envíalo y listo: en unos segundos esta tarjeta desaparece sola. Si no desaparece, usa “Ya lo envié”.
        </p>
      </Card>
      {queue.length === 0 ? <Card><p className="empty">No hay contactos reservados. Pulsa “Traer contactos”.</p></Card> : (
        <div className="grid cols-2">
          {queue.map((c: any) => (
            <Card key={c.message_id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div><Link href={`/contacts/${c.contact_id}`}><b>{contactLabel(c)}</b></Link>{c.business_name && c.name ? <span className="muted"> · {c.name}</span> : null}
                  <div className="muted small mono">{c.phone}</div>
                  {c.address || c.instagram || c.website ? <div className="muted small">{[c.address, c.instagram, c.website].filter(Boolean).join(' · ')}</div> : null}
                </div>
              </div>
              <div className="draft">{c.body}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <a className="btn small primary" target="_blank" rel="noreferrer" href={`https://wa.me/${c.phone.replace('+', '')}?text=${encodeURIComponent(c.body)}`}>Abrir WhatsApp</a>
                <CopyButton text={c.body} />
                <form action={manualAction} style={{ display: 'contents' }}>
                  <input type="hidden" name="contact_id" value={c.contact_id} /><input type="hidden" name="account_id" value={sel.id} />
                  <button className="btn small" name="op" value="reroll" title="Genera otra redacción">Otro texto</button>
                  <button className="btn small" name="op" value="sent" title="Úsalo si enviaste el mensaje y no se detectó">Ya lo envié</button>
                  <button className="btn small danger" name="op" value="skip" title="Devuelve el contacto a la lista general">Saltar</button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
