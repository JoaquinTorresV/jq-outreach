import { greeting } from './time';

export type Vars = Record<string, string | undefined | null>;
export type Variant = {
  id: number;
  step: number;
  kind: 'normal' | 'failover';
  name: string;
  body: string;
  requires: string[];
  weight: number;
  active: boolean;
};

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
export const slugVar = (s: string) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const VAR_RE = /\{\s*([^{}|\s]+)\s*(?:\|([^{}]*))?\}/g;
const SPIN_RE = /\[\[([^\[\]]*)\]\]/g;

/** Variables que la plantilla usa SIN valor de respaldo (obligatorias) + las declaradas en `requires`. */
export function requiredVars(body: string, requires: string[] = []): string[] {
  const set = new Set(requires.map(slugVar).filter(Boolean));
  for (const m of body.matchAll(VAR_RE)) if (m[2] === undefined) set.add(slugVar(m[1]));
  set.delete('saludo'); // siempre disponible
  return [...set];
}

export function usedVars(body: string): string[] {
  return [...new Set([...body.matchAll(VAR_RE)].map((m) => slugVar(m[1])))];
}

export function hasVar(vars: Vars, name: string): boolean {
  const v = vars[name];
  return typeof v === 'string' && v.trim() !== '';
}

export function resolveSpintax(body: string, rng: () => number = Math.random): string {
  let out = body;
  for (let i = 0; i < 6 && SPIN_RE.test(out); i++) {
    SPIN_RE.lastIndex = 0;
    out = out.replace(SPIN_RE, (_m, g: string) => {
      const opts = g.split('|');
      return opts[Math.floor(rng() * opts.length)] ?? '';
    });
  }
  return out;
}

/** Cantidad de textos distintos que puede producir una plantilla solo con su spintax. */
export function spinCombos(body: string): number {
  let n = 1;
  for (const m of body.matchAll(SPIN_RE)) n *= Math.max(1, m[1].split('|').length);
  return n;
}

export function cleanup(text: string): string {
  let t = text.replace(/\r/g, '');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  t = t.replace(/\s+([,.;:!?])/g, '$1');
  t = t.replace(/([¿¡])\s+/g, '$1');
  t = t.replace(/([,;:])\1+/g, '$1').replace(/,\s*([.!?])/g, '$1');
  t = t.replace(/^[\s,;:.]+/, '').trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

export function renderTemplate(body: string, vars: Vars, rng: () => number = Math.random): { text: string; missing: string[] } {
  const missing: string[] = [];
  const spun = resolveSpintax(body, rng);
  const text = spun.replace(VAR_RE, (_m, name: string, fb?: string) => {
    const key = slugVar(name);
    const v = vars[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (fb !== undefined) return fb.trim();
    missing.push(key);
    return '';
  });
  return { text: cleanup(text), missing };
}

export function validateRendered(text: string): { ok: true } | { ok: false; reason: string } {
  if (!text || text.trim().length < 2) return { ok: false, reason: 'texto_vacio' };
  if (text.length > 1500) return { ok: false, reason: 'texto_muy_largo' };
  if (/[{}]|\[\[|\]\]/.test(text)) return { ok: false, reason: 'variable_sin_reemplazar' };
  if (/\b(undefined|null|NaN)\b/.test(text)) return { ok: false, reason: 'valor_invalido' };
  return { ok: true };
}

/** Elige una variante cuyos datos obligatorios existan; prefiere las más personalizadas. */
export function pickVariant(variants: Variant[], vars: Vars, rng: () => number = Math.random): Variant | null {
  const eligible = variants
    .filter((v) => v.active)
    .map((v) => ({ v, req: requiredVars(v.body, v.requires) }))
    .filter(({ req }) => req.every((r) => hasVar(vars, r)));
  if (!eligible.length) return null;
  const weights = eligible.map(({ v, req }) => v.weight * (1 + req.length));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r <= 0) return eligible[i].v;
  }
  return eligible[eligible.length - 1].v;
}

const HONORIFICS = new Set(['dr', 'dra', 'doctor', 'doctora', 'sr', 'sra', 'srta', 'don', 'dona', 'ing', 'lic', 'prof', 'arq', 'mg', 'abog']);
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'van', 'von']);
const BUSINESS_RE = new RegExp(
  '\\b(spa|s\\.?a\\.?|ltda|limitada|eirl|sas|inc|llc|corp|restaurant|restaurante|clinica|centro|taller|ferreteria|peluqueria|barberia|hotel|cafe|cafeteria|panaderia|inmobiliaria|constructora|consultora|agencia|estudio|studio|tienda|boutique|market|minimarket|libreria|farmacia|dental|odontologia|gimnasio|gym|salon|veterinaria|abogados|ingenieria|servicios|comercial|distribuidora|importadora|group|grupo|escuela|colegio|instituto|academia|automotriz|transportes|logistica|producciones|eventos|constructora|arquitectos|joyeria|optica|ottica|kinesiologia|podologia|spa)\\b',
  'i',
);

export function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && PARTICLES.has(lower)) return lower;
      // todo minúscula o todo mayúscula → capitaliza; mezcla intencional (McDonald) se respeta
      if (w === lower || w === w.toUpperCase()) return lower.replace(/(^|[-'])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
      return w;
    })
    .join(' ');
}

export function looksLikeBusiness(name: string): boolean {
  const n = strip(name);
  return BUSINESS_RE.test(n) || /\d/.test(n) || /[&@]/.test(n) || n.trim().split(/\s+/).length > 4;
}

/** Primer nombre de pila de una persona ("Dra. maría José Pérez" → "María"). */
export function firstNameOf(full: string | null | undefined): string | null {
  if (!full) return null;
  const tokens = titleCase(full).replace(/[.,;()]/g, ' ').split(/\s+/).filter(Boolean);
  const t = tokens.filter((w) => !HONORIFICS.has(strip(w).toLowerCase()));
  const first = t[0];
  if (!first || first.length < 2) return null;
  return first;
}

export type ContactLike = {
  name?: string | null; first_name?: string | null; business_name?: string | null; address?: string | null;
  city?: string | null; category?: string | null; email?: string | null; instagram?: string | null;
  facebook?: string | null; website?: string | null; extra?: Record<string, unknown> | null;
};

export function contactVars(c: ContactLike, now: Date, tz: string): Vars {
  const v: Vars = {
    nombre: c.first_name ?? firstNameOf(c.name && !looksLikeBusiness(c.name) ? c.name : null),
    nombre_completo: c.name && !looksLikeBusiness(c.name) ? titleCase(c.name) : null,
    negocio: c.business_name ?? (c.name && looksLikeBusiness(c.name) ? c.name : null),
    direccion: c.address, ciudad: c.city, rubro: c.category, email: c.email,
    instagram: c.instagram, facebook: c.facebook, web: c.website,
    saludo: greeting(now, tz),
  };
  for (const [k, val] of Object.entries(c.extra ?? {})) {
    const key = slugVar(k);
    if (key && !(key in v) && val != null && String(val).trim() !== '') v[key] = String(val);
  }
  return v;
}
