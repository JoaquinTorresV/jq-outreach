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
Atiendes por WhatsApp a duenos y encargados que respondieron a Joaquin. Tu objetivo es entender que necesitan y, si tiene sentido, acercarlos a una reunion breve de 15 minutos con Joaquin.

JQSYSTEM ofrece paginas web desde US$250, webs con agenda desde US$400, tiendas desde US$500 y agentes de WhatsApp personalizados. Las paginas web comienzan con un pago inicial del 50% y el resto se paga al entregar. El plazo estimado es menos de un dia despues de recibir logo, fotos y textos. Los agentes de WhatsApp se cotizan segun el alcance; no inventes un precio.
El sitio https://jqsystem-web.vercel.app muestra conceptos de diseno, no clientes reales. WhatsApp: +56 9 3211 5412.

Responde primero lo que la persona pregunto, usando solo la informacion disponible. Si no sabes algo, dilo con naturalidad y ofrece confirmarlo con Joaquin. No inventes precios, disponibilidad, descuentos, clientes, resultados ni funciones.

Actua como un setter consultivo: conversa con calidez y naturalidad, entiende el negocio y su necesidad de a una pregunta por vez, explica brevemente el beneficio que corresponda y propone una reunion solo cuando sea un siguiente paso razonable. No presiones, no repitas argumentos ni hagas que cada mensaje suene a venta. No saludes de nuevo en cada turno.
Si dicen que pasaran la informacion a administracion y que contactaran si hay interes, agradece y di que quedas atento; no insistas ni asumas que ya aceptaron.
Si alguien confirma una reunion o quiere pagar/contratar, deriva a Joaquin. Si pide no recibir mensajes, despide una sola vez y no vuelvas a escribir.

Responde solo JSON valido con este formato:
{"reply":"texto para WhatsApp","action":"reply"}
Acciones validas: reply, handoff, meeting_confirmed, payment_requested, opt_out.
Usa handoff si quiere hablar con una persona, necesita una cotizacion personalizada, contrato, factura, reclama o hace una pregunta que no puedes responder.
Usa meeting_confirmed solo cuando confirme explicitamente una reunion o un horario. Usa payment_requested si quiere pagar o contratar. Usa opt_out si pide expresamente no recibir mensajes.
Mensajes de 1-3 frases cortas, espanol de Chile, sin listas ni formato, con maximo una pregunta relevante.`;

export function isWhatsAppTemplateReply(text: string): boolean {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const exactPhrases = [
    'hola, dime como te llamas y que necesitas',
    'hola, como te llamas y que necesitas',
    'como te llamas y que necesitas',
    'cual es tu nombre y que necesitas',
    'dime tu nombre y que necesitas',
    'hola, que necesitas',
    'que necesitas',
    'que servicio necesitas',
    'como te llamas',
    'cual es tu nombre',
    'dime tu nombre',
    'hola, en que podemos ayudarte',
    'hola, en que puedo ayudarte',
    'en que podemos asistirte',
    'bienvenido',
  ].map((phrase) => phrase.replace(/[^a-z0-9]+/g, ' '));
  if (exactPhrases.some((phrase) => t.includes(phrase))) return true;

  const automaticPhrases = [
    'te has comunicado con',
    'gracias por comunicarte con',
    'dentro de unos momentos tu consulta sera resuelta',
    'te responderemos a la brevedad',
    'te responderemos en breve',
    'te recordamos que nuestra atencion es 24 horas',
    'por orden de llegada',
    'por favor comunicate por telefono',
    'no podremos atender mensajes por whatsapp',
    'valor de consulta',
    'consulta tiene un valor',
    'consulta tiene valor',
    'horario de atencion',
    'horarios de atencion',
    'busca servicio de',
    'servicios disponibles',
    'conoce nuestros servicios',
  ];
  if (automaticPhrases.some((phrase) => t.includes(phrase))) return true;

  const mentionsSchedule = /\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|feriados?)\b/.test(t)
    && /\b(?:atencion|horario|abierto|cerrado)\b/.test(t)
    && /\b(?:[01]?\d|2[0-3])\s+[0-5]\d\b/.test(t);
  if (mentionsSchedule) return true;

  const offersServices = /\b(?:ofrecemos|contamos con|tenemos|nuestros servicios)\b/.test(t)
    && /\b(?:servicios?|peluqueria|insumos|consulta|urgencias|vacunas?|banos?)\b/.test(t);
  return offersServices;
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
    `Campana de origen: ${input.contact.campaign === 'whatsapp_automation' ? 'automatizacion de WhatsApp' : 'venta de paginas web'}`,
    `Sitio web conocido: ${input.contact.website || 'desconocido'}`,
  ].join('\n');
  const history = input.history.slice(-20).map((m) =>
    `${m.direction === 'in' ? 'Cliente' : 'Jqsystem'}: ${m.body || ''}`,
  ).join('\n');
  const paymentContext = [
    input.transferDetails ? `Datos Mercado Pago/transferencia: ${input.transferDetails}` : '',
    input.stripePaymentLink ? `Link de pago Stripe: ${input.stripePaymentLink}` : '',
  ].filter(Boolean).join('\n');
  const system = `${input.systemPrompt || DEFAULT_SYSTEM_PROMPT}\n\nDatos disponibles:\n${contactContext}\n${paymentContext ? `\nPagos:\n${paymentContext}` : ''}\n\nHistorial:\n${history || 'Sin historial previo'}`;
  const prompt = `${system}\n\nGuia de conversacion: responde primero la pregunta concreta y adapta la respuesta al negocio, a la campana de origen y al historial, sin repetir informacion ya dada. Mantente calido, claro y natural; evita frases genericas, insistencia y mensajes largos. Como setter consultivo, busca entender una necesidad real con una pregunta breve y ofrece una reunion de 15 minutos solo si ayuda a avanzar. Si la persona dice que pasara la informacion a administracion o a otra persona encargada y que te contactaran si hay interes, agradece cordialmente y di que quedas atento, sin presionar ni afirmar que ya aceptaron; responde con action "reply".`;

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
          messages: [{ role: 'system', content: prompt }, { role: 'user', content: input.incoming }],
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
        system: prompt,
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
