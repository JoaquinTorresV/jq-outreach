import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { normalizePhone, splitPhones, looksLikePhone } from './phone';
import { firstNameOf, looksLikeBusiness, titleCase } from './template';

export type Field =
  | 'phone' | 'phone_alt' | 'name' | 'business_name' | 'address' | 'city' | 'category' | 'maps_url'
  | 'email' | 'instagram' | 'facebook' | 'website' | 'social' | 'notes' | 'extra' | 'ignore';
export const FIELD_LABEL: Record<Field, string> = {
  phone: 'Teléfono / WhatsApp', phone_alt: 'Teléfono alternativo', name: 'Nombre de la persona',
  business_name: 'Nombre del negocio', address: 'Dirección', city: 'Ciudad / comuna', category: 'Rubro',
  maps_url: 'Perfil de Google Maps',
  email: 'Email', instagram: 'Instagram', facebook: 'Facebook', website: 'Sitio web',
  social: 'Redes sociales (mixto)', notes: 'Notas', extra: 'Guardar como dato extra', ignore: 'Ignorar',
};

export type ParsedTable = {
  kind: 'csv' | 'xlsx' | 'txt';
  headers: string[];
  hasHeader: boolean;
  rows: string[][];
  sheets?: string[];
  sheet?: string;
  warnings: string[];
};

export type ContactDraft = {
  phone: string;
  name: string | null;
  first_name: string | null;
  business_name: string | null;
  address: string | null;
  city: string | null;
  category: string | null;
  maps_url: string | null;
  email: string | null;
  instagram: string | null;
  facebook: string | null;
  website: string | null;
  notes: string | null;
  extra: Record<string, string>;
  stage: 'nuevo' | 'revision';
  stage_reason: string | null;
};

export type Rejected = { row: number; reason: string; raw: string[] };
export type BuildResult = {
  drafts: ContactDraft[];
  rejected: Rejected[];
  duplicatesInFile: number;
  stats: { total: number; ok: number; needsReview: number; withName: number; withBusiness: number; withAddress: number; withSocial: number };
};

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s: string) => strip(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
const tidy = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ───────────────────────── Lectura de archivos ─────────────────────────

function decodeText(buf: Buffer): string {
  let s: string;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    s = new TextDecoder('windows-1252').decode(buf);
  }
  return s.replace(/^﻿/, '');
}

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, any>;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join('');
    if ('result' in o) return cellToString(o.result);
    if ('text' in o) return cellToString(o.text);
    if ('hyperlink' in o) return String(o.hyperlink);
    if ('error' in o) return '';
  }
  return String(v);
}

const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
const isOle = (b: Buffer) => b.length > 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

function pullPhoneFromLine(line: string): string[] | null {
  const m = line.match(/(\+?\d[\d\s\-().]{6,}\d)/);
  if (!m) return null;
  const rest = tidy(line.replace(m[0], ' ').replace(/[,;|:\-–—]+\s*$/g, '').replace(/^[,;|:\-–—\s]+/g, ''));
  return [rest, m[1]];
}

