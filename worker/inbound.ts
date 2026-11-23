import { exec, one, q, tx } from '../src/lib/db';
import { logEvent, notify } from '../src/lib/events';
import { getSettings } from '../src/lib/settings';
import { nextActionAfter } from '../src/lib/schedule';
import { logger } from '../src/lib/logger';
import type { ContactRow } from '../src/lib/types';
import type { InboundEvent } from './client';
import type { WaClient } from './client';
import { aiChatReply, isWhatsAppTemplateReply } from './ai';

const OPT_OUT_RE = new RegExp(
  [
    'no\\s+me\\s+interesa', 'no\\s+nos\\s+interesa', 'no\\s+gracias', 'no\\s+quiero', 'no\\s+molest\\w*',
    'no\\s+(?:me\\s+)?escrib\\w*', 'dej\\w*\\s+de\\s+(?:escribir|molestar|enviar|contactar|mandar)\\w*',
    '(?:elimin|borr|saqu)\\w*\\s+(?:mi|este)\\s+(?:numero|contacto)', 'stop', 'desuscrib\\w*',
    '(?:dar|dan|den|dame|denme|darme|darnos|dennos)\\s+(?:me\\s+|nos\\s+)?de\\s+baja',
    '(?:sac|quit|borr)\\w*(?:me|nos)?\\s+(?:de|a)\\s+(?:la|su|esa|esta)\\s+(?:lista|base)', 'sacarme\\s+de', 'saquen(?:me|nos)?\\s+de', 'spam', 'me\\s+bloque\\w*', 'numero\\s+equivocado', 'equivocad[oa]',
  ].map((p) => `\\b${p}\\b`).join('|'),
  'i',
);

export function isOptOut(text: string): boolean {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return OPT_OUT_RE.test(t);
}

const REPLIED_OR_CLOSED = ['respondio', 'calificado', 'cliente', 'perdido', 'descartado', 'opt_out'];
const MANUAL_OK_STAGES = ['nuevo', 'valido', 'revision', 'sin_whatsapp'];

async function findContact(ev: InboundEvent): Promise<ContactRow | null> {
  if (ev.phone) {
    const c = await one<ContactRow>('select * from contacts where phone = $1', ['+' + ev.phone]);
    if (c) {
      if (ev.lid && c.lid !== ev.lid) await q('update contacts set lid = $2 where id = $1', [c.id, ev.lid]);
      return c;
    }
  }
  if (ev.lid) return one<ContactRow>('select * from contacts where lid = $1', [ev.lid]);
  return null;
}

/** Procesa un mensaje (entrante o enviado desde el teléfono) y actualiza el pipeline. */
export async function handleMessage(ev: InboundEvent, client?: WaClient): Promise<'ignored' | 'own' | 'manual' | 'reply' | 'optout' | 'duplicate'> {
  const contact = await findContact(ev);
  if (!contact) return 'ignored'; // chats personales o gente fuera del pipeline: no se tocan

  // Mensajes que salieron desde el teléfono (envío manual) o ecos de los que envía el sistema
  if (ev.fromMe) return handleOutgoing(ev, contact);

  const s = await getSettings();
  const optOut = isOptOut(ev.text);
  const templateReply = isWhatsAppTemplateReply(ev.text);
  const incomingDigits = ev.phone ?? contact.phone.replace(/\D/g, '');
  const globallyBlocked = s.ai_blocked_numbers.some((number) => incomingDigits === number || incomingDigits.endsWith(number));

  const result = await tx(async (c) => {
    const ins = await c.query(
      `insert into messages (contact_id, account_id, direction, source, body, status, wa_message_id, sent_at)
       values ($1,$2,'in','inbound',$3,'received',$4, to_timestamp($5::double precision / 1000.0))
       on conflict (account_id, wa_message_id) where wa_message_id is not null do nothing
       returning id`,
      [contact.id, ev.accountId, ev.text.slice(0, 4000), ev.waMessageId, ev.timestamp],
    );
    if (!ins.rowCount) return null; // duplicado
    const stage = contact.stage;
    let newStage = stage;
    let reason: string | null = null;
    if (templateReply) {
      // Las respuestas genéricas de WhatsApp Business no cuentan como interés real:
      // conservan el contacto en seguimiento y no son atendidas por IA.
      reason = 'respuesta_plantilla_whatsapp';
    } else if (optOut && !['cliente', 'calificado'].includes(stage)) {
      newStage = 'opt_out';
      reason = 'opt_out_detectado';
    } else if (!REPLIED_OR_CLOSED.includes(stage)) {
      newStage = 'respondio';
    }
    if (templateReply) {
      await c.query(
        `update contacts set last_inbound_at = null, stage_reason = coalesce($2, stage_reason),
           account_id = coalesce(account_id, $3), updated_at = now() where id = $1`,
        [contact.id, reason, ev.accountId],
      );
    } else {
      await c.query(
        `update contacts set last_inbound_at = now(), stage = $2, stage_reason = coalesce($3, stage_reason),
           next_action_at = null, account_id = coalesce(account_id, $4), updated_at = now() where id = $1`,
        [contact.id, newStage, reason, ev.accountId],
      );
    }
    // Respuesta recibida: se cancela cualquier seguimiento pendiente
    if (!templateReply) {
      await c.query(
        `update messages set status = 'cancelled', updated_at = now()
         where contact_id = $1 and direction = 'out' and status in ('retry','queued')`,
        [contact.id],
      );
    }
    return { newStage, messageId: ins.rows[0].id as number };
  });
  if (!result) return 'duplicate';

  const who = contact.first_name || contact.business_name || contact.name || contact.phone;
  if (result.newStage === 'opt_out') {
    await logEvent('info', 'opt_out', { texto: ev.text.slice(0, 200) }, { accountId: ev.accountId, contactId: contact.id, messageId: result.messageId });
    if (client?.isOpen()) await sendFixedReply(ev, contact, client, 'Sin problema, gracias por avisarme. Te deseo mucho éxito con el negocio.');
    return 'optout';
  }
  await logEvent('info', 'respuesta_recibida', { texto: ev.text.slice(0, 200) }, { accountId: ev.accountId, contactId: contact.id, messageId: result.messageId });
  if (!templateReply && s.ai_chat_enabled && !globallyBlocked && contact.ai_enabled !== false && client?.isOpen()) {
    await generateAndSendAiReply(ev, contact, client);
  }
  if (s.notify_replies && !REPLIED_OR_CLOSED.includes(contact.stage)) {
    await notify(`💬 ${who} respondió (cuenta #${ev.accountId}):\n"${ev.text.slice(0, 300)}"\n${contact.phone}`);
  }
  return 'reply';
}

