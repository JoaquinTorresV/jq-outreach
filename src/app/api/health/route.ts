import { NextResponse } from 'next/server';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Para monitores externos (UptimeRobot, etc.): 200 si la base y el worker responden; 503 si no. */
export async function GET() {
  const out: Record<string, unknown> = { ok: false, db: false, worker: false };
  try {
    await q('select 1');
    out.db = true;
    const w = await q<{ worker_id: string; age: number }>(
      `select worker_id, extract(epoch from now() - last_seen)::int as age from worker_status order by last_seen desc limit 5`,
    );
    out.workers = w.map((x) => ({ id: x.worker_id, age_s: x.age }));
    out.worker = w.some((x) => x.age < 60);
    const accts = await q<{ id: number; status: string }>('select id, status from accounts order by id');
    out.accounts = accts;
    out.ok = out.db && out.worker;
  } catch (e) {
    out.error = (e as Error).message;
  }
  return NextResponse.json(out, { status: out.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
