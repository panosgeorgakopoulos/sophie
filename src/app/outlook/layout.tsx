import React from 'react';
import Script from 'next/script';

export const metadata = {
  title: 'IFG Assistant - Outlook Add-in',
};

export default function OutlookLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Load Office.js before interactivity */}
        <Script 
          src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" 
          strategy="beforeInteractive" 
        />
      </head>
      <body className="bg-slate-50 antialiased h-screen overflow-hidden">
        {children}
      </body>
    </html>
  );
}
