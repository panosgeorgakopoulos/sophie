'use client';

import { useRouter } from 'next/navigation';

export default function ClientLogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    router.push('/admin/login');
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="text-xs font-medium text-gray-500 hover:text-red-600 transition"
    >
      Sign out
    </button>
  );
}
