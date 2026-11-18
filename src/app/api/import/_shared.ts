import { defaultCountry, extraCountries } from '@/lib/env';
import { autoMap, buildDrafts, parseFile, type Field } from '@/lib/importer';

export const MAX_BYTES = 25 * 1024 * 1024;

export function countries(): string[] {
  return [...new Set([defaultCountry(), ...extraCountries()])];
}

export async function readUpload(req: Request) {
  const fd = await req.formData();
  const file = fd.get('file');
  if (!(file instanceof File)) throw new Error('Falta el archivo');
  if (file.size > MAX_BYTES) throw new Error('El archivo supera los 25 MB');
  const buf = Buffer.from(await file.arrayBuffer());
  const sheet = String(fd.get('sheet') ?? '') || undefined;
  const table = await parseFile(buf, file.name, { sheet, countries: countries() });
  let mapping: Field[] = autoMap(table, countries());
  const raw = fd.get('mapping');
  if (typeof raw === 'string' && raw) {
    const parsed = JSON.parse(raw) as Field[];
    if (Array.isArray(parsed) && parsed.length === table.headers.length) mapping = parsed;
  }
  const built = buildDrafts(table, mapping, { countries: countries() });
  return { file, table, mapping, built };
}
