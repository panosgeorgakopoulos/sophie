import { z } from 'zod';
import type { SourcePolicy } from './types';
const date = z.string().datetime({ offset: true }).nullable();
export const sourcePolicySchema = z.object({
  sections: z.array(z.enum(['mathimata', 'eksetaseis', 'spoudes', 'synergeies', 'vivliothiki'])).max(5),
  language: z.enum(['el', 'fr', 'mul']), departmentId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  audience: z.enum(['private', 'public']).default('private'), authority: z.number().int().min(0).max(100).default(0),
  effectiveFrom: date, expiresAt: date,
}).strict().refine((value) => value.audience === 'private' || value.sections.length > 0, 'Public sources need a category').refine((value) => !value.effectiveFrom || !value.expiresAt || Date.parse(value.effectiveFrom) < Date.parse(value.expiresAt), 'expiresAt must follow effectiveFrom');
export const manifestSchema = z.object({
  version: z.literal(1),
  files: z.record(z.string().min(1), sourcePolicySchema),
  requiredUrls: z.array(z.string().url()).default([]),
}).strict().refine((value) => Object.values(value.files).every((policy) => policy.sections.length > 0), 'Local files require an explicit category');
export type SourceManifest = z.infer<typeof manifestSchema>;
export type { SourcePolicy };
export function parseManifest(value: unknown): SourceManifest { return manifestSchema.parse(value); }
