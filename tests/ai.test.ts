import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWhatsAppTemplateReply } from '../worker/ai';

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
