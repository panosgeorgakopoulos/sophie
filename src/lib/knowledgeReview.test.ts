import {describe,it,expect,vi} from 'vitest';
vi.mock('./db',()=>({pool:{connect:vi.fn()}}));
import {validateEvidence,factDraftSchema} from './knowledgeReview';
describe('fact review',()=>{
  it('requires an exact value inside a quote inside its evidence',()=>{
    expect(()=>validateEvidence('a@ifg.gr','Exams: a@ifg.gr','Exams: a@ifg.gr')).not.toThrow();
    expect(()=>validateEvidence('b@ifg.gr','Exams: a@ifg.gr','Exams: a@ifg.gr')).toThrow();
    expect(()=>validateEvidence('a@ifg.gr','Exams: a@ifg.gr','Library: a@ifg.gr')).toThrow();
  });
  it('rejects expired and excessively large fact drafts',()=>{
    const id='11111111-1111-4111-8111-111111111111';
    const draft={sourceId:id,versionId:id,evidenceChunkId:id,subjectKey:'exams',subjectLabel:'Exams',subjectAliases:['examens'],field:'email',value:'a@ifg.gr',evidenceQuote:'a@ifg.gr',language:'fr',effectiveFrom:null,expiresAt:'2000-01-01T00:00:00Z'};
    expect(factDraftSchema.safeParse(draft).success).toBe(false);
    expect(factDraftSchema.safeParse({...draft,expiresAt:'2099-01-01T00:00:00Z',value:'x'.repeat(1601)}).success).toBe(false);
  });
});
