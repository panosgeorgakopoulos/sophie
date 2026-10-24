import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { chunkStructuredDocument } from '../chunking';
import { PARSER_VERSION } from './parsers';
import { sourcePolicySchema } from './manifest';
import type { SourceInput } from './types';

export interface PublisherDependencies {
  pool: Pick<Pool, 'query' | 'connect'>;
  embed: (text: string, options: { purpose: 'document'; title: string }) => Promise<number[]>;
  embeddingProfile: string;
  concurrency?: number;
  /** Optional queue fencing, executed under the same transaction as publication. */
  assertPublicationAllowed?: (client: PoolClient) => Promise<void>;
  onPublished?: (client: PoolClient, result: PublishResult) => Promise<void>;
}
export interface PublishResult { sourceId: string; versionId: string; changed: boolean; chunks: number; reusedEmbeddings: number }
export function contentHash(input: SourceInput): string {
  return createHash('sha256').update(JSON.stringify({ title: input.document.title, blocks: input.document.blocks,
    effectiveFrom: input.policy.effectiveFrom, expiresAt: input.policy.expiresAt })).digest('hex');
}
export async function publishSource(input: SourceInput, runId: string, deps: PublisherDependencies): Promise<PublishResult> {
  sourcePolicySchema.parse(input.policy);
  if (input.document.issues.length) throw new Error(`Source quarantined: ${input.document.issues.join('; ')}`);
  const chunks = chunkStructuredDocument(input.document.title, input.document.blocks);
  if (!chunks.length || chunks.length > 2000) throw new Error('Source chunk count exceeds safe bounds');
  const hash = contentHash(input);
  const preflight = await deps.pool.query<{id: string}>(
    `SELECT v.id FROM knowledge_versions v JOIN knowledge_sources s ON s.id=v.source_id
     WHERE s.canonical_key=$1 AND v.content_hash=$2 AND v.parser_version=$3 AND v.embedding_model=$4`,
    [input.canonicalKey, hash, PARSER_VERSION, deps.embeddingProfile],
  );
  const embeddings: number[][] = [];
  let reusedEmbeddings = 0;
  if (!preflight.rows.length) {
    // Provider work and embedding-cache reads happen before acquiring any client/transaction.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 2, chunks.length) }, async () => {
      while (next < chunks.length) {
        const index = next++;
        const chunk = chunks[index];
        const cache = await deps.pool.query<{embedding: string}>(
          `SELECT d.embedding::text AS embedding FROM documents d JOIN knowledge_versions v ON v.id=d.version_id
           WHERE d.content=$1 AND d.metadata->>'document_title'=$2 AND v.embedding_model=$3 LIMIT 1`,
          [chunk.content, input.document.title, deps.embeddingProfile],
        );
        const vector: number[] = cache.rows[0] ? JSON.parse(cache.rows[0].embedding) : await deps.embed(chunk.content, { purpose: 'document', title: input.document.title });
        if (vector.length !== 3072 || vector.some((value) => !Number.isFinite(value))) throw new Error('Embedding dimensionality/finite-value validation failed');
        embeddings[index] = vector;
        if (cache.rows[0]) reusedEmbeddings++;
      }
    }));
  }
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await deps.assertPublicationAllowed?.(client);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.canonicalKey]);
    await client.query(
      `INSERT INTO knowledge_sources(canonical_key,source_name,source_type,department_id,sections,language,audience,authority)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(canonical_key) DO NOTHING`,
      [input.canonicalKey,input.sourceName,input.sourceType,input.policy.departmentId,input.policy.sections,input.policy.language,input.policy.audience,input.policy.authority],
    );
    const source = await client.query<{id:string;active_version_id:string|null;stale:boolean}>(
      `SELECT s.id,s.active_version_id,COALESCE(previous.started_at>current.started_at,false) AS stale
       FROM knowledge_sources s LEFT JOIN ingestion_runs previous ON previous.id=s.last_seen_run_id
       CROSS JOIN ingestion_runs current WHERE s.canonical_key=$1 AND current.id=$2 FOR UPDATE OF s`,
      [input.canonicalKey,runId],
    );
    if (!source.rows[0] || source.rows[0].stale) throw new Error('Source publication rejected: missing run or newer run already observed');
    const sourceId = source.rows[0].id;
    let version = await client.query<{id:string}>(
      'SELECT id FROM knowledge_versions WHERE source_id=$1 AND content_hash=$2 AND parser_version=$3 AND embedding_model=$4',
      [sourceId,hash,PARSER_VERSION,deps.embeddingProfile],
    );
    if (!version.rows.length) {
      if (embeddings.length !== chunks.length) throw new Error('Version changed during staging; retry source');
      version = await client.query<{id:string}>(
        `INSERT INTO knowledge_versions(source_id,content_hash,parser_version,embedding_model,effective_from,expires_at)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [sourceId,hash,PARSER_VERSION,deps.embeddingProfile,input.policy.effectiveFrom,input.policy.expiresAt],
      );
      for (let start = 0; start < chunks.length; start += 40) {
        const batch = chunks.slice(start,start+40).map((chunk,offset) => ({
          content: chunk.content, embedding: JSON.stringify(embeddings[start+offset]),
          metadata: { ...input.metadata, ...chunk.metadata, document_title: input.document.title, sections: input.policy.sections,
            section: input.policy.sections[0], department_id: input.policy.departmentId, language: input.policy.language },
        }));
        await client.query(
          `INSERT INTO documents(source_id,version_id,source_name,source_type,content,embedding,metadata)
           SELECT $1,$2,$3,$4,item.content,item.embedding::vector,item.metadata
           FROM jsonb_to_recordset($5::jsonb) AS item(content text,embedding text,metadata jsonb)`,
          [sourceId,version.rows[0].id,input.sourceName,input.sourceType,JSON.stringify(batch)],
        );
      }
    }
    const versionId = version.rows[0].id;
    await client.query(
      `UPDATE knowledge_sources SET active_version_id=$2,source_name=$3,source_type=$4,department_id=$5,
       sections=$6,language=$7,audience=$8,authority=$9,status='active',last_seen_at=now(),last_seen_run_id=$10,
       last_verified_at=now(),last_error=NULL,
       approval_status=CASE WHEN status<>'active' THEN 'pending' ELSE approval_status END
       WHERE id=$1`,
      [sourceId,versionId,input.sourceName,input.sourceType,input.policy.departmentId,input.policy.sections,input.policy.language,input.policy.audience,input.policy.authority,runId],
    );
    // DB trigger resets approval when version/policy changes. No code path auto-approves.
    const result = { sourceId,versionId,changed:source.rows[0].active_version_id!==versionId,chunks:chunks.length,reusedEmbeddings };
    await deps.onPublished?.(client, result);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function quarantineSource(key: string, reason: string, runId: string, pool: Pick<Pool,'query'>): Promise<void> {
  // Preserve immutable historical chunks; stop serving a source whose new extraction is unsafe.
  await pool.query(`UPDATE knowledge_sources s SET status='quarantined',approval_status='pending',last_error=$2,last_seen_at=now(),last_seen_run_id=$3
    WHERE canonical_key=$1 AND EXISTS(SELECT 1 FROM ingestion_runs current WHERE current.id=$3
      AND NOT EXISTS(SELECT 1 FROM ingestion_runs previous WHERE previous.id=s.last_seen_run_id AND previous.started_at>current.started_at))`, [key,reason.slice(0,1000),runId]);
}
export async function withdrawSource(key: string, reason: string, runId: string, pool: Pick<Pool,'query'>): Promise<void> {
  await pool.query(`UPDATE knowledge_sources s SET status='withdrawn',approval_status='pending',last_error=$2,last_seen_at=now(),last_seen_run_id=$3
    WHERE canonical_key=$1 AND EXISTS(SELECT 1 FROM ingestion_runs current WHERE current.id=$3
      AND NOT EXISTS(SELECT 1 FROM ingestion_runs previous WHERE previous.id=s.last_seen_run_id AND previous.started_at>current.started_at))`, [key,reason.slice(0,1000),runId]);
}
export async function reconcileSources(runId: string, scope: 'web'|'local', complete: boolean, pool: Pick<Pool,'query'>): Promise<number> {
  if (!complete) throw new Error('Reconciliation forbidden after an incomplete run');
  const result = await pool.query(
    `UPDATE knowledge_sources SET status='withdrawn',approval_status='pending',last_error='Not present in complete source manifest'
     WHERE canonical_key LIKE $1 AND last_seen_run_id IS DISTINCT FROM $2::uuid
       AND (last_seen_at IS NULL OR last_seen_at < (SELECT started_at FROM ingestion_runs WHERE id=$2))`,
    [scope==='web'?'https://%':'local:%',runId],
  );
  return result.rowCount ?? 0;
}
