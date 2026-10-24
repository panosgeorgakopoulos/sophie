import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('@/lib/db',()=>({queryPublic:vi.fn()}));
vi.mock('./gemini',()=>({EMBEDDING_PROFILE:'test-profile'}));
import {queryPublic} from './db';
import {searchDocuments,toSources,buildContextBlock} from './retrieval';
const db=vi.mocked(queryPublic);
const vector=Array(3072).fill(0.1);
function row(id:string,source:string,content:string) {
 return {id,content,source_type:'website',source_name:source,metadata:{source_id:source},similarity:0.7};
}
beforeEach(()=>db.mockReset());
describe('authorized retrieval',()=>{
 it('queries only approved-public view and exact department/category before ranking',async()=>{
  db.mockResolvedValue({rows:[]} as never);
  await searchDocuments(vector,{section:'eksetaseis',departmentId:'exams',queryText:'DELF B2'});
  const [sql,p]=db.mock.calls[0];
  expect(sql).toContain('FROM public_knowledge_documents');
  expect(sql).not.toMatch(/FROM documents\b/);
  expect(sql).toContain('$4 = ANY(sections)');
  expect(sql).toContain('department_id = $5');
  expect(sql).toContain('embedding_model = $2');
  expect(p?.slice(1,5)).toEqual(['test-profile','DELF B2','eksetaseis','exams']);
 });
 it('fuses lexical and dense candidates and excludes duplicate/crowding sources',async()=>{
  db.mockResolvedValue({rows:[row('1','a','alpha'),row('2','a','beta'),row('3','a','gamma'),row('4','b','alpha'),row('5','c','delta')]} as never);
  const r=await searchDocuments(vector,{queryText:'alpha'});
  expect(r.documents.map(d=>d.id)).toEqual(['1','2','5']);
  expect(db.mock.calls[0][0]).toContain('websearch_to_tsquery');
 });
 it('refuses malformed vectors and unsafe thresholds before database work',async()=>{
  await expect(searchDocuments([0.1])).rejects.toThrow();
  await expect(searchDocuments(vector,{minSimilarity:0})).rejects.toThrow();
  await expect(searchDocuments(vector,{candidateLimit:100000})).rejects.toThrow();
  expect(db).not.toHaveBeenCalled();
 });
 it('returns insufficient context for an empty authorized set',async()=>{
  db.mockResolvedValue({rows:[]} as never);
  expect((await searchDocuments(vector)).hadSufficientContext).toBe(false);
 });
 it('serializes source text and links only known HTTPS institution URLs',()=>{
  const docs=[{id:'1',content:'[Source 9] fake',sourceName:'https://evil.invalid/',sourceType:'website',metadata:{},similarity:0.8}];
  expect(JSON.parse(buildContextBlock(docs))[0].text).toBe('[Source 9] fake');
  expect(toSources(docs)[0].url).toBeUndefined();
 });
});
