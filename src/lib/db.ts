import pg from 'pg';

// bigint (int8) y count(*) llegan como número: los volúmenes de este sistema caben de sobra
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

const g = globalThis as unknown as { __jqPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!g.__jqPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Falta la variable DATABASE_URL');
    g.__jqPool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    g.__jqPool.on('error', (err) => console.error('[pg] error en conexión inactiva', err.message));
  }
  return g.__jqPool;
}

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool().query(sql, params)).rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

export async function exec(sql: string, params: unknown[] = []): Promise<number> {
  return (await pool().query(sql, params)).rowCount ?? 0;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function closePool() {
  if (g.__jqPool) {
    await g.__jqPool.end().catch(() => {});
    g.__jqPool = undefined;
  }
}
