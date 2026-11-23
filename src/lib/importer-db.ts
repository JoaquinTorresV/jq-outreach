import type { PoolClient } from 'pg';
import { tx } from './db';
import type { Campaign } from './campaigns';
import type { BuildResult } from './importer';

export type SaveResult = { batchId: number; inserted: number; updated: number };

const COLS = ['phone', 'name', 'first_name', 'business_name', 'address', 'city', 'category', 'email', 'instagram', 'facebook', 'website', 'maps_url', 'notes', 'stage', 'stage_reason'] as const;

/** Inserta contactos nuevos; si el teléfono ya existe, solo completa datos faltantes (nunca pisa la etapa). */
export async function saveDrafts(filename: string, built: BuildResult, campaign: Campaign): Promise<SaveResult> {
  return tx(async (c: PoolClient) => {
    const batch = await c.query(
      `insert into import_batches(filename, total_rows, invalid, duplicates, summary, campaign)
       values ($1,$2,$3,$4,$5::jsonb,$6) returning id`,
      [filename, built.stats.total, built.rejected.length, built.duplicatesInFile,
       JSON.stringify({ stats: built.stats, rejected: built.rejected.slice(0, 300) }), campaign],
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
      const campaignParam = params.length + 1;
      const values = tuples.map((tuple) => `${tuple.slice(0, -1)},$${campaignParam})`).join(',');
      const res = await c.query(
        `insert into contacts (${COLS.join(',')}, extra, batch_id, campaign) values ${values}
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
        [...params, campaign],
      );
      for (const r of res.rows) r.inserted ? inserted++ : updated++;
    }
    await c.query('update import_batches set imported = $2, updated = $3 where id = $1', [batchId, inserted, updated]);
    return { batchId, inserted, updated };
  });
}
