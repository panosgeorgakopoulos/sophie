import type { ReactNode } from 'react';

export const metadata = { title: 'IFG Assistant — Outlook' };
export default function OutlookLayout({ children }: { children: ReactNode }) {
  return <div className="bg-slate-50 min-h-screen">{children}</div>;
}
