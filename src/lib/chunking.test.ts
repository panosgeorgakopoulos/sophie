import { describe, it, expect } from 'vitest';
import { chunkText } from './chunking';

describe('chunkText', () => {
  it('returns an empty array for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const text = 'This is a short paragraph about French courses.';
    const chunks = chunkText(text, { chunkSize: 400, overlap: 50 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('French courses');
  });

  it('does not exceed chunkSize words per chunk (ignoring overlap carry-over)', () => {
    const paragraph = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(paragraph, { chunkSize: 100, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const wordCount = chunk.trim().split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(110); // chunkSize + overlap carry-over
    }
  });

  it('prefers paragraph boundaries over mid-sentence cuts', () => {
    const paraA = 'Alpha sentence one. Alpha sentence two. Alpha sentence three.';
    const paraB = 'Beta sentence one. Beta sentence two. Beta sentence three.';
    const text = `${paraA}\n\n${paraB}`;
    // chunkSize large enough that both paragraphs fit in one chunk together
    const chunks = chunkText(text, { chunkSize: 400, overlap: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('Alpha sentence three');
    expect(chunks[0]).toContain('Beta sentence one');
  });

  it('splits an oversized single paragraph on sentence boundaries, not mid-sentence', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `This is sentence number ${i} in a long paragraph.`);
    const text = sentences.join(' ');
    const chunks = chunkText(text, { chunkSize: 50, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should end on a sentence boundary (a period), not a fragment.
    for (const chunk of chunks) {
      expect(chunk.trim().endsWith('.')).toBe(true);
    }
  });

  it('falls back to word-count slicing for a single run-on sentence with no punctuation', () => {
    const words = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkText(words, { chunkSize: 100, overlap: 0 });
    expect(chunks.length).toBe(3);
  });

  it('carries overlap words into the next chunk', () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkText(words, { chunkSize: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const firstChunkWords = chunks[0].split(/\s+/);
    const secondChunkWords = chunks[1].split(/\s+/);
    const overlapCandidate = firstChunkWords.slice(-20);
    expect(secondChunkWords.slice(0, overlapCandidate.length)).toEqual(overlapCandidate);
  });
});

import { chunkStructuredDocument } from './chunking';

describe('structured ingestion regression gates', () => {
  it('preserves every token around interior dots, Greek punctuation and contact labels', () => {
    const tokens = [...Array.from({length:420},(_,i)=>`λέξη${i}`), 'Contact:', 'library@example.invalid', 'https://ifg.gr/fr/examens/', '12.50€', 'DELF.B2'];
    const actual=chunkText(tokens.join(' '),{chunkSize:100,overlap:0}).join(' ').split(/\s+/);
    expect(actual).toEqual(tokens);
  });
  it('never mixes departments and repeats the governing heading for atomic contacts', () => {
    const chunks=chunkStructuredDocument('Institut',[{kind:'paragraph',headingPath:['Examens'],text:Array(800).fill('exam').join(' ')},
      {kind:'contact',headingPath:['Examens'],text:'Contact: examens@example.invalid'},
      {kind:'contact',headingPath:['Médiathèque'],text:'Contact: library@example.invalid'}]);
    const exam=chunks.find(chunk=>chunk.content.includes('examens@'))!;
    const library=chunks.find(chunk=>chunk.content.includes('library@'))!;
    expect(exam.content).toContain('Institut > Examens');
    expect(library.content).toContain('Institut > Médiathèque');
    expect(library.content).not.toContain('examens@');
  });
  it('rejects oversized atomic rows rather than dropping attribution', () => {
    expect(()=>chunkStructuredDocument('T',[{kind:'table_row',headingPath:['Fees'],text:Array(801).fill('word').join(' ')}])).toThrow('Atomic');
  });
  it.each([{chunkSize:0},{chunkSize:100,overlap:100},{overlap:-1}])('rejects unsafe chunk configuration %j',options=>{
    expect(()=>chunkText('text',options)).toThrow();
  });
});
