import QRCode from 'qrcode';
import { accountCommand, deleteAccount, saveAccount } from '@/app/actions';
import AutoRefresh from '@/components/AutoRefresh';
import Flash from '@/components/Flash';
import { AccountBadge, Badge, Card, PageHeader } from '@/components/ui';
import { ago, fmtDateTime } from '@/lib/format';
import { getAccounts, getCommands } from '@/lib/queries';

function AccountFields({ a }: { a?: any }) {
  return (
    <div className="form-grid">
      <label>Nombre interno<input name="label" defaultValue={a?.label ?? ''} placeholder="Ej. Número fuerte" required /></label>
      <label>Primer mensaje
        <select name="first_message_mode" defaultValue={a?.first_message_mode ?? 'manual'}>
          <option value="manual">Manual (lo envío yo; más seguro)</option>
          <option value="auto">Automático (lo envía el sistema)</option>
        </select>
      </label>
      <label>Contactos nuevos por día<input type="number" name="daily_new_cap" min={0} max={1000} defaultValue={a?.daily_new_cap ?? 50} /></label>
      <label>Mensajes totales por día (nuevos + seguimientos)<input type="number" name="daily_total_cap" min={1} max={2000} defaultValue={a?.daily_total_cap ?? 150} /></label>
      <label>Máximo por hora<input type="number" name="hourly_cap" min={1} max={500} defaultValue={a?.hourly_cap ?? 40} /></label>
      <label>Proxy (recomendado, uno por número)<input name="proxy_url" defaultValue={a?.proxy_url ?? ''} placeholder="socks5://usuario:clave@host:puerto" /></label>
    </div>
  );
}

export default async function Accounts({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const accounts = await getAccounts();
  const cmds = Object.fromEntries(await Promise.all(accounts.map(async (a) => [a.id, await getCommands(a.id)] as const)));
  const qrs = Object.fromEntries(await Promise.all(accounts.filter((a) => a.qr).map(async (a) => [a.id, await QRCode.toDataURL(a.qr!, { margin: 1, width: 440 })] as const)));
  const busy = accounts.some((a) => ['qr_requerido', 'conectando'].includes(a.status));
  const total = accounts.reduce((s, a) => s + a.daily_new_cap, 0);
  return (
    <>
      {busy ? <AutoRefresh seconds={4} /> : <AutoRefresh seconds={20} />}
      <PageHeader title="Números de WhatsApp" sub={accounts.length > 1 ? `Reparto de contactos nuevos: ${accounts.map((a) => `${a.label} ${Math.round((a.daily_new_cap / Math.max(1, total)) * 100)}%`).join(' · ')}` : 'Agrega uno o dos números. El reparto se controla con el cupo de nuevos por día de cada uno.'} />
      <Flash msg={msg} />
      {accounts.map((a) => (
        <Card key={a.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ marginBottom: 4 }}>{a.label} <AccountBadge status={a.status} /> {a.simulated ? <Badge tone="info">simulado</Badge> : null}</h2>
              <div className="muted small">
                {a.phone ?? 'sin vincular'} · conexión: {a.connection} · latido {ago(a.last_heartbeat)}
                {a.status_reason ? <> · motivo: <b>{a.status_reason}</b></> : null}{a.paused_until ? <> · hasta {fmtDateTime(a.paused_until)}</> : null}
              </div>
              {a.last_error ? <div className="small" style={{ color: 'var(--bad)' }}>Último error: {a.last_error}</div> : null}
              {!a.proxy_url && !a.simulated ? <div className="small" style={{ color: 'var(--warn)' }}>Sin proxy: sale por la IP del servidor. Con dos números, una misma IP los relaciona y si baneas uno el otro queda expuesto.</div> : null}
            </div>
            <form action={accountCommand} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'start' }}>
              <input type="hidden" name="account_id" value={a.id} />
              {a.status === 'pausada_manual' || a.status === 'pausada_auto' ? <button className="btn small primary" name="type" value="resume">Reanudar</button> : <button className="btn small" name="type" value="pause">Pausar</button>}
              <button className="btn small" name="type" value="connect" title="Reconecta o genera un QR nuevo si no hay sesión">Conectar / mostrar QR</button>
              <button className="btn small" name="type" value="refresh_caps" title="Consulta a WhatsApp si hay restricciones o límite de chats nuevos">Consultar límites</button>
              <button className="btn small" name="type" value="disconnect">Desconectar</button>
              <button className="btn small danger" name="type" value="logout" title="Cierra la sesión de WhatsApp y pide vincular de nuevo">Cerrar sesión</button>
            </form>
          </div>

          {qrs[a.id] && a.status === 'qr_requerido' ? (
            <div className="grid cols-2" style={{ margin: '14px 0' }}>
              <div>
                <h3>Vincular con QR</h3>
                <p className="small muted">En el teléfono del número: WhatsApp → Dispositivos vinculados → Vincular un dispositivo → escanea. El QR se renueva solo.</p>
                <div className="qr"><img src={qrs[a.id]} alt="Código QR para vincular WhatsApp" /></div>
              </div>
              <div>
                <h3>O con código de 8 caracteres</h3>
                <p className="small muted">Si no puedes escanear: Vincular con el número de teléfono → escribe el código.</p>
                {a.pairing_code ? <p className="pairing">{a.pairing_code}</p> : null}
                <form action={accountCommand} className="form-row">
                  <input type="hidden" name="account_id" value={a.id} /><input type="hidden" name="type" value="pairing" />
                  <label>Número con código de país<input name="phone" placeholder="56912345678" inputMode="numeric" /></label>
                  <button className="btn small">Pedir código</button>
                </form>
              </div>
            </div>
          ) : null}

          {cmds[a.id]?.length ? <p className="muted small">Órdenes: {cmds[a.id].map((c: any) => `${c.type} → ${c.status}${c.result ? ` (${c.result})` : ''}`).join(' · ')}</p> : null}

          <details style={{ marginTop: 10 }}>
            <summary>Configuración</summary>
            <form action={saveAccount} style={{ display: 'grid', gap: 12 }}>
              <input type="hidden" name="id" value={a.id} />
              <AccountFields a={a} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary small">Guardar</button>
                <button className="btn danger small" formAction={deleteAccount} title="Sus contactos quedan sin asignar">Eliminar número</button>
              </div>
            </form>
          </details>
        </Card>
      ))}
      <Card title="Agregar un número">
        <form action={saveAccount} style={{ display: 'grid', gap: 12 }}>
          <AccountFields />
          <label className="inline"><input type="checkbox" name="simulated" /> Número simulado (para probar el sistema sin WhatsApp real)</label>
          <div><button className="btn primary">Crear y vincular</button></div>
        </form>
      </Card>
    </>
  );
}
