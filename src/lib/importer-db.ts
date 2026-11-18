import type { PoolClient } from 'pg';
import { tx } from './db';
import type { BuildResult } from './importer';

export type SaveResult = { batchId: number; inserted: number; updated: number };

const COLS = ['phone', 'name', 'first_name', 'business_name', 'address', 'city', 'category', 'email', 'instagram', 'facebook', 'website', 'notes'] as const;

/** Inserta contactos nuevos; si el teléfono ya existe, solo completa datos faltantes (nunca pisa la etapa). */
export async function saveDrafts(filename: string, built: BuildResult): Promise<SaveResult> {
  return tx(async (c: PoolClient) => {
    const batch = await c.query(
      `insert into import_batches(filename, total_rows, invalid, duplicates, summary)
       values ($1,$2,$3,$4,$5::jsonb) returning id`,
      [filename, built.stats.total, built.rejected.length, built.duplicatesInFile,
       JSON.stringify({ stats: built.stats, rejected: built.rejected.slice(0, 300) })],
    );
    const batchId = batch.rows[0].id as number;
    let inserted = 0;
    let updated = 0;
    const CHUNK = 400;
    for (let i = 0; i < built.drafts.length; i += CHUNK) {
      const chunk = built.drafts.slice(i, i + CHUNK);
      const params: unknown[] = [];
      const tuples = chunk.map((d, k) => {
        const base = k * (COLS.length + 2);
        COLS.forEach((col) => params.push((d as any)[col] ?? null));
        params.push(JSON.stringify(d.extra ?? {}), batchId);
        return `(${Array.from({ length: COLS.length + 2 }, (_, j) => `$${base + j + 1}`).join(',')})`;
      });
      const res = await c.query(
        `insert into contacts (${COLS.join(',')}, extra, batch_id) values ${tuples.join(',')}
         on conflict (phone) do update set
           name = coalesce(contacts.name, excluded.name),
           first_name = coalesce(contacts.first_name, excluded.first_name),
           business_name = coalesce(contacts.business_name, excluded.business_name),
           address = coalesce(contacts.address, excluded.address),
           city = coalesce(contacts.city, excluded.city),
           category = coalesce(contacts.category, excluded.category),
           email = coalesce(contacts.email, excluded.email),
           instagram = coalesce(contacts.instagram, excluded.instagram),
           facebook = coalesce(contacts.facebook, excluded.facebook),
           website = coalesce(contacts.website, excluded.website),
           notes = coalesce(contacts.notes, excluded.notes),
           extra = excluded.extra || contacts.extra,
           updated_at = now()
         returning (xmax = 0) as inserted`,
        params,
      );
      for (const r of res.rows) r.inserted ? inserted++ : updated++;
    }
    await c.query('update import_batches set imported = $2, updated = $3 where id = $1', [batchId, inserted, updated]);
    return { batchId, inserted, updated };
  });
}
