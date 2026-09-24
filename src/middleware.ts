import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Only used so the root layout can tell whether it's rendering the internal
// /admin dashboard (which must never load the public chat widget script) --
// Server Components can't read the current pathname directly.
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
