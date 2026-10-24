import {describe,it,expect,vi} from 'vitest';
import {crawlWebsite} from './crawler';
import type {FetchResult} from './fetch';
const base='https://www.ifg.gr';
const response=(url:string,body:string,status=200,contentType='text/html'):FetchResult=>({url,status,body:Buffer.from(body),contentType});
function fixture(extra:Record<string,FetchResult>={}){
 const pages:Record<string,FetchResult>={
 [`${base}/robots.txt`]:response(`${base}/robots.txt`,'User-agent: *\nDisallow: /wp-admin/',200,'text/plain'),
 [`${base}/sitemap.xml`]:response(`${base}/sitemap.xml`,'<sitemapindex><sitemap><loc>https://www.ifg.gr/pages.xml</loc></sitemap></sitemapindex>',200,'application/xml'),
 [`${base}/pages.xml`]:response(`${base}/pages.xml`,'<urlset><url><loc>https://www.ifg.gr/eksetaseis/</loc></url></urlset>',200,'application/xml'),
 [`${base}/`]:response(`${base}/`,'<p>Institut français de Grèce.</p>'),
 [`${base}/fr/`]:response(`${base}/fr/`,'<p>Institut français de Grèce.</p>'),
 [`${base}/eksetaseis/`]:response(`${base}/eksetaseis/`,'<h1>Examens</h1><p>Choose an exam.</p><a href="nested/">Details</a>'),
 [`${base}/eksetaseis/nested/`]:response(`${base}/eksetaseis/nested/`,'<p>Dates</p><a href="/wp-content/uploads/calendar.pdf">Calendrier</a>'),
 [`${base}/wp-content/uploads/calendar.pdf`]:response(`${base}/wp-content/uploads/calendar.pdf`,'%PDF-1.7',200,'application/pdf'),...extra};
 return vi.fn(async(url:string)=>{if(!pages[url])throw new Error('Unexpected fixture URL');return pages[url];});
}
describe('bounded discovery and lifecycle',()=>{
 it('follows nested subpages and linked PDF with parent provenance',async()=>{
  const docs=vi.fn();const report=await crawlWebsite({sitemap:`${base}/sitemap.xml`,fetch:fixture(),onDocument:docs,onWithdrawal:vi.fn()});
  expect(report.complete).toBe(true);
  expect(docs.mock.calls.find(([entry])=>entry.url.endsWith('.pdf'))?.[0].parentUrl).toBe(`${base}/eksetaseis/nested/`);
 });
 it('marks capped run partial, never implying unseen sources were removed',async()=>{
  const report=await crawlWebsite({sitemap:`${base}/sitemap.xml`,fetch:fixture(),maxPages:1,onDocument:vi.fn(),onWithdrawal:vi.fn()});
  expect(report.complete).toBe(false);expect(report.withdrawn).toEqual([]);
 });
 it('distinguishes authoritative 404 retirement from transient failure',async()=>{
  const withdrawn=vi.fn();
  const report=await crawlWebsite({sitemap:`${base}/sitemap.xml`,fetch:fixture({[`${base}/eksetaseis/`]:response(`${base}/eksetaseis/`,'Gone',404)}),onDocument:vi.fn(),onWithdrawal:withdrawn});
  expect(withdrawn).toHaveBeenCalledWith(`${base}/eksetaseis/`,'HTTP 404');expect(report.complete).toBe(true);
  const failed=await crawlWebsite({sitemap:`${base}/sitemap.xml`,fetch:fixture({[`${base}/eksetaseis/`]:response(`${base}/eksetaseis/`,'Oops',503)}),onDocument:vi.fn(),onWithdrawal:withdrawn});
  expect(failed.complete).toBe(false);
 });
 it('detects required PDF missing after discovery',async()=>{
  const report=await crawlWebsite({sitemap:`${base}/sitemap.xml`,requiredUrls:[`${base}/missing.pdf`],fetch:fixture({[`${base}/missing.pdf`]:response(`${base}/missing.pdf`,'Gone',404)}),onDocument:vi.fn(),onWithdrawal:vi.fn()});
  expect(report.failures.some(failure=>failure.reason.includes('Required source'))).toBe(true);
 });
 it('quarantines unresolved dynamic content while still discovering its links',async()=>{
  const fetch=fixture({[`${base}/eksetaseis/`]:response(`${base}/eksetaseis/`,'<a role="tab" aria-controls="missing">Next</a><a href="/wp-content/uploads/calendar.pdf">PDF</a>')});
  const report=await crawlWebsite({sitemap:`${base}/sitemap.xml`,fetch,onDocument:vi.fn(),onWithdrawal:vi.fn()});
  expect(report.complete).toBe(false);expect(report.visited).toContain(`${base}/wp-content/uploads/calendar.pdf`);
 });
});
