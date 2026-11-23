import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiChatReply, isWhatsAppTemplateReply } from '../worker/ai';
import type { ContactRow } from '../src/lib/types';

const contact: ContactRow = {
  id: 1, phone: '+56912345678', jid: null, lid: null, name: 'Camila Soto', first_name: 'Camila',
  business_name: 'Veterinaria Demo', address: null, city: 'Santiago', category: 'veterinaria',
  email: null, instagram: null, facebook: null, website: null, maps_url: null, campaign: 'web_sales',
  extra: {}, batch_id: null, source: 'test', account_id: null, stage: 'respondio', stage_reason: null,
  step: 1, next_action_at: null, verify_attempts: 0, verified_at: null, failover_pending: false,
  first_sent_at: null, last_outbound_at: null, last_inbound_at: null, notes: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ai_enabled: true, ai_handoff_at: null, ai_last_action: null,
};

test('detecta mensajes automáticos habituales de WhatsApp Business', () => {
  for (const text of [
    'Hola, dime cómo te llamas y qué necesitas',
    'Hola, ¿cómo te llamas? ¿Qué servicio necesitas?',
    'Hola, ¿qué necesitas?',
    'Hola, ¿en qué podemos ayudarte?',
    'Hola, ¿en qué podemos asistirte?',
    'Buen día! 👋 Te has comunicado con Veterinaria Concha y Toro. Dentro de unos momentos, tu consulta será resuelta. HORARIO DE ATENCIÓN: Lunes a viernes 10:00 a 14:00.',
    'Hola! ✨ Gracias por comunicarte con Clínica Veterinaria Sevilla. ¿En qué podemos ayudarte? Te responderemos a la brevedad.',
    'Gracias por comunicarte con Small Pets Puerto Montt. ¿Cómo podemos ayudarte? Busca servicio de peluquería canina o insumos de mascotas.',
    'Servicios disponibles: peluquería canina, baños e insumos para mascotas.',
    'HORARIO DE ATENCIÓN: Lunes a viernes 10:00 a 14:00, sábado 10:00 a 17:00.',
    'La consulta tiene un valor de $15.000.',
    '¡Hola! Buen día desde Veterinaria San Gabriel. Te recordamos que nuestra atención es 24 horas y por orden de llegada. Estamos aquí para ayudarte con lo que necesites. Después de las 00:00, por favor comunícate por teléfono, ya que no podremos atender mensajes por WhatsApp en ese horario. ¿En qué podemos asistirte hoy?',
  ]) {
    assert.equal(isWhatsAppTemplateReply(text), true, text);
  }
});

test('no confunde respuestas reales del cliente con mensajes automáticos', () => {
  for (const text of [
    'Sí, necesito una página web',
    '¿Cuánto cuesta?',
    'Quiero agendar una reunión',
    'Hola, buenas tardes',
    'Te comunicas con el área de recepción, le entregaremos esta información a la administración de la Veterinaria y en caso de interesarles te contactaremos por esta vía.',
    'Hola, buenas tardes. Soy Joaquín, te escribo por una página web para la veterinaria.',
  ]) {
    assert.equal(isWhatsAppTemplateReply(text), false, text);
  }
});

test('solicita y procesa la salida estructurada de Anthropic', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousFetch = globalThis.fetch;
  const captured: {
    body?: { tool_choice?: { name?: string }; tools?: { input_schema?: { required?: string[] } }[] };
  } = {};
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = async (_input, init) => {
    captured.body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      content: [{
        type: 'tool_use',
        name: 'respond_to_contact',
        input: { reply: 'Muchas gracias, quedo atento.', action: 'reply' },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await aiChatReply({
      contact,
      incoming: 'Lo pasaremos a administración y te contactaremos si les interesa.',
      history: [],
      provider: 'anthropic',
      systemPrompt: 'Instrucciones de prueba',
      transferDetails: '',
      stripePaymentLink: '',
    });

    assert.deepEqual(result, { reply: 'Muchas gracias, quedo atento.', action: 'reply' });
    assert.equal(captured.body?.tool_choice?.name, 'respond_to_contact');
    assert.deepEqual(captured.body?.tools?.[0]?.input_schema?.required, ['reply', 'action']);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});
