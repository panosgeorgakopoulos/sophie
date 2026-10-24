import {describe,it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {publishSource,reconcileSources,type PublisherDependencies} from './publisher';
import type {SourceInput} from './types';
const input:SourceInput={canonicalKey:'local:policy.md',sourceName:'policy.md',sourceType:'md',policy:{sections:['mathimata'],language:'mul',departmentId:'courses',audience:'private',authority:50,effectiveFrom:null,expiresAt:null},document:{title:'Courses',issues:[],blocks:[{kind:'contact',headingPath:['Courses'],text:'Contact: courses@example.invalid'}]}};
function harness(existing=false,stale=false){
 const trace:string[]=[];
 const query=vi.fn(async(sql:string)=>{
  trace.push(sql);
  if(sql.startsWith('SELECT s.id'))return{rows:[{id:'source-id',active_version_id:existing?'version-id':null,stale}]};
  if(sql.startsWith('SELECT id FROM knowledge_versions'))return{rows:existing?[{id:'version-id'}]:[]};
  if(sql.startsWith('INSERT INTO knowledge_versions'))return{rows:[{id:'version-id'}]};
  return {rows:[]};
 });
 const poolQuery=vi.fn(async(sql:string)=>{trace.push(sql);return{rows:sql.startsWith('SELECT v.id')&&existing?[{id:'version-id'}]:[]};});
 const client={query,release:vi.fn()};
 const connect=vi.fn(async()=>{trace.push('CONNECT');return client;});
 const pool={query:poolQuery,connect}as unknown as Pool;
 const embed=vi.fn(async()=>{trace.push('EMBED');return Array(3072).fill(0.1);});
 const deps:PublisherDependencies={pool,embed,embeddingProfile:'test-profile'};
 return {deps,trace,query,poolQuery,client,connect,embed};
}
describe('immutable staged publication',()=>{
 it('finishes remote embeddings before opening transaction and never deletes historical chunks',async()=>{
  const h=harness();const result=await publishSource(input,'run-id',h.deps);
  expect(h.trace.indexOf('EMBED')).toBeLessThan(h.trace.indexOf('CONNECT'));
  expect(h.embed).toHaveBeenCalledWith(expect.stringContaining('courses@'),{purpose:'document',title:'Courses'});
  expect(result.changed).toBe(true);expect(h.trace.some(sql=>/^DELETE/i.test(sql))).toBe(false);
  expect(h.query.mock.calls.some(([sql])=>sql.includes("approval_status='approved'"))).toBe(false);
  expect(h.trace.at(-1)).toBe('COMMIT');expect(h.client.release).toHaveBeenCalled();
 });
 it('unchanged versions skip provider and preserve approval through same active pointer',async()=>{
  const h=harness(true);const result=await publishSource(input,'run-id',h.deps);
  expect(result.changed).toBe(false);expect(h.embed).not.toHaveBeenCalled();
  expect(h.trace.some(sql=>sql.startsWith('INSERT INTO documents'))).toBe(false);
 });
 it('failed embedding never acquires a connection or changes live source',async()=>{
  const h=harness();h.embed.mockRejectedValueOnce(new Error('Quota'));
  await expect(publishSource(input,'run-id',h.deps)).rejects.toThrow('Quota');expect(h.connect).not.toHaveBeenCalled();
 });
 it('stale overlapping runs roll back without replacing newer content',async()=>{
  const h=harness(false,true);await expect(publishSource(input,'older-run',h.deps)).rejects.toThrow('newer run');expect(h.trace.at(-1)).toBe('ROLLBACK');
  expect(h.trace.some(sql=>sql.startsWith('INSERT INTO documents'))).toBe(false);
 });
 it('extraction quality failures cannot publish',async()=>{
  const h=harness();await expect(publishSource({...input,document:{...input.document,issues:['OCR required']}},'run-id',h.deps)).rejects.toThrow('quarantined');expect(h.embed).not.toHaveBeenCalled();expect(h.connect).not.toHaveBeenCalled();
 });
 it('partial crawl reconciliation is rejected without database mutation',async()=>{
  const h=harness();await expect(reconcileSources('run-id','web',false,h.deps.pool)).rejects.toThrow('incomplete');expect(h.poolQuery).not.toHaveBeenCalled();
 });
});
