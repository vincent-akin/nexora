'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/reviews', label: 'Reviews' },
  { href: '/admin/games', label: 'Games' },
  { href: '/admin/rules', label: 'Rules' },
  { href: '/admin/tasks', label: 'Tasks' },
  { href: '/admin/players', label: 'Players' },
  { href: '/admin/shop', label: 'Shop' },
  { href: '/admin/audit', label: 'Audit log' },
];

/** Sidebar links for the admin console, with the current page marked. */
export default function AdminNav({ badges }: { badges: Record<string, number> }) {
  const path = usePathname();
  return (
    <nav className="adm-nav" aria-label="Admin">
      {ITEMS.map((i) => {
        const on = i.exact ? path === i.href : path.startsWith(i.href);
        const n = badges[i.href] ?? 0;
        return (
          <Link key={i.href} href={i.href} aria-current={on ? 'page' : undefined} className={on ? 'on' : ''}>
            {i.label}{n > 0 ? <span className="adm-badge" aria-label={`${n} waiting`}>{n}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
