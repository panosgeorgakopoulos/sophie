import { queryPublic } from '@/lib/db';
import { numberEnv } from './env';
import { EMBEDDING_PROFILE } from './gemini';

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
  queryText?: string;
  departmentId?: string;
  language?: string;
  /** Authorization is server-owned; this API only exposes approved public evidence. */
  audience?: 'public';
  candidateLimit?: number;
  finalLimit?: number;
  minSimilarity?: number;
}
export interface SearchResult { documents: DocumentMatch[]; hadSufficientContext: boolean }

function boundedLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Invalid retrieval limit');
  return value;
}

/**
 * Exact filtered dense + lexical search fused with reciprocal ranks. Materializing
 * the authorized subset deliberately avoids filtered ANN underfill. Switch to ANN
 * only after measuring department/language recall on a representative corpus.
 * Candidate evidence is never permission to emit an unverified institutional fact.
 */
export async function searchDocuments(embedding: number[], options: SearchOptions = {}): Promise<SearchResult> {
  if (embedding.length !== 3072 || embedding.some(v => !Number.isFinite(v))) throw new Error('Invalid query embedding');
  if (options.audience && options.audience !== 'public') throw new Error('Invalid retrieval audience');
  const minimum = options.minSimilarity ?? numberEnv('RAG_MIN_SIMILARITY', 0.55, 0.1, 1);
  if (!Number.isFinite(minimum) || minimum < 0.1 || minimum > 1) throw new Error('Invalid similarity threshold');
  const candidates = boundedLimit(options.candidateLimit ?? 30, 100);
  const finalLimit = boundedLimit(options.finalLimit ?? 6, 20);
  const sql = `WITH eligible AS MATERIALIZED (
    SELECT id,content,source_type,source_name,metadata,embedding,source_id,authority
    FROM public_knowledge_documents
    WHERE embedding_model = $2
      AND ($4::text IS NULL OR $4 = ANY(sections))
      AND ($5::text IS NULL OR department_id = $5)
  ), dense_candidates AS (
    SELECT id, 1-(embedding::halfvec(3072) <=> $1::halfvec(3072)) AS similarity
    FROM eligible ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072) LIMIT $6
  ), dense AS (
    SELECT *, row_number() OVER (ORDER BY similarity DESC,id) AS rank FROM dense_candidates
  ), lexical_candidates AS (
    SELECT id,ts_rank_cd(to_tsvector('simple',content),websearch_to_tsquery('simple',$3)) AS score
    FROM eligible WHERE $3 <> '' AND to_tsvector('simple',content) @@ websearch_to_tsquery('simple',$3)
    ORDER BY score DESC,id LIMIT $6
  ), lexical AS (
    SELECT *,row_number() OVER (ORDER BY score DESC,id) AS rank FROM lexical_candidates
  ) SELECT e.id,e.content,e.source_type,e.source_name,e.metadata,
      COALESCE(d.similarity,1-(e.embedding::halfvec(3072) <=> $1::halfvec(3072))) AS similarity,
      COALESCE(1.0/(60+d.rank),0)+COALESCE(1.0/(60+l.rank),0) AS fusion_score
    FROM eligible e LEFT JOIN dense d ON d.id=e.id LEFT JOIN lexical l ON l.id=e.id
    WHERE (d.similarity >= $7 OR l.id IS NOT NULL)
    ORDER BY fusion_score DESC,e.authority DESC,e.id LIMIT $6`;
  const {rows} = await queryPublic(sql,[JSON.stringify(embedding),EMBEDDING_PROFILE,
    (options.queryText ?? '').normalize('NFKC').slice(0,4000),
    options.section && options.section !== 'all' ? options.section : null,
    options.departmentId ?? null,candidates,minimum]);
  const documents: DocumentMatch[] = [];
  const perSource = new Map<string,number>();
  const contents = new Set<string>();
  for (const row of rows) {
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata ?? {};
    const source = String(metadata.source_id ?? row.source_name);
    const content = String(row.content);
    const normalized = content.normalize('NFKC').replace(/\s+/g,' ').trim();
    if (contents.has(normalized) || (perSource.get(source) ?? 0) >= 2) continue;
    contents.add(normalized); perSource.set(source,(perSource.get(source) ?? 0)+1);
    documents.push({id:String(row.id),content,sourceType:String(row.source_type),sourceName:String(row.source_name),
      metadata,similarity:Number(row.similarity)});
    if (documents.length >= finalLimit) break;
  }
  return {documents,hadSufficientContext:documents.length>0};
}

export function buildContextBlock(documents: DocumentMatch[]): string {
  // JSON serialization prevents source names from forging ad-hoc source delimiters.
  return JSON.stringify(documents.map(d=>({id:d.id,source:d.sourceName,metadata:d.metadata,text:d.content})));
}

export function toSources(documents: DocumentMatch[]): {source_name:string;source_type:string;url?:string}[] {
  const seen = new Set<string>();
  return documents.filter(d=>{if(seen.has(d.sourceName))return false;seen.add(d.sourceName);return true;})
    .map(d=>({source_name:d.sourceName,source_type:d.sourceType,...(/^https:\/\/(?:www\.)?ifg\.gr\//i.test(d.sourceName)?{url:d.sourceName}:{})}));
}