async function handleOutgoing(ev: InboundEvent, contact: ContactRow): Promise<'own' | 'manual' | 'ignored'> {
  // Eco de un mensaje que envió el propio sistema (ya está registrado con su id)
  const known = await one('select id from messages where account_id = $1 and wa_message_id = $2', [ev.accountId, ev.waMessageId]);
  if (known) return 'own';
  // Mensajes anteriores a la importación del contacto no cuentan (historial)
  if (ev.timestamp < new Date(contact.created_at).getTime() - 60_000) return 'ignored';

  const s = await getSettings();
  if (contact.step === 0 && MANUAL_OK_STAGES.includes(contact.stage)) {
    // Primer mensaje enviado a mano desde el teléfono → arranca el reloj de seguimientos
    const next = nextActionAfter(1, s, new Date(ev.timestamp));
    const msgId = await tx(async (c) => {
      const r = await c.query(
        `insert into messages (contact_id, account_id, direction, step, source, body, body_hash, status, wa_message_id, sent_at, attempts)
         values ($1,$2,'out',1,'manual',$3,null,'sent',$4, to_timestamp($5::double precision / 1000.0), 1)
         on conflict (contact_id, step) where direction = 'out' and step is not null do update
           set source = 'manual', body = excluded.body, status = 'sent', wa_message_id = excluded.wa_message_id,
               account_id = excluded.account_id, sent_at = excluded.sent_at, error_code = null, error_detail = null, updated_at = now()
           where messages.status in ('queued','retry','blocked','failed','unconfirmed')
         returning id`,
        [contact.id, ev.accountId, ev.text.slice(0, 4000), ev.waMessageId, ev.timestamp],
      );
      if (!r.rowCount) return null;
      await c.query(
        `update contacts set step = 1, stage = 'contactado', stage_reason = null, account_id = $2, first_sent_at = coalesce(first_sent_at, now()),
           last_outbound_at = now(), next_action_at = $3, updated_at = now() where id = $1`,
        [contact.id, ev.accountId, next],
      );
      return r.rows[0].id as number;
    });
    if (msgId) {
      await logEvent('info', 'primer_mensaje_manual', { texto: ev.text.slice(0, 120) }, { accountId: ev.accountId, contactId: contact.id, messageId: msgId });
      return 'manual';
    }
    return 'ignored';
  }
  // Escribió a mano a alguien que ya está en el pipeline: se pospone el siguiente seguimiento automático
  await q(
    `update contacts set last_outbound_at = now(),
       next_action_at = case when next_action_at is not null then greatest(next_action_at, now() + interval '1 day') end,
       updated_at = now() where id = $1`,
    [contact.id],
  );
  logger.debug({ contactId: contact.id }, 'mensaje manual a contacto del pipeline: seguimiento pospuesto');
  return 'manual';
}

