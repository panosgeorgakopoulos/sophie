import { NextResponse } from 'next/server';

export async function GET() {
  if (process.env.NODE_ENV === 'production') return new NextResponse('Not found', { status: 404 });
  // Local fixture only. Never execute upstream IFG HTML/scripts on the staff application's origin.
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>IFG widget development preview</title></head><body><main><h1>IFG widget development preview</h1><p>This local fixture loads the public widget for development.</p></main><script src="/widget.js"></script></body></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
