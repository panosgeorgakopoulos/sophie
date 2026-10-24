import { z } from 'zod';
import { pool } from './db';
import { HttpError } from './httpError';

export const factDraftSchema = z.object({
  sourceId: z.uuid(), versionId: z.uuid(), evidenceChunkId: z.uuid(),
  subjectKey: z.string().regex(/^[a-z0-9][a-z0-9:_-]{1,127}$/),
  subjectLabel: z.string().trim().min(2).max(200),
  subjectAliases: z.array(z.string().trim().min(2).max(160)).min(1).max(20),
  qualifiers: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().trim().min(1).max(120)).refine(value => Object.keys(value).length <= 10, 'At most ten qualifiers').default({}),
  field: z.enum(['email','phone','address','date','fee','contact','policy']),
  value: z.string().trim().min(1).max(1600), evidenceQuote: z.string().trim().min(1).max(4000),
  language: z.enum(['el','fr','en']),
  effectiveFrom: z.iso.datetime({offset:true}).nullable(), expiresAt: z.iso.datetime({offset:true}),
}).strict().refine(v => Date.parse(v.expiresAt) > Date.now() && (!v.effectiveFrom || Date.parse(v.expiresAt) > Date.parse(v.effectiveFrom)), 'A future expiry after the effective date is required.');

export const reviewSchema = z.object({
  kind: z.enum(['source','fact']), id: z.uuid(), versionId: z.uuid(),
  decision: z.enum(['approved','rejected']),
}).strict();

export function validateEvidence(value: string, quote: string, content: string): void {
  if (!quote.includes(value) || !content.includes(quote)) {
    throw new HttpError(422, 'The exact value and quotation must occur in the selected evidence chunk.');
  }
}

export async function createFactDraft(input: z.infer<typeof factDraftSchema>, actorId: string) {
  input = factDraftSchema.parse(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows} = await client.query<{content:string;department_id:string}>(`
      SELECT d.content,s.department_id FROM documents d JOIN knowledge_sources s ON s.id=d.source_id
      WHERE d.id=$1 AND d.source_id=$2 AND d.version_id=$3 AND s.active_version_id=$3
        AND s.status='active' FOR UPDATE OF s`, [input.evidenceChunkId,input.sourceId,input.versionId]);
    if (!rows[0]) throw new HttpError(409, 'The source version changed or its evidence is unavailable.');
    validateEvidence(input.value,input.evidenceQuote,rows[0].content);
    const result = await client.query<{id:string}>(`
      INSERT INTO knowledge_facts (source_id,version_id,department_id,subject_key,subject_label,
        subject_aliases,qualifiers,field,value,language,evidence_chunk_id,evidence_quote,effective_from,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [input.sourceId,input.versionId,rows[0].department_id,input.subjectKey,input.subjectLabel,input.subjectAliases,
        input.qualifiers,input.field,input.value,input.language,input.evidenceChunkId,input.evidenceQuote,input.effectiveFrom,input.expiresAt]);
    const id = result.rows[0].id;
    await client.query(`INSERT INTO knowledge_audit_events(actor_id,action,source_id,fact_id) VALUES($1,'fact_drafted',$2,$3)`,[actorId,input.sourceId,id]);
    await client.query('COMMIT');
    return id;
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function reviewKnowledge(input: z.infer<typeof reviewSchema>, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let sourceId: string;
    if (input.kind === 'source') {
      const result = await client.query<{id:string}>(`
        UPDATE knowledge_sources s SET approval_status=$3,reviewed_by=$4,reviewed_at=now(),last_verified_at=now()
        FROM knowledge_versions v WHERE s.id=$1 AND s.active_version_id=$2 AND v.id=$2
          AND s.status='active' AND s.audience='public'
          AND (v.expires_at IS NULL OR v.expires_at>now())
          AND EXISTS(SELECT 1 FROM documents d WHERE d.source_id=s.id AND d.version_id=v.id)
        RETURNING s.id`,[input.id,input.versionId,input.decision,actorId]);
      if (!result.rows[0]) throw new HttpError(409,'Only the current, active, public source version can be reviewed.');
      sourceId = result.rows[0].id;
    } else {
      const evidence = await client.query<{source_id:string;value:string;evidence_quote:string;content:string}>(`
        SELECT f.source_id,f.value,f.evidence_quote,d.content FROM knowledge_facts f
        JOIN knowledge_sources s ON s.id=f.source_id
        JOIN documents d ON d.id=f.evidence_chunk_id AND d.source_id=f.source_id AND d.version_id=f.version_id
        WHERE f.id=$1 AND f.version_id=$2 AND s.active_version_id=$2 AND s.status='active'
          AND s.audience='public' AND s.approval_status='approved' AND f.department_id=s.department_id
          AND f.expires_at>now() FOR UPDATE OF s,f`,[input.id,input.versionId]);
      const row=evidence.rows[0];
      if (!row) throw new HttpError(409,'Approve the current source first and verify the fact expiry.');
      validateEvidence(row.value,row.evidence_quote,row.content);
      sourceId=row.source_id;
      await client.query(`UPDATE knowledge_facts SET approval_status=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1`,[input.id,input.decision,actorId]);
    }
    await client.query(`INSERT INTO knowledge_audit_events(actor_id,action,source_id,fact_id,details)
      VALUES($1,$2,$3,$4,$5)`,[actorId,`${input.kind}_${input.decision}`,sourceId,input.kind==='fact'?input.id:null,{versionId:input.versionId}]);
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
