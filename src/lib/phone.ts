import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

/** Países donde libphonenumber no distingue fijo de móvil: regla propia sobre el número nacional. */
const MOBILE_NATIONAL: Record<string, RegExp> = {
  CL: /^9\d{8}$/, // Chile: móviles = 9 + 8 dígitos; los fijos empiezan con 2, 3x, 4x, 5x, 6x o 7x
};

function isMobileLike(p: NonNullable<ReturnType<typeof parsePhoneNumberFromString>>): boolean {
  const t = p.getType();
  if (t === 'FIXED_LINE' || t === 'TOLL_FREE' || t === 'PREMIUM_RATE' || t === 'VOIP' || t === 'SHARED_COST') return false;
  const rule = p.country ? MOBILE_NATIONAL[p.country] : undefined;
  return rule ? rule.test(p.nationalNumber) : true;
}

export type PhoneResult =
  | { ok: true; e164: string; digits: string; country: string; jid: string }
  | { ok: false; reason: 'vacio' | 'formato' | 'fijo' | 'invalido' };

/** Separa celdas con varios teléfonos ("+56 9 1234 5678 / 22 123 4567"). */
export function splitPhones(cell: string): string[] {
  return String(cell ?? '')
    .split(/[\/;|\n\r]+|,(?=\s*\+?\d)|\s+(?:y|o|e)\s+(?=\+?\d)/i)
    .map((s) => s.trim())
    .filter((s) => /\d{6,}/.test(s.replace(/\D/g, '')));
}

function clean(raw: string): string {
  let s = raw.trim();
  // quita texto como "tel:", "wa.me/", "whatsapp:"
  s = s.replace(/^(tel:|whatsapp:|wa\.me\/|https?:\/\/wa\.me\/|https?:\/\/api\.whatsapp\.com\/send\?phone=)/i, '');
  s = s.replace(/[?&].*$/, '');
  const plus = s.trim().startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!plus && digits.startsWith('00')) return '+' + digits.slice(2);
  return (plus ? '+' : '') + digits;
}

/** Normaliza un teléfono a E.164 aceptando solo móviles (WhatsApp). */
export function normalizePhone(raw: string, countries: string[] = ['CL']): PhoneResult {
  const s = clean(String(raw ?? ''));
  if (!s || s.replace(/\D/g, '').length < 7) return { ok: false, reason: s ? 'formato' : 'vacio' };
  let sawFixed = false;
  const tryCountries: (CountryCode | undefined)[] = s.startsWith('+') ? [undefined] : (countries as CountryCode[]);
  for (const c of tryCountries) {
    const p = parsePhoneNumberFromString(s, c);
    if (p && p.isValid()) {
      if (!isMobileLike(p)) {
        sawFixed = true;
        continue;
      }
      const digits = p.number.replace('+', '');
      return { ok: true, e164: p.number, digits, country: p.country ?? c ?? '', jid: `${digits}@s.whatsapp.net` };
    }
  }
  // Sin "+" y sin país válido: probar anteponiendo "+" por si ya traía código de país
  if (!s.startsWith('+')) {
    const p = parsePhoneNumberFromString('+' + s);
    if (p && p.isValid()) {
      if (isMobileLike(p)) {
        const digits = p.number.replace('+', '');
        return { ok: true, e164: p.number, digits, country: p.country ?? '', jid: `${digits}@s.whatsapp.net` };
      }
      sawFixed = true;
    }
  }
  return { ok: false, reason: sawFixed ? 'fijo' : 'invalido' };
}

/** ¿La celda parece contener un teléfono? (para detectar columnas por contenido) */
export function looksLikePhone(v: string, countries: string[]): boolean {
  return splitPhones(v).some((x) => {
    const result = normalizePhone(x, countries);
    return result.ok || result.reason === 'fijo';
  });
}
