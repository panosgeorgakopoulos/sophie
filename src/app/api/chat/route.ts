import { NextResponse } from 'next/server';
import { embedText, getChatModel, withGeminiRetry } from '@/lib/gemini';
import { searchDocuments, buildContextBlock, toSources } from '@/lib/retrieval';
import { query } from '@/lib/db';
import { ChatRequestSchema } from '@/lib/validation';
import { checkRateLimit, getClientKey } from '@/lib/rateLimit';
import { checkCors } from '@/lib/cors';
import { toSafeErrorResponse } from '@/lib/apiError';
import { SYSTEM_PROMPT } from '@/config/systemPrompt';

// Deterministic, zero-LLM-call fallback used when no ingested content clears
// the similarity threshold (see src/lib/retrieval.ts). This guarantees zero
// hallucination on genuinely out-of-scope questions and saves a Gemini call,
// but a real LLM call would auto-detect language -- so we pick the reply
// variant with a lightweight heuristic instead of always answering in English.
type SupportedLanguage = 'fr' | 'en' | 'el';

function detectLanguage(text: string): SupportedLanguage {
  if (/[Ͱ-Ͽἀ-῿]/.test(text)) return 'el';
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text) || /\b(le|la|les|des|une|est|vous|bonjour|merci|combien|comment)\b/i.test(text)) {
    return 'fr';
  }
  return 'en';
}

const NO_CONTEXT_REPLIES: Record<SupportedLanguage, string> = {
  fr: "Je n'ai pas d'information vérifiée sur ce sujet précis. Pour une réponse fiable, contactez notre équipe.\n\nhttps://www.ifg.gr/fr/contact/\ncontact@ifg.gr\n+30 210 3398600",
  en: "I don't have verified information on this specific topic. For a reliable answer, please contact our team.\n\nhttps://www.ifg.gr/fr/contact/\ncontact@ifg.gr\n+30 210 3398600",
  el: 'Δεν διαθέτω επιβεβαιωμένες πληροφορίες για το συγκεκριμένο θέμα. Για μια αξιόπιστη απάντηση, επικοινωνήστε με την ομάδα μας.\n\nhttps://www.ifg.gr/fr/contact/\ncontact@ifg.gr\n+30 210 3398600',
};

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
  const rate = checkRateLimit(`chat:${clientKey}`, { limit: 10, windowMs: 60_000 });
  if (!rate.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { ...cors.headers, 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  let parsed;
  try {
    parsed = ChatRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: cors.headers });
  }

  const { message, conversation_history, session_id, section } = parsed;

  try {
    const queryEmbedding = await embedText(message);
    const { documents, hadSufficientContext } = await searchDocuments(queryEmbedding, { section });

    let replyText: string;
    if (!hadSufficientContext) {
      replyText = NO_CONTEXT_REPLIES[detectLanguage(message)];
    } else {
      const contextBlock = buildContextBlock(documents);
      const chatModel = getChatModel(SYSTEM_PROMPT);

      const history = conversation_history.map((msg) => ({
        role: msg.role === 'user' ? ('user' as const) : ('model' as const),
        parts: [{ text: msg.content }],
      }));
      while (history.length > 0 && history[0].role === 'model') {
        history.shift();
      }

      const chat = chatModel.startChat({ history });
      const prompt = `Context Information:\n---\n${contextBlock}\n---\n\nUser Message:\n${message}`;
      const response = await withGeminiRetry(() => chat.sendMessage(prompt));
      replyText = response.response.text();
    }

    let logId: string | null = null;
    try {
      const logRes = await query(
        'INSERT INTO chat_logs (session_id, user_message, assistant_reply, message_embedding, section) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [session_id, message, replyText, JSON.stringify(queryEmbedding), section],
      );
      logId = logRes.rows[0]?.id ?? null;
    } catch (err) {
      console.error('[chat] Failed to log interaction:', err);
    }

    if (!hadSufficientContext) {
      try {
        await query(
          'INSERT INTO flagged_conversations (conversation_history, flag_reason) VALUES ($1, $2)',
          [
            // conversation_history from the request is prior turns only --
            // the current question must be appended explicitly, otherwise
            // the flagged record never captures what was actually asked
            // (a pre-existing bug carried through the earlier rewrite until
            // caught via the admin dashboard's "Needs review" page).
            JSON.stringify([
              ...conversation_history,
              { role: 'user', content: message },
              { role: 'assistant', content: replyText },
            ]),
            'No relevant context found above similarity threshold',
          ],
        );
      } catch (err) {
        console.error('[chat] Failed to flag conversation:', err);
      }
    }

    return NextResponse.json(
      { reply: replyText, log_id: logId, sources: toSources(documents) },
      { headers: cors.headers },
    );
  } catch (error) {
    return toSafeErrorResponse(error, 'chat route', { headers: cors.headers });
  }
}
