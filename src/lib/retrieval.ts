import { query } from '@/lib/db';

export interface DocumentMatch {
  id: string;
  content: string;
  sourceType: string;
  sourceName: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

export interface SearchOptions {
  section?: string;
  /** How many candidates to fetch from the DB before thresholding. */
  candidateLimit?: number;
  /** How many matches to actually keep/use as context after thresholding. */
  finalLimit?: number;
  /** Minimum cosine similarity for a chunk to be considered relevant. */
  minSimilarity?: number;
}

export interface SearchResult {
  documents: DocumentMatch[];
  hadSufficientContext: boolean;
}

// Empirically calibrated against the live corpus (documents.embedding,
// gemini-embedding-2, cosine distance): real in-scope questions ("how much
// do adult courses cost", "what documents do I need for the DELF exam")
// scored 0.64-0.70 top-5 similarity, while clearly out-of-scope questions
// ("capital of Australia", "chocolate cake recipe") topped out at 0.46-0.50.
// 0.55 sits in the gap with margin on both sides. Tunable via RAG_MIN_SIMILARITY
// if the corpus grows and the distribution shifts.
const DEFAULT_MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY ?? 0.55);
const DEFAULT_CANDIDATE_LIMIT = 20;
const DEFAULT_FINAL_LIMIT = 6;

// documents.embedding is vector(3072), which exceeds pgvector's 2000-dim cap
// for HNSW indexes on the native `vector` type. The migration indexes a
// halfvec(3072) expression instead, so queries must cast identically
// (embedding::halfvec(3072) <=> $1::halfvec(3072)) for the planner to use it.
export async function searchDocuments(
  queryEmbedding: number[],
  options: SearchOptions = {},
): Promise<SearchResult> {
  const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const finalLimit = options.finalLimit ?? DEFAULT_FINAL_LIMIT;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const embeddingParam = JSON.stringify(queryEmbedding);
  const section = options.section && options.section !== 'all' ? options.section : undefined;

  const sql = section
    ? `SELECT id, content, source_type, source_name, metadata,
              1 - (embedding::halfvec(3072) <=> $1::halfvec(3072)) AS similarity
       FROM documents
       WHERE metadata->>'section' = $2
       ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072)
       LIMIT $3`
    : `SELECT id, content, source_type, source_name, metadata,
              1 - (embedding::halfvec(3072) <=> $1::halfvec(3072)) AS similarity
       FROM documents
       ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072)
       LIMIT $2`;

  const params = section ? [embeddingParam, section, candidateLimit] : [embeddingParam, candidateLimit];
  const { rows } = await query(sql, params);

  const documents: DocumentMatch[] = rows
    .map((row: Record<string, unknown>): DocumentMatch => ({
      id: row.id as string,
      content: row.content as string,
      sourceType: row.source_type as string,
      sourceName: row.source_name as string,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>) ?? {},
      similarity: Number(row.similarity),
    }))
    .filter((doc) => doc.similarity >= minSimilarity)
    .slice(0, finalLimit);

  return { documents, hadSufficientContext: documents.length > 0 };
}

export interface PastExampleMatch {
  userMessage: string;
  assistantReply: string;
  similarity: number;
}

export function buildContextBlock(documents: DocumentMatch[]): string {
  if (documents.length === 0) {
    return 'No relevant context found.';
  }
  return documents
    .map((doc, index) => {
      const heading = typeof doc.metadata.section_heading === 'string' ? ` - ${doc.metadata.section_heading}` : '';
      return `[Source ${index + 1}: ${doc.sourceName} (${doc.sourceType})${heading}]\n${doc.content}\n`;
    })
    .join('\n');
}

export function toSources(documents: DocumentMatch[]): { source_name: string; source_type: string; url?: string }[] {
  const seen = new Set<string>();
  const sources: { source_name: string; source_type: string; url?: string }[] = [];
  for (const doc of documents) {
    if (seen.has(doc.sourceName)) continue;
    seen.add(doc.sourceName);
    const isUrl = doc.sourceType === 'website' && /^https?:\/\//.test(doc.sourceName);
    sources.push({
      source_name: doc.sourceName,
      source_type: doc.sourceType,
      ...(isUrl ? { url: doc.sourceName } : {}),
    });
  }
  return sources;
}
