import { logger } from '../src/lib/logger';
import type { ContactRow } from '../src/lib/types';

export type AiChatAction = 'reply' | 'handoff' | 'meeting_confirmed' | 'payment_requested' | 'opt_out';

export type AiChatInput = {
  contact: ContactRow;
  incoming: string;
  history: { direction: 'in' | 'out'; body: string | null }[];
  provider: 'anthropic' | 'openai';
  systemPrompt: string;
  transferDetails: string;
  stripePaymentLink: string;
};

export type AiChatResult = { reply: string; action: AiChatAction };

const DEFAULT_SYSTEM_PROMPT = `Eres el asistente virtual de jqsystem, una agencia chilena de tecnologia para negocios.
Atiendes por WhatsApp a duenos y encargados que respondieron a Joaquin.
Tu objetivo principal es conseguir una reunion corta de 15 minutos con Joaquin.
Si la persona quiere pagar al instante, puedes entregar la opcion de pago indicada en el contexto.
No cierres contratos ni inventes datos.

JQSYSTEM ofrece paginas web desde US$250, webs con agenda desde US$400, tiendas desde US$500 y agentes de WhatsApp personalizados.
Las paginas web se empiezan con un pago inicial del 50% y se completan al entregar.
El sitio de ejemplos es https://jqsystem-web.vercel.app y son conceptos de diseno, no clientes reales.
WhatsApp: +56 9 3211 5412.

Responde solo JSON valido con este formato:
{"reply":"texto para WhatsApp","action":"reply"}
Acciones validas: reply, handoff, meeting_confirmed, payment_requested, opt_out.
Usa handoff si quiere hablar con una persona, cotizacion exacta, contrato, factura, reclama o hace una pregunta que no puedes responder.
Usa meeting_confirmed solo si confirmo explicitamente una reunion o un horario.
Usa payment_requested si quiere pagar o contratar.
Usa opt_out si pide expresamente no recibir mensajes.
Mensajes cortos: 1-3 frases, una sola pregunta, español de Chile, sin listas ni formato.`;

export function isWhatsAppTemplateReply(text: string): boolean {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return [
    'hola, dime como te llamas y que necesitas',
    'hola, como te llamas y que necesitas',
    'hola, que necesitas',
    'hola, en que podemos ayudarte',
    'hola, en que puedo ayudarte',
    'bienvenido',
  ].some((phrase) => t.includes(phrase));
}

/** Reescribe levemente un mensaje saliente sin cambiar su significado. */
export async function aiPersonalize(text: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.AI_MODEL || 'claude-haiku-4-5';
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
          'los nombres propios, números, enlaces y la intención. Cambia solo la redacción. Largo similar al original (±15%). ' +
          'No agregues información, promesas ni emojis nuevos. Responde únicamente con el mensaje reescrito.',
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

export async function aiChatReply(input: AiChatInput): Promise<AiChatResult | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (input.provider === 'anthropic' && !anthropicKey) return null;
  if (input.provider === 'openai' && !openaiKey) return null;

  const contactContext = [
    `Nombre: ${input.contact.first_name || input.contact.name || 'desconocido'}`,
    `Negocio: ${input.contact.business_name || 'desconocido'}`,
    `Rubro: ${input.contact.category || 'desconocido'}`,
    `Ciudad: ${input.contact.city || 'desconocida'}`,
  ].join('\n');
  const history = input.history.slice(-20).map((m) =>
    `${m.direction === 'in' ? 'Cliente' : 'Jqsystem'}: ${m.body || ''}`,
  ).join('\n');
  const paymentContext = [
    input.transferDetails ? `Datos Mercado Pago/transferencia: ${input.transferDetails}` : '',
    input.stripePaymentLink ? `Link de pago Stripe: ${input.stripePaymentLink}` : '',
  ].filter(Boolean).join('\n');
  const system = `${input.systemPrompt || DEFAULT_SYSTEM_PROMPT}\n\nDatos disponibles:\n${contactContext}\n${paymentContext ? `\nPagos:\n${paymentContext}` : ''}\n\nHistorial:\n${history || 'Sin historial previo'}`;

  try {
    if (input.provider === 'openai') {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: input.incoming }],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      return parseChatResult(data.choices?.[0]?.message?.content);
    }

    const model = process.env.AI_MODEL || 'claude-haiku-4-5';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: input.incoming }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json() as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    return parseChatResult(text);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'IA: no pude generar respuesta de conversación');
    return null;
  }
}

function parseChatResult(text: string | undefined): AiChatResult | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()) as Partial<AiChatResult>;
    if (!parsed.reply || typeof parsed.reply !== 'string') return null;
    const actions: AiChatAction[] = ['reply', 'handoff', 'meeting_confirmed', 'payment_requested', 'opt_out'];
    const action = actions.includes(parsed.action as AiChatAction) ? parsed.action as AiChatAction : 'reply';
    if (parsed.reply.length > 1000) return null;
    return { reply: parsed.reply.trim(), action };
  } catch {
    return null;
  }
}

export function acceptable(original: string, rewritten: string): boolean {
  const ratio = rewritten.length / Math.max(1, original.length);
  if (ratio < 0.7 || ratio > 1.3) return false;
  const tokens = original.match(/https?:\/\/\S+|\d[\d.,]*/g) ?? [];
  if (!tokens.every((tk) => rewritten.includes(tk))) return false;
  if (/[{}]|\[\[|\]\]/.test(rewritten)) return false;
  return true;
}
