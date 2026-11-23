import { deleteTemplate, saveTemplate } from '@/app/actions';
import Flash from '@/components/Flash';
import { Badge, Card, PageHeader } from '@/components/ui';
import { pct } from '@/lib/format';
import { getTemplates } from '@/lib/queries';
import { renderTemplate, requiredVars, spinCombos, type Vars } from '@/lib/template';
import { greeting } from '@/lib/time';
import { CAMPAIGNS, CAMPAIGN_LABEL } from '@/lib/campaigns';

const STEP_NAME: Record<number, string> = { 1: 'Primer mensaje', 2: 'Seguimiento 1', 3: 'Seguimiento 2', 4: 'Seguimiento 3 (cierre)' };
const SAMPLES: { label: string; vars: Vars }[] = [
  { label: 'datos completos', vars: { nombre: 'María', nombre_completo: 'María Pérez', negocio: 'Peluquería Lucía', ciudad: 'Viña del Mar', rubro: 'peluquería', direccion: 'Av. Libertad 123', instagram: '@pelu_lucia' } },
  { label: 'solo nombre', vars: { nombre: 'María' } },
  { label: 'solo negocio', vars: { negocio: 'Peluquería Lucía' } },
  { label: 'sin datos', vars: {} },
];

export default async function Templates({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const all = await getTemplates();
  const saludo = greeting(new Date(), 'America/Santiago');
  return (
    <>
      <PageHeader title="Plantillas" sub="Cada paso puede tener varias variantes; el sistema elige una según los datos que tenga de cada contacto." />
      <Flash msg={msg} />
      <Card title="Cómo escribirlas">
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div className="small">
            <p><code>{'{nombre}'}</code> primer nombre · <code>{'{negocio}'}</code> · <code>{'{ciudad}'}</code> · <code>{'{rubro}'}</code> · <code>{'{direccion}'}</code> · <code>{'{instagram}'}</code> · <code>{'{web}'}</code> · <code>{'{saludo}'}</code> (Buenos días/Buenas tardes/Buenas noches). Las columnas extra del archivo también sirven, con su nombre en minúsculas y guion bajo.</p>
            <p><code>{'{nombre|por acá}'}</code> usa “por acá” si falta el nombre. <code>{'{nombre|}'}</code> lo omite sin dejar comas sueltas.</p>
          </div>
          <div className="small">
            <p><code>{'[[Hola|Buenas|Qué tal]]'}</code> elige una opción al azar en cada envío: así no hay dos mensajes iguales.</p>
            <p>Si una variante usa una variable <b>sin</b> texto de respaldo, solo se usa con contactos que tengan ese dato. Deja siempre al menos una variante “sin datos” por paso, para quienes no tienen nada más que el teléfono.</p>
          </div>
        </div>
      </Card>

      {CAMPAIGNS.map((campaign) => (
        <section key={campaign}>
          <h2>{CAMPAIGN_LABEL[campaign]}</h2>
          {[1, 2, 3, 4].map((step) => {
        const list = all.filter((t: any) => t.campaign === campaign && t.step === step);
        const generic = list.some((t: any) => t.active && t.kind === 'normal' && requiredVars(t.body, t.requires).length === 0);
        return (
          <Card key={step} title={`Paso ${step} · ${STEP_NAME[step]}`}>
            {!generic ? <p className="alert warn small">No hay una variante activa que funcione sin datos: los contactos sin nombre ni negocio quedarían en “revisión”. Agrega una.</p> : null}
            {list.map((t: any) => {
              const req = requiredVars(t.body, t.requires);
              const combos = spinCombos(t.body);
              const preview = SAMPLES.map((s) => ({ ...s, ok: req.every((r) => (s.vars as any)[r]), text: renderTemplate(t.body, { ...s.vars, saludo }).text }));
              const first = preview.find((p) => p.ok);
              return (
                <details key={t.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }} open={false}>
                  <summary>
                    {t.name} {!t.active ? <Badge>desactivada</Badge> : null} {t.kind === 'failover' ? <Badge tone="info">failover</Badge> : null}
                    <span className="muted small"> · peso {t.weight} · enviada {t.sent} veces · respondieron {t.replied} ({pct(t.replied, t.sent)})</span>
                  </summary>
                  <div className="small" style={{ marginBottom: 8 }}>
                    Necesita: {req.length ? req.map((r) => <Badge key={r} tone="info">{r}</Badge>) : <Badge tone="ok">nada (sirve para todos)</Badge>}
                    {' '}· Combinaciones por spintax: <b>{combos}</b>{req.length === 0 && combos < 12 ? <span style={{ color: 'var(--warn)' }}> (pocas: con muchos contactos sin datos se repetirá el texto; agrega más opciones)</span> : null}
                  </div>
                  <div className="grid cols-2" style={{ gap: 12 }}>
                    <form action={saveTemplate} style={{ display: 'grid', gap: 8 }}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="campaign" value={campaign} />
                      <div className="form-grid">
                        <label>Nombre<input name="name" defaultValue={t.name} /></label>
                        <label>Paso<select name="step" defaultValue={t.step}>{[1, 2, 3, 4].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                        <label>Tipo<select name="kind" defaultValue={t.kind}><option value="normal">Normal</option><option value="failover">Failover (otro número)</option></select></label>
                        <label>Peso<input type="number" name="weight" min={1} max={20} defaultValue={t.weight} /></label>
                      </div>
                      <label>Texto<textarea name="body" defaultValue={t.body} rows={6} /></label>
                      <label>Datos obligatorios extra (opcional, separados por coma)<input name="requires" defaultValue={(t.requires ?? []).join(', ')} /></label>
                      <label className="inline"><input type="checkbox" name="active" defaultChecked={t.active} /> Activa</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn primary small">Guardar</button>
                        <button className="btn danger small" formAction={deleteTemplate}>Eliminar</button>
                      </div>
                    </form>
                    <div>
                      <h3>Vista previa</h3>
                      {first ? <div className="draft">{first.text}</div> : <p className="alert warn small">Ningún ejemplo cumple los datos obligatorios.</p>}
                      <p className="muted small">Se usaría con: {preview.filter((p) => p.ok).map((p) => p.label).join(', ') || 'nadie'}.</p>
                    </div>
                  </div>
                </details>
              );
            })}
            <details style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
              <summary>+ Nueva variante para este paso</summary>
              <form action={saveTemplate} style={{ display: 'grid', gap: 8 }}>
                <input type="hidden" name="step" value={step} />
                <input type="hidden" name="campaign" value={campaign} />
                <div className="form-grid">
                  <label>Nombre<input name="name" placeholder="Ej. Apertura con rubro" /></label>
                  <label>Tipo<select name="kind"><option value="normal">Normal</option><option value="failover">Failover (otro número)</option></select></label>
                  <label>Peso<input type="number" name="weight" min={1} max={20} defaultValue={1} /></label>
                </div>
                <label>Texto<textarea name="body" rows={5} placeholder="[[Hola|Buenas]] {nombre|}, ¿cómo estás? …" /></label>
                <div><button className="btn primary small">Crear</button></div>
              </form>
            </details>
          </Card>
        );
          })}
        </section>
      ))}
    </>
  );
}
