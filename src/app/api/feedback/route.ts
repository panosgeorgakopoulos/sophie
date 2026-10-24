import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { FeedbackRequestSchema } from '@/lib/validation';
import { checkRateLimit, getClientKey } from '@/lib/rateLimit';
import { checkCors } from '@/lib/cors';
import { readJsonBody } from '@/lib/requestBody';
import { toSafeErrorResponse } from '@/lib/apiError';
import { hashToken } from '@/lib/conversation';

export async function OPTIONS(req: Request) {
  const cors = checkCors(req.headers.get('origin'));
  if (!cors.allowed) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: cors.headers });
}
export async function POST(req: Request) {
  const cors = checkCors(req.headers.get('origin'));
  if (!cors.allowed) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  const headers = { ...cors.headers, 'Cache-Control': 'no-store' };
  try {
    const rate = await checkRateLimit(`feedback:${getClientKey(req)}`, { limit: 20, windowMs: 60_000 });
    if (!rate.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers });
    const parsed = FeedbackRequestSchema.safeParse(await readJsonBody(req, { maxBytes: 2048 }));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers });
    const data = parsed.data;
    const result = await query(`UPDATE chat_logs AS log SET is_helpful = $1, feedback_token_hash = NULL
      FROM chat_sessions AS session
      WHERE log.id = $2 AND log.session_id = session.id::text
        AND log.feedback_token_hash = $3 AND session.token_hash = $4
        AND session.expires_at > now() AND log.expires_at > now() AND log.is_helpful IS NULL`, [
      data.is_helpful, data.log_id, hashToken(data.feedback_token), hashToken(data.session_token),
    ]);
    if (!result.rowCount) return NextResponse.json({ error: 'Feedback authorization expired or already used' }, { status: 404, headers });
    return NextResponse.json({ success: true }, { headers });
  } catch (error) { return toSafeErrorResponse(error, 'feedback route', { headers }); }
}
