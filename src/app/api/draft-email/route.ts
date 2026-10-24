import { NextResponse } from 'next/server';

/** Retired unsafe prototype. Deliberately performs no body read, retrieval, or provider call. */
export async function POST() {
  return NextResponse.json(
    { error: 'Email drafting is unavailable pending staff authentication, approved sources, and privacy review.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
