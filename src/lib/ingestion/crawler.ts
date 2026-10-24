import * as cheerio from 'cheerio';
import { canonicalUrl, safeFetch, type FetchResult } from './fetch';
import { extractHtml, type ExtractedHtml } from './html';

export interface CrawlEntry { url: string; parentUrl?: string; depth: number; lastmod?: string }
export interface CrawlReport { complete: boolean; failures: { url: string; reason: string }[]; visited: string[]; withdrawn: string[]; excluded: string[] }
interface Options {
  sitemap: string; maxPages?: number; maxDepth?: number; maxSitemaps?: number; requiredUrls?: string[];
  fetch?: (url: string) => Promise<FetchResult>;
  onDocument: (entry: CrawlEntry, result: FetchResult, html?: ExtractedHtml) => Promise<void>;
  onWithdrawal: (url: string, reason: string) => Promise<void>;
}
const excludedSitemap = /(?:category|post_tag|author|event|event_category|event_group|newsletter)-sitemap/i;
const supportedPage = (url: string) => !/\.(?:jpg|jpeg|png|webp|gif|svg|mp4|mp3|css|js|zip|ics|doc|docx|xls|xlsx|xml)$/i.test(new URL(url).pathname);
const excludedPage = (url: string) => /\/(?:news|events|event|newsletter|author|tag|category)\/|\/test[^/]*\/?$|\/wp-(?:json|admin)\//i.test(new URL(url).pathname);
export async function crawlWebsite(options: Options): Promise<CrawlReport> {
  const fetcher = options.fetch ?? safeFetch;
  const report: CrawlReport = { complete: true, failures: [], visited: [], withdrawn: [], excluded: [] };
  const fail = (url: string, reason: string) => { report.complete = false; report.failures.push({ url, reason }); };
  const frontier: CrawlEntry[] = [];
  const discovered = new Set<string>();
  const sitemapSeen = new Set<string>();
  const queue = (raw: string, parentUrl?: string, depth = 0, lastmod?: string) => {
    let url: string;
    try { url = canonicalUrl(raw, parentUrl); } catch { return; }
    if (!supportedPage(url) || discovered.has(url)) return;
    if(discovered.size >= 50000){fail(url,'Discovery count exceeded');return;}
    discovered.add(url);
    if (excludedPage(url)) { report.excluded.push(url); return; }
    if (depth > (options.maxDepth ?? 12)) { fail(url, 'Crawl depth exceeded'); return; }
    frontier.push({ url, parentUrl, depth, lastmod });
  };
  const visitSitemap = async (raw: string): Promise<void> => {
    const url = canonicalUrl(raw);
    if (sitemapSeen.has(url) || excludedSitemap.test(url)) return;
    if (sitemapSeen.size >= (options.maxSitemaps ?? 100)) throw new Error('Sitemap count exceeded');
    sitemapSeen.add(url);
    const response = await fetcher(url);
    if (response.status !== 200 || response.body.length > 5 * 1024 * 1024) throw new Error('Sitemap response invalid');
    const xml = response.body.toString('utf8');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD/entity declarations forbidden');
    const $ = cheerio.load(xml, { xmlMode: true });
    const nested = $('sitemapindex > sitemap > loc').map((_, el) => $(el).text().trim()).get();
    if (nested.length) for (const loc of nested) await visitSitemap(canonicalUrl(loc, url));
    else {
      const urls = $('urlset > url');
      if (!urls.length) throw new Error('Sitemap contains no URLs');
      urls.each((_, el) => {
        if (discovered.size > 50000) throw new Error('Discovery count exceeded');
        queue($(el).children('loc').text().trim(), url, 0, $(el).children('lastmod').text().trim() || undefined);
      });
    }
  };
  // Robots is checked before any page discovery. Unknown/unavailable robots fails closed.
  const disallowed: string[] = [];
  try {
    const robots = await fetcher(new URL('/robots.txt', options.sitemap).toString());
    if (robots.status !== 200 && robots.status !== 404) throw new Error('robots.txt unavailable');
    if (robots.status === 200) {
      let applies = false;
      for (const line of robots.body.toString('utf8').split(/\r?\n/)) {
        const match = /^\s*([^:#]+):\s*([^#]*)/.exec(line);
        if (!match) continue;
        if (match[1].toLowerCase().trim() === 'user-agent') applies = ['*', 'sophieingest', 'sophieingest/2.0'].includes(match[2].trim().toLowerCase());
        if (applies && match[1].toLowerCase().trim() === 'disallow' && match[2].trim()) disallowed.push(match[2].trim());
      }
    }
    await visitSitemap(options.sitemap);
  } catch (error) { fail(options.sitemap, error instanceof Error ? error.message : 'Discovery failed'); return report; }
  queue('https://www.ifg.gr/');
  queue('https://www.ifg.gr/fr/');
  for (const url of options.requiredUrls ?? []) queue(url);
  for (let i = 0; i < frontier.length; i++) {
    const entry = frontier[i];
    if (report.visited.length >= (options.maxPages ?? 5000)) { fail(entry.url, 'Page budget reached; reconciliation disabled'); break; }
    if (disallowed.some((prefix) => {
      const pattern = prefix.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      return new RegExp(`^${pattern.replace(/\\\$$/, '$')}`).test(new URL(entry.url).pathname);
    })) { fail(entry.url, 'Disallowed by robots.txt'); continue; }
    report.visited.push(entry.url);
    try {
      const response = await fetcher(entry.url);
      if (response.status === 404 || response.status === 410) { await options.onWithdrawal(entry.url, `HTTP ${response.status}`); report.withdrawn.push(entry.url); continue; }
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const pdf = response.contentType === 'application/pdf';
      if (pdf) {
        if (response.body.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF magic');
        await options.onDocument(entry, response);
      } else {
        if (!['text/html', 'application/xhtml+xml'].includes(response.contentType)) throw new Error(`Unexpected MIME: ${response.contentType}`);
        const html = extractHtml(response.body.toString('utf8'), response.url);
        // Discover links even if this source is quarantined, so bad extraction does not hide descendants.
        for (const link of html.links) queue(link, entry.url, entry.depth + 1);
        if (html.issues.length) throw new Error(html.issues.join('; '));
        await options.onDocument(entry, response, html);
      }
    } catch (error) { fail(entry.url, error instanceof Error ? error.message : 'Source failed'); }
  }
  const visited = new Set(report.visited.filter((url) => !report.failures.some((failure) => failure.url === url) && !report.withdrawn.includes(url)));
  for (const required of options.requiredUrls ?? []) if (!visited.has(canonicalUrl(required))) fail(required, 'Required source not successfully ingested');
  return report;
}
