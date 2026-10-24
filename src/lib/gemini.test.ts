import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ embed: vi.fn(), generate: vi.fn() }));
const rate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { embedContent: sdk.embed, generateContent: sdk.generate }; } }));
vi.mock('./rateLimit', () => ({checkRateLimit:rate}));
import { embedText, prepareEmbeddingText, generateFactSelection, withGeminiRetry, EMBEDDING_PROFILE } from './gemini';
beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-no-network');
  for(const key of ['GEMINI_PROCESSING_APPROVED','GEMINI_APPROVED_FOR_PUBLIC_USE','GEMINI_PAID_SERVICE_CONFIRMED']) vi.stubEnv(key,'true');
  sdk.embed.mockReset(); sdk.generate.mockReset();rate.mockReset().mockResolvedValue({success:true});
});
afterEach(() => {vi.useRealTimers();vi.unstubAllEnvs();});
describe('bounded Gemini adapter', () => {
  it('uses versioned asymmetric Embedding2 prefixes without unsupported taskType', async () => {
    sdk.embed.mockResolvedValue({ embeddings: [{ values: Array(3072).fill(0.1) }] });
    expect(EMBEDDING_PROFILE).toContain('retrieval-v1');
    expect(prepareEmbeddingText('question', 'query')).toBe('task: search result | query: question');
    await embedText('body', { purpose: 'document', title: 'Library' });
    expect(sdk.embed.mock.calls[0][0]).toMatchObject({ contents: 'title: Library | text: body', config: { outputDimensionality: 3072 } });
    expect(sdk.embed.mock.calls[0][0].config).not.toHaveProperty('taskType');
  });
  it('rejects malformed vectors and empty/oversize inputs', async () => {
    sdk.embed.mockResolvedValue({ embeddings: [{ values: [0.1] }] });
    await expect(embedText('x')).rejects.toThrow('Invalid embedding');
    await expect(embedText('')).rejects.toThrow('input length');
    await expect(embedText('x'.repeat(24_001))).rejects.toThrow('input length');
  });
  it('puts selection rules in systemInstruction with deterministic bounded JSON output', async () => {
    sdk.generate.mockResolvedValue({ text: '{"fact_ids":[]}' });
    await generateFactSelection('Rules', { facts: [] });
    expect(sdk.generate.mock.calls[0][0].config).toMatchObject({ systemInstruction: 'Rules', temperature: 0, maxOutputTokens: 512, responseMimeType: 'application/json' });
  });
  it('aborts a stalled call at the total deadline', async () => {
    vi.useFakeTimers();
    const result = withGeminiRetry(() => new Promise(() => {}), { budgetMs: 50 });
    const expectation = expect(result).rejects.toThrow('deadline');
    await vi.advanceTimersByTimeAsync(51); await expectation;
  });
  it('does not retry invalid credentials or unclassified permanent failures', async () => {
    const operation = vi.fn().mockRejectedValue({ status: 401 });
    await expect(withGeminiRetry(operation)).rejects.toMatchObject({ status: 401 });
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('never contacts a provider without explicit processing/public approval',async()=>{
    vi.stubEnv('GEMINI_PROCESSING_APPROVED','false');vi.stubEnv('GEMINI_APPROVED_FOR_PUBLIC_USE','false');
    await expect(embedText('Private document')).rejects.toThrow('disabled');
    await expect(generateFactSelection('Rules',{})).rejects.toThrow('disabled');
    expect(sdk.embed).not.toHaveBeenCalled();expect(sdk.generate).not.toHaveBeenCalled();
  });
  it('shared provider quota exhaustion blocks the external call',async()=>{
    rate.mockResolvedValue({success:false});
    await expect(embedText('document')).rejects.toThrow('budget');expect(sdk.embed).not.toHaveBeenCalled();
  });
  it('requires paid-service confirmation for both embeddings and public selection', async () => {
    vi.stubEnv('GEMINI_PAID_SERVICE_CONFIRMED', 'false');
    await expect(embedText('Private document')).rejects.toThrow('disabled');
    await expect(generateFactSelection('Rules', {})).rejects.toThrow('disabled');
    expect(sdk.embed).not.toHaveBeenCalled();
    expect(sdk.generate).not.toHaveBeenCalled();
    expect(rate).not.toHaveBeenCalled();
  });
});
