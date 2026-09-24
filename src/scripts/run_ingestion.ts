import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import * as mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

import { pool } from '../lib/db';
import { chunkText } from '../lib/chunking';
import { mapUrlToSection } from '../lib/sectionMapping';
import { embedText } from '../lib/gemini';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Proactive delay between embedding calls to stay within free-tier Gemini
// rate limits; embedText() also retries transient 429s on top of this.
const EMBED_DELAY_MS = 4500;

const DEFAULT_SITEMAP_INDEX = 'https://www.ifg.gr/sitemap_index.xml';

// Confirmed live via robots.txt (Sitemap: https://www.ifg.gr/sitemap_index.xml)
// and inspection of its nested sitemaps. Excluded categories:
// - category-/post_tag-/author-sitemap: thin, auto-generated taxonomy archive
//   pages (lists of links, no unique content worth embedding).
// - event-/event_category-/event_group-/newsletter-sitemap: high-volume
//   (750-1000+ URLs each) and time-sensitive; including them risks surfacing
//   expired event dates/newsletter content as current, and would burn a large
//   share of the free-tier embedding quota on lower-value content. Revisit if
//   event- or newsletter-specific Q&A becomes a product priority.
const EXCLUDED_SITEMAP_PATTERNS = [
  /category-sitemap/i,
  /post_tag-sitemap/i,
  /author-sitemap/i,
  /event-sitemap/i,
  /event_category-sitemap/i,
  /event_group-sitemap/i,
  /newsletter-sitemap/i,
];

// /news/ posts are time-sensitive (announcements, exam result posts, etc.);
// skip ones older than this so stale announcements don't get treated as
// current fact. Configurable since "how far back is relevant" is a judgment
// call that may need tuning after seeing real ingested content.
const TIME_SENSITIVE_PATH_PREFIXES = ['/news/'];
const NEWS_MAX_AGE_DAYS = Number(process.env.NEWS_MAX_AGE_DAYS ?? 365);

// Confirmed via live fetch: these are empty admin scratch/test pages (e.g.
// /test-xyz/ contains nothing but its own title) that ended up in
// page-sitemap.xml. They add near-zero value and occasionally surface as a
// weak-signal match when nothing else scores well. Skip any URL whose last
// path segment starts with "test".
const JUNK_PATH_PATTERN = /\/test[^/]*\/?$/i;

interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
}

async function fetchSitemapEntries(sitemapUrl: string, limit?: number): Promise<SitemapUrlEntry[]> {
  const res = await fetch(sitemapUrl);
  const xml = await res.text();

  if (/<sitemapindex/i.test(xml)) {
    const nestedLocs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    let entries: SitemapUrlEntry[] = [];
    for (const nested of nestedLocs) {
      if (EXCLUDED_SITEMAP_PATTERNS.some((pattern) => pattern.test(nested))) {
        console.log(`  Skipping sitemap (excluded category): ${nested}`);
        continue;
      }
      const remaining = limit ? limit - entries.length : undefined;
      if (remaining !== undefined && remaining <= 0) break;
      entries = entries.concat(await fetchSitemapEntries(nested, remaining));
    }
    return entries;
  }

  const urlBlocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  const entries: SitemapUrlEntry[] = [];
  const seen = new Set<string>();
  for (const block of urlBlocks) {
    const locMatch = /<loc>(.*?)<\/loc>/.exec(block[1]);
    if (!locMatch) continue;
    const loc = locMatch[1].trim();
    if (seen.has(loc)) continue; // Yoast sitemaps sometimes list duplicate entries
    seen.add(loc);
    const lastmodMatch = /<lastmod>(.*?)<\/lastmod>/.exec(block[1]);
    entries.push({ loc, lastmod: lastmodMatch?.[1] });
    if (limit && entries.length >= limit) break;
  }
  return entries;
}

function isStaleTimeSensitivePage(entry: SitemapUrlEntry): boolean {
  let pathname: string;
  try {
    pathname = new URL(entry.loc).pathname;
  } catch {
    return false;
  }
  const isTimeSensitive = TIME_SENSITIVE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isTimeSensitive || !entry.lastmod) return false;
  const ageDays = (Date.now() - new Date(entry.lastmod).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > NEWS_MAX_AGE_DAYS;
}

