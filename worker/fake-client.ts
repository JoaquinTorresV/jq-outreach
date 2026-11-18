import { randomBytes } from 'node:crypto';
import { sleep } from '../src/lib/time';
import { SendError, type ClientHandlers, type WaClient } from './client';

export type FakeOptions = {
  /** velocidad: 1 = tiempos reales de escritura; 0.02 = casi instantáneo */
  speed?: number;
  /** probabilidad de que el contacto responda tras un envío */
  replyRate?: number;
  /** probabilidad de que la respuesta sea un rechazo ("no me interesa") */
  optOutRate?: number;
  /** probabilidad de error de envío aleatorio */
  failRate?: number;
  exists?: (digits: string) => boolean;
  /** errores a lanzar en los próximos envíos (para pruebas) */
  failNext?: SendError[];
  autoOpen?: boolean;
};

/** Cliente simulado: sirve para probar todo el flujo sin un número real (cuentas "simuladas" y tests). */
export class FakeClient implements WaClient {
  readonly kind = 'simulated' as const;
  open = false;
  sent: { jid: string; text: string; messageId: string }[] = [];
  verifyCalls: string[][] = [];
  constructor(private accountId: number, private h: ClientHandlers, public opts: FakeOptions = {}) {
    if (opts.autoOpen !== false) setTimeout(() => this.connect(), 300);
  }
  async connect() {
    this.open = true;
    await this.h.onOpen({ jid: `5600000${String(this.accountId).padStart(4, '0')}:1@s.whatsapp.net`, phone: `5600000${String(this.accountId).padStart(4, '0')}` });
  }
  isOpen() { return this.open; }
  isRegistered() { return true; }
  newMessageId() { return 'SIM' + randomBytes(8).toString('hex').toUpperCase(); }

  async sendText(jid: string, text: string, o: { messageId: string; typingMs: number }) {
    if (!this.open) throw new SendError('not_open', 'simulado: sin conexión');
    const next = this.opts.failNext?.shift();
    if (next) throw next;
    await sleep(Math.min(o.typingMs, 8000) * (this.opts.speed ?? 0.02));
    if (Math.random() < (this.opts.failRate ?? 0)) throw new SendError('other', 'simulado: error aleatorio');
    this.sent.push({ jid, text, messageId: o.messageId });
    const phone = jid.split('@')[0];
    setTimeout(() => void this.h.onMessageStatus(o.messageId, 'delivered'), 400);
    if (Math.random() < (this.opts.replyRate ?? 0.15)) {
      const optOut = Math.random() < (this.opts.optOutRate ?? 0.2);
      setTimeout(
        () =>
          void this.h.onMessage({
            accountId: this.accountId, fromMe: false, waMessageId: 'SIMIN' + randomBytes(6).toString('hex'),
            phone, lid: null, kind: 'conversation', timestamp: Date.now(),
            text: optOut ? 'No me interesa, gracias' : 'Hola! Sí, cuéntame más',
          }),
        3000 + Math.random() * 12000,
      );
    }
  }

  async onWhatsApp(digits: string[]) {
    this.verifyCalls.push(digits);
    const ex = this.opts.exists ?? ((d: string) => !d.endsWith('0'));
    return digits.map((d) => ({ digits: d, jid: ex(d) ? `${d}@s.whatsapp.net` : null, exists: ex(d) }));
  }
  async fetchRestrictions() {}
  async requestPairingCode() { return 'SIMU-LATE'; }
  end() { this.open = false; }
  async logout() { this.open = false; }
}
