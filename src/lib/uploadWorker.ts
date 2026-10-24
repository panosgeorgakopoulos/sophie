import { pool } from './db';
import { claimUpload, type UploadJob } from './uploadQueue';

/** Each claimed generation gets its own run, rather than inheriting worker age. */
export async function runUploadBatch(processJob: (job: UploadJob, runId: string) => Promise<boolean>, limit = 10) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('Invalid upload batch limit');
  let processed = 0;
  let failed = 0;
  for (let count = 0; count < limit; count++) {
    const job = await claimUpload();
    if (!job) break;
    // A later claim may be newer than content published by another worker while
    // this worker was busy. Source freshness must follow this claim's run.
    const { rows: [run] } = await pool.query<{id:string}>("INSERT INTO ingestion_runs(scope) VALUES('uploads') RETURNING id");
    let success = false;
    try {
      success = await processJob(job, run.id);
      if (success) processed++;
      else failed++;
    } finally {
      await pool.query(`UPDATE ingestion_runs SET status=$2,finished_at=now(),stats=$3 WHERE id=$1`,
        [run.id, success ? 'complete' : 'failed', { uploadId: job.id, processed: success ? 1 : 0, failed: success ? 0 : 1 }]);
    }
  }
  return { processed, failed };
}
