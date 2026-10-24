import { NextResponse } from 'next/server';

/** Automatic replies are retired until signed ingress, a reviewed outbox, and approval exist. */
export async function POST() {
  return NextResponse.json(
    { error: 'Automatic email replies are disabled. No message has been drafted or sent.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
