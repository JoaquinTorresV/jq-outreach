import { redirect } from 'next/navigation';
import { authConfigured, createSession, isAuthed } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function login(formData: FormData) {
  'use server';
  const ok = await createSession(String(formData.get('password') ?? ''));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 900)); // frena intentos por fuerza bruta
    redirect('/login?error=1');
  }
  redirect('/');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAuthed()) redirect('/');
  const { error } = await searchParams;
  return (
    <main className="login">
      <form action={login} className="card login-card">
        <h1>jq-outreach</h1>
        <p className="sub">Prospección por WhatsApp</p>
        {!authConfigured() ? (
          <p className="alert bad">Falta definir la variable de entorno <code>DASHBOARD_PASSWORD</code> en el servidor.</p>
        ) : null}
        <label>
          Contraseña
          <input type="password" name="password" autoFocus autoComplete="current-password" required />
        </label>
        {error ? <p className="alert bad">Contraseña incorrecta.</p> : null}
        <button className="btn primary" type="submit">Entrar</button>
      </form>
    </main>
  );
}
