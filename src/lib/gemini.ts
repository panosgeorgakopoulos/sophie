import { GoogleGenAI } from '@google/genai';
import { checkRateLimit } from './rateLimit';
import { integerEnv } from './env';

export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const EMBEDDING_PROFILE = `${EMBEDDING_MODEL}:retrieval-v1:3072`;
export const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite';
let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 12_000, retryOptions: { attempts: 1 } } });
  return client;
}

function boundedSetting(name: string, fallback: number, maximum: number): number {
  return integerEnv(name,fallback,1,maximum);
}
async function acquireProviderBudget(publicRequest: boolean): Promise<void> {
  const budgets = [
    { key: 'provider:global:minute', limit: boundedSetting('GEMINI_REQUESTS_PER_MINUTE', 60, 1000), windowMs: 60_000 },
    { key: 'provider:global:day', limit: boundedSetting('GEMINI_REQUESTS_PER_DAY', 2000, 100000), windowMs: 86_400_000 },
    ...(publicRequest ? [
      { key: 'provider:public:minute', limit: boundedSetting('GEMINI_PUBLIC_REQUESTS_PER_MINUTE', 20, 1000), windowMs: 60_000 },
      { key: 'provider:public:day', limit: boundedSetting('GEMINI_PUBLIC_REQUESTS_PER_DAY', 500, 100000), windowMs: 86_400_000 },
    ] : []),
  ];
  for (const { key, ...options } of budgets) {
    if (!(await checkRateLimit(key, options)).success) throw new GeminiUnavailableError('Provider budget exhausted');
  }
}

let inFlight = 0;
let failures = 0;
let openUntil = 0;
export class GeminiUnavailableError extends Error {}
interface RetryOptions { retries?: number; baseDelayMs?: number; budgetMs?: number; signal?: AbortSignal }
function transient(error: unknown): boolean {
  const status = Number((error as { status?: number })?.status);
  return [408, 429, 500, 502, 503, 504].includes(status);
}

/** A total budget covers attempts and jitter; SDK retries are disabled. */
export async function withGeminiRetry<T>(fn: (signal: AbortSignal) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  if (Date.now() < openUntil || inFlight >= 4) throw new GeminiUnavailableError('Provider temporarily unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.budgetMs ?? 12_000);
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  inFlight++;
  try {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try {
        const result = await new Promise<T>((resolve, reject) => {
          const onAbort = () => reject(new GeminiUnavailableError('Provider deadline exceeded'));
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) { signal.removeEventListener('abort', onAbort); onAbort(); return; }
          fn(signal).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
        });
        failures = 0;
        return result;
      } catch (error) {
        if (!transient(error)) throw error;
        if (attempt >= (options.retries ?? 1)) {
          if (++failures >= 3) openUntil = Date.now() + 30_000;
          throw error;
        }
        const delay = (options.baseDelayMs ?? 250) * 2 ** attempt * (0.5 + Math.random());
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { clearTimeout(waitTimer); reject(new GeminiUnavailableError('Provider deadline exceeded')); };
          const waitTimer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, delay);
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
      }
    }
  } finally {
    clearTimeout(timer);
    inFlight--;
  }
}

export function prepareEmbeddingText(text: string, purpose: 'document' | 'query', title = 'none'): string {
  // Embedding 2 does not support taskType. Use its documented asymmetric
  // retrieval prefixes; the profile is versioned to prevent mixed indexes.
  return purpose === 'document' ? `title: ${title} | text: ${text}` : `task: search result | query: ${text}`;
}

export async function embedText(text: string, options: { purpose?: 'document' | 'query'; title?: string; signal?: AbortSignal } = {}): Promise<number[]> {
  if (process.env.GEMINI_PROCESSING_APPROVED !== 'true' || process.env.GEMINI_PAID_SERVICE_CONFIRMED !== 'true') throw new GeminiUnavailableError('Provider processing is disabled');
  if (!text.trim() || text.length > 24_000) throw new Error('Embedding input length is invalid');
  const result = await withGeminiRetry(async signal => {
    await acquireProviderBudget(false);
    signal.throwIfAborted();
    return getClient().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: prepareEmbeddingText(text, options.purpose ?? 'query', options.title),
    config: { outputDimensionality: 3072, abortSignal: signal },
    });
  }, { signal: options.signal });
  const values = result.embeddings?.[0]?.values;
  if (!values || values.length !== 3072 || values.some(value => !Number.isFinite(value))) throw new Error('Invalid embedding response');
  return values;
}

export async function generateFactSelection(systemInstruction: string, payload: unknown, signal?: AbortSignal): Promise<string> {
  if (process.env.GEMINI_APPROVED_FOR_PUBLIC_USE !== 'true' || process.env.GEMINI_PAID_SERVICE_CONFIRMED !== 'true') throw new GeminiUnavailableError('Public AI selection is disabled');
  const serialized = JSON.stringify(payload);
  if (serialized.length > 24_000) throw new Error('Fact selection context is too large');
  const response = await withGeminiRetry(async abortSignal => {
    await acquireProviderBudget(true);
    abortSignal.throwIfAborted();
    return getClient().models.generateContent({
    model: CHAT_MODEL,
    contents: [{ role: 'user', parts: [{ text: serialized }] }],
    config: {
      systemInstruction, temperature: 0, maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object', properties: { fact_ids: { type: 'array', items: { type: 'string' }, maxItems: 3 } }, required: ['fact_ids'], additionalProperties: false },
      abortSignal,
    },
    });
  }, { signal });
  return response.text ?? '';
}
