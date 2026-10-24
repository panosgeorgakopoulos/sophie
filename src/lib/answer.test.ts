import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), query: vi.fn() }));
vi.mock('./db', () => ({ queryPublic: mocks.query }));
vi.mock('./gemini', () => ({ generateFactSelection: mocks.generate }));
import { answerFromApprovedFacts, validateFactSelection } from './answer';
import { validateApprovedFact, type FactResolution } from './facts';
const row = {
  id: '11111111-1111-4111-8111-111111111111', source_id: '22222222-2222-4222-8222-222222222222', version_id: '33333333-3333-4333-8333-333333333333', evidence_chunk_id: '44444444-4444-4444-8444-444444444444', department_id: 'library', subject_key: 'library', subject_label: 'Library', subject_aliases: ['library'], qualifiers: {}, field: 'policy', value: 'Bring your membership card.', language: 'en', evidence_quote: 'Bring your membership card.', evidence_content: 'Bring your membership card.', source_name: 'https://www.ifg.gr/library/', source_type: 'website', effective_from: null, expires_at: '2099-01-01', approval_status: 'approved', audience: 'public',
};
const fact = validateApprovedFact(row)!;
const resolution: FactResolution = { status: 'ready', fields: ['policy'], facts: [fact], scope: { subjectKey: 'library', subjectLabel: 'Library', departmentId: 'library', qualifiers: {} } };
beforeEach(() => { mocks.generate.mockReset(); mocks.query.mockReset(); });
describe('fact-only answer rendering', () => {
  it.each(['Call 555-0100', '{"fact_ids":[],"answer":"555-0100"}', '{"fact_ids":["99999999-9999-4999-8999-999999999999"]}', `{"fact_ids":["${fact.id}","${fact.id}"]}`])('rejects prose, injected fields, unknown IDs and duplicate IDs', raw => expect(validateFactSelection(raw, [fact])).toBeNull());
  it('ignores model-invented phone data and returns no borrowed citations', async () => {
    mocks.generate.mockResolvedValue('{"fact_ids":[],"answer":"The exam number is 555-0100"}');
    const answer = await answerFromApprovedFacts('Library rules?', resolution, 'en');
    expect(answer.outcome).toBe('invalid_selection');
    expect(answer.reply).not.toContain('555-0100');
    expect(answer.sources).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('renders only exact approved values and precise evidence, redacting identifiers before the provider', async () => {
    mocks.generate.mockResolvedValue(JSON.stringify({ fact_ids: [fact.id] })); mocks.query.mockResolvedValue({ rows: [row] });
    const answer = await answerFromApprovedFacts('Library rules? Send to me@example.invalid', resolution, 'en');
    expect(answer.reply).toBe('Approved information\n\nLibrary\nInformation: Bring your membership card.');
    expect(answer.sources[0]).toMatchObject({ fact_id: fact.id, version_id: fact.version_id, evidence_chunk_id: fact.evidence_chunk_id });
    expect(JSON.stringify(mocks.generate.mock.calls)).not.toContain('me@example.invalid');
  });
  it('abstains if a fact is withdrawn during model selection', async () => {
    mocks.generate.mockResolvedValue(JSON.stringify({ fact_ids: [fact.id] })); mocks.query.mockResolvedValue({ rows: [] });
    expect((await answerFromApprovedFacts('Library rules?', resolution, 'en')).outcome).toBe('unavailable');
  });
  it('answers direct institutional fields without giving the model any opportunity to change values', async () => {
    const phoneRow = { ...row, field: 'phone', value: '+30 210 0000000', evidence_quote: '+30 210 0000000', evidence_content: '+30 210 0000000' };
    const phone = validateApprovedFact(phoneRow)!; mocks.query.mockResolvedValue({ rows: [phoneRow] });
    const answer = await answerFromApprovedFacts('Library phone?', { ...resolution, fields: ['phone'], facts: [phone] }, 'el');
    expect(mocks.generate).not.toHaveBeenCalled(); expect(answer.reply).toContain('Τηλέφωνο: +30 210 0000000');
  });
});
