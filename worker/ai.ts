import { logger } from '../src/lib/logger';

/**
 * Personalización opcional con IA: reescribe levemente el mensaje (mismo significado, otra redacción).
 * Si falla o el resultado no pasa las validaciones, devuelve null y se usa el texto de la plantilla.
 */
export async function aiPersonalize(text: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.AI_MODEL || 'claude-haiku-5-5';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system:
          'Reescribes mensajes cortos de WhatsApp en español natural y cercano. Mantén EXACTAMENTE el mismo significado, ' +
          'los nombres propios, números, enlaces y la intención. Cambia solo la redacción (sinónimos, orden de las frases). ' +
          'Largo similar al original (±15%). No agregues información, promesas ni emojis nuevos. ' +
          'Responde únicamente con el mensaje reescrito, sin comillas ni explicaciones.',
        messages: [{ role: 'user', content: text }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      logger.warn({ status: res.status }, 'IA: respuesta no exitosa, uso la plantilla');
      return null;
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const out = data.content?.find((c) => c.type === 'text')?.text?.trim();
    return out && acceptable(text, out) ? out : null;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'IA: falló la personalización, uso la plantilla');
    return null;
  }
}

/** El texto reescrito debe conservar números, enlaces y tener un largo parecido. */
export function acceptable(original: string, rewritten: string): boolean {
  const ratio = rewritten.length / Math.max(1, original.length);
  if (ratio < 0.7 || ratio > 1.3) return false;
  const tokens = original.match(/https?:\/\/\S+|\d[\d.,]*/g) ?? [];
  if (!tokens.every((tk) => rewritten.includes(tk))) return false;
  if (/[{}]|\[\[|\]\]/.test(rewritten)) return false;
  return true;
}
