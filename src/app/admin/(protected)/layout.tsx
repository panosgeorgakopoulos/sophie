import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminSession';
import AdminNav from './AdminNav';
import ClientLogoutButton from './ClientLogoutButton';

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) {
    redirect('/admin/login');
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-200">
          <p className="font-semibold text-gray-900">Sophie</p>
          <p className="text-xs text-gray-500">Staff Dashboard</p>
        </div>
        <AdminNav />
        <div className="mt-auto px-5 py-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 truncate" title={session.email}>
            {session.name}
          </p>
          <p className="text-[11px] text-gray-400 mb-2">{session.role}</p>
          <ClientLogoutButton />
        </div>
      </aside>
      <main className="flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
