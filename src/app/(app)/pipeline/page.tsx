import Link from 'next/link';
import AutoRefresh from '@/components/AutoRefresh';
import { Card, PageHeader, StageBadge } from '@/components/ui';
import { ago, contactLabel } from '@/lib/format';
import { getAccounts, getPipeline } from '@/lib/queries';
import { CLOSED, PIPELINE, STAGE_LABEL } from '@/lib/stages';

export default async function Pipeline() {
  const [{ counts, cards }, accounts] = await Promise.all([getPipeline(12), getAccounts()]);
  const n = Object.fromEntries(counts.map((c) => [c.stage, c.n]));
  const label = (id: number | null) => accounts.find((a) => a.id === id)?.label;
  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader title="Pipeline" sub="Los que respondieron aparecen primero. Haz clic en una tarjeta para ver la conversación." />
      <div className="kanban">
        {PIPELINE.map((stage) => (
          <div className="col" key={stage}>
            <h3><span>{STAGE_LABEL[stage].replace(/ \(.*\)/, '')}</span><Link href={`/contacts?stage=${stage}`} className="small">{n[stage] ?? 0}</Link></h3>
            {cards.filter((c: any) => c.stage === stage).map((c: any) => (
              <Link key={c.id} href={`/contacts/${c.id}`} className="kcard">
                <div className="t">{contactLabel(c)}</div>
                <div className="m">{c.phone}{label(c.account_id) ? ` · ${label(c.account_id)}` : ''}</div>
                <div className="m">{c.last_inbound_at ? `respondió ${ago(c.last_inbound_at)}` : c.next_action_at ? `próximo ${ago(c.next_action_at)}` : `act. ${ago(c.updated_at)}`}</div>
              </Link>
            ))}
            {(n[stage] ?? 0) > 12 ? <Link className="small" href={`/contacts?stage=${stage}`}>ver los {n[stage]} →</Link> : null}
          </div>
        ))}
      </div>
      <Card title="Cerrados">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {CLOSED.map((s) => (
            <Link key={s} href={`/contacts?stage=${s}`}><StageBadge stage={s} /> <b>{n[s] ?? 0}</b></Link>
          ))}
        </div>
      </Card>
    </>
  );
}
