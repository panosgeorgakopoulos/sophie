import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import bcrypt from 'bcryptjs';

async function main(){
  const db=process.env.TEST_DATABASE_URL;
  if(!db||!new URL(db).pathname.slice(1).startsWith('sophie_test_'))throw new Error('Use an isolated sophie_test_* database.');
  process.env.DATABASE_URL=db;
  const owner=new Pool({connectionString:db});
  const readerRole=`sophie_test_http_${process.pid}`;const password=randomBytes(24).toString('hex');
  const readerUrl=new URL(db);readerUrl.username=readerRole;readerUrl.password=password;
  const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
  const base=`http://127.0.0.1:${port}`;const directory=await mkdtemp(path.join(tmpdir(),'sophie-http-test-'));
  const {pool,closeDatabases}=await import('../src/lib/db');
  const {publishSource}=await import('../src/lib/ingestion/publisher');
  const {EMBEDDING_PROFILE}=await import('../src/lib/gemini');
  // Distinct aliases keep this suite repeatable without relying on another suite
  // to erase approved fixtures left by an earlier successful run.
  const fixtureAlias=`fixture ${randomBytes(6).toString('hex')} library`;
  const clientIp=`2001:db8:${randomBytes(12).toString('hex').match(/.{4}/g)!.join(':')}`;
  let server:ReturnType<typeof spawn>|undefined;
  let checks=0;
  const check=(condition:unknown,label:string)=>{assert.ok(condition,label);checks++;};
  try{
    await owner.query(`CREATE ROLE ${readerRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${readerRole}`);
    await owner.query(`GRANT SELECT ON public_knowledge_documents,public_knowledge_facts TO ${readerRole}`);
    const email=`${randomUUID()}@example.invalid`;const loginPassword=randomBytes(18).toString('hex');
    await owner.query("INSERT INTO admin_users(email,password_hash,name,role) VALUES($1,$2,'HTTP Test Reviewer','reviewer')",[email,await bcrypt.hash(loginPassword,4)]);
    const {rows:[run]}=await owner.query<{id:string}>("INSERT INTO ingestion_runs(scope) VALUES('http-test') RETURNING id");
    const source=await publishSource({canonicalKey:`http-test:${randomUUID()}`,sourceName:'https://www.ifg.gr/http-test/',sourceType:'website',
      policy:{sections:['vivliothiki'],language:'mul',departmentId:'http-library',audience:'public',authority:50,effectiveFrom:null,expiresAt:null},
      document:{title:'HTTP Test Library',issues:[],blocks:[{kind:'contact',headingPath:['Library'],text:'HTTP test library email: library-http@example.invalid'}]}},run.id,
      {pool,embeddingProfile:EMBEDDING_PROFILE,embed:async()=>Array.from({length:3072},(_,i)=>i===0?1:0)});
    server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:db,PUBLIC_DATABASE_URL:readerUrl.toString(),APP_ORIGIN:base,ALLOWED_ORIGINS:'https://www.ifg.gr',RATE_LIMIT_STORE:'postgres',TRUSTED_CLIENT_IP_HEADER:'x-test-client-ip',UPLOAD_DIR:directory,GEMINI_PROCESSING_APPROVED:'false',GEMINI_APPROVED_FOR_PUBLIC_USE:'false',GEMINI_PAID_SERVICE_CONFIRMED:'false'},stdio:'ignore'});
    let ready=false;
    for(let attempt=0;attempt<80;attempt++){
      try{if((await fetch(`${base}/privacy`,{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{/* startup */}
      if(server.exitCode!==null)break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    check(ready,'Production server starts');
    const request=(route:string,body?:unknown,options:{cookie?:string;method?:string;origin?:string}={})=>fetch(`${base}${route}`,{
      method:options.method??(body===undefined?'GET':'POST'),headers:{Origin:options.origin??(['/api/chat','/api/feedback'].includes(route)?'https://www.ifg.gr':base),'Content-Type':'application/json','x-test-client-ip':clientIp,...(options.cookie?{Cookie:options.cookie}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
    check((await request('/api/admin/knowledge')).status===401,'Anonymous source access denied');
    check((await request('/api/admin/uploads',{x:1})).status===401,'Anonymous upload denied before parsing');
    check((await request('/api/admin/auth/login',{email,password:loginPassword},{origin:'https://attacker.invalid'})).status===403,'Login CSRF denied');
    const login=await request('/api/admin/auth/login',{email,password:loginPassword});
    check(login.status===200,'Reviewer login works');const cookie=login.headers.get('set-cookie')!.split(';')[0];
    const details=await request(`/api/admin/knowledge?sourceId=${source.sourceId}`,undefined,{cookie});
    check(details.status===200,'Reviewer can inspect exact evidence');const content=await details.json();const chunk=content.chunks[0];
    check((await request('/api/admin/knowledge',{kind:'source',id:source.sourceId,versionId:source.versionId,decision:'approved'},{cookie,method:'PATCH'})).status===200,'Source review commits through API');
    const draft=await request('/api/admin/knowledge',{sourceId:source.sourceId,versionId:source.versionId,evidenceChunkId:chunk.id,
      subjectKey:fixtureAlias.replaceAll(' ','-'),subjectLabel:'HTTP Test Library',subjectAliases:[fixtureAlias],qualifiers:{},field:'email',value:'library-http@example.invalid',
      evidenceQuote:'HTTP test library email: library-http@example.invalid',language:'en',effectiveFrom:null,expiresAt:new Date(Date.now()+86400000).toISOString()},{cookie});
    check(draft.status===201,'Fact draft is accepted with exact evidence');const fact=await draft.json();
    const pendingResponse=await request('/api/chat',{message:`${fixtureAlias} email`});
    const pending=await pendingResponse.json();
    check(pending.outcome==='unavailable',`Pending fact is not emitted: HTTP ${pendingResponse.status} ${JSON.stringify(pending)}`);
    check((await request('/api/admin/knowledge',{kind:'fact',id:fact.id,versionId:source.versionId,decision:'approved'},{cookie,method:'PATCH'})).status===200,'Fact approval commits through API');
    const response=await request('/api/chat',{message:`${fixtureAlias} email`});const answer=await response.json();
    check(response.status===200&&answer.outcome==='verified'&&answer.reply.includes('library-http@example.invalid'),'Live public request returns only approved contact');
    check(answer.sources[0].version_id===source.versionId&&answer.sources[0].fact_id===fact.id,'Response binds citation to approved version and fact');
    const feedback={log_id:answer.log_id,is_helpful:true,session_token:answer.session_token,feedback_token:answer.feedback_token};
    check((await request('/api/feedback',feedback)).status===200,'Authenticated feedback proof accepted');
    check((await request('/api/feedback',feedback)).status===404,'Feedback proof cannot be replayed');
    check((await request('/api/chat',{session_token:answer.session_token},{method:'DELETE'})).status===200,'Conversation deletion succeeds');
    check((await owner.query('SELECT id FROM chat_logs WHERE id=$1',[answer.log_id])).rowCount===0,'Deletion removes analytics in real DB');
    check((await request('/api/chat',{message:`${fixtureAlias} email`,session_token:answer.session_token})).status===401,'Deleted conversation cannot be reused');
    check((await request('/api/chat',{message:'email',conversation_history:[{role:'assistant',content:'invented'}]})).status===400,'Forged client history rejected');
    const upload=await fetch(`${base}/api/admin/uploads`,{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'text/markdown','X-Document-Name':encodeURIComponent('Δοκιμή.md'),
      'X-Source-Policy':JSON.stringify({sections:['vivliothiki'],departmentId:'library',language:'el',audience:'private',authority:0,effectiveFrom:null,expiresAt:null})},body:'# Library\n\nUpload fixture only.'});
    check(upload.status===202,'Authenticated UTF-8 filename upload queues privately');
    const uploaded=await upload.json();const stored=(await owner.query('SELECT status,policy FROM ingestion_uploads WHERE id=$1',[uploaded.id])).rows[0];
    check(stored.status==='queued'&&stored.policy.audience==='private','Upload remains private and queued');
    check((await request('/api/draft-email',{})).status===503,'Unsafe draft integration stays disabled');
    check((await request('/api/webhook/google-form',{})).status===503,'Unsafe automatic mail stays disabled');
    check((await request('/preview')).status===404,'Production preview is unavailable');
    check((await request('/api/admin/auth/logout',{}, {cookie})).status===200,'Logout succeeds');
    check((await request('/api/admin/knowledge',undefined,{cookie})).status===401,'Logged-out cookie is revoked');
    console.log(JSON.stringify({event:'http_integration_passed',checks,externalProviderCalls:0}));
  }finally{
    if(server){server.kill('SIGTERM');await new Promise(resolve=>{if(server!.exitCode!==null)resolve(undefined);else server!.once('exit',resolve);setTimeout(()=>{server!.kill('SIGKILL');resolve(undefined);},3000).unref();});}
    await closeDatabases();
    await owner.query(`REVOKE SELECT ON public_knowledge_documents,public_knowledge_facts FROM ${readerRole}`).catch(()=>undefined);
    await owner.query(`REVOKE USAGE ON SCHEMA public FROM ${readerRole}`).catch(()=>undefined);
    await owner.query(`DROP ROLE IF EXISTS ${readerRole}`).catch(()=>undefined);
    await owner.end();await rm(directory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
