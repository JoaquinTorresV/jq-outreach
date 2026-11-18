import Papa from 'papaparse';
import { isAuthed } from '@/lib/auth';
import { exportContacts } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await isAuthed())) return new Response('No autorizado', { status: 401 });
  const u = new URL(req.url).searchParams;
  const rows = await exportContacts({ q: u.get('q') ?? undefined, stage: u.get('stage') ?? undefined, account: u.get('account') ?? undefined, batch: u.get('batch') ?? undefined });
  // BOM para que Excel respete los acentos
  const csv = '﻿' + Papa.unparse(rows);
  return new Response(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="contactos-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
