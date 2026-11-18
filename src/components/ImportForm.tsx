'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

type Preview = {
  filename: string; kind: string; sheets: string[] | null; sheet: string | null; hasHeader: boolean; headers: string[]; samples: string[][];
  mapping: string[]; fields: Record<string, string>; warnings: string[];
  stats: { total: number; ok: number; withName: number; withBusiness: number; withAddress: number; withSocial: number };
  duplicatesInFile: number; existing: number; rejected: { row: number; reason: string; raw: string[] }[]; rejectedTotal: number;
  preview: Record<string, any>[];
};
type Result = { batchId: number; inserted: number; updated: number; total: number; duplicatesInFile: number; rejected: { row: number; reason: string; raw: string[] }[] };

const REASON: Record<string, string> = { sin_telefono: 'sin teléfono', telefono_invalido: 'teléfono inválido', telefono_fijo: 'teléfono fijo (no WhatsApp)' };

export default function ImportForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const [result, setResult] = useState<Result | null>(null);

  async function call(url: string, m: string[] | null, sh: string) {
    const f = fileRef.current?.files?.[0];
    if (!f) return null;
    const fd = new FormData();
    fd.set('file', f);
    if (m) fd.set('mapping', JSON.stringify(m));
    if (sh) fd.set('sheet', sh);
    const res = await fetch(url, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');
    return data;
  }

  async function preview(m: string[] | null, sh = sheet) {
    setBusy(true); setError(''); setResult(null);
    try {
      const data: Preview | null = await call('/api/import/preview', m, sh);
      if (data) { setPv(data); setMapping(data.mapping); setSheet(data.sheet ?? ''); }
    } catch (e) { setError((e as Error).message); setPv(null); } finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setError('');
    try {
      const data: Result | null = await call('/api/import/commit', mapping, sheet);
      if (data) { setResult(data); setPv(null); router.refresh(); if (fileRef.current) fileRef.current.value = ''; }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function downloadRejected() {
    if (!result) return;
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const csv = '﻿' + ['fila,motivo,datos', ...result.rejected.map((r) => `${r.row},${esc(REASON[r.reason] ?? r.reason)},${esc(r.raw.join(' | '))}`)].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'rechazados.csv';
    a.click();
  }

  return (
    <>
      <section className="card">
        <h2>1. Elige el archivo</h2>
        <p className="muted small" style={{ marginTop: -6 }}>CSV, TSV, TXT o Excel (.xlsx). Puede traer nombre de la persona, del negocio, teléfono, dirección y redes; los datos que falten no son problema. También sirve un TXT con solo números, uno por línea.</p>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,text/plain" onChange={() => preview(null, '')} disabled={busy} />
        {busy ? <p className="muted small">Leyendo…</p> : null}
        {error ? <p className="alert bad">{error}</p> : null}
      </section>

      {pv ? (
        <>
          <section className="card">
            <h2>2. Revisa cómo se entendieron las columnas</h2>
            {pv.warnings.map((w) => <p key={w} className="alert warn small">{w}</p>)}
            {pv.sheets && pv.sheets.length > 1 ? (
              <label style={{ maxWidth: 280, marginBottom: 12 }}>Hoja del Excel
                <select value={sheet} onChange={(e) => { setSheet(e.target.value); preview(null, e.target.value); }}>
                  {pv.sheets.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            ) : null}
            {!pv.hasHeader ? <p className="alert info small">El archivo no tiene fila de encabezados; detecté las columnas por su contenido.</p> : null}
            <div className="table-wrap"><table>
              <thead><tr><th>Columna del archivo</th><th>Ejemplos</th><th>Usar como</th></tr></thead>
              <tbody>
                {pv.headers.map((h, i) => (
                  <tr key={i}>
                    <td><b>{h}</b></td>
                    <td className="small muted">{pv.samples[i].filter(Boolean).join(' · ') || '—'}</td>
                    <td>
                      <select value={mapping[i]} disabled={busy} onChange={(e) => { const m = [...mapping]; m[i] = e.target.value; setMapping(m); preview(m); }}>
                        {Object.entries(pv.fields).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>

          <section className="card">
            <h2>3. Resultado esperado</h2>
            <div className="grid cols-4">
              <div className="stat"><div className="stat-value">{pv.stats.ok}</div><div className="stat-label">contactos válidos de {pv.stats.total} filas</div></div>
              <div className="stat"><div className="stat-value">{pv.existing}</div><div className="stat-label">ya existían (solo se completan datos faltantes)</div></div>
              <div className={`stat ${pv.rejectedTotal ? 'warn' : ''}`}><div className="stat-value">{pv.rejectedTotal}</div><div className="stat-label">filas rechazadas</div></div>
              <div className="stat"><div className="stat-value">{pv.duplicatesInFile}</div><div className="stat-label">repetidos dentro del archivo (fusionados)</div></div>
            </div>
            <p className="muted small">Con nombre de persona: <b>{pv.stats.withName}</b> · con negocio: <b>{pv.stats.withBusiness}</b> · con dirección: <b>{pv.stats.withAddress}</b> · con redes/web: <b>{pv.stats.withSocial}</b>. A quienes les falte el nombre se les enviará una variante de mensaje que no lo necesita.</p>
            {pv.preview.length ? (
              <div className="table-wrap"><table>
                <thead><tr><th>Teléfono</th><th>Nombre</th><th>Negocio</th><th>Dirección</th><th>Redes / web</th></tr></thead>
                <tbody>{pv.preview.map((d, i) => (
                  <tr key={i}><td className="mono">{d.phone}</td><td>{d.first_name ? `${d.first_name}` : <span className="muted">—</span>}{d.name && d.name !== d.first_name ? <span className="muted small"> ({d.name})</span> : null}</td><td>{d.business_name ?? <span className="muted">—</span>}</td><td className="small">{d.address ?? '—'}</td><td className="small">{[d.instagram, d.facebook, d.website].filter(Boolean).join(' · ') || '—'}</td></tr>
                ))}</tbody>
              </table></div>
            ) : null}
            {pv.rejected.length ? (
              <details style={{ marginTop: 12 }}>
                <summary>Ver filas rechazadas ({pv.rejectedTotal})</summary>
                <table><tbody>{pv.rejected.map((r) => <tr key={r.row}><td className="small">fila {r.row}</td><td className="small"><b>{REASON[r.reason] ?? r.reason}</b></td><td className="small muted">{r.raw.join(' | ').slice(0, 120)}</td></tr>)}</tbody></table>
              </details>
            ) : null}
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" disabled={busy || pv.stats.ok === 0} onClick={commit}>Importar {pv.stats.ok} contactos</button>
            </div>
          </section>
        </>
      ) : null}

      {result ? (
        <section className="card">
          <h2>Importación lista</h2>
          <p className="alert ok"><b>{result.inserted}</b> contactos nuevos · <b>{result.updated}</b> ya existían (se completaron datos) · <b>{result.rejected.length}</b> rechazados · lote #{result.batchId}.</p>
          <p className="muted small">El sistema verifica poco a poco cuáles tienen WhatsApp y los deja como “válidos” para el primer mensaje. Nada se envía hasta que lo hagas desde <a href="/manual">Cola manual</a> o actives el modo automático en un número.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn small" href={`/contacts?batch=${result.batchId}`}>Ver contactos del lote</a>
            {result.rejected.length ? <button className="btn small" onClick={downloadRejected}>Descargar rechazados (CSV)</button> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
