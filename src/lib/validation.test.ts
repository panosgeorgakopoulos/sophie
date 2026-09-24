import { describe, it, expect } from 'vitest';
import { ChatRequestSchema, FeedbackRequestSchema } from './validation';

describe('ChatRequestSchema', () => {
  it('accepts a minimal valid request and applies defaults', () => {
    const result = ChatRequestSchema.parse({ message: 'Hello' });
    expect(result.message).toBe('Hello');
    expect(result.conversation_history).toEqual([]);
    expect(result.session_id).toBe('anonymous');
    expect(result.section).toBe('all');
  });

  it('rejects an empty message', () => {
    expect(() => ChatRequestSchema.parse({ message: '' })).toThrow();
    expect(() => ChatRequestSchema.parse({ message: '   ' })).toThrow();
  });

  it('rejects a message over the length cap', () => {
    expect(() => ChatRequestSchema.parse({ message: 'a'.repeat(2001) })).toThrow();
  });

  it('rejects an unknown section', () => {
    expect(() => ChatRequestSchema.parse({ message: 'hi', section: 'not-a-real-section' })).toThrow();
  });

  it('accepts a known section', () => {
    const result = ChatRequestSchema.parse({ message: 'hi', section: 'mathimata' });
    expect(result.section).toBe('mathimata');
  });

  it('rejects conversation_history longer than 20 messages', () => {
    const history = Array.from({ length: 21 }, () => ({ role: 'user' as const, content: 'x' }));
    expect(() => ChatRequestSchema.parse({ message: 'hi', conversation_history: history })).toThrow();
  });

  it('rejects a conversation_history entry with an invalid role', () => {
    expect(() =>
      ChatRequestSchema.parse({
        message: 'hi',
        conversation_history: [{ role: 'system', content: 'x' }],
      }),
    ).toThrow();
  });
});

describe('FeedbackRequestSchema', () => {
  it('accepts a valid feedback payload', () => {
    const result = FeedbackRequestSchema.parse({
      log_id: '3799bfee-c37e-4241-aeda-6734a949845f',
      is_helpful: true,
      session_id: 'abc',
    });
    expect(result.is_helpful).toBe(true);
  });

  it('rejects a non-UUID log_id', () => {
    expect(() =>
      FeedbackRequestSchema.parse({ log_id: 'not-a-uuid', is_helpful: true, session_id: 'abc' }),
    ).toThrow();
  });

  it('requires session_id (the IDOR fix depends on this being present)', () => {
    expect(() =>
      FeedbackRequestSchema.parse({ log_id: '3799bfee-c37e-4241-aeda-6734a949845f', is_helpful: true }),
    ).toThrow();
  });

  it('rejects a non-boolean is_helpful', () => {
    expect(() =>
      FeedbackRequestSchema.parse({
        log_id: '3799bfee-c37e-4241-aeda-6734a949845f',
        is_helpful: 'yes',
        session_id: 'abc',
      }),
    ).toThrow();
  });
});
