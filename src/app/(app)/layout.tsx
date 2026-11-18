import Link from 'next/link';
import type { ReactNode } from 'react';
import { logout, toggleSwitch } from '@/app/actions';
import Nav from '@/components/Nav';
import { requireAuth } from '@/lib/auth';
import { one } from '@/lib/db';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireAuth();
  const s = await getSettings(0);
  const st = await one<{ errors: number; worker_age: number | null }>(
    `select (select count(*)::int from messages where direction = 'out' and status in ('failed','unconfirmed','blocked')) as errors,
            (select extract(epoch from now() - max(last_seen))::int from worker_status) as worker_age`,
  );
  const workerDown = st?.worker_age == null || st.worker_age > 60;
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">jq-outreach</Link>
          <Nav errors={st?.errors ?? 0} />
          <form action={toggleSwitch}>
            <input type="hidden" name="key" value="kill_switch" />
            <button className={`btn small ${s.kill_switch ? 'primary' : 'danger'}`} title="Frena todos los envíos de inmediato">
              {s.kill_switch ? 'Reanudar envíos' : 'Pausar todo'}
            </button>
          </form>
          <form action={logout}><button className="btn small">Salir</button></form>
        </div>
      </header>
      {s.kill_switch ? <div className="banner bad">ENVÍOS PAUSADOS — el kill switch está activo; no sale ningún mensaje.</div> : null}
      {s.dry_run ? <div className="banner warn">MODO PRUEBA — se simula todo, no se envía nada real. Los días de espera pasan a minutos.</div> : null}
      {workerDown ? <div className="banner bad">El worker no responde{st?.worker_age != null ? ` (último latido hace ${Math.round(st.worker_age / 60)} min)` : ''}: sin él no se envía ni se detectan respuestas. Revisa el servicio “worker”.</div> : null}
      <main className="wrap">{children}</main>
    </>
  );
}
