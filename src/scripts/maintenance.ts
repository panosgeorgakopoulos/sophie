import { unlink,readdir,lstat } from 'node:fs/promises';
import { pool } from '../lib/db';
import { uploadDirectory,uploadPath } from '../lib/uploadStorage';

async function main() {
  await pool.query('SELECT purge_expired_chat_data()');
  await pool.query('DELETE FROM admin_sessions WHERE expires_at<=now()');
  await pool.query('DELETE FROM rate_limit_buckets WHERE expires_at<=now()');
  if(process.argv.includes('--scrub-legacy-transcripts')) {
    // Explicit migration operation: destroys historical raw messages and embeddings.
    await pool.query(`UPDATE chat_logs SET user_message='[not retained]',assistant_reply='[not retained]',message_embedding=NULL
      WHERE outcome IS NULL`);
    await pool.query(`UPDATE flagged_conversations SET conversation_history='[]',flag_reason='Legacy content removed'`);
  }
  if(process.env.UPLOAD_DIR) {
    const {rows}=await pool.query<{id:string}>(`SELECT id FROM ingestion_uploads WHERE file_deleted_at IS NULL
      AND status IN ('ready','quarantined','failed') AND created_at<now()-interval '7 days' LIMIT 200`);
    for(const row of rows) {
      await unlink(await uploadPath(row.id)).catch(error=>{if(error.code!=='ENOENT')throw error;});
      await pool.query('UPDATE ingestion_uploads SET file_deleted_at=now() WHERE id=$1',[row.id]);
    }
    // An API process crash between file write and queue insert can leave an orphan.
    for(const name of await readdir(await uploadDirectory())) {
      const id=name.replace(/\.quarantine$/,'');
      if(!/^[0-9a-f-]{36}\.quarantine$/i.test(name))continue;
      const file=await uploadPath(id);const stat=await lstat(file);
      if(stat.isSymbolicLink()||Date.now()-stat.mtimeMs<24*3600000)continue;
      const {rows:jobs}=await pool.query('SELECT id FROM ingestion_uploads WHERE id=$1',[id]);
      if(!jobs.length)await unlink(file);
    }
  }
  console.log(JSON.stringify({event:'retention_complete'}));
}
main().catch(()=>{console.error(JSON.stringify({event:'retention_failed'}));process.exitCode=1;}).finally(()=>pool.end());
