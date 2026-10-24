import {describe,it,expect,vi,afterEach} from 'vitest';
import {uploadFormat,validateUploadSignature,readUpload,scanUpload,uploadCanonicalKey} from './uploadStorage';
afterEach(()=>vi.unstubAllEnvs());
describe('untrusted uploads',()=>{
  it('rejects paths, empty names and type mismatches',()=>{
    for(const name of ['../test.pdf','a/b.pdf','x\\y.pdf','.hidden.pdf','test\n.pdf','']) expect(()=>uploadFormat(name,'application/pdf')).toThrow();
    expect(()=>uploadFormat('test.docx','application/pdf')).toThrow();
    expect(uploadFormat('Catalogue.pdf','application/pdf')).toBe('pdf');
  });
  it('rejects truncated magic and invalid UTF-8 without parser execution',()=>{
    for(const format of ['docx','xlsx','pdf'] as const) expect(()=>validateUploadSignature(Buffer.from([1]),format)).toThrow();
    expect(()=>validateUploadSignature(Buffer.from([255,254]),'md')).toThrow();
  });
  it('uses stable normalized document identity across replacement content',()=>{
    expect(uploadCanonicalKey('exams','CATALOGUE.pdf')).toBe(uploadCanonicalKey('exams','catalogue.pdf'));
    expect(uploadCanonicalKey('exams','catalogue.pdf')).not.toBe(uploadCanonicalKey('courses','catalogue.pdf'));
  });
  it('enforces byte size independently of content-length',async()=>{
    const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(20*1024*1024+1));controller.close();}});
    await expect(readUpload(new Request('http://localhost',{method:'POST',body,duplex:'half'} as RequestInit))).rejects.toMatchObject({status:413});
    await expect(readUpload(new Request('http://localhost',{method:'POST',body:''}))).rejects.toMatchObject({status:400});
  });
  it('fails closed when a malware scanner is not configured',async()=>{
    vi.stubEnv('CLAMSCAN_PATH','');await expect(scanUpload('/tmp/never-opened-test')).rejects.toThrow('not configured');
  });
});
