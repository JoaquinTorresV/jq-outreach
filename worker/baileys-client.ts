import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers, DisconnectReason, fetchLatestBaileysVersion, generateMessageIDV2, isJidBroadcast, isJidGroup,
  isJidNewsletter, isJidStatusBroadcast, isLidUser, isPnUser, jidDecode, makeCacheableSignalKeyStore,
  type WAMessage,
} from '@whiskeysockets/baileys';
import type { Agent } from 'node:https';
import { logger } from '../src/lib/logger';
import { sleep } from '../src/lib/time';
import { usePgAuthState } from './pg-auth-state';
import {
  SendError, withTimeout,
  type ClientHandlers, type InboundEvent, type WaClient,
} from './client';

const IGNORED_KINDS = new Set([
  'protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'reactionMessage',
  'pollUpdateMessage', 'encReactionMessage', 'keepInChatMessage',
]);

function extractText(m: WAMessage): { text: string; kind: string } {
  const msg = m.message;
  if (!msg) return { text: '', kind: 'empty' };
  const inner = msg.ephemeralMessage?.message ?? msg.viewOnceMessage?.message ?? msg.documentWithCaptionMessage?.message ?? msg;
  const kind = Object.keys(inner).find((k) => k !== 'messageContextInfo') ?? 'unknown';
  const text =
    inner.conversation ?? inner.extendedTextMessage?.text ?? inner.imageMessage?.caption ?? inner.videoMessage?.caption ??
    inner.documentMessage?.caption ?? inner.buttonsResponseMessage?.selectedDisplayText ?? inner.listResponseMessage?.title ?? '';
  return { text: text || (kind === 'conversation' ? '' : `[${kind.replace('Message', '')}]`), kind };
}

