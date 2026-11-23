import { clearDryRun, saveSettings, testAlert, toggleSwitch } from '@/app/actions';
import Flash from '@/components/Flash';
import { Card, PageHeader } from '@/components/ui';
import { getSettings } from '@/lib/settings';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const s = await getSettings(0);
  const n = (name: string, label: string, v: number, hint?: string, min = 0, max = 100000) => (
    <label>{label}<input type="number" name={name} defaultValue={v} min={min} max={max} />{hint ? <span className="muted small"> {hint}</span> : null}</label>
  );
  return (
    <>
      <PageHeader title="Ajustes" sub="Todo se aplica en segundos, sin reiniciar nada." />
      <Flash msg={msg} />
      <div className="grid cols-2">
        <Card title="Interruptores">
          <form action={toggleSwitch} style={{ marginBottom: 12 }}>
            <input type="hidden" name="key" value="kill_switch" /><input type="hidden" name="return" value="/settings" />
            <p className="small">Kill switch: frena de inmediato todos los envíos de todos los números (la recepción de respuestas sigue).</p>
            <button className={`btn ${s.kill_switch ? 'primary' : 'danger'}`}>{s.kill_switch ? 'Reanudar envíos' : 'Pausar todos los envíos'}</button>
          </form>
          <form action={toggleSwitch}>
            <input type="hidden" name="key" value="dry_run" /><input type="hidden" name="return" value="/settings" />
            <p className="small">Modo prueba: arma mensajes, aplica cupos y recorre todo el flujo, pero <b>no envía nada</b>. Los “días” de espera pasan a minutos para ver los seguimientos en poco tiempo.</p>
            <button className="btn">{s.dry_run ? 'Salir del modo prueba' : 'Activar modo prueba'}</button>
          </form>
          <form action={clearDryRun} style={{ marginTop: 12 }}>
            <p className="small muted">Antes de lanzar de verdad, limpia lo generado en pruebas: borra los mensajes simulados y deja los contactos como estaban.</p>
            <button className="btn small danger">Limpiar datos de prueba</button>
          </form>
        </Card>
        <Card title="Alertas">
          <p className="small muted">Se avisa por webhook de Discord (o Slack) cuando hay errores críticos —cuenta baneada, sesión cerrada, proxy caído, worker reiniciándose— y cuando alguien responde.</p>
          <form action={testAlert}><button className="btn small">Enviar alerta de prueba</button></form>
          <p className="small muted">Configura la URL abajo y guarda primero.</p>
        </Card>
      </div>

      <form action={saveSettings}>
        <Card title="Horario y ritmo de envío">
          <div className="form-grid">
            <label>Zona horaria<input name="timezone" defaultValue={s.timezone} /></label>
            {n('start_hour', 'Desde las (hora)', s.send_window.start_hour, '', 0, 23)}
            {n('end_hour', 'Hasta las (hora)', s.send_window.end_hour, '', 1, 24)}
          </div>
          <p style={{ margin: '12px 0 4px', fontWeight: 600, fontSize: 13 }}>Días de envío</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {DAYS.map((d, i) => <label key={d} className="inline"><input type="checkbox" name={`day_${i}`} defaultChecked={s.send_window.days.includes(i)} /> {d}</label>)}
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            {n('delay_min_s', 'Espera mínima entre mensajes (s)', s.delay_min_s)}
            {n('delay_max_s', 'Espera máxima entre mensajes (s)', s.delay_max_s)}
            {n('break_every_min', 'Pausa larga cada (mín. mensajes)', s.break_every_min)}
            {n('break_every_max', 'Pausa larga cada (máx. mensajes)', s.break_every_max)}
            {n('break_min_s', 'Duración pausa larga mín. (s)', s.break_min_s)}
            {n('break_max_s', 'Duración pausa larga máx. (s)', s.break_max_s)}
          </div>
          <p className="muted small">Referencia: {Math.round((s.send_window.end_hour - s.send_window.start_hour) * 3600 / ((s.delay_min_s + s.delay_max_s) / 2 || 1))} mensajes por número en la ventana, sin contar pausas largas.</p>
        </Card>
        <Card title="Seguimientos">
          <div className="form-grid">
            <label>Días de espera antes de cada seguimiento (3 números)<input name="followup_days" defaultValue={s.followup_days.join(', ')} /></label>
            {n('exhaust_after_days', 'Días tras el último seguimiento para marcar “agotado”', s.exhaust_after_days)}
            <label>Dejar de iniciar contactos nuevos desde (fecha)<input type="date" name="stop_new_after" defaultValue={s.stop_new_after ?? ''} /></label>
          </div>
          <p className="muted small">Para una campaña de 30 días, pon la fecha del día 22: los últimos días se usan solo para completar seguimientos de los contactos ya iniciados.</p>
        </Card>
        <Card title="Seguridad anti-baneo">
          <div className="form-grid">
            {n('duplicate_guard_max', 'Máx. de textos idénticos por número en 24 h', s.duplicate_guard_max, '', 1, 1000)}
            {n('max_send_attempts', 'Intentos por mensaje ante errores', s.max_send_attempts, '', 1, 5)}
            {n('circuit_breaker_failures', 'Fallos seguidos para pausar un número', s.circuit_breaker_failures, '', 2, 50)}
            {n('qr_failover_minutes', 'Minutos sin sesión antes de pasar sus contactos a otro número', s.qr_failover_minutes, '', 5, 1440)}
          </div>
          <label className="inline" style={{ marginTop: 12 }}><input type="checkbox" name="ai_personalization" defaultChecked={s.ai_personalization} /> Reescribir levemente cada mensaje con IA (requiere ANTHROPIC_API_KEY en el servidor; si falla se usa la plantilla)</label>
        </Card>
        <Card title="Agente de respuestas por WhatsApp">
          <label className="inline"><input type="checkbox" name="ai_chat_enabled" defaultChecked={s.ai_chat_enabled} /> Responder automáticamente conversaciones entrantes</label>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>Proveedor
              <select name="ai_provider" defaultValue={s.ai_provider}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>
            <label>Datos de Mercado Pago o transferencia<textarea name="ai_transfer_details" defaultValue={s.ai_transfer_details} placeholder="Nombre, RUT/alias, banco o instrucciones de transferencia…" /></label>
            <label>Link de pago Stripe<input name="ai_stripe_payment_link" defaultValue={s.ai_stripe_payment_link} placeholder="https://buy.stripe.com/…" /></label>
            <label>Números bloqueados para la IA
              <textarea name="ai_blocked_numbers" defaultValue={s.ai_blocked_numbers.join('\n')} placeholder="56912345678&#10;573001234567" />
            </label>
          </div>
          <label style={{ marginTop: 12 }}>Contexto y reglas del agente
            <textarea name="ai_system_prompt" defaultValue={s.ai_system_prompt} placeholder="Incluye servicios, precios, horarios, reglas comerciales y cuándo derivar a Joaquín." style={{ minHeight: 180 }} />
          </label>
          <p className="muted small">Las respuestas automáticas se detienen al confirmar reunión/pago, derivar a humano, solicitar baja o cuando se pausa el contacto desde el CRM.</p>
        </Card>
        <Card title="Verificación de números">
          <div className="form-grid">
            {n('verify_per_hour', 'Consultas por hora', s.verify_per_hour, '', 10, 2000)}
            {n('verify_batch', 'Tamaño de cada lote', s.verify_batch, '', 1, 50)}
            {n('verify_buffer', 'Contactos válidos de reserva', s.verify_buffer, 'no se verifica todo de golpe', 10, 5000)}
          </div>
        </Card>
        <Card title="Notificaciones">
          <div className="form-grid">
            <label>URL del webhook (Discord/Slack)<input name="alert_webhook_url" defaultValue={s.alert_webhook_url} placeholder="https://discord.com/api/webhooks/…" /></label>
            <label>Nivel mínimo de alerta
              <select name="alert_min_level" defaultValue={s.alert_min_level}>
                <option value="critical">Solo críticas</option><option value="error">Errores y críticas</option><option value="warn">También avisos</option>
              </select>
            </label>
          </div>
          <label className="inline" style={{ marginTop: 12 }}><input type="checkbox" name="notify_replies" defaultChecked={s.notify_replies} /> Avisar cuando alguien responde</label>
        </Card>
        <button className="btn primary">Guardar ajustes</button>
      </form>
    </>
  );
}
