import { z } from 'zod';

export const KNOWN_SECTIONS = ['all', 'mathimata', 'eksetaseis', 'spoudes', 'synergeies', 'vivliothiki'] as const;
export const OpaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid token');

// Strict parsing deliberately rejects caller-authored histories and session IDs.
export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  session_token: OpaqueTokenSchema.optional(),
  section: z.enum(KNOWN_SECTIONS).optional().default('all'),
}).strict();
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const FeedbackRequestSchema = z.object({
  log_id: z.string().uuid(),
  is_helpful: z.boolean(),
  session_token: OpaqueTokenSchema,
  feedback_token: OpaqueTokenSchema,
}).strict();
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
export const DeleteConversationSchema = z.object({ session_token: OpaqueTokenSchema }).strict();
