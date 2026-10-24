import { NextResponse } from 'next/server';
import { HttpError } from './httpError';

export function toSafeErrorResponse(
  error: unknown,
  context: string,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  // Provider/DB exceptions may contain prompts, credentials, or document text.
  // Log only a static event label and classification, never the exception object.
  const status = error instanceof HttpError ? error.status : (init.status ?? 500);
  if (status >= 500) console.error(JSON.stringify({ event: 'request_failed', context, status }));
  return NextResponse.json(
    { error: error instanceof HttpError ? error.message : 'Something went wrong. Please try again in a moment.' },
    { status, headers: { 'Cache-Control': 'no-store', ...init.headers } },
  );
}
