import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { AuthenticationCreds, AuthenticationState, SignalDataSet, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { pool, q, exec } from '../src/lib/db';

/** Estado de autenticación de Baileys guardado en Postgres (reemplaza useMultiFileAuthState). */
export async function usePgAuthState(accountId: number) {
  const row = (await q<{ data: string }>('select data from wa_auth_creds where account_id = $1', [accountId]))[0];
  const creds: AuthenticationCreds = row ? JSON.parse(row.data, BufferJSON.reviver) : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const out: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        if (!ids.length) return out;
        const rows = await q<{ key_id: string; data: string }>(
          'select key_id, data from wa_auth_keys where account_id = $1 and type = $2 and key_id = any($3)',
          [accountId, type, ids],
        );
        for (const r of rows) {
          let v = JSON.parse(r.data, BufferJSON.reviver);
          if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
          out[r.key_id] = v;
        }
        return out;
      },
      set: async (data: SignalDataSet) => {
        const client = await pool().connect();
        try {
          await client.query('begin');
          for (const type of Object.keys(data) as (keyof SignalDataSet)[]) {
            const entries = Object.entries(data[type] ?? {});
            const del = entries.filter(([, v]) => v == null).map(([id]) => id);
            const ups = entries.filter(([, v]) => v != null);
            if (del.length) {
              await client.query('delete from wa_auth_keys where account_id = $1 and type = $2 and key_id = any($3)', [accountId, type, del]);
            }
            if (ups.length) {
              await client.query(
                `insert into wa_auth_keys (account_id, type, key_id, data)
                 select $1, $2, k, d from unnest($3::text[], $4::text[]) as t(k, d)
                 on conflict (account_id, type, key_id) do update set data = excluded.data`,
                [accountId, type, ups.map(([id]) => id), ups.map(([, v]) => JSON.stringify(v, BufferJSON.replacer))],
              );
            }
          }
          await client.query('commit');
        } catch (e) {
          await client.query('rollback').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
    },
  };

  const saveCreds = async () => {
    await exec(
      `insert into wa_auth_creds (account_id, data, updated_at) values ($1, $2, now())
       on conflict (account_id) do update set data = excluded.data, updated_at = now()`,
      [accountId, JSON.stringify(state.creds, BufferJSON.replacer)],
    );
  };

  return { state, saveCreds, registered: !!creds.registered };
}

export async function clearAuthState(accountId: number) {
  await exec('delete from wa_auth_keys where account_id = $1', [accountId]);
  await exec('delete from wa_auth_creds where account_id = $1', [accountId]);
}
