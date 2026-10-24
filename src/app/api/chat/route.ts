import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import { ChatRequestSchema, DeleteConversationSchema } from '@/lib/validation';
import { checkRateLimit, getClientKey } from '@/lib/rateLimit';
import { checkCors } from '@/lib/cors';
import { readJsonBody } from '@/lib/requestBody';
import { toSafeErrorResponse } from '@/lib/apiError';
import { PROMPT_VERSION } from '@/config/systemPrompt';
import { CHAT_MODEL } from '@/lib/gemini';
import { resolveApprovedFacts } from '@/lib/facts';
import { answerFromApprovedFacts } from '@/lib/answer';
import { getConversation, updateConversation, deleteConversation, InvalidConversationError, newOpaqueToken, hashToken } from '@/lib/conversation';
import { detectLanguage } from '@/lib/language';

export async function OPTIONS(req: Request) {
  const cors = checkCors(req.headers.get('origin'));
  if (!cors.allowed) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: cors.headers });
}

export async function POST(req: Request) {
  const cors = checkCors(req.headers.get('origin'));
  if (!cors.allowed) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  const headers = { ...cors.headers, 'Cache-Control': 'no-store' };
  const requestId = randomUUID();
  const started = Date.now();
  try {
    const rate = await checkRateLimit(`chat:${getClientKey(req)}`, { limit: 10, windowMs: 60_000 });
    if (!rate.success) return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429, headers: { ...headers, 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) } });
    const validation = ChatRequestSchema.safeParse(await readJsonBody(req, { maxBytes: 12_000 }));
    if (!validation.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers });
    const { message, session_token, section } = validation.data;
    const conversation = await getConversation(session_token);
    const language = detectLanguage(message, conversation.state.language);
    const resolution = await resolveApprovedFacts(message, { section, language, previous: conversation.state });
    const budget = AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]);
    const answer = await answerFromApprovedFacts(message, resolution, language, budget);
    await updateConversation(conversation.id, { ...answer.state, section });

    // Persist useful operational evidence without raw questions, histories,
    // sensitive query embeddings or user-controlled log text.
    const feedbackToken = newOpaqueToken();
    const log = await query(`INSERT INTO chat_logs
      (session_id, conversation_id, user_message, assistant_reply, section, feedback_token_hash, outcome, evidence, model_metadata)
      SELECT $1::text, s.id, $2, $3, $4, $5, $6, $7, $8 FROM chat_sessions s
      WHERE s.id=$1::uuid AND s.expires_at>now() RETURNING id`, [
      conversation.id, '[question not retained]', answer.reply, section,
      hashToken(feedbackToken), answer.outcome,
      JSON.stringify(answer.sources.map(source => ({ fact_id: source.fact_id, source_id: source.source_id, version_id: source.version_id, evidence_chunk_id: source.evidence_chunk_id }))),
      JSON.stringify({ request_id: requestId, language, fields: resolution.fields, prompt_version: PROMPT_VERSION, model: resolution.fields.includes('policy') && resolution.status === 'ready' ? CHAT_MODEL : null, latency_ms: Date.now() - started }),
    ]);
    if(!log.rows[0]) throw new InvalidConversationError('Conversation expired or deleted');
    return NextResponse.json({
      reply: answer.reply, log_id: log.rows[0]?.id ?? null,
      feedback_token: log.rows[0]?.id ? feedbackToken : null,
      session_token: conversation.token, sources: answer.sources, outcome: answer.outcome,
    }, { headers });
  } catch (error) {
    if (error instanceof InvalidConversationError) return NextResponse.json({ error: 'Conversation expired. Start a new conversation.', code: 'SESSION_EXPIRED' }, { status: 401, headers });
    return toSafeErrorResponse(error, 'chat route', { headers });
  }
}

export async function DELETE(req: Request) {
  const cors = checkCors(req.headers.get('origin'));
  if (!cors.allowed) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  const headers = { ...cors.headers, 'Cache-Control': 'no-store' };
  try {
    const rate = await checkRateLimit(`chat-delete:${getClientKey(req)}`, { limit: 20, windowMs: 60_000 });
    if (!rate.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers });
    const parsed = DeleteConversationSchema.safeParse(await readJsonBody(req, { maxBytes: 1024 }));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers });
    await deleteConversation(parsed.data.session_token);
    return NextResponse.json({ success: true }, { headers });
  } catch (error) { return toSafeErrorResponse(error, 'delete conversation', { headers }); }
}
