'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/conversations', label: 'Conversations' },
  { href: '/admin/flagged', label: 'Needs review' },
  { href: '/admin/documents', label: 'Knowledge base' },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-4 space-y-1">
      {LINKS.map((link) => {
        const isActive = link.href === '/admin' ? pathname === '/admin' : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
