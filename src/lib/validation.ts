import { z } from 'zod';

const KNOWN_SECTIONS = ['all', 'mathimata', 'eksetaseis', 'spoudes', 'synergeies', 'vivliothiki'] as const;

export const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
});

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1, 'message is required').max(2000, 'message is too long'),
  conversation_history: z.array(ConversationMessageSchema).max(20).optional().default([]),
  session_id: z.string().min(1).max(200).optional().default('anonymous'),
  section: z.enum(KNOWN_SECTIONS).optional().default('all'),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const FeedbackRequestSchema = z.object({
  log_id: z.string().uuid('log_id must be a valid UUID'),
  is_helpful: z.boolean(),
  session_id: z.string().min(1).max(200),
});

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
