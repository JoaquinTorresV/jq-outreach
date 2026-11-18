import { q, tx } from '../src/lib/db';
import { logEvent } from '../src/lib/events';
import { getSettings } from '../src/lib/settings';
import { rand } from '../src/lib/time';
import type { WaClient } from './client';

/**
 * Verifica (de a pocos y con pausas) qué números tienen WhatsApp, manteniendo un colchón de contactos "válidos".
 * No se verifica todo de una vez: consultar miles de números de golpe también levanta banderas.
 */
export class Verifier {
  private nextAt = 0;
  private busy = false;

  async tick(pick: () => { client: WaClient; accountId: number } | null) {
    if (this.busy || Date.now() < this.nextAt) return;
    this.busy = true;
    try {
      const s = await getSettings();
      const buf = (await q<{ n: number }>("select count(*)::int as n from contacts where stage = 'valido' and step = 0"))[0]?.n ?? 0;
      if (buf >= s.verify_buffer) return;
      const hour = (await q<{ n: number }>("select count(*)::int as n from contacts where verified_at > now() - interval '1 hour'"))[0]?.n ?? 0;
      if (hour >= s.verify_per_hour) return;
      const sel = pick();
      if (!sel) return;

      const rows = await q<{ id: number; phone: string; verify_attempts: number }>(
        `select id, phone, verify_attempts from contacts
         where stage = 'nuevo' and verify_attempts < 2 order by verify_attempts, id limit $1`,
        [Math.min(s.verify_batch, s.verify_per_hour - hour)],
      );
      if (!rows.length) return;

      let results;
      try {
        results = await sel.client.onWhatsApp(rows.map((r) => r.phone.replace('+', '')));
      } catch (e) {
        this.nextAt = Date.now() + 10 * 60_000;
        await logEvent('warn', 'verificacion_error', { error: (e as Error).message, pausa: '10 min' }, { accountId: sel.accountId });
        return;
      }
      const anyExists = results.some((r) => r.exists);
      let valid = 0, none = 0, retry = 0;
      await tx(async (c) => {
        for (const r of rows) {
          const res = results.find((x) => x.digits === r.phone.replace('+', ''));
          if (res?.exists) {
            valid++;
            await c.query(`update contacts set stage = 'valido', jid = $2, verified_at = now(), stage_reason = null, updated_at = now() where id = $1`, [r.id, res.jid]);
          } else if (r.verify_attempts >= 1 || anyExists) {
            // Si en el mismo lote otros sí existen, este realmente no tiene WhatsApp; si no, se confirma en una 2ª pasada
            none++;
            await c.query(`update contacts set stage = 'sin_whatsapp', stage_reason = 'sin_whatsapp', verified_at = now(), updated_at = now() where id = $1`, [r.id]);
          } else {
            retry++;
            await c.query('update contacts set verify_attempts = verify_attempts + 1, updated_at = now() where id = $1', [r.id]);
          }
        }
      });
      await logEvent('info', 'verificacion_lote', { validos: valid, sin_whatsapp: none, reintentar: retry }, { accountId: sel.accountId });
      // Espaciado: el lote siguiente según la tasa por hora configurada, con jitter
      const spacing = (3600 / Math.max(1, s.verify_per_hour / s.verify_batch)) * 1000;
      this.nextAt = Date.now() + spacing * rand(0.7, 1.3);
    } finally {
      this.busy = false;
    }
  }
}