export async function createBaileysClient(opts: {
  accountId: number;
  handlers: ClientHandlers;
  agent?: Agent;
}): Promise<WaClient> {
  const { accountId, handlers: h } = opts;
  const log = logger.child({ accountId, mod: 'baileys' });
  const { state, saveCreds, registered } = await usePgAuthState(accountId);

  let version: [number, number, number] | undefined;
  try {
    version = (await withTimeout(fetchLatestBaileysVersion(), 8000, () => new Error('timeout'))).version as [number, number, number];
  } catch {
    log.warn('no pude consultar la última versión de WhatsApp Web; uso la incluida en Baileys');
  }

  const baileysLog = logger.child({ accountId, mod: 'wa' });
  baileysLog.level = process.env.BAILEYS_LOG_LEVEL ?? 'warn';

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLog as any) },
    logger: baileysLog as any,
    browser: Browsers.ubuntu('Chrome'),
    agent: opts.agent,
    fetchAgent: opts.agent,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  });

  let open = false;

  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
      h.onCredsSaved?.();
    } catch (e) {
      log.error({ err: (e as Error).message }, 'no pude guardar las credenciales de WhatsApp');
    }
  });

  sock.ev.on('connection.update', async (u) => {
    try {
      if (u.qr) await h.onQr(u.qr);
      if (u.reachoutTimeLock) {
        const t = u.reachoutTimeLock;
        await h.onRestriction({
          type: 'reachout_timelock', active: !!t.isActive, until: t.timeEnforcementEnds ?? null,
          enforcement: (t.enforcementType as string | undefined) ?? null,
        });
      }
      if (u.connection === 'open') {
        open = true;
        const id = sock.user?.id ?? null;
        const phone = id ? (jidDecode(id)?.user ?? null) : null;
        await h.onOpen({ jid: id, phone });
      } else if (u.connection === 'close') {
        open = false;
        const err = u.lastDisconnect?.error as Boom | undefined;
        const code = err?.output?.statusCode ?? null;
        await h.onClose({
          code,
          reason: err?.message ?? 'cerrada',
          loggedOut: code === DisconnectReason.loggedOut,
          banned: code === DisconnectReason.forbidden,
          replaced: code === DisconnectReason.connectionReplaced,
          restartRequired: code === DisconnectReason.restartRequired,
        });
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, 'error en connection.update');
    }
  });

  sock.ev.on('lid-mapping.update', async (m) => {
    try {
      const pn = jidDecode(m.pn)?.user;
      const lid = jidDecode(m.lid)?.user;
      if (pn && lid) await h.onLidMapping({ lid, phone: pn });
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'error en lid-mapping.update');
    }
  });

  sock.ev.on('message-capping.update', async (c) => {
    try {
      await h.onRestriction({
        type: 'new_chat_cap', status: (c.capping_status as string | undefined) ?? null,
        used: c.used_quota ?? null, total: c.total_quota ?? null, cycleEnd: c.cycle_end_timestamp ?? null,
      });
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'error en message-capping.update');
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      const id = u.key?.id;
      const st = u.update?.status;
      if (!id || st == null) continue;
      // proto.WebMessageInfo.Status: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED
      const mapped = st === 0 ? 'error' : st === 2 ? 'server_ack' : st === 3 ? 'delivered' : st >= 4 ? 'read' : null;
      if (mapped) await Promise.resolve(h.onMessageStatus(id, mapped)).catch(() => {});
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      try {
        const jid = m.key.remoteJid;
        if (!jid || !m.key.id) continue;
        if (isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid)) continue;
        const { text, kind } = extractText(m);
        if (IGNORED_KINDS.has(kind) || kind === 'empty') continue;

        let phone: string | null = null;
        let lid: string | null = null;
        if (isPnUser(jid)) phone = jidDecode(jid)?.user ?? null;
        else if (isLidUser(jid)) {
          lid = jidDecode(jid)?.user ?? null;
          const alt = (m.key as { remoteJidAlt?: string }).remoteJidAlt;
          if (alt && isPnUser(alt)) phone = jidDecode(alt)?.user ?? null;
          else {
            const pn = await sock.signalRepository.lidMapping.getPNForLID(jid).catch(() => null);
            if (pn) phone = jidDecode(pn)?.user ?? null;
          }
        } else continue;

        const ts = Number(m.messageTimestamp ?? 0) * 1000 || Date.now();
        const ev: InboundEvent = {
          accountId, fromMe: !!m.key.fromMe, waMessageId: m.key.id, phone, lid, text, kind, timestamp: ts,
        };
        await h.onMessage(ev);
      } catch (e) {
        log.error({ err: (e as Error).message }, 'error procesando un mensaje entrante');
      }
    }
  });

  const client: WaClient = {
    kind: 'baileys',
    isOpen: () => open,
    isRegistered: () => !!state.creds.registered || registered,
    newMessageId: () => generateMessageIDV2(sock.user?.id),

    async sendText(jid, text, { messageId, typingMs }) {
      if (!open) throw new SendError('not_open', 'La conexión no está abierta');
      try {
        await sock.sendPresenceUpdate('composing', jid).catch(() => {});
        await sleep(typingMs);
        await sock.sendPresenceUpdate('paused', jid).catch(() => {});
        if (!open) throw new SendError('not_open', 'La conexión se cerró antes de enviar');
        await withTimeout(sock.sendMessage(jid, { text }, { messageId }), 30_000, () => new SendError('timeout', 'Sin confirmación del servidor en 30 s'));
      } catch (e) {
        if (e instanceof SendError) throw e;
        const sc = (e as Boom)?.output?.statusCode;
        const msg = (e as Error)?.message ?? String(e);
        if (sc === 401) throw new SendError('logged_out', msg, sc);
        if (sc === 403) throw new SendError('forbidden', msg, sc);
        if (/not authenticated/i.test(msg)) throw new SendError('not_open', msg, sc);
        if (sc === 408 || /timed out/i.test(msg) || sc === 428 || /connection closed/i.test(msg)) throw new SendError('timeout', msg, sc);
        throw new SendError('other', msg, sc);
      }
    },

    async onWhatsApp(digits) {
      const res = (await sock.onWhatsApp(...digits.map((d) => `${d}@s.whatsapp.net`))) ?? [];
      return digits.map((d) => {
        const hit = res.find((r) => jidDecode(r.jid)?.user === d);
        return { digits: d, jid: hit?.exists ? hit.jid : null, exists: !!hit?.exists };
      });
    },

    async fetchRestrictions() {
      const t = await sock.fetchAccountReachoutTimelock().catch(() => null);
      if (t) {
        await h.onRestriction({ type: 'reachout_timelock', active: !!t.isActive, until: t.timeEnforcementEnds ?? null, enforcement: (t.enforcementType as string | undefined) ?? null });
      }
      const c = await sock.fetchNewChatMessageCap().catch(() => null);
      if (c) {
        await h.onRestriction({ type: 'new_chat_cap', status: (c.capping_status as string | undefined) ?? null, used: c.used_quota ?? null, total: c.total_quota ?? null, cycleEnd: c.cycle_end_timestamp ?? null });
      }
    },

    requestPairingCode: (phone) => sock.requestPairingCode(phone.replace(/\D/g, '')),

    end() {
      open = false;
      try { sock.end(undefined); } catch { /* ya cerrado */ }
    },
    async logout() {
      open = false;
      try { await sock.logout(); } catch { try { sock.end(undefined); } catch { /* */ } }
    },
  };
  return client;
}
