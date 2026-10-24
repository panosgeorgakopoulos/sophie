import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { query } from './db';

const StateSchema = z.object({
  subjectKey: z.string().max(200).optional(),
  subjectLabel: z.string().max(200).optional(),
  departmentId: z.string().max(200).optional(),
  qualifiers: z.record(z.string(), z.string().max(200)).optional(),
  section: z.string().max(30).optional(),
  language: z.enum(['fr', 'en', 'el']).optional(),
}).strict();
export type ConversationState = z.infer<typeof StateSchema>;
export interface Conversation { id: string; token: string; state: ConversationState }
export class InvalidConversationError extends Error {}
export function newOpaqueToken(): string { return randomBytes(32).toString('base64url'); }
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export async function getConversation(token?: string): Promise<Conversation> {
  if (token) {
    const { rows } = await query('SELECT id, state FROM chat_sessions WHERE token_hash = $1 AND expires_at > now()', [hashToken(token)]);
    if (rows.length !== 1) throw new InvalidConversationError('Conversation expired or unknown');
    const parsed = StateSchema.safeParse(rows[0].state);
    return { id: rows[0].id, token, state: parsed.success ? parsed.data : {} };
  }
  const newToken = newOpaqueToken();
  const { rows } = await query('INSERT INTO chat_sessions (token_hash) VALUES ($1) RETURNING id', [hashToken(newToken)]);
  return { id: rows[0].id, token: newToken, state: {} };
}

export async function updateConversation(id: string, state: ConversationState): Promise<void> {
  // The original expiry is never extended; context has a firm retention limit.
  const result = await query('UPDATE chat_sessions SET state = $1 WHERE id = $2 AND expires_at > now()', [JSON.stringify(StateSchema.parse(state)), id]);
  if(result.rowCount===0) throw new InvalidConversationError('Conversation expired or deleted');
}

export async function deleteConversation(token: string): Promise<boolean> {
  // One SQL statement deletes logs and bearer credentials without a partial-operation race.
  const result = await query(`WITH removed AS (
    DELETE FROM chat_sessions WHERE token_hash = $1 RETURNING id
  ), deleted_logs AS (
    DELETE FROM chat_logs WHERE session_id IN (SELECT id::text FROM removed)
  ) SELECT id FROM removed`, [hashToken(token)]);
  return result.rows.length > 0;
}
