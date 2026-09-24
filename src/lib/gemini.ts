import { GoogleGenerativeAI } from '@google/generative-ai';

// Fail fast: a missing key must never silently fall back to a dummy client
// that would fail confusingly on the first real API call.
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('GEMINI_API_KEY environment variable is required.');
}

const genAI = new GoogleGenerativeAI(apiKey);

// Confirmed live/callable on this key's free tier via a direct models.list()
// call and a live embedContent() call (both output 3072-dim vectors).
export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const CHAT_MODEL = 'gemini-3.5-flash-lite';

let embeddingModel: ReturnType<typeof genAI.getGenerativeModel> | null = null;
function getEmbeddingModel() {
  if (!embeddingModel) {
    embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  }
  return embeddingModel;
}

export function getChatModel(systemInstruction: string) {
  return genAI.getGenerativeModel({ model: CHAT_MODEL, systemInstruction });
}

interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
}

function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number; response?: { status?: number } })?.status
    ?? (err as { response?: { status?: number } })?.response?.status;
  if (status === 429) return true;
  const message = String((err as { message?: string })?.message ?? '');
  return /rate.?limit|quota|429/i.test(message);
}

// Free-tier Gemini quota is real but opaque (exact RPM/TPM/RPD are only
// visible per-project in AI Studio, not published) and can be tightened by
// Google at any time. Back off and retry transient 429s instead of failing
// the whole request on the first hiccup.
export async function withGeminiRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err) || attempt === retries) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export async function embedText(text: string): Promise<number[]> {
  const model = getEmbeddingModel();
  const result = await withGeminiRetry(() => model.embedContent(text));
  return result.embedding.values;
}