export async function parseFile(buf: Buffer, filename: string, opts: { sheet?: string; countries?: string[] } = {}): Promise<ParsedTable> {
  const countries = opts.countries ?? ['CL'];
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const warnings: string[] = [];
  if (isOle(buf) || ext === 'xls') {
    throw new Error('El formato .xls (Excel antiguo) no es compatible. Abre el archivo en Excel y guárdalo como .xlsx o .csv.');
  }

  let kind: ParsedTable['kind'];
  let raw: string[][] = [];
  let sheets: string[] | undefined;
  let sheet: string | undefined;

  if (isZip(buf) || ext === 'xlsx' || ext === 'xlsm') {
    kind = 'xlsx';
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new Error('No pude abrir el Excel. ¿Está protegido con contraseña o dañado? Prueba guardándolo como .csv.');
    }
    const nonEmpty = wb.worksheets.filter((w) => w.actualRowCount > 0);
    if (!nonEmpty.length) throw new Error('El Excel no tiene filas con datos.');
    sheets = nonEmpty.map((w) => w.name);
    const ws = nonEmpty.find((w) => w.name === opts.sheet) ?? nonEmpty[0];
    sheet = ws.name;
    if (nonEmpty.length > 1) warnings.push(`El archivo tiene ${nonEmpty.length} hojas; se está usando "${ws.name}".`);
    const cols = ws.columnCount;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const r: string[] = [];
      for (let c = 1; c <= cols; c++) r.push(tidy(cellToString(row.getCell(c).value)));
      raw.push(r);
    });
  } else {
    const text = decodeText(buf);
    kind = ext === 'txt' ? 'txt' : 'csv';
    const parsed = Papa.parse<string[]>(text, {
      delimiter: '',
      delimitersToGuess: [',', ';', '\t', '|'],
      skipEmptyLines: 'greedy',
    });
    raw = (parsed.data as string[][]).map((r) => r.map(tidy));
    if (parsed.errors.length) warnings.push(`El archivo tiene ${parsed.errors.length} línea(s) con formato raro; se leyeron igual.`);
  }

  raw = raw.filter((r) => r.some((c) => c !== ''));
  if (!raw.length) throw new Error('El archivo está vacío.');

  // Una sola columna con texto libre ("Juan Pérez 912345678"): separar nombre y teléfono.
  const maxCols = Math.max(...raw.map((r) => r.length));
  if (maxCols === 1) {
    const exploded = raw.map((r) => pullPhoneFromLine(r[0]));
    const hits = exploded.filter(Boolean).length;
    if (hits >= Math.ceil(raw.length * 0.5)) {
      raw = raw.map((r, i) => exploded[i] ?? [r[0], '']);
      raw = [['nombre', 'telefono'], ...raw];
      warnings.push('El archivo tenía una sola columna; separé automáticamente el nombre y el teléfono de cada línea.');
    }
  }

  const width = Math.max(...raw.map((r) => r.length));
  raw = raw.map((r) => [...r, ...Array(width - r.length).fill('')]);

  // ¿La primera fila es encabezado? No lo es si alguna celda parece teléfono.
  const first = raw[0];
  const firstHasPhone = first.some((c) => /\d[\d\s\-().]{6,}\d/.test(c) && looksLikePhone(c, countries));
  const hasHeader = !firstHasPhone;
  const headers = hasHeader ? first.map((h, i) => h || `Columna ${i + 1}`) : first.map((_, i) => `Columna ${i + 1}`);
  const rows = hasHeader ? raw.slice(1) : raw;
  return { kind, headers, hasHeader, rows, sheets, sheet, warnings };
}

// ───────────────────────── Mapeo de columnas ─────────────────────────

type HeaderClass = { field: Field; strength?: number } | null;

export function classifyHeader(h: string): HeaderClass {
  const k = norm(h);
  if (!k) return null;
  if (/whatsapp.*(posible|possible)|(posible|possible).*whatsapp/.test(k)) return null;
  if (/telefononormalizado|normalizedphone|^e164$/.test(k)) return { field: 'phone', strength: 0 };
  if (/whatsapp|wsp|watsap|^wa$|^wapp$/.test(k)) return { field: 'phone', strength: 1 };
  if (/celular|movil|mobile|^cel\d?$|^cell/.test(k)) return { field: 'phone', strength: 1 };
  if (/fijo|landline/.test(k)) return { field: 'phone_alt', strength: 9 };
  if (/telefono|^tel\d?$|fono|phone|numero|^nro|^num$|contactonumero/.test(k)) return { field: 'phone', strength: 2 };
  if (/^(title|titulo)$/.test(k)) return { field: 'business_name' };
  if (/negocio|empresa|company|business|razonsocial|nombrecomercial|local$|tienda|establecimiento|organizacion|fantasia|marca|clinica|restaurant/.test(k))
    return { field: 'business_name' };
  if (/^(nombre|name|contacto|persona|cliente|propietario|dueno|encargado|responsable|doctor|medico|profesional|fullname|firstname|primernombre)/.test(k) || /^(dr|dra)$/.test(k))
    return { field: 'name' };
  if (/direccion|address|domicilio|ubicacion|calle|^dir$/.test(k)) return { field: 'address' };
  if (/ciudad|comuna|city|localidad|town/.test(k)) return { field: 'city' };
  if (/rubro|giro|categoria|category|industria|sector|actividad|especialidad|^tipo/.test(k)) return { field: 'category' };
  if (/mail|correo/.test(k)) return { field: 'email' };
  if (/instagram|^ig$|^insta/.test(k)) return { field: 'instagram' };
  if (/facebook|^fb$/.test(k)) return { field: 'facebook' };
  if (/redes|social|rrss/.test(k)) return { field: 'social' };
  if (/^(estadoweb|webstatus|webstate)$/.test(k)) return null;
  if (/^(mapsurl|googlemapsurl|linkmaps|urlmapa)$/.test(k)) return { field: 'maps_url' };
  if (/web|sitio|pagina|site|dominio/.test(k)) return { field: 'website' };
  if (/nota|comentario|observacion|^obs/.test(k)) return { field: 'notes' };
  return null;
}

const looksEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const looksUrl = (v: string) => /^(https?:\/\/|www\.)\S+$/i.test(v) || /^[a-z0-9-]+\.(cl|com|co|net|org|io|shop|store|app)(\/\S*)?$/i.test(v);
const looksLikeGoogleMapsUrl = (v: string) => /^https?:\/\/(?:(?:www\.)?google\.[^/]+\/maps|maps\.google\.[^/]+\/)/i.test(v);
const looksHandle = (v: string) => /^@[\w.]{2,}$/.test(v) || /instagram\.com\//i.test(v);

export function autoMap(table: ParsedTable, countries: string[]): Field[] {
  const n = table.headers.length;
  const mapping: Field[] = Array(n).fill('extra');
  const sample = table.rows.slice(0, 200);
  const col = (i: number) => sample.map((r) => r[i] ?? '').filter(Boolean);
  const ratio = (i: number, fn: (v: string) => boolean) => {
    const c = col(i);
    return c.length ? c.filter(fn).length / c.length : 0;
  };

  const phones: { i: number; strength: number }[] = [];
  if (table.hasHeader) {
    table.headers.forEach((h, i) => {
      if (norm(h) === 'url') {
        mapping[i] = col(i).some(looksLikeGoogleMapsUrl) ? 'maps_url' : 'website';
        return;
      }
      const c = classifyHeader(h);
      if (!c) return;
      if (c.field === 'phone' || c.field === 'phone_alt') phones.push({ i, strength: c.strength ?? 5 });
      else mapping[i] = c.field;
    });
  }
  // Columnas de teléfono: por contenido si el encabezado no ayudó
  if (!phones.length) {
    const scored = Array.from({ length: n }, (_, i) => ({ i, r: ratio(i, (v) => looksLikePhone(v, countries)) }))
      .filter((x) => x.r >= 0.5).sort((a, b) => b.r - a.r);
    scored.forEach((x, k) => phones.push({ i: x.i, strength: k }));
  }
  phones.sort((a, b) => a.strength - b.strength || a.i - b.i);
  phones.forEach((p, k) => (mapping[p.i] = k === 0 ? 'phone' : 'phone_alt'));

  // Columnas sin clasificar: por contenido
  const free = () => mapping.map((f, i) => (f === 'extra' ? i : -1)).filter((i) => i >= 0);
  for (const i of free()) {
    if (ratio(i, looksEmail) >= 0.6) mapping[i] = 'email';
    else if (ratio(i, looksHandle) >= 0.6) mapping[i] = 'instagram';
    else if (ratio(i, looksLikeGoogleMapsUrl) >= 0.6) mapping[i] = 'maps_url';
    else if (ratio(i, looksUrl) >= 0.6) mapping[i] = 'website';
  }
  if (!table.hasHeader) {
    const textCols = free().filter((i) => col(i).length > 0);
    const has = (f: Field) => mapping.includes(f);
    for (const i of textCols) {
      const c = col(i);
      if (!has('name') && !has('business_name')) {
        const biz = c.filter(looksLikeBusiness).length / c.length;
        mapping[i] = biz >= 0.5 ? 'business_name' : 'name';
      } else if (!has('business_name') && mapping[textCols[0]] === 'name') {
        mapping[i] = 'business_name';
      } else if (!has('address') && c.filter((v) => /\d/.test(v) && v.length > 10).length / c.length >= 0.5) {
        mapping[i] = 'address';
      }
    }
  }
  return mapping;
}

// ───────────────────────── Construcción de contactos ─────────────────────────

function socialsFrom(value: string, out: Partial<ContactDraft>) {
  for (const t of value.split(/[\s,;|]+/).filter(Boolean)) {
    const ig = t.match(/instagram\.com\/([\w.]+)/i);
    if (ig) { out.instagram ??= '@' + ig[1]; continue; }
    if (/facebook\.com|fb\.com|fb\.me/i.test(t)) { out.facebook ??= t; continue; }
    if (t.startsWith('@') && t.length > 2) { out.instagram ??= t; continue; }
    if (looksUrl(t)) { out.website ??= t; }
  }
}

function normInstagram(v: string): string | null {
  const m = v.match(/instagram\.com\/([\w.]+)/i);
  const h = (m ? m[1] : v).replace(/^@/, '').replace(/\/$/, '').trim();
  return h && /^[\w.]{2,}$/.test(h) ? '@' + h : v || null;
}

