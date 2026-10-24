import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './db';
import type { DocumentFormat } from './ingestion/types';
import { quarantineSource } from './ingestion/publisher';

export interface UploadJob {
  id: string; original_name: string; format: DocumentFormat; content_hash: string;
  policy: unknown; lease_token: string;
}

export async function claimUpload(): Promise<UploadJob | undefined> {
  await pool.query(`UPDATE ingestion_uploads old SET status='quarantined',result_code='superseded_by_newer_upload',finished_at=now()
    WHERE old.status='queued' AND EXISTS(SELECT 1 FROM ingestion_uploads newer
      WHERE newer.canonical_key=old.canonical_key AND (newer.created_at,newer.id)>(old.created_at,old.id))`);
  const { rows } = await pool.query<UploadJob>(`
    UPDATE ingestion_uploads SET status='processing',attempts=attempts+1,
      lease_until=now()+interval '15 minutes',lease_token=$1
    WHERE id=(SELECT id FROM ingestion_uploads WHERE (status='queued' OR (status='processing' AND lease_until<now()))
      AND attempts<3 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id,original_name,format,content_hash,policy,lease_token`, [randomUUID()]);
  return rows[0];
}
export async function renewUploadLease(job: UploadJob): Promise<void> {
  const { rowCount } = await pool.query(`UPDATE ingestion_uploads SET lease_until=now()+interval '15 minutes'
    WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_until>now()`, [job.id, job.lease_token]);
  if (rowCount !== 1) throw new Error('Upload lease lost');
}
export async function assertUploadLease(client: PoolClient, job: UploadJob): Promise<void> {
  // Lock the queue row through source publication and completion. An expired/reassigned
  // worker can neither publish nor mark a new owner's work complete.
  const { rows } = await client.query(`SELECT id FROM ingestion_uploads current
    WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_until>now()
      AND NOT EXISTS(SELECT 1 FROM ingestion_uploads newer WHERE newer.canonical_key=current.canonical_key
        AND (newer.created_at,newer.id)>(current.created_at,current.id)) FOR UPDATE`, [job.id, job.lease_token]);
  if (rows.length !== 1) throw new Error('Upload lease lost');
}
export async function completeUpload(client: PoolClient, job: UploadJob, sourceId: string): Promise<void> {
  const { rowCount } = await client.query(`UPDATE ingestion_uploads SET status='ready',source_id=$3,
    lease_until=NULL,lease_token=NULL,finished_at=now(),result_code='awaiting_source_and_fact_review'
    WHERE id=$1 AND lease_token=$2 AND status='processing'`, [job.id, job.lease_token, sourceId]);
  if (rowCount !== 1) throw new Error('Upload completion lost ownership');
}
export async function quarantineUpload(job: UploadJob, canonicalKey: string, runId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertUploadLease(client, job);
    // An unsafe replacement must stop the prior approved version from answering.
    // quarantineSource also prevents an older ingestion run from overriding a newer run.
    await quarantineSource(canonicalKey, 'Uploaded replacement requires review', runId, client);
    await client.query(`UPDATE ingestion_uploads SET status='quarantined',lease_until=NULL,lease_token=NULL,
      finished_at=now(),result_code='scan_parse_or_publish_failed' WHERE id=$1 AND lease_token=$2`, [job.id, job.lease_token]);
    await client.query('COMMIT');
    return true;
  } catch {
    await client.query('ROLLBACK');
    return false;
  } finally { client.release(); }
}
