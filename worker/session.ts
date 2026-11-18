import { exec, one } from '../src/lib/db';
import { logEvent, type Level } from '../src/lib/events';
import { logger } from '../src/lib/logger';
import type { AccountRow } from '../src/lib/types';
import { clearAuthState } from './pg-auth-state';
import { Dispatcher, type SessionControl } from './dispatcher';
import { handleLidMapping, handleMessage, handleStatus } from './inbound';
import type { CloseInfo, ClientHandlers, Restriction, WaClient } from './client';

export type ClientFactory = (handlers: ClientHandlers, account: AccountRow) => Promise<WaClient>;

export async function patchAccount(id: number, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  await exec(`update accounts set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((k) => patch[k])]);
}

export const getAccount = (id: number) => one<AccountRow>('select * from accounts where id = $1', [id]);

/** Una cuenta de WhatsApp: su conexión, su estado y su dispatcher. Aislada del resto de las cuentas. */
export class AccountSession implements SessionControl {
  client: WaClient | null = null;
  account: AccountRow | null = null;
  readonly dispatcher: Dispatcher;
  private stopped = true;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;
  private pairingPhone: string | null = null;
  private pairingDone = false;
  private connecting = false;
  private log;

  constructor(public readonly id: number, private factory: ClientFactory) {
    this.dispatcher = new Dispatcher(id, () => this.client, this);
    this.log = logger.child({ accountId: id, mod: 'session' });
  }

  async start() {
    this.stopped = false;
    await this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.client?.end();
    this.client = null;
  }

  private scheduleReconnect(immediate = false) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = immediate ? 500 : Math.min(300, 2 * 2 ** this.attempt) * 1000 + Math.random() * 1500;
    this.attempt++;
    this.timer = setTimeout(() => void this.connect(), delay);
  }

  async connect() {
    if (this.stopped || this.connecting || this.client?.isOpen()) return;
    this.connecting = true;
    try {
      const a = await getAccount(this.id);
      if (!a) return this.stop();
      this.account = a;
      if (a.status === 'baneada') return;
      const keepStatus = a.status === 'pausada_manual' || (a.status === 'pausada_auto' && a.paused_until && new Date(a.paused_until) > new Date());
      await patchAccount(this.id, {
        connection: 'connecting',
        ...(keepStatus ? {} : { status: a.status === 'qr_requerido' ? 'qr_requerido' : 'conectando' }),
        disconnected_since: a.disconnected_since ?? new Date(),
      });
      this.pairingDone = false;
      this.client = await this.factory(this.handlers, a);
    } catch (e) {
      const msg = (e as Error).message;
      this.client = null;
      const proxyProblem = /proxy/i.test(msg);
      await patchAccount(this.id, { connection: 'closed', last_error: msg.slice(0, 300) });
      if (proxyProblem) await this.pause('proxy_caido', 2, 'error');
      else await logEvent('error', 'error_de_conexion', { error: msg }, { accountId: this.id });
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  // ───────── Manejadores de eventos del cliente ─────────
  private handlers: ClientHandlers = {
    onOpen: async ({ jid, phone }) => {
      this.attempt = 0;
      const a = await getAccount(this.id);
      const paused = a && (a.status === 'pausada_manual' || (a.status === 'pausada_auto' && a.paused_until && new Date(a.paused_until) > new Date()));
      await patchAccount(this.id, {
        connection: 'open', disconnected_since: null, last_connected_at: new Date(), qr: null, qr_at: null, pairing_code: null,
        wa_jid: jid, ...(phone && !this.account?.simulated ? { phone: '+' + phone } : {}), last_error: null,
        ...(paused ? {} : { status: 'activa', status_reason: null, paused_until: null }),
      });
      await logEvent('info', 'cuenta_conectada', { jid }, { accountId: this.id });
      void this.client?.fetchRestrictions().catch(() => {});
    },

    onClose: async (info: CloseInfo) => {
      const wasRegistered = this.client?.isRegistered() ?? false;
      this.client?.end();
      this.client = null;
      await patchAccount(this.id, { connection: 'closed', disconnected_since: new Date(), last_error: info.reason.slice(0, 300) });
      if (this.stopped) return;

      if (info.loggedOut) return this.markLoggedOut();
      if (info.banned) return this.markBanned(`cierre con código ${info.code} (forbidden)`);
      if (info.replaced) {
        await this.pause('sesion_reemplazada', 60 * 24, 'critical');
        await logEvent('critical', 'sesion_reemplazada', { detalle: 'Otra sesión abrió esta cuenta; no se reconecta sola' }, { accountId: this.id });
        return;
      }
      if (info.restartRequired) return this.scheduleReconnect(true);
      // Sin sesión registrada (QR sin escanear y expirado): quedar a la espera de que alguien pida un QR nuevo
      if (!wasRegistered) {
        await patchAccount(this.id, { status: 'qr_requerido', status_reason: 'qr_expirado', qr: null });
        return;
      }
      await logEvent('warn', 'conexion_perdida', { codigo: info.code, motivo: info.reason }, { accountId: this.id });
      this.scheduleReconnect();
    },

    onQr: async (qr) => {
      await patchAccount(this.id, { qr, qr_at: new Date(), status: 'qr_requerido', status_reason: 'esperando_escaneo', connection: 'connecting' });
      if (this.pairingPhone && !this.pairingDone && this.client) {
        this.pairingDone = true;
        try {
          const code = await this.client.requestPairingCode(this.pairingPhone);
          await patchAccount(this.id, { pairing_code: code });
        } catch (e) {
          await logEvent('warn', 'codigo_vinculacion_fallo', { error: (e as Error).message }, { accountId: this.id });
        }
      }
    },

    onMessage: async (ev) => {
      try { await handleMessage(ev); } catch (e) { await logEvent('error', 'error_mensaje_entrante', { error: (e as Error).message }, { accountId: this.id }); }
    },
    onMessageStatus: async (waId, status) => { await handleStatus(this.id, waId, status).catch(() => {}); },
    onLidMapping: async (m) => { await handleLidMapping(this.id, m).catch(() => {}); },
    onRestriction: async (r) => this.onRestriction(r),
  };

  private async onRestriction(r: Restriction) {
    if (r.type === 'reachout_timelock') {
      await patchAccount(this.id, { cap_info: { ...(this.account?.cap_info ?? {}), reachout: { active: r.active, until: r.until, enforcement: r.enforcement } } });
      if (r.active) {
        const mins = r.until ? Math.max(10, Math.ceil((r.until.getTime() - Date.now()) / 60_000)) : 180;
        await logEvent('critical', 'restriccion_whatsapp', { tipo: r.enforcement, hasta: r.until?.toISOString() ?? 'desconocido' }, { accountId: this.id });
        await this.pause('restriccion_whatsapp', mins, 'critical');
      }
      return;
    }
    const a = await getAccount(this.id);
    await patchAccount(this.id, { cap_info: { ...(a?.cap_info ?? {}), new_chat_cap: { status: r.status, used: r.used, total: r.total, cycle_end: r.cycleEnd } } });
    if (r.status === 'CAPPED') {
      const mins = r.cycleEnd ? Math.max(30, Math.ceil((new Date(r.cycleEnd).getTime() - Date.now()) / 60_000)) : 360;
      await logEvent('error', 'limite_chats_nuevos', { usados: r.used, total: r.total }, { accountId: this.id });
      await this.pause('limite_chats_nuevos', mins, 'error');
    } else if (r.status === 'FIRST_WARNING' || r.status === 'SECOND_WARNING') {
      await logEvent('warn', 'aviso_limite_chats_nuevos', { estado: r.status, usados: r.used, total: r.total }, { accountId: this.id });
    }
  }

  // ───────── Control de estado ─────────
  async pause(reason: string, minutes: number, level: Level = 'error') {
    const a = await getAccount(this.id);
    if (!a || a.status === 'baneada' || a.status === 'pausada_manual') return;
    await patchAccount(this.id, { status: 'pausada_auto', status_reason: reason, paused_until: new Date(Date.now() + minutes * 60_000) });
    await logEvent(level, 'cuenta_pausada_auto', { motivo: reason, minutos: minutes }, { accountId: this.id });
  }

  async markLoggedOut() {
    this.client?.end();
    this.client = null;
    await clearAuthState(this.id);
    await patchAccount(this.id, { status: 'qr_requerido', status_reason: 'sesion_cerrada', connection: 'closed', qr: null, paused_until: null });
    await logEvent('critical', 'sesion_cerrada', { detalle: 'WhatsApp cerró la sesión: hay que escanear el QR de nuevo. Sus contactos pendientes pasan a otro número.' }, { accountId: this.id });
    // Deja listo un QR nuevo una sola vez
    this.attempt = 0;
    this.scheduleReconnect(true);
  }

  async markBanned(reason: string) {
    this.client?.end();
    this.client = null;
    await patchAccount(this.id, { status: 'baneada', status_reason: reason, connection: 'closed', qr: null });
    await logEvent('critical', 'cuenta_baneada', { detalle: reason }, { accountId: this.id });
  }

  // ───────── Comandos desde el dashboard ─────────
  async runCommand(type: string, payload: Record<string, any>): Promise<string> {
    switch (type) {
      case 'connect': {
        this.pairingPhone = payload.phone ? String(payload.phone) : null;
        this.stopped = false;
        this.attempt = 0;
        if (this.client && !this.client.isOpen()) { this.client.end(); this.client = null; }
        const a = await getAccount(this.id);
        if (a?.status === 'baneada') await patchAccount(this.id, { status: 'desconectada', status_reason: null });
        await this.connect();
        return 'conectando';
      }
      case 'pairing': {
        this.pairingPhone = String(payload.phone ?? '');
        this.pairingDone = false;
        if (this.client) { this.client.end(); this.client = null; }
        this.stopped = false;
        await this.connect();
        return 'solicitando código';
      }
      case 'disconnect':
        this.stop();
        await patchAccount(this.id, { status: 'desconectada', status_reason: 'desconectada_manual', connection: 'closed', qr: null });
        return 'desconectada';
      case 'logout':
        try { await this.client?.logout(); } catch { /* ya cerrado */ }
        this.client = null;
        await clearAuthState(this.id);
        await patchAccount(this.id, { status: 'desconectada', status_reason: 'sesion_cerrada_manual', connection: 'closed', qr: null });
        this.stopped = false;
        this.attempt = 0;
        this.scheduleReconnect(true);
        return 'sesión cerrada; generando QR nuevo';
      case 'pause':
        await patchAccount(this.id, { status: 'pausada_manual', status_reason: 'pausa_manual', paused_until: null });
        await logEvent('info', 'cuenta_pausada_manual', {}, { accountId: this.id });
        return 'pausada';
      case 'resume':
        await patchAccount(this.id, { status: this.client?.isOpen() ? 'activa' : 'conectando', status_reason: null, paused_until: null, consecutive_failures: 0 });
        await logEvent('info', 'cuenta_reanudada', {}, { accountId: this.id });
        if (!this.client) { this.stopped = false; await this.connect(); }
        return 'reanudada';
      case 'refresh_caps':
        await this.client?.fetchRestrictions();
        return 'consultado';
      default:
        throw new Error(`comando desconocido: ${type}`);
    }
  }
}