function phoneForReview(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return raw.trim().startsWith('+') ? `+${digits}` : digits;
}

export function buildDrafts(table: ParsedTable, mapping: Field[], opts: { countries: string[] }): BuildResult {
  const phoneCols = mapping.map((f, i) => (f === 'phone' ? i : -1)).filter((i) => i >= 0);
  const altCols = mapping.map((f, i) => (f === 'phone_alt' ? i : -1)).filter((i) => i >= 0);
  const byPhone = new Map<string, ContactDraft>();
  const rejected: Rejected[] = [];
  let duplicates = 0;
  const hasBizCol = mapping.includes('business_name');
  const rowOffset = table.hasHeader ? 2 : 1;

  table.rows.forEach((r, idx) => {
    const rowNo = idx + rowOffset;
    let reason = 'sin_telefono';
    let phone: string | null = null;
    let reviewPhone: string | null = null;
    let reviewReason: string | null = null;
    for (const ci of [...phoneCols, ...altCols]) {
      const cell = r[ci] ?? '';
      if (!cell) continue;
      const cands = splitPhones(cell);
      if (!cands.length) {
        reason = 'telefono_invalido';
        const digits = cell.replace(/\D/g, '');
        if (digits && !reviewPhone) { reviewPhone = phoneForReview(cell); reviewReason = 'telefono_invalido'; }
      }
      for (const cand of cands) {
        const res = normalizePhone(cand, opts.countries);
        if (res.ok) { phone = res.e164; break; }
        const issue = res.reason === 'fijo' ? 'telefono_fijo' : 'telefono_invalido';
        reason = issue;
        if (!reviewPhone) { reviewPhone = phoneForReview(cand); reviewReason = issue; }
      }
      if (phone) break;
    }
    if (!phone && reviewPhone) phone = reviewPhone;
    if (!phone) {
      if (r.some((c) => c)) rejected.push({ row: rowNo, reason, raw: r });
      return;
    }

    const d: ContactDraft = {
      phone, name: null, first_name: null, business_name: null, address: null, city: null, category: null, maps_url: null,
      email: null, instagram: null, facebook: null, website: null, notes: null, extra: {},
      stage: reviewReason ? 'revision' : 'nuevo', stage_reason: reviewReason,
    };
    mapping.forEach((f, ci) => {
      const v = tidy(r[ci]);
      if (!v) return;
      switch (f) {
        case 'name': d.name = v; break;
        case 'business_name': d.business_name = v; break;
        case 'address': d.address = v; break;
        case 'city': d.city = titleCase(v); break;
        case 'category': d.category = v; break;
        case 'maps_url': d.maps_url = v; break;
        case 'email': if (looksEmail(v.toLowerCase())) d.email = v.toLowerCase(); break;
        case 'instagram': d.instagram = normInstagram(v); break;
        case 'facebook': d.facebook = v; break;
        case 'website': d.website = v; break;
        case 'social': socialsFrom(v, d); d.extra[table.headers[ci]] = v; break;
        case 'notes': d.notes = v; break;
        case 'extra': d.extra[table.headers[ci]] = v; break;
        default: break;
      }
    });

    // ¿"nombre" es en realidad un negocio?
    if (d.name && !hasBizCol && looksLikeBusiness(d.name)) { d.business_name = d.name; d.name = null; }
    if (d.name) { d.name = titleCase(d.name); d.first_name = firstNameOf(d.name); }

    const prev = byPhone.get(phone);
    if (prev) {
      duplicates++;
      if (d.stage === 'nuevo') { prev.stage = 'nuevo'; prev.stage_reason = null; }
      for (const k of Object.keys(d) as (keyof ContactDraft)[]) {
        if (k === 'extra') prev.extra = { ...d.extra, ...prev.extra };
        else if (!prev[k] && d[k]) (prev as any)[k] = d[k];
      }
    } else {
      byPhone.set(phone, d);
    }
  });

  const drafts = [...byPhone.values()];
  return {
    drafts,
    rejected,
    duplicatesInFile: duplicates,
    stats: {
      total: table.rows.length,
      ok: drafts.length,
      needsReview: drafts.filter((d) => d.stage === 'revision').length,
      withName: drafts.filter((d) => d.first_name).length,
      withBusiness: drafts.filter((d) => d.business_name).length,
      withAddress: drafts.filter((d) => d.address).length,
      withSocial: drafts.filter((d) => d.instagram || d.facebook || d.website).length,
    },
  };
}
