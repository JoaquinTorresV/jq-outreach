import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

const COOKIE = 'jq_session';
const TTL_S = 60 * 60 * 24 * 7;

const secret = () => process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD || '';
const sign = (exp: number) => `${exp}.${createHmac('sha256', secret()).update(String(exp)).digest('hex')}`;

function safeEqual(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const authConfigured = () => !!process.env.DASHBOARD_PASSWORD;

export async function isAuthed(): Promise<boolean> {
  if (!authConfigured()) return false; // sin contraseña configurada, nadie entra (fail closed)
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return false;
  const [exp] = v.split('.');
  if (!exp || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(v, sign(Number(exp)));
}

/** Úsalo al inicio de cada página y de cada server action: las acciones son endpoints públicos. */
export async function requireAuth() {
  if (!(await isAuthed())) redirect('/login');
}

export async function createSession(password: string): Promise<boolean> {
  if (!authConfigured() || !safeEqual(password, process.env.DASHBOARD_PASSWORD!)) return false;
  const proto = (await headers()).get('x-forwarded-proto');
  (await cookies()).set(COOKIE, sign(Math.floor(Date.now() / 1000) + TTL_S), {
    httpOnly: true, sameSite: 'lax', secure: proto === 'https', path: '/', maxAge: TTL_S,
  });
  return true;
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}
