import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractHtml, extractMarkdown, containsContact } from './html';
import type { StructuredBlock } from '../chunking';
import type { ParsedDocument, DocumentFormat } from './types';

export const PARSER_VERSION = 'structured-v2.1';
export function validateArchive(data: Buffer): void {
  // Validate central-directory decompression budgets before handing OOXML to a parser.
  const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < Math.max(0, data.length - 65557) || eocd + 22 > data.length) throw new Error('Invalid ZIP directory');
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  if (!count || count > 5000 || count === 0xffff || offset === 0xffffffff) throw new Error('Unsupported or oversized ZIP archive');
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const flags = data.readUInt16LE(offset + 8);
    const compressed = data.readUInt32LE(offset + 20);
    const uncompressed = data.readUInt32LE(offset + 24);
    const nameSize = data.readUInt16LE(offset + 28);
    const extraSize = data.readUInt16LE(offset + 30);
    const commentSize = data.readUInt16LE(offset + 32);
    if (offset + 46 + nameSize + extraSize + commentSize > eocd) throw new Error('ZIP directory is truncated');
    const name = data.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    if (flags & 1 || /(^|[/\\])\.\.([/\\]|$)|^[\\/]|^[a-z]:|vbaProject\.bin$/i.test(name)) throw new Error('Encrypted, path-traversing or macro archive forbidden');
    expanded += uncompressed;
    if (uncompressed > 16 * 1024 * 1024 || expanded > 64 * 1024 * 1024 || uncompressed / Math.max(1, compressed) > 200) throw new Error('Archive decompression budget exceeded');
    offset += 46 + nameSize + extraSize + commentSize;
  }
}
interface PdfOutput { title: string; pages: { num: number; text: string }[]; tables: { num: number; tables: string[][][] }[] }
interface DocxOutput { html: string; warnings: string[] }
interface WorkbookOutput { sheets: { name: string; rows: { index: number; cells: { column: number; text: string; merged: boolean; master: string | null }[] }[] }[] }
export interface OcrPage { page: number; text: string; confidence: number }
export interface ParseOptions {
  title?: string;
  /** Deployment-provided sandboxed Greek/French OCR. Confidence below 0.95 stays quarantined. */
  ocr?: (bytes: Buffer, pages: number[], languages: readonly ['ell', 'fra']) => Promise<OcrPage[]>;
  worker?: (bytes: Buffer, format: Exclude<DocumentFormat, 'md'>) => Promise<unknown>;
}
export async function runParserWorker(bytes: Buffer, format: Exclude<DocumentFormat, 'md'>): Promise<unknown> {
  const worker = fileURLToPath(new URL('./parser-worker.mjs', import.meta.url));
  const modules = path.resolve(path.dirname(worker), '../../../node_modules');
  const image=process.env.PARSER_CONTAINER_IMAGE;
  if(process.env.NODE_ENV==='production'&&!image) throw new Error('Production document parsing requires the isolated parser container');
  if(image&&!/^(?:[a-zA-Z0-9._:/-]+@)?sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Parser container must use a pinned image digest');
  const runtime=process.env.CONTAINER_RUNTIME_PATH||'/usr/bin/docker';
  if(image&&!path.isAbsolute(runtime))throw new Error('Container runtime path must be absolute');
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(!image&&(major<25||(major===25&&minor<8)))throw new Error('Local parsing requires Node 25.8+');
  const containerName=`sophie-parser-${randomUUID()}`;
  const permissionArgs=['--permission','--allow-addons','--allow-worker','--max-old-space-size=384'];
  const args=image?['run','--rm','-i','--name',containerName,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
    '--memory=512m','--cpus=1','--pids-limit=64','--user=10001:10001','--tmpfs=/tmp:rw,noexec,nosuid,size=64m',
    '--entrypoint=node',image,...permissionArgs,'--allow-fs-read=/opt/parser/parser-worker.mjs','--allow-fs-read=/opt/parser/node_modules','/opt/parser/parser-worker.mjs']
    :[...permissionArgs,`--allow-fs-read=${worker}`,`--allow-fs-read=${modules}`,worker];
  return new Promise((resolve, reject) => {
    const child = spawn(image?runtime:process.execPath, args, {
      env: { LANG: 'C.UTF-8', NODE_ENV: 'production' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stop=()=>{
      child.kill('SIGKILL');
      if(image){const cleanup=spawn(runtime,['rm','-f',containerName],{env:{LANG:'C.UTF-8',NODE_ENV:'production'},stdio:'ignore'});cleanup.on('error',()=>undefined);}
    };
    const timer = setTimeout(() => { stop(); reject(new Error('Document parser deadline exceeded')); }, 60000);
    const stdout: Buffer[] = [];
    let bytesOut = 0;
    child.stdout.on('data', (part: Buffer) => {
      bytesOut += part.length;
      if (bytesOut > 12 * 1024 * 1024) { stop(); reject(new Error('Parser output budget exceeded')); return; }
      stdout.push(part);
    });
    // Do not persist parser stderr: malformed files can echo private document text.
    child.stderr.resume();
    child.stdin.on('error', () => undefined);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error('Isolated parser failed; source requires review')); return; }
      try { resolve(JSON.parse(Buffer.concat(stdout).toString('utf8'))); } catch { reject(new Error('Invalid parser output')); }
    });
    child.stdin.end(JSON.stringify({ format, data: bytes.toString('base64') }));
  });
}
export function pdfQualityIssues(pages: { num: number; text: string }[]): string[] {
  if (!pages.length) return ['PDF has no pages'];
  return pages.flatMap((page) => {
    const text = page.text.trim();
    const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    const corruption = text.match(/\ufffd/gu)?.length ?? 0;
    return letters < 40 || text.split(/\s+/u).length < 8 || corruption / Math.max(text.length, 1) > 0.01 ? [`Page ${page.num} failed text quality; OCR/manual review required`] : [];
  });
}
export async function parseDocument(bytes: Buffer, format: DocumentFormat, options: ParseOptions = {}): Promise<ParsedDocument> {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Document byte limit exceeded');
  const title = options.title ?? 'Document';
  if (format === 'md') return extractMarkdown(bytes.toString('utf8'), title);
  if (format === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF signature');
  if (format === 'docx' || format === 'xlsx') validateArchive(bytes);
  const output = await (options.worker ?? runParserWorker)(bytes, format);
  if (format === 'docx') {
    const data = output as DocxOutput;
    const document = extractHtml(data.html, title);
    return { title, blocks: document.blocks, issues: [...document.issues, ...(data.warnings.includes('error') ? ['DOCX parser error'] : [])] };
  }
  if (format === 'xlsx') {
    const data = output as WorkbookOutput;
    const blocks: StructuredBlock[] = [];
    for (const sheet of data.sheets) {
      // Preserve literal row values and coordinates; no guessed "first row = headers".
      // The first five nonempty rows repeat as context for title/multirow headers.
      const context = sheet.rows.slice(0, 5).map((row) => `Row ${row.index}: ${row.cells.map((cell) => `[${cell.column}] ${cell.text}`).join(' | ')}`).join('\n');
      for (const row of sheet.rows) blocks.push({ kind: 'table_row', headingPath: [sheet.name], table: sheet.name, row: row.index,
        text: `Sheet context (rows ${sheet.rows.slice(0, 5).map((item) => item.index).join(', ')}):\n${context}\n\nRow ${row.index}: ${row.cells.map((cell) => `Column ${cell.column}${cell.merged ? ` (merged from ${cell.master})` : ''}: ${cell.text}`).join(' | ')}` });
    }
    return { title, blocks, issues: blocks.length ? [] : ['Workbook contains no visible values'] };
  }
  const pdf = output as PdfOutput;
  let issues = pdfQualityIssues(pdf.pages);
  const ocrUsed = new Set<number>();
  if (issues.length && options.ocr) {
    const weak = pdf.pages.filter((page) => pdfQualityIssues([page]).length).map((page) => page.num);
    const replacements = await options.ocr(bytes, weak, ['ell', 'fra']);
    for (const result of replacements) {
      const page = pdf.pages.find((candidate) => candidate.num === result.page && weak.includes(result.page));
      if (page && result.confidence >= 0.95 && result.confidence <= 1) { page.text = result.text; ocrUsed.add(page.num); }
    }
    issues = pdfQualityIssues(pdf.pages);
    // OCR reading order and exact critical digits need human verification even with good confidence.
    if (ocrUsed.size) issues.push('OCR output requires human verification before publication');
  }
  const blocks: StructuredBlock[] = [];
  for (const page of pdf.pages) {
    const tables = pdf.tables.find((entry) => entry.num === page.num)?.tables ?? [];
    for (const [index, rows] of tables.entries()) {
      const headerContext = rows.slice(0, 2).map((row) => row.join(' | ')).join('\n');
      for (const [rowIndex, row] of rows.entries()) blocks.push({ kind: 'table_row', headingPath: [], page: page.num, table: `page-${page.num}-table-${index + 1}`, row: rowIndex + 1,
        text: `Table top rows (verify headers):\n${headerContext}\nRow ${rowIndex + 1}: ${row.map((cell, column) => `Column ${column + 1}: ${cell}`).join(' | ')}` });
    }
    // Keep page reading-order text with explicit page provenance; multi-column text
    // not recognized as a table is quarantined instead of silently trusted.
    if (!tables.length && page.text.split('\n').filter((line) => /\S\t+\S/.test(line)).length >= 3) issues.push(`Page ${page.num} has unresolved columns/table layout`);
    const extracted = extractMarkdown(page.text, title);
    for (const block of extracted.blocks) blocks.push({ ...block, kind: containsContact(block.text) ? 'contact' : block.kind, page: page.num });
  }
  return { title: pdf.title || title, blocks, issues: [...new Set(issues)] };
}
