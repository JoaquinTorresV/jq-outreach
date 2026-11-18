import { createHash } from 'node:crypto';
import { q } from './db';
import { contactVars, pickVariant, renderTemplate, validateRendered, type ContactLike, type Variant } from './template';

let cache: { at: number; rows: Variant[] } | null = null;

export async function loadVariants(step: number, kind: 'normal' | 'failover' = 'normal'): Promise<Variant[]> {
  if (!cache || Date.now() - cache.at > 5000) {
    cache = { at: Date.now(), rows: await q<Variant>('select id, step, kind, name, body, requires, weight, active from templates where active') };
  }
  return cache.rows.filter((v) => v.step === step && v.kind === kind);
}
export function invalidateVariants() { cache = null; }

export const hashText = (t: string) => createHash('sha1').update(t.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

export type Rendered =
  | { ok: true; text: string; variantId: number; variantName: string; hash: string }
  | { ok: false; reason: string };

/** Elige variante según los datos del contacto, rellena variables y valida. Sin IA ni consultas de duplicados. */
export async function renderForContact(
  contact: ContactLike, step: number, opts: { failover?: boolean; tz: string; now?: Date },
): Promise<Rendered> {
  let variants = await loadVariants(step, opts.failover ? 'failover' : 'normal');
  if (!variants.length && opts.failover) variants = await loadVariants(step, 'normal');
  const vars = contactVars(contact, opts.now ?? new Date(), opts.tz);
  const v = pickVariant(variants, vars);
  if (!v) return { ok: false, reason: 'sin_plantilla_aplicable' };
  const { text } = renderTemplate(v.body, vars);
  const val = validateRendered(text);
  if (!val.ok) return { ok: false, reason: val.reason };
  return { ok: true, text, variantId: v.id, variantName: v.name, hash: hashText(text) };
}
