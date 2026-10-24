import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pool } from '../lib/db';
import { uploadPath,scanUpload,uploadCanonicalKey,validateUploadSignature } from '../lib/uploadStorage';
import { sourcePolicySchema } from '../lib/ingestion/manifest';
import { parseDocument } from '../lib/ingestion/parsers';
import { publishSource } from '../lib/ingestion/publisher';
import { embedText,EMBEDDING_PROFILE } from '../lib/gemini';
import { renewUploadLease,assertUploadLease,completeUpload,quarantineUpload } from '../lib/uploadQueue';
import { runUploadBatch } from '../lib/uploadWorker';

async function main() {
  const {failed}=await runUploadBatch(async(job,runId)=>{
    let lostLease=false;let renewing=false;
    const heartbeat=setInterval(()=>{
      if(renewing)return;
      renewing=true;
      void renewUploadLease(job).catch(()=>{lostLease=true;}).finally(()=>{renewing=false;});
    },60_000);
    let canonicalKey: string | undefined;
    try {
      const policy=sourcePolicySchema.parse(job.policy);
      if (!policy.sections.length) throw new Error('Uploaded documents require a category');
      canonicalKey=uploadCanonicalKey(policy.departmentId,job.original_name);
      const file=await uploadPath(job.id); const stat=await lstat(file);
      if(!stat.isFile() || stat.isSymbolicLink() || stat.size>20*1024*1024)throw new Error('Invalid quarantine file');
      const bytes=await readFile(file);
      if(createHash('sha256').update(bytes).digest('hex')!==job.content_hash)throw new Error('Quarantine integrity failure');
      validateUploadSignature(bytes,job.format);
      await scanUpload(file);
      const document=await parseDocument(bytes,job.format,{title:job.original_name});
      if(document.issues.length)throw new Error('Parser requires review');
      await publishSource({canonicalKey,sourceName:job.original_name,sourceType:job.format,
        policy,document,metadata:{upload_id:job.id}},runId,{
        pool,embed:embedText,embeddingProfile:EMBEDDING_PROFILE,
        assertPublicationAllowed: async client=>{
          if(lostLease)throw new Error('Upload lease lost');
          await assertUploadLease(client,job);
        },
        onPublished: async(client,result)=>completeUpload(client,job,result.sourceId),
      });
      return true;
    } catch {
      const quarantined=canonicalKey ? await quarantineUpload(job,canonicalKey,runId) : false;
      console.error(JSON.stringify({event:quarantined?'upload_quarantined':'upload_deferred',id:job.id}));
      return false;
    } finally { clearInterval(heartbeat); }
  });
  await pool.query(`UPDATE ingestion_uploads SET status='failed',lease_token=NULL,lease_until=NULL,
    result_code='retry_budget_exhausted',finished_at=now() WHERE status='processing' AND lease_until<now() AND attempts>=3`);
  if(failed)process.exitCode=1;
}
main().catch(()=>{console.error('Upload worker failed.');process.exitCode=1;}).finally(()=>pool.end());
