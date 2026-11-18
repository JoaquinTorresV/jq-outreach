/** Contrato entre la lógica de negocio y WhatsApp. Baileys y el cliente simulado lo implementan. */

export type InboundEvent = {
  accountId: number;
  fromMe: boolean;
  waMessageId: string;
  phone: string | null; // solo dígitos (E.164 sin "+")
  lid: string | null;
  text: string;
  kind: string;
  timestamp: number; // ms
};

export type MessageStatus = 'server_ack' | 'delivered' | 'read' | 'error';

export type CloseInfo = { code: number | null; reason: string; loggedOut: boolean; banned: boolean; replaced: boolean; restartRequired: boolean };

export type Restriction =
  | { type: 'reachout_timelock'; active: boolean; until: Date | null; enforcement: string | null }
  | { type: 'new_chat_cap'; status: string | null; used: number | null; total: number | null; cycleEnd: string | null };

export interface ClientHandlers {
  onOpen(info: { jid: string | null; phone: string | null }): void | Promise<void>;
  onClose(info: CloseInfo): void | Promise<void>;
  onQr(qr: string): void | Promise<void>;
  onMessage(ev: InboundEvent): void | Promise<void>;
  onMessageStatus(waMessageId: string, status: MessageStatus): void | Promise<void>;
  onLidMapping(m: { lid: string; phone: string }): void | Promise<void>;
  onRestriction(r: Restriction): void | Promise<void>;
  onCredsSaved?(): void;
}

export interface WaClient {
  readonly kind: 'baileys' | 'simulated';
  isOpen(): boolean;
  isRegistered(): boolean;
  newMessageId(): string;
  sendText(jid: string, text: string, opts: { messageId: string; typingMs: number }): Promise<void>;
  onWhatsApp(digits: string[]): Promise<{ digits: string; jid: string | null; exists: boolean }[]>;
  fetchRestrictions(): Promise<void>;
  requestPairingCode(phone: string): Promise<string>;
  end(): void;
  logout(): Promise<void>;
}

export type SendErrorCode =
  | 'timeout'       // sin confirmación: puede haberse enviado → NO reenviar solo
  | 'not_open'      // no había conexión: seguro reintentar
  | 'logged_out'    // la sesión ya no es válida
  | 'forbidden'     // 403: posible restricción/ban
  | 'other';

export class SendError extends Error {
  constructor(public code: SendErrorCode, message: string, public statusCode?: number) {
    super(message);
    this.name = 'SendError';
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(onTimeout()), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