// Cloudflare's email-obfuscation ("Email Protection") replaces mailto links
// with a JS-decoded span; since we don't execute JS, cheerio sees the raw
// fallback text literally reading "[email protected]" -- confirmed present on
// several real ifg.gr pages (e.g. /oi-choroi-mas/) and, before this fix, was
// faithfully repeated by the model as if it were a real email in at least
// one live test answer. Strip it rather than ingest it as content.
const CLOUDFLARE_EMAIL_PLACEHOLDER = /\[email\s*protected\]/gi;

// Joins block-level element text with paragraph breaks instead of calling
// $('body').text() directly, which just concatenates every text node with
// whatever whitespace happened to be in the source HTML. Preserving real
// paragraph boundaries lets chunkText()'s paragraph-aware splitting actually
// do its job on scraped pages instead of degrading to one giant blob.
function extractBodyText($: cheerio.CheerioAPI): string {
  const blocks: string[] = [];
  $('body')
    .find('h1, h2, h3, h4, h5, h6, p, li, td, blockquote')
    .each((_, el) => {
      const text = $(el)
        .text()
        .replace(CLOUDFLARE_EMAIL_PLACEHOLDER, '')
        .replace(/[ \t]+/g, ' ')
        .trim();
      if (text) blocks.push(text);
    });
  if (blocks.length > 0) return blocks.join('\n\n');
  return $('body').text().replace(CLOUDFLARE_EMAIL_PLACEHOLDER, '').replace(/\s+/g, ' ').trim();
}

