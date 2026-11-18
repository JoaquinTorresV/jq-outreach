import { deleteBatch } from '@/app/actions';
import Flash from '@/components/Flash';
import ImportForm from '@/components/ImportForm';
import { Card, PageHeader } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { getBatches } from '@/lib/queries';

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const batches = await getBatches();
  return (
    <>
      <PageHeader title="Importar contactos" sub="Sube tu lista; antes de guardar verás cómo se interpretó cada columna." />
      <Flash msg={msg} />
      <ImportForm />
      <Card title="Lotes importados">
        {batches.length === 0 ? <p className="empty">Todavía no importaste nada.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Lote</th><th>Archivo</th><th>Fecha</th><th>Nuevos</th><th>Ya existían</th><th>Rechazados</th><th></th></tr></thead>
            <tbody>{batches.map((b: any) => (
              <tr key={b.id}>
                <td><a href={`/contacts?batch=${b.id}`}>#{b.id}</a></td><td>{b.filename}</td><td className="small">{fmtDateTime(b.created_at)}</td>
                <td>{b.imported}</td><td>{b.updated}</td><td>{b.invalid}</td>
                <td><form action={deleteBatch}><input type="hidden" name="id" value={b.id} /><button className="btn small danger" title="Elimina solo los contactos de este lote que nunca recibieron mensajes">Quitar sin contactar</button></form></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
