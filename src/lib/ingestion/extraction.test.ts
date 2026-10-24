import { describe,it,expect } from 'vitest';
import { decodeCloudflareEmail,extractHtml,extractMarkdown } from './html';
import { parseManifest,sourcePolicySchema } from './manifest';
import { canonicalUrl,isPublicAddress } from './fetch';

const encode=(email:string)=>Buffer.from([73,...Buffer.from(email)].map((value,index)=>index?value^73:value)).toString('hex');
describe('structured extraction',()=>{
  it('decodes contact attributes and preserves div text exactly once',()=>{
    const html=`<main><h1>Institut</h1><h3>Examens</h3><div><p>Alpha <b>beta</b></p><div>Direct contact <a href="mailto:exams%40example.invalid">Email us</a></div></div><p><a href="tel:+302103000000">Call</a><span data-cfemail="${encode('info@example.invalid')}">[email protected]</span></p></main>`;
    const result=extractHtml(html,'Source');
    expect(result.issues).toEqual([]);
    const all=result.blocks.map(block=>block.text).join('\n');
    expect(all.match(/Alpha beta/g)).toHaveLength(1);
    expect(all).toContain('exams@example.invalid');expect(all).toContain('+302103000000');expect(all).toContain('info@example.invalid');
    expect(result.blocks.every(block=>block.headingPath.join(' > ')==='Institut > Examens')).toBe(true);
  });
  it('replaces sibling heading paths even when heading levels skip',()=>{
    const result=extractHtml('<h1>IFG</h1><h3>Examens</h3><p>exams@example.invalid</p><h3>Library</h3><p>library@example.invalid</p>','Source');
    expect(result.blocks[1].headingPath).toEqual(['IFG','Library']);
  });
  it('repeats table headers, rowspan and units for each row',()=>{
    const result=extractHtml('<h2>DELF</h2><table><tr><th>Session</th><th>Prix EUR</th></tr><tr><td rowspan="2">2026</td><td>90</td></tr><tr><td>100</td></tr></table>','Tarifs');
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1].text).toBe('Session: 2026 | Prix EUR: 100');
    expect(result.blocks[1].kind).toBe('table_row');
  });
  it('includes static hidden tabs with their label and flags missing AJAX panels',()=>{
    const result=extractHtml('<div id="t">Examens</div><div id="pane" role="tabpanel" aria-labelledby="t" hidden><p>exam@example.invalid</p></div><a role="tab" aria-controls="missing">Next</a>','IFG');
    expect(result.blocks.find(b=>b.text.includes('@'))?.headingPath).toContain('Examens');
    expect(result.issues).toContain('Unresolved dynamic tab content requires reviewed rendering');
  });
  it('keeps Markdown table rows attached to headers',()=>{
    const result=extractMarkdown('# Tarifs\n\n| Diplôme | EUR |\n| --- | --- |\n| B2 | 100 |\n','IFG');
    expect(result.blocks[0]).toMatchObject({kind:'table_row',headingPath:['Tarifs'],text:'Diplôme: B2 | EUR: 100'});
  });
  it('rejects malformed encoded emails',()=>expect(decodeCloudflareEmail('bad')).toBeUndefined());
});
describe('fetch and policy boundaries',()=>{
  it.each(['http://ifg.gr/','https://ifg.gr@127.0.0.1/','https://evil.invalid/','https://ifg.gr:444/','https://user:password@ifg.gr/'])('rejects unsafe URL %s',url=>expect(()=>canonicalUrl(url)).toThrow());
  it('normalizes fragment and tracking parameters',()=>expect(canonicalUrl('/fr/examens/?b=2&utm_source=x&a=1#tab','https://www.ifg.gr')).toBe('https://www.ifg.gr/fr/examens/?a=1&b=2'));
  it.each(['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','172.16.1.1','100.64.0.1','198.18.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'])('rejects reserved address %s',ip=>expect(isPublicAddress(ip)).toBe(false));
  it.each(['8.8.8.8','2606:4700:4700::1111'])('allows global address %s',ip=>expect(isPublicAddress(ip)).toBe(true));
  it('requires explicit local validity metadata and defaults audience private',()=>{
    const policy={sections:['mathimata'],language:'mul',departmentId:'courses',effectiveFrom:null,expiresAt:null};
    expect(parseManifest({version:1,files:{'policy.md':policy}}).files['policy.md'].audience).toBe('private');
    expect(()=>parseManifest({version:1,files:{'policy.md':{...policy,effectiveFrom:undefined}}})).toThrow();
    expect(()=>sourcePolicySchema.parse({...policy,sections:[],audience:'public'})).toThrow();
  });
});
