import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { FeedbackRequestSchema } from '@/lib/validation';
import { checkRateLimit, getClientKey } from '@/lib/rateLimit';
import { checkCors } from '@/lib/cors';
import { toSafeErrorResponse } from '@/lib/apiError';

export async function OPTIONS(req: Request) {
  const cors = checkCors(req.headers.get('origin'));
  if (!cors.allowed) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: cors.headers });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const cors = checkCors(origin);
  if (!cors.allowed) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  const clientKey = getClientKey(req);
  const rate = checkRateLimit(`feedback:${clientKey}`, { limit: 20, windowMs: 60_000 });
  if (!rate.success) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      { status: 429, headers: { ...cors.headers, 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  let parsed;
  try {
    parsed = FeedbackRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: cors.headers });
  }

  try {
    // Scoping the update to the session that created the log closes the
    // previous IDOR (any caller could flip is_helpful on any log_id). This
    // isn't cryptographic auth -- session_id is client-supplied and the app
    // has no login system -- but it stops the trivial "guess a UUID, rate it
    // helpful" attack, which mattered more when ratings fed live prompts.
    // They no longer do (see chat route); feedback is now an analytics-only
    // signal for manual review.
    const result = await query(
      'UPDATE chat_logs SET is_helpful = $1 WHERE id = $2 AND session_id = $3',
      [parsed.is_helpful, parsed.log_id, parsed.session_id],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Log not found for this session' }, { status: 404, headers: cors.headers });
    }

    return NextResponse.json({ success: true }, { headers: cors.headers });
  } catch (error) {
    return toSafeErrorResponse(error, 'feedback route', { headers: cors.headers });
  }
}
