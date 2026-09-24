import { NextResponse } from 'next/server';

// Logs the full error server-side (where it's actually useful for debugging)
// and returns a generic message to the client -- never error.message, which
// can leak internals (DB schema hints, file paths, third-party error text).
export function toSafeErrorResponse(
  error: unknown,
  context: string,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  console.error(`[${context}]`, error);
  return NextResponse.json(
    { error: 'Something went wrong. Please try again in a moment.' },
    { status: init.status ?? 500, headers: init.headers },
  );
}
