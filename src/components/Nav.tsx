'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Resumen' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/contacts', label: 'Contactos' },
  { href: '/import', label: 'Importar' },
  { href: '/manual', label: 'Cola manual' },
  { href: '/templates', label: 'Plantillas' },
  { href: '/errors', label: 'Errores' },
  { href: '/accounts', label: 'Números' },
  { href: '/settings', label: 'Ajustes' },
];

export default function Nav({ errors }: { errors: number }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Principal">
      {ITEMS.map((i) => {
        const active = i.href === '/' ? path === '/' : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={active ? 'active' : ''}>
            {i.label}
            {i.href === '/errors' && errors > 0 ? <span className="count">{errors}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
