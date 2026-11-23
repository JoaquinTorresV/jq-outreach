import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { saveDrafts } from '@/lib/importer-db';
import { readUpload } from '../_shared';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const { file, built, campaign } = await readUpload(req);
    if (!built.drafts.length) return NextResponse.json({ error: 'No hay ningún teléfono válido para importar. Revisa que la columna de teléfono esté bien detectada.' }, { status: 400 });
    const res = await saveDrafts(file.name, built, campaign);
    return NextResponse.json({ ...res, campaign, needsReview: built.stats.needsReview, rejected: built.rejected.slice(0, 5000), duplicatesInFile: built.duplicatesInFile, total: built.stats.total });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
