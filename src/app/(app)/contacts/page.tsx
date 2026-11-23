import Link from 'next/link';
import Flash from '@/components/Flash';
import { Card, Empty, PageHeader, StageBadge } from '@/components/ui';
import { ago, contactLabel, fmtDateTime } from '@/lib/format';
import { getAccounts, getBatches, listContacts } from '@/lib/queries';
import { STAGES, STAGE_LABEL } from '@/lib/stages';
import { CAMPAIGNS, CAMPAIGN_LABEL } from '@/lib/campaigns';

type SP = { q?: string; stage?: string; account?: string; batch?: string; campaign?: string; page?: string; msg?: string };

export default async function Contacts({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [res, accounts, batches] = await Promise.all([
    listContacts({ q: sp.q, stage: sp.stage, account: sp.account, batch: sp.batch, campaign: sp.campaign, page: Number(sp.page) || 1 }),
    getAccounts(),
    getBatches(),
  ]);
  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, stage: sp.stage, account: sp.account, batch: sp.batch, campaign: sp.campaign, ...over })) if (v) p.set(k, String(v));
    return p.toString();
  };
  return (
    <>
      <PageHeader title="Contactos" sub={`${res.total.toLocaleString('es-CL')} resultados`}>
        <a className="btn small" href={`/api/export?${qs({})}`}>Descargar CSV</a>
      </PageHeader>
      <Flash msg={sp.msg} />
      <Card>
        <form method="get" className="form-row">
          <label>Buscar<input name="q" defaultValue={sp.q} placeholder="nombre, negocio, teléfono, dirección…" /></label>
          <label>Etapa
            <select name="stage" defaultValue={sp.stage ?? ''}>
              <option value="">Todas</option>
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
          </label>
          <label>Número
            <select name="account" defaultValue={sp.account ?? ''}>
              <option value="">Todos</option><option value="none">Sin asignar</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <label>Lote
            <select name="batch" defaultValue={sp.batch ?? ''}>
              <option value="">Todos</option>
              {batches.map((b: any) => <option key={b.id} value={b.id}>#{b.id} · {b.filename}</option>)}
            </select>
          </label>
          <label>Campaña
            <select name="campaign" defaultValue={sp.campaign ?? ''}>
              <option value="">Todas</option>
              {CAMPAIGNS.map((c) => <option key={c} value={c}>{CAMPAIGN_LABEL[c]}</option>)}
            </select>
          </label>
          <button className="btn primary">Filtrar</button>
        </form>
      </Card>
      <Card>
        {res.rows.length === 0 ? <Empty>No hay contactos con esos filtros.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Contacto</th><th>Teléfono</th><th>Campaña</th><th>Etapa</th><th>Paso</th><th>Número</th><th>Último envío</th><th>Respuesta</th><th>Próxima acción</th></tr></thead>
            <tbody>
              {res.rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/contacts/${c.id}`}><b>{contactLabel(c)}</b></Link>{c.business_name && c.name ? <div className="muted small">{c.name}</div> : null}</td>
                  <td className="mono">{c.phone}</td>
                  <td className="small">{CAMPAIGN_LABEL[c.campaign]}</td>
                  <td><StageBadge stage={c.stage} />{c.stage_reason ? <div className="muted small">{c.stage_reason}</div> : null}</td>
                  <td>{c.step}/4</td>
                  <td>{c.account_label ?? <span className="muted">—</span>}</td>
                  <td className="small">{ago(c.last_outbound_at)}</td>
                  <td className="small">{ago(c.last_inbound_at)}</td>
                  <td className="small">{c.next_action_at ? fmtDateTime(c.next_action_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="pager">
          {res.page > 1 ? <Link className="btn small" href={`/contacts?${qs({ page: res.page - 1 })}`}>← Anterior</Link> : null}
          <span className="muted small">Página {res.page} de {res.pages}</span>
          {res.page < res.pages ? <Link className="btn small" href={`/contacts?${qs({ page: res.page + 1 })}`}>Siguiente →</Link> : null}
        </div>
      </Card>
    </>
  );
}
