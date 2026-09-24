import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

import { query } from '@/lib/db';
import { searchDocuments, buildContextBlock, toSources } from './retrieval';

const mockedQuery = vi.mocked(query);

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'id-1',
    content: 'Some content',
    source_type: 'website',
    source_name: 'https://www.ifg.gr/example/',
    metadata: {},
    similarity: 0.7,
    ...overrides,
  };
}

describe('searchDocuments', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('builds an unfiltered query when no section is given', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [row()] } as never);
    await searchDocuments([0.1, 0.2], {});
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).not.toContain("metadata->>'section'");
    expect(params).toEqual([JSON.stringify([0.1, 0.2]), 20]);
  });

  it('builds a section-filtered query when section is given and not "all"', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [row()] } as never);
    await searchDocuments([0.1, 0.2], { section: 'mathimata' });
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain("metadata->>'section' = $2");
    expect(params).toEqual([JSON.stringify([0.1, 0.2]), 'mathimata', 20]);
  });

  it('treats section "all" the same as no section', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [row()] } as never);
    await searchDocuments([0.1, 0.2], { section: 'all' });
    const [sql] = mockedQuery.mock.calls[0];
    expect(sql).not.toContain("metadata->>'section'");
  });

  it('filters out rows below the similarity threshold', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [row({ id: 'a', similarity: 0.8 }), row({ id: 'b', similarity: 0.4 })],
    } as never);
    const result = await searchDocuments([0.1], { minSimilarity: 0.55 });
    expect(result.documents.map((d) => d.id)).toEqual(['a']);
    expect(result.hadSufficientContext).toBe(true);
  });

  it('reports hadSufficientContext=false when nothing clears the threshold', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [row({ similarity: 0.3 })],
    } as never);
    const result = await searchDocuments([0.1], { minSimilarity: 0.55 });
    expect(result.documents).toEqual([]);
    expect(result.hadSufficientContext).toBe(false);
  });

  it('caps results at finalLimit after filtering', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: Array.from({ length: 10 }, (_, i) => row({ id: `id-${i}`, similarity: 0.9 })),
    } as never);
    const result = await searchDocuments([0.1], { finalLimit: 3, minSimilarity: 0.5 });
    expect(result.documents).toHaveLength(3);
  });

  it('parses metadata that comes back as a JSON string', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [row({ metadata: JSON.stringify({ section_heading: 'Pricing' }) })],
    } as never);
    const result = await searchDocuments([0.1], { minSimilarity: 0.5 });
    expect(result.documents[0].metadata).toEqual({ section_heading: 'Pricing' });
  });
});

describe('buildContextBlock', () => {
  it('returns the no-context marker for an empty list', () => {
    expect(buildContextBlock([])).toBe('No relevant context found.');
  });

  it('includes source name and content for each document', () => {
    const block = buildContextBlock([
      { id: '1', content: 'Course prices are listed here.', sourceType: 'website', sourceName: 'https://www.ifg.gr/x/', metadata: {}, similarity: 0.7 },
    ]);
    expect(block).toContain('https://www.ifg.gr/x/');
    expect(block).toContain('Course prices are listed here.');
  });
});

describe('toSources', () => {
  it('deduplicates by source_name', () => {
    const docs = [
      { id: '1', content: 'a', sourceType: 'website', sourceName: 'https://www.ifg.gr/x/', metadata: {}, similarity: 0.7 },
      { id: '2', content: 'b', sourceType: 'website', sourceName: 'https://www.ifg.gr/x/', metadata: {}, similarity: 0.6 },
    ];
    expect(toSources(docs)).toHaveLength(1);
  });

  it('includes a url only for website sources with an http(s) source_name', () => {
    const docs = [
      { id: '1', content: 'a', sourceType: 'website', sourceName: 'https://www.ifg.gr/x/', metadata: {}, similarity: 0.7 },
      { id: '2', content: 'b', sourceType: 'docx', sourceName: 'Policies.docx', metadata: {}, similarity: 0.6 },
    ];
    const sources = toSources(docs);
    expect(sources[0].url).toBe('https://www.ifg.gr/x/');
    expect(sources[1].url).toBeUndefined();
  });
});
