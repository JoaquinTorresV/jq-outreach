import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { q } from '@/lib/db';
import { FIELD_LABEL } from '@/lib/importer';
import { readUpload } from '../_shared';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const { file, table, mapping, built, campaign } = await readUpload(req);
    const phones = built.drafts.map((d) => d.phone);
    const existing = phones.length ? (await q<{ n: number }>('select count(*)::int as n from contacts where phone = any($1)', [phones]))[0].n : 0;
    return NextResponse.json({
      filename: file.name, kind: table.kind, sheets: table.sheets ?? null, sheet: table.sheet ?? null, hasHeader: table.hasHeader, campaign,
      headers: table.headers, samples: table.headers.map((_, i) => table.rows.slice(0, 3).map((r) => r[i] ?? '')),
      mapping, fields: FIELD_LABEL, warnings: table.warnings, stats: built.stats, duplicatesInFile: built.duplicatesInFile,
      existing, rejected: built.rejected.slice(0, 100), rejectedTotal: built.rejected.length, preview: built.drafts.slice(0, 8),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