async function upsertDocumentChunks(
  sourceName: string,
  sourceType: string,
  chunks: string[],
  metadataBase: Record<string, unknown>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM documents WHERE source_name = $1', [sourceName]);
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embedText(chunks[i]);
      await client.query(
        'INSERT INTO documents (content, embedding, source_type, source_name, metadata) VALUES ($1, $2, $3, $4, $5)',
        [chunks[i], JSON.stringify(embedding), sourceType, sourceName, { ...metadataBase, chunk_index: i }],
      );
      await sleep(EMBED_DELAY_MS);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function ingestWebsitePage(entry: SitemapUrlEntry): Promise<void> {
  const url = entry.loc;
  try {
    const pageRes = await fetch(url);
    if (!pageRes.ok) {
      console.log(`  ✗ ${url} -> HTTP ${pageRes.status}, skipping`);
      return;
    }
    const html = await pageRes.text();
    const $ = cheerio.load(html);
    $('nav, header, footer, script, style, noscript, iframe').remove();

    const title = $('title').text().trim() || url;
    const mainText = extractBodyText($);
    if (!mainText) {
      console.log(`  ✗ ${url} -> no text content, skipping`);
      return;
    }

    const section = mapUrlToSection(url);
    const chunks = chunkText(mainText);
    await upsertDocumentChunks(url, 'website', chunks, {
      page_title: title,
      ...(section ? { section } : {}),
    });
    console.log(`  ✓ ${url} -> ${chunks.length} chunk(s)${section ? ` [${section}]` : ' [unmapped]'}`);
  } catch (err) {
    console.error(`  ✗ Failed to process ${url}:`, err);
  }
}

async function ingestWebsite(sitemapIndexUrl: string, limit?: number): Promise<void> {
  console.log(`Fetching sitemap: ${sitemapIndexUrl}`);
  const entries = await fetchSitemapEntries(sitemapIndexUrl, limit);
  console.log(`Found ${entries.length} candidate URL(s) after excluding thin/time-sensitive sitemap categories.`);

  let processed = 0;
  for (const entry of entries) {
    if (isStaleTimeSensitivePage(entry)) {
      console.log(`  Skipping stale news/blog page (older than ${NEWS_MAX_AGE_DAYS}d): ${entry.loc}`);
      continue;
    }
    if (JUNK_PATH_PATTERN.test(entry.loc)) {
      console.log(`  Skipping junk/test page: ${entry.loc}`);
      continue;
    }
    await ingestWebsitePage(entry);
    processed++;
    if (limit && processed >= limit) break;
  }
}

async function ingestPDFs(directoryPath: string): Promise<void> {
  if (!fs.existsSync(directoryPath)) return;
  console.log(`Reading PDFs from ${directoryPath}...`);
  const files = fs.readdirSync(directoryPath).filter((f) => f.toLowerCase().endsWith('.pdf'));
  for (const file of files) {
    console.log(`  Processing PDF: ${file}`);
    try {
      const filePath = path.join(directoryPath, file);
      const dataBuffer = fs.readFileSync(filePath);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(dataBuffer);
      const text: string = data.text.trim();
      const chunks = chunkText(text);
      await upsertDocumentChunks(file, 'pdf', chunks, { document_title: file.replace(/\.pdf$/i, '') });
      console.log(`  ✓ ${file} -> ${chunks.length} chunk(s)`);
    } catch (err) {
      console.error(`  ✗ Failed to process PDF ${file}:`, err);
    }
  }
}

async function ingestDocx(directoryPath: string): Promise<void> {
  if (!fs.existsSync(directoryPath)) return;
  console.log(`Reading DOCX from ${directoryPath}...`);
  const files = fs.readdirSync(directoryPath).filter((f) => f.toLowerCase().endsWith('.docx'));
  for (const file of files) {
    console.log(`  Processing DOCX: ${file}`);
    try {
      const filePath = path.join(directoryPath, file);
      const result = await mammoth.extractRawText({ path: filePath });
      const chunks = chunkText(result.value.trim());
      await upsertDocumentChunks(file, 'docx', chunks, { document_title: file.replace(/\.docx$/i, '') });
      console.log(`  ✓ ${file} -> ${chunks.length} chunk(s)`);
    } catch (err) {
      console.error(`  ✗ Failed to process DOCX ${file}:`, err);
    }
  }
}

async function ingestXlsx(directoryPath: string): Promise<void> {
  if (!fs.existsSync(directoryPath)) return;
  console.log(`Reading XLSX from ${directoryPath}...`);
  const files = fs.readdirSync(directoryPath).filter((f) => f.toLowerCase().endsWith('.xlsx'));
  for (const file of files) {
    console.log(`  Processing XLSX: ${file}`);
    try {
      const filePath = path.join(directoryPath, file);
      const workbook = xlsx.readFile(filePath);
      const sections = workbook.SheetNames.map((sheetName) => {
        const csv = xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        return `Sheet: ${sheetName}\n${csv}`;
      });
      const chunks = chunkText(sections.join('\n\n'));
      await upsertDocumentChunks(file, 'xlsx', chunks, { document_title: file.replace(/\.xlsx$/i, '') });
      console.log(`  ✓ ${file} -> ${chunks.length} chunk(s)`);
    } catch (err) {
      console.error(`  ✗ Failed to process XLSX ${file}:`, err);
    }
  }
}

async function ingestMd(directoryPath: string): Promise<void> {
  if (!fs.existsSync(directoryPath)) return;
  console.log(`Reading Markdown from ${directoryPath}...`);
  const files = fs.readdirSync(directoryPath).filter((f) => f.toLowerCase().endsWith('.md'));
  for (const file of files) {
    console.log(`  Processing MD: ${file}`);
    try {
      const filePath = path.join(directoryPath, file);
      const text = fs.readFileSync(filePath, 'utf8').trim();
      const chunks = chunkText(text);
      await upsertDocumentChunks(file, 'md', chunks, { document_title: file.replace(/\.md$/i, '') });
      console.log(`  ✓ ${file} -> ${chunks.length} chunk(s)`);
    } catch (err) {
      console.error(`  ✗ Failed to process MD ${file}:`, err);
    }
  }
}

async function main() {
  console.log('Starting ingestion pipeline...');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  const dataDir = args[0] || path.resolve(process.cwd(), 'datasets');
  const sitemapIndexUrl = args[1] || DEFAULT_SITEMAP_INDEX;

  // File-based ingestion (local datasets/ directory).
  // ingestPDFs kept disabled by default: pdf-parse's require/export shape
  // needs verification against the installed version before enabling in
  // production ingestion runs. DOCX/XLSX/MD cover the current dataset.
  // await ingestPDFs(dataDir);
  await ingestDocx(dataDir);
  await ingestXlsx(dataDir);
  await ingestMd(dataDir);

  // Full-site hybrid crawl: sitemap-driven for coverage, URL-pattern section
  // tagging for the widget's category filter pills (src/lib/sectionMapping.ts).
  // Pass --limit=N to cap total pages processed (useful for a smoke test
  // before burning free-tier embedding quota on a full run).
  await ingestWebsite(sitemapIndexUrl, limit);

  console.log('\n✓ Ingestion complete!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
