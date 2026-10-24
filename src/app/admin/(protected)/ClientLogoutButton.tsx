'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ClientLogoutButton() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function handleLogout() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Revocation failed');
      router.push('/admin/login');
      router.refresh();
    } catch {
      setError('Sign out failed. Please retry; your session is still active.');
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button onClick={handleLogout} disabled={pending} className="text-xs font-medium text-gray-500 hover:text-red-600 transition">
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </>
  );
}
