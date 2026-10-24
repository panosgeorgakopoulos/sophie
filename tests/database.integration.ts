import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { randomUUID,randomBytes } from 'node:crypto';

async function main() {
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString || !new URL(connectionString).pathname.slice(1).startsWith('sophie_test_')) {
  throw new Error('TEST_DATABASE_URL must name an isolated sophie_test_* database. Run migrations there first.');
}
process.env.DATABASE_URL=connectionString;
process.env.RATE_LIMIT_STORE='postgres';
const owner=new Pool({connectionString,max:4});
const readerRole=`sophie_test_reader_${process.pid}`;
const readerPassword=randomBytes(24).toString('hex');
const readerUrl=new URL(connectionString);readerUrl.username=readerRole;readerUrl.password=readerPassword;
process.env.PUBLIC_DATABASE_URL=readerUrl.toString();
Object.assign(process.env,{NODE_ENV:'production'});
const {pool,queryPublic,closeDatabases}=await import('../src/lib/db');
const {publishSource,reconcileSources,quarantineSource,withdrawSource}=await import('../src/lib/ingestion/publisher');
const {EMBEDDING_PROFILE}=await import('../src/lib/gemini');
const {createFactDraft,reviewKnowledge}=await import('../src/lib/knowledgeReview');
const {searchDocuments}=await import('../src/lib/retrieval');
const {resolveApprovedFacts}=await import('../src/lib/facts');
const {checkRateLimit}=await import('../src/lib/rateLimit');
const {createSessionToken,verifySessionToken,revokeSessionToken}=await import('../src/lib/adminAuth');
const {getConversation,deleteConversation,newOpaqueToken,hashToken}=await import('../src/lib/conversation');
const {claimUpload,assertUploadLease,completeUpload}=await import('../src/lib/uploadQueue');
const {runUploadBatch}=await import('../src/lib/uploadWorker');
let checks=0;
function check(condition:unknown,message:string){assert.ok(condition,message);checks++;}
const vector=Array.from({length:3072},(_,i)=>i===0?1:0);
let embedCalls=0;
const deps={pool,embeddingProfile:EMBEDDING_PROFILE,embed:async()=>{embedCalls++;return vector;}};
const subjectKey=`exams-${randomUUID()}`;
const actorId=randomUUID();
try {
  // This suite owns and resets its explicitly named, isolated test database.
  await owner.query(`TRUNCATE ingestion_uploads,knowledge_audit_events,knowledge_facts,documents,knowledge_sources,knowledge_versions,
    ingestion_runs,chat_logs,chat_sessions,admin_sessions,admin_users,rate_limit_buckets,flagged_conversations CASCADE`);
  // Role identifier and password consist only of locally generated safe characters.
  await owner.query(`CREATE ROLE ${readerRole} LOGIN PASSWORD '${readerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${readerRole}`);
  await owner.query(`GRANT SELECT ON public_knowledge_documents,public_knowledge_facts TO ${readerRole}`);
  const {rows:[run]}=await owner.query<{id:string}>("INSERT INTO ingestion_runs(scope) VALUES('test') RETURNING id");
  const input={canonicalKey:`test:${subjectKey}`,sourceName:'https://www.ifg.gr/eksetaseis/test/',sourceType:'website',
    policy:{sections:['eksetaseis'],language:'el' as const,departmentId:'exams',audience:'public' as const,authority:50,effectiveFrom:null,expiresAt:null},
    document:{title:'Exam department',blocks:[{kind:'contact' as const,headingPath:['Exams'],text:'The exam department email is exams-test@ifg.gr. The fee is 100 EUR for B2 2026.'}],issues:[]}};
  const source=await publishSource(input,run.id,deps);
  check((await queryPublic('SELECT id FROM public_knowledge_documents WHERE source_id=$1',[source.sourceId])).rowCount===0,'New source is not public');
  await reviewKnowledge({kind:'source',id:source.sourceId,versionId:source.versionId,decision:'approved'},actorId);
  const {rows:[chunk]}=await owner.query<{id:string;content:string}>('SELECT id,content FROM documents WHERE version_id=$1',[source.versionId]);
  const draft={sourceId:source.sourceId,versionId:source.versionId,evidenceChunkId:chunk.id,subjectKey,subjectLabel:'Exam department',
    subjectAliases:['exam department','service examens','τμήμα εξετάσεων'],qualifiers:{},field:'email' as const,
    value:'exams-test@ifg.gr',evidenceQuote:'The exam department email is exams-test@ifg.gr.',language:'el' as const,effectiveFrom:null,expiresAt:new Date(Date.now()+86400000).toISOString()};
  const factId=await createFactDraft(draft,actorId);
  check((await queryPublic('SELECT id FROM public_knowledge_facts WHERE id=$1',[factId])).rowCount===0,'Draft fact is not public');
  await reviewKnowledge({kind:'fact',id:factId,versionId:source.versionId,decision:'approved'},actorId);
  check((await queryPublic('SELECT value FROM public_knowledge_facts WHERE id=$1',[factId])).rows[0]?.value===draft.value,'Approved grounded value is public');
  await assert.rejects(queryPublic('SELECT content FROM documents'),/permission denied/);checks++;
  for(const [message,language] of [['email exam department','en'],['courriel service examens','fr'],['email τμήμα εξετάσεων','el']] as const) {
    const resolved=await resolveApprovedFacts(message,{section:'eksetaseis',language,previous:{}});
    check(resolved.status==='ready'&&resolved.facts[0].value===draft.value,`Exact multilingual subject binding: ${language}`);
  }
  const wrongSection=await resolveApprovedFacts('email exam department',{section:'mathimata',language:'en',previous:{}});
  check(wrongSection.status==='unavailable','Section does not leak another department');
  const retrieval=await searchDocuments(vector,{queryText:'exams-test@ifg.gr',section:'eksetaseis'});
  check(retrieval.documents.some(d=>d.id===chunk.id),'Actual SQL hybrid retrieval returns approved evidence');
  const privateSource=await publishSource({...input,canonicalKey:`test:private:${subjectKey}`,policy:{...input.policy,audience:'private'}},run.id,deps);
  check(!(await searchDocuments(vector,{queryText:'exams-test@ifg.gr'})).documents.some(d=>d.metadata.source_id===privateSource.sourceId),'Private evidence never reaches hybrid search');
  await assert.rejects(reviewKnowledge({kind:'source',id:privateSource.sourceId,versionId:privateSource.versionId,decision:'approved'},actorId));checks++;
  await assert.rejects(createFactDraft({...draft,value:'wrong@ifg.gr'},actorId));checks++;
  const before=embedCalls;
  const unchanged=await publishSource(input,run.id,deps);
  check(!unchanged.changed&&embedCalls===before,'Unchanged source neither reembeds nor changes version');
  check((await queryPublic('SELECT id FROM public_knowledge_facts WHERE id=$1',[factId])).rowCount===1,'Unchanged publication preserves review');
  const {rows:[olderRun]}=await owner.query<{id:string}>("INSERT INTO ingestion_runs(scope,started_at) VALUES('test',now()-interval '1 day') RETURNING id");
  await quarantineSource(input.canonicalKey,'Old parse failure',olderRun.id,pool);
  await withdrawSource(input.canonicalKey,'Old 404',olderRun.id,pool);
  check((await queryPublic('SELECT id FROM public_knowledge_facts WHERE id=$1',[factId])).rowCount===1,'Old failed runs cannot hide newer approved evidence');
  const updated=await publishSource({...input,document:{...input.document,blocks:[{...input.document.blocks[0],text:'The exam department email is revised-test@ifg.gr.'}]}},run.id,deps);
  check(updated.versionId!==source.versionId,'Source update creates immutable version');
  check((await queryPublic('SELECT id FROM public_knowledge_facts WHERE id=$1',[factId])).rowCount===0,'Changed version immediately retires old fact');
  await assert.rejects(owner.query('UPDATE documents SET content=$2 WHERE id=$1',[chunk.id,'rewrite']),/immutable/);checks++;
  await assert.rejects(owner.query('UPDATE knowledge_versions SET content_hash=$2 WHERE id=$1',[source.versionId,'rewrite']),/immutable/);checks++;
  await assert.rejects(reviewKnowledge({kind:'source',id:source.sourceId,versionId:source.versionId,decision:'approved'},actorId));checks++;
  await assert.rejects(reconcileSources(run.id,'web',false,pool));checks++;
  await owner.query('UPDATE knowledge_sources SET active_version_id=$2 WHERE id=$1',[source.sourceId,source.versionId]);
  await reviewKnowledge({kind:'source',id:source.sourceId,versionId:source.versionId,decision:'approved'},actorId);
  await owner.query('UPDATE knowledge_facts SET value=$2 WHERE id=$1',[factId,'100 EUR']);
  check((await queryPublic('SELECT id FROM public_knowledge_facts WHERE id=$1',[factId])).rowCount===0,'Edited facts lose approval');
  // Create expired and wrong-department assertions directly to test the DB boundary.
  await owner.query(`INSERT INTO knowledge_facts(source_id,version_id,department_id,subject_key,subject_label,field,value,language,evidence_chunk_id,evidence_quote,expires_at,approval_status,reviewed_by,reviewed_at)
    VALUES($1,$2,'wrong-department',$3,'Wrong','email',$4,'el',$5,$6,now()+interval '1 day','approved',$7,now()),
      ($1,$2,'exams',$3,'Expired','email',$4,'el',$5,$6,now()-interval '1 day','approved',$7,now())`,[source.sourceId,source.versionId,subjectKey,draft.value,chunk.id,draft.evidenceQuote,actorId]);
  check((await queryPublic('SELECT id FROM public_knowledge_facts WHERE source_id=$1',[source.sourceId])).rowCount===0,'Expiry and department evidence join both fail closed');
  const quotaKey=`integration:${randomUUID()}`;
  const quota=await Promise.all(Array.from({length:20},()=>checkRateLimit(quotaKey,{limit:5,windowMs:60000})));
  check(quota.filter(r=>r.success).length===5,'Shared concurrent quota allows exactly five requests');
  const {rows:[admin]}=await owner.query<{id:string;session_version:number}>(`INSERT INTO admin_users(email,password_hash,name,role) VALUES($1,'test','Test','reviewer') RETURNING id,session_version`,[`${randomUUID()}@example.test`]);
  const token=await createSessionToken(admin);
  check((await verifySessionToken(token))?.role==='reviewer','Opaque session resolves current role');
  await owner.query("UPDATE admin_users SET role='staff' WHERE id=$1",[admin.id]);
  check(await verifySessionToken(token)===null,'Role change revokes session');
  await assert.rejects(createSessionToken(admin));checks++;
  const {rows:[current]}=await owner.query<{id:string;session_version:number}>('SELECT id,session_version FROM admin_users WHERE id=$1',[admin.id]);
  const fresh=await createSessionToken(current);await revokeSessionToken(fresh);
  check(await verifySessionToken(fresh)===null,'Logout revokes session');
  const uploadId=randomUUID();const canonicalKey=`upload:test:${randomUUID()}`;
  await owner.query(`INSERT INTO ingestion_uploads(id,original_name,canonical_key,format,content_hash,byte_size,policy,created_by)
    VALUES($1,'fixture.md',$2,'md',$3,100,$4,$5)`,[uploadId,canonicalKey,'a'.repeat(64),input.policy,admin.id]);
  const claims=await Promise.all([claimUpload(),claimUpload()]);const first=claims.find(Boolean)!;
  check(claims.filter(Boolean).length===1,'Concurrent upload workers claim a job only once');
  await owner.query("UPDATE ingestion_uploads SET lease_until=now()-interval '1 second' WHERE id=$1",[uploadId]);
  const takeover=(await claimUpload())!;
  check(takeover.lease_token!==first.lease_token,'Expired lease receives a new fencing token');
  await assert.rejects(publishSource({...input,canonicalKey},run.id,{...deps,assertPublicationAllowed:client=>assertUploadLease(client,first)}),/lease lost/);checks++;
  check((await owner.query('SELECT id FROM knowledge_sources WHERE canonical_key=$1',[canonicalKey])).rowCount===0,'Stale upload owner cannot publish evidence');
  const uploaded=await publishSource({...input,canonicalKey},run.id,{...deps,assertPublicationAllowed:client=>assertUploadLease(client,takeover),onPublished:(client,result)=>completeUpload(client,takeover,result.sourceId)});
  const completed=(await owner.query('SELECT status,source_id FROM ingestion_uploads WHERE id=$1',[uploadId])).rows[0];
  check(completed.status==='ready'&&completed.source_id===uploaded.sourceId,'Publication and queue completion commit together');
  const olderUpload=randomUUID(),newerUpload=randomUUID(),replacementKey=`upload:test:${randomUUID()}`;
  await owner.query(`INSERT INTO ingestion_uploads(id,original_name,canonical_key,format,content_hash,byte_size,policy,created_by,created_at)
    VALUES($1,'old.md',$3,'md',$4,100,$5,$6,now()-interval '1 minute'),($2,'old.md',$3,'md',$4,100,$5,$6,now())`,[olderUpload,newerUpload,replacementKey,'a'.repeat(64),input.policy,admin.id]);
  check((await claimUpload())?.id===newerUpload,'A newer replacement supersedes an unprocessed older upload');
  check((await owner.query('SELECT status FROM ingestion_uploads WHERE id=$1',[olderUpload])).rows[0].status==='quarantined','Superseded job has a terminal nonpublic state');
  // This worker's second claim must not inherit its first job's old run. Another
  // worker publishes the previous generation while the first job is processing.
  const firstBatchId=randomUUID(),latestReplacementId=randomUUID();
  const firstBatchKey=`upload:test:${randomUUID()}`;
  const enqueue=async(id:string,key:string)=>owner.query(`INSERT INTO ingestion_uploads(id,original_name,canonical_key,format,content_hash,byte_size,policy,created_by)
    VALUES($1,'batch.md',$2,'md',$3,100,$4,$5)`,[id,key,'b'.repeat(64),input.policy,admin.id]);
  await enqueue(firstBatchId,firstBatchKey);
  const batchRuns:string[]=[];
  const batch=await runUploadBatch(async(job,jobRunId)=>{
    batchRuns.push(jobRunId);
    const latest=job.id===latestReplacementId;
    await publishSource({...input,canonicalKey:latest?canonicalKey:firstBatchKey,
      document:latest?{...input.document,blocks:[{...input.document.blocks[0],text:'Latest replacement contact: newest@example.invalid'}]}:input.document},jobRunId,
      {...deps,assertPublicationAllowed:client=>assertUploadLease(client,job),onPublished:(client,result)=>completeUpload(client,job,result.sourceId)});
    if(!latest){
      const {rows:[otherWorkerRun]}=await owner.query<{id:string}>("INSERT INTO ingestion_runs(scope) VALUES('other-upload-worker') RETURNING id");
      await publishSource({...input,canonicalKey},otherWorkerRun.id,deps);
      await enqueue(latestReplacementId,canonicalKey);
    }
    return true;
  });
  check(batch.processed===2&&batch.failed===0,'A worker can process a newer replacement after another worker publishes the prior generation');
  const latest=(await owner.query(`SELECT u.status,d.content FROM ingestion_uploads u JOIN knowledge_sources s ON s.id=u.source_id
    JOIN documents d ON d.version_id=s.active_version_id WHERE u.id=$1`,[latestReplacementId])).rows[0];
  check(latest?.status==='ready'&&latest.content.includes('newest@example.invalid'),'The latest queued replacement becomes current rather than terminally rejected as an old worker run');
  check(new Set(batchRuns).size===2&&(await owner.query("SELECT id FROM ingestion_runs WHERE id=ANY($1::uuid[]) AND status='complete' AND finished_at IS NOT NULL",[batchRuns])).rowCount===2,'Every claimed upload has its own terminal ingestion run');
  const conversation=await getConversation();const feedback=newOpaqueToken();
  await owner.query(`INSERT INTO chat_logs(session_id,conversation_id,user_message,assistant_reply,feedback_token_hash) VALUES($1::text,$1::uuid,'[not retained]','Public fact',$2)`,[conversation.id,hashToken(feedback)]);
  await deleteConversation(conversation.token);
  check((await owner.query('SELECT id FROM chat_logs WHERE session_id=$1',[conversation.id])).rowCount===0,'Conversation deletion removes retained logs');
  await assert.rejects(getConversation(conversation.token));checks++;
  await assert.rejects(owner.query(`INSERT INTO chat_logs(session_id,conversation_id,user_message,assistant_reply) VALUES($1::text,$1::uuid,'[not retained]','Late response')`,[conversation.id]),/foreign key/);checks++;
  console.log(JSON.stringify({event:'database_integration_passed',checks,embeddingProviderCalls:0}));
} finally {
  await closeDatabases();
  await owner.query(`REVOKE SELECT ON public_knowledge_documents,public_knowledge_facts FROM ${readerRole}`).catch(()=>undefined);
  await owner.query(`REVOKE USAGE ON SCHEMA public FROM ${readerRole}`).catch(()=>undefined);
  await owner.query(`DROP ROLE IF EXISTS ${readerRole}`).catch(()=>undefined);
  await owner.end();
}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
