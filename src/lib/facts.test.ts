import { describe, it, expect, vi, beforeEach } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('./db', () => ({ queryPublic: query }));
import { resolveApprovedFacts, validateApprovedFact, resolveSubject, requestedFields, revalidateApprovedFacts } from './facts';

export const factFixture = {
  id: '11111111-1111-4111-8111-111111111111', source_id: '22222222-2222-4222-8222-222222222222', version_id: '33333333-3333-4333-8333-333333333333', evidence_chunk_id: '44444444-4444-4444-8444-444444444444',
  department_id: 'library', subject_key: 'library', subject_label: 'Médiathèque', subject_aliases: ['library', 'médiathèque', 'βιβλιοθήκη'], qualifiers: {}, field: 'email', value: 'library@example.invalid', language: 'fr',
  evidence_quote: 'Médiathèque: library@example.invalid', evidence_content: 'Médiathèque: library@example.invalid', source_name: 'https://www.ifg.gr/library/', source_type: 'website', effective_from: null, expires_at: '2099-01-01T00:00:00Z', approval_status: 'approved', audience: 'public',
};
const subjects = [factFixture, { ...factFixture, subject_key: 'exams', department_id: 'exams', subject_aliases: ['exams', 'examens', 'εξετάσεις'] }];
const prior = { subjectKey: 'library', departmentId: 'library', section: 'all', language: 'fr' as const };
beforeEach(() => query.mockReset());

describe('approved fact boundary', () => {
  it('requires an exact current value and quote; rejects expired and malformed facts', () => {
    expect(validateApprovedFact(factFixture)).not.toBeNull();
    for (const patch of [{ value: 'exam@example.invalid' }, { evidence_content: 'Missing quote' }, { expires_at: '2000-01-01' }, { effective_from: '2098-01-01' }, { approval_status: 'pending' }, { audience: 'staff' }, { qualifiers: { audience: ['adult'] } }]) expect(validateApprovedFact({ ...factFixture, ...patch })).toBeNull();
  });
  it.each(['Library email', 'courriel de la MÉDIATHÈQUE', 'email της βιβλιοθήκης'])('resolves explicit accented multilingual subjects: %s', text => {
    // Greek inflection requires an explicitly approved alias, never stemming
    // that could turn similar department names into the same identity.
    const aliases = subjects.map(item => ({ ...item, subject_aliases: [...item.subject_aliases, ...(item.department_id === 'library' ? ['βιβλιοθήκης'] : [])] }));
    expect(resolveSubject(text, aliases, {})).toMatchObject({ department_id: 'library' });
  });
  it('rejects cross-department ambiguity and unrelated followup', () => {
    expect(resolveSubject('library and exams phone', subjects, prior)).toBe('ambiguous');
    expect(resolveSubject('contact the consulate', subjects, prior)).toBeNull();
    expect(resolveSubject('and the consulate email', subjects, prior)).toBeNull();
    expect(resolveSubject('Et son numéro ?', subjects, prior)).toMatchObject({ department_id: 'library' });
    expect(resolveSubject('Και το τηλέφωνο;', subjects, prior)).toMatchObject({ department_id: 'library' });
  });
  it.each([['Quel est le numéro de téléphone ?', 'phone'], ['Ποια είναι η διεύθυνση;', 'address'], ['Πότε είναι οι εξετάσεις;', 'date'], ['Combien coûte le cours ?', 'fee']])('recognizes exact field intent %s', (text, field) => expect(requestedFields(text)).toContain(field));
  it('never returns a differently scoped fee or silently picks conflicting contacts', async () => {
    query.mockResolvedValueOnce({ rows: [factFixture] }).mockResolvedValueOnce({ rows: [{ ...factFixture, field: 'fee', value: '100 EUR', evidence_quote: '100 EUR', evidence_content: '100 EUR', qualifiers: { audience: 'adults', period: '2026' } }] });
    expect((await resolveApprovedFacts('library price', { section: 'all', language: 'en', previous: {} })).status).toBe('ambiguous');
    query.mockResolvedValueOnce({ rows: [factFixture] }).mockResolvedValueOnce({ rows: [factFixture, { ...factFixture, id: '55555555-5555-4555-8555-555555555555', value: 'other@example.invalid', evidence_quote: 'other@example.invalid', evidence_content: 'other@example.invalid' }] });
    expect((await resolveApprovedFacts('library email', { section: 'all', language: 'en', previous: {} })).status).toBe('ambiguous');
  });
  it('uses approved qualifiers and refuses a mismatching explicit year', async () => {
    const fee = { ...factFixture, field: 'fee', language: 'en', value: '100 EUR', evidence_quote: '100 EUR', evidence_content: '100 EUR', qualifiers: { audience: 'adults', period: '2026' } };
    query.mockResolvedValueOnce({ rows: [factFixture] }).mockResolvedValueOnce({ rows: [fee] });
    expect((await resolveApprovedFacts('library price adults 2026', { section: 'all', language: 'en', previous: {} })).status).toBe('ready');
    query.mockResolvedValueOnce({ rows: [factFixture] }).mockResolvedValueOnce({ rows: [fee] });
    expect((await resolveApprovedFacts('library price adults 2026 and 2027', { section: 'all', language: 'en', previous: {} })).status).toBe('unavailable');
  });
  it('does not inherit a subject across a category change', async () => {
    query.mockResolvedValueOnce({ rows: [factFixture] });
    expect((await resolveApprovedFacts('Et son numéro ?', { section: 'eksetaseis', language: 'fr', previous: prior })).status).toBe('unavailable');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('rechecks withdrawn evidence after model latency', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await revalidateApprovedFacts([validateApprovedFact(factFixture)!])).toBeNull();
  });
  it('never inherits a B2 fee into a B1 followup',async()=>{
    const fee={...factFixture,field:'fee',language:'en',value:'100 EUR',evidence_quote:'100 EUR',evidence_content:'100 EUR',qualifiers:{level:'B2'}};
    query.mockResolvedValueOnce({rows:[factFixture]}).mockResolvedValueOnce({rows:[fee]});
    expect((await resolveApprovedFacts('and the B1 price',{section:'all',language:'en',previous:{...prior,qualifiers:{level:'B2'}}})).status).toBe('unavailable');
  });
});
