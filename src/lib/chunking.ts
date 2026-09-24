export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

const DEFAULT_CHUNK_SIZE = 400;
const DEFAULT_OVERLAP = 50;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function splitIntoSentences(paragraph: string): string[] {
  const matches = paragraph.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [paragraph];
}

function splitLongPieceByWords(piece: string, chunkSize: number): string[] {
  const words = piece.trim().split(/\s+/).filter(Boolean);
  if (words.length <= chunkSize) return [piece];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    out.push(words.slice(i, i + chunkSize).join(' '));
  }
  return out;
}

// Paragraph/sentence-aware chunking: prefers to cut on paragraph boundaries,
// falls back to sentence boundaries for oversized paragraphs, and only falls
// back further to a raw word-count slice for a single run-on sentence that
// alone exceeds chunkSize. This avoids the naive whitespace-only splitter's
// habit of cutting mid-sentence, which hurts retrieval precision -- a chunk
// that starts or ends mid-thought is a worse match for a semantically whole
// question.
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (!text.trim()) return [];

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const units = paragraphs.length > 0 ? paragraphs : [text.trim()];

  const pieces: string[] = [];
  for (const para of units) {
    if (wordCount(para) <= chunkSize) {
      pieces.push(para);
      continue;
    }
    for (const sentence of splitIntoSentences(para)) {
      if (wordCount(sentence) <= chunkSize) {
        pieces.push(sentence);
      } else {
        pieces.push(...splitLongPieceByWords(sentence, chunkSize));
      }
    }
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join(' ').trim());
    }
  };

  for (const piece of pieces) {
    const pieceWords = wordCount(piece);
    if (current.length > 0 && currentWords + pieceWords > chunkSize) {
      flush();
      const prevWords = current.join(' ').split(/\s+/);
      const overlapWords = prevWords.slice(Math.max(0, prevWords.length - overlap));
      current = overlapWords.length > 0 ? [overlapWords.join(' ')] : [];
      currentWords = overlapWords.length;
    }
    current.push(piece);
    currentWords += pieceWords;
  }
  flush();

  return chunks.filter((c) => c.length > 0);
}
