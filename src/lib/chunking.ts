export interface ChunkOptions { chunkSize?: number; overlap?: number }
export interface StructuredBlock {
  kind: 'paragraph' | 'contact' | 'table_row';
  text: string;
  headingPath: string[];
  page?: number;
  table?: string;
  row?: number;
  tabId?: string;
}
export interface StructuredChunk {
  content: string;
  metadata: {
    heading_path: string[];
    section_heading: string;
    block_kind: StructuredBlock['kind'];
    page?: number;
    table?: string;
    row?: number;
    tab_id?: string;
    chunk_index: number;
  };
}
const count = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;
function settings(options: ChunkOptions) {
  const size = options.chunkSize ?? 400;
  const overlap = options.overlap ?? 50;
  if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(overlap) || overlap < 0 || overlap >= size) {
    throw new Error('chunkSize must be a positive integer and overlap must be smaller than chunkSize');
  }
  return { size, overlap };
}
function pieces(text: string, size: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/u).filter((p) => p.trim())) {
    // Split at whitespace after punctuation: interior dots in emails, URLs,
    // decimal fees and course identifiers are never consumed by the splitter.
    const sentences = count(paragraph) > size ? paragraph.split(/(?<=[.!?;;])\s+/u) : [paragraph];
    for (const sentence of sentences) {
      if (count(sentence) <= size) result.push(sentence.trim());
      else {
        const words = sentence.match(/\S+/gu) ?? [];
        for (let i = 0; i < words.length; i += size) result.push(words.slice(i, i + size).join(' '));
      }
    }
  }
  return result;
}
/** Legacy plain-text API. Structured ingesters use chunkStructuredDocument. */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { size, overlap } = settings(options);
  const result: string[] = [];
  let current: string[] = [];
  let currentSize = 0;
  for (const piece of pieces(text, size)) {
    if (current.length && currentSize + count(piece) > size) {
      result.push(current.join(' '));
      const carry = overlap ? current.join(' ').split(/\s+/u).slice(-overlap) : [];
      current = carry.length ? [carry.join(' ')] : [];
      currentSize = carry.length;
    }
    current.push(piece);
    currentSize += count(piece);
  }
  if (current.length) result.push(current.join(' '));
  return result;
}
/** Never overlaps across section, department, page, table row or tab boundaries.
 * Atomic contact cards and table rows are rejected, never truncated, if oversized.
 * A character budget complements the word budget for Greek/French token expansion. */
export function chunkStructuredDocument(title: string, blocks: StructuredBlock[], options: ChunkOptions = {}): StructuredChunk[] {
  const { size } = settings({ ...options, overlap: options.overlap ?? 0 });
  const result: StructuredChunk[] = [];
  for (const block of blocks) {
    if (!block.text.trim()) continue;
    const path = [title, ...block.headingPath].filter((part, i, all) => part && part !== all[i - 1]);
    const prefix = `${path.join(' > ')}${block.page ? ` | Page ${block.page}` : ''}\n\n`;
    if (prefix.length > 2000) throw new Error('Heading path exceeds the extraction budget');
    const atomic = block.kind !== 'paragraph';
    if (atomic && (count(block.text) > size * 2 || block.text.length > 10000)) throw new Error('Atomic contact/table block exceeds the extraction budget; manual review required');
    const texts = atomic ? [block.text.trim()] : chunkText(block.text, { chunkSize: size, overlap: 0 });
    for (const text of texts) {
      if (text.length > 10000) throw new Error('Text block exceeds character budget; manual review required');
      result.push({
        content: prefix + text,
        metadata: {
          heading_path: path, section_heading: path.join(' > '), block_kind: block.kind,
          ...(block.page ? { page: block.page } : {}), ...(block.table ? { table: block.table } : {}),
          ...(block.row !== undefined ? { row: block.row } : {}), ...(block.tabId ? { tab_id: block.tabId } : {}),
          chunk_index: result.length,
        },
      });
    }
  }
  return result;
}
