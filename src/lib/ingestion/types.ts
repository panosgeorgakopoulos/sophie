import type { StructuredBlock } from '../chunking';
export interface ParsedDocument { title: string; language?: string; blocks: StructuredBlock[]; issues: string[] }
export type DocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'md';
export interface SourcePolicy {
  sections: string[];
  language: 'el' | 'fr' | 'mul';
  departmentId: string;
  audience: 'private' | 'public';
  authority: number;
  effectiveFrom: string | null;
  expiresAt: string | null;
}
export interface SourceInput {
  canonicalKey: string;
  sourceName: string;
  sourceType: string;
  policy: SourcePolicy;
  document: ParsedDocument;
  metadata?: Record<string, unknown>;
}