async function sendFixedReply(ev: InboundEvent, contact: ContactRow, client: WaClient, text: string) {
  const jid = contact.jid ?? `${contact.phone.replace('+', '')}@s.whatsapp.net`;
  const waMessageId = client.newMessageId();
  try {
    await client.sendText(jid, text, { messageId: waMessageId, typingMs: 1000 });
    await exec(
      `insert into messages (contact_id, account_id, direction, source, body, status, wa_message_id, sent_at)
       values ($1,$2,'out','ai',$3,'sent',$4,now())`,
      [contact.id, ev.accountId, text, waMessageId],
    );
  } catch (e) {
    await logEvent('error', 'ia_no_pudo_enviar', { error: (e as Error).message }, { accountId: ev.accountId, contactId: contact.id });
  }
}

async function generateAndSendAiReply(ev: InboundEvent, contact: ContactRow, client: WaClient) {
  const s = await getSettings();
  const history = await q<{ direction: 'in' | 'out'; body: string | null }>(
    `select direction, body from messages
     where contact_id = $1 and direction in ('in','out') and body is not null
       and status in ('received','sent','delivered','read')
     order by coalesce(sent_at, created_at) desc, id desc limit 21`,
    [contact.id],
  );

  const ai = await aiChatReply({
    contact,
    incoming: ev.text,
    history: history.reverse(),
    provider: s.ai_provider,
    systemPrompt: s.ai_system_prompt,
    transferDetails: s.ai_transfer_details,
    stripePaymentLink: s.ai_stripe_payment_link,
  });
  if (!ai) return;

  const jid = contact.jid ?? `${contact.phone.replace('+', '')}@s.whatsapp.net`;
  const waMessageId = client.newMessageId();
  try {
    await client.sendText(jid, ai.reply, { messageId: waMessageId, typingMs: Math.min(5000, Math.max(1000, ai.reply.length * 45)) });
  } catch (e) {
    await logEvent('error', 'ia_no_pudo_enviar', { error: (e as Error).message }, { accountId: ev.accountId, contactId: contact.id });
    return;
  }

  await tx(async (c) => {
    await c.query(
      `insert into messages (contact_id, account_id, direction, source, body, status, wa_message_id, sent_at)
       values ($1,$2,'out','ai',$3,'sent',$4,now())`,
      [contact.id, ev.accountId, ai.reply, waMessageId],
    );
    const handoff = ai.action !== 'reply';
    await c.query(
      `update contacts set ai_enabled = $2, ai_handoff_at = $3, ai_last_action = $4,
         stage = case when $5 then 'opt_out' when $6 then 'calificado' else stage end,
         stage_reason = coalesce($7, stage_reason), next_action_at = null, updated_at = now()
       where id = $1`,
      [
        contact.id,
        !handoff,
        handoff ? new Date() : null,
        ai.action,
        ai.action === 'opt_out',
        ai.action === 'meeting_confirmed',
        ai.action === 'opt_out' ? 'opt_out_ia' : ai.action === 'handoff' || ai.action === 'payment_requested' ? 'derivacion_ia' : null,
      ],
    );
  });
  await logEvent('info', 'respuesta_ia_enviada', { accion: ai.action, texto: ai.reply.slice(0, 300) }, {
    accountId: ev.accountId,
    contactId: contact.id,
  });
}

/** Actualiza estado de entrega (entregado/leído) de mensajes enviados por el sistema. */
export async function handleStatus(accountId: number, waMessageId: string, status: 'server_ack' | 'delivered' | 'read' | 'error') {
  if (status === 'server_ack') return;
  if (status === 'error') {
    const r = await one<{ id: number; contact_id: number }>(
      `update messages set error_code = 'entrega_fallida', error_detail = 'WhatsApp reportó error de entrega', updated_at = now()
       where account_id = $1 and wa_message_id = $2 and direction = 'out' returning id, contact_id`,
      [accountId, waMessageId],
    );
    if (r) await logEvent('warn', 'entrega_fallida', {}, { accountId, contactId: r.contact_id, messageId: r.id });
    return;
  }
  await q(
    `update messages set status = $3, updated_at = now()
     where account_id = $1 and wa_message_id = $2 and direction = 'out'
       and status in ('sent','delivered') and ($3 = 'read' or status = 'sent')`,
    [accountId, waMessageId, status],
  );
}

export async function handleLidMapping(accountId: number, m: { lid: string; phone: string }) {
  await q('update contacts set lid = $2 where phone = $1 and (lid is distinct from $2)', ['+' + m.phone, m.lid]);
}
