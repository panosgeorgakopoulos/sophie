import { z } from 'zod';
import { queryPublic as query } from './db';
import type { ConversationState } from './conversation';
import type { SupportedLanguage } from './language';

export const FactFieldSchema = z.enum(['email', 'phone', 'address', 'date', 'fee', 'policy', 'contact']);
export type FactField = z.infer<typeof FactFieldSchema>;
const FactSchema = z.object({
  id: z.string().uuid(), source_id: z.string().uuid(), version_id: z.string().uuid(),
  department_id: z.string().min(1), subject_key: z.string().min(1), subject_label: z.string().min(1).max(200),
  subject_aliases: z.array(z.string()), qualifiers: z.record(z.string(), z.string().min(1).max(200)),
  field: FactFieldSchema, value: z.string().min(1).max(1600), language: z.string(),
  evidence_chunk_id: z.string().uuid(), evidence_quote: z.string().min(1).max(4000),
  evidence_content: z.string(), source_name: z.string(), source_type: z.string(),
  effective_from: z.union([z.string(), z.date()]).nullable(), expires_at: z.union([z.string(), z.date()]),
  approval_status: z.literal('approved'), audience: z.literal('public'),
});
export type ApprovedFact = z.infer<typeof FactSchema>;
export type FactScope = { subjectKey: string; subjectLabel: string; departmentId: string; qualifiers: Record<string, string> };
export type FactResolution = { status: 'ready'; facts: ApprovedFact[]; scope: FactScope; fields: FactField[] } | { status: 'ambiguous' | 'unavailable'; fields: FactField[] };

export function normalizeEntity(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('el').replace(/ς/gu, 'σ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function hasPhrase(text: string, phrase: string): boolean {
  const normalized = normalizeEntity(phrase);
  return normalized.length >= 2 && ` ${normalizeEntity(text)} `.includes(` ${normalized} `);
}

export function requestedFields(text: string): FactField[] {
  const normalized = normalizeEntity(text);
  const fields: FactField[] = [];
  if (/email|e mail|courriel|mail|ηλεκτρονικ|ταχυδρομ/.test(normalized)) fields.push('email');
  if (/phone|telephone|numero|extension|τηλεφων|αριθμοσ/.test(normalized)) fields.push('phone');
  if (/address|adresse|διευθυν|where|ou se trouve|που βρισκ/.test(normalized)) fields.push('address');
  if (/date|when|deadline|schedule|calendar|horaire|quand|calendrier|ημερομην|ποτε|προθεσμι|ωραριο|προγραμμα εξετα/.test(normalized)) fields.push('date');
  if (/fee|price|cost|tarif|prix|cout|combien|κοστοσ|τιμη|τιμεσ|ποσο|διδακτρ|εκπτωσ|discount|reduction/.test(normalized)) fields.push('fee');
  if (/contact|επικοινων/.test(normalized) && fields.length === 0) fields.push('email', 'phone');
  return fields.length ? fields : ['policy'];
}

export function validateApprovedFact(row: unknown, now = Date.now()): ApprovedFact | null {
  const parsed = FactSchema.safeParse(row);
  if (!parsed.success) return null;
  const fact = parsed.data;
  const expires = new Date(fact.expires_at).getTime();
  const effective = fact.effective_from ? new Date(fact.effective_from).getTime() : 0;
  if (!Number.isFinite(expires) || expires <= now || !Number.isFinite(effective) || effective > now) return null;
  // The approved value must be an exact part of the approved quote, and the quote
  // must still exist in the CURRENT version's linked evidence chunk.
  if (!fact.evidence_quote.includes(fact.value) || !fact.evidence_content.includes(fact.evidence_quote)) return null;
  if (/\p{Cc}/u.test(fact.subject_label) || [...fact.value].some(character => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)))) return null;
  return fact;
}

interface SubjectRow { subject_key: string; subject_label: string; department_id: string; subject_aliases: string[] }
export function resolveSubject(message: string, subjects: SubjectRow[], previous: ConversationState): SubjectRow | 'ambiguous' | null {
  const matched = subjects.filter(subject => subject.subject_aliases.some(alias => hasPhrase(message, alias)));
  const unique = new Map(matched.map(subject => [`${subject.department_id}:${subject.subject_key}`, subject]));
  if (unique.size > 1) return 'ambiguous';
  if (unique.size === 1) return [...unique.values()][0];
  // Context inheritance is limited to explicit follow-ups; an unrelated new
  // request cannot silently inherit another department's contact details.
  const normalized = normalizeEntity(message);
  const connectors = /^(and|et|και)(?: |$)/u.test(normalized) || ['its', 'their', 'son', 'ses', 'leur', 'του', 'της'].some(word => hasPhrase(normalized, word));
  // Only short, field-only followups may inherit a subject. Unknown names such
  // as "and the library email?" must not silently reuse the previous department.
  const followupWords = new Set(normalizeEntity('and et και its their son ses leur του της το τη τα ο η των the a an le la les l de du des quel quelle what is are please aussi also email e mail courriel adresse address phone telephone number numero extension contact date fee price cost tarif prix cout when quand ποιο ποια ποιοσ ποιασ ειναι τηλεφωνο αριθμοσ email διευθυνση ημερομηνια κοστοσ τιμη').split(' '));
  const followup = connectors && normalized.split(' ').every(word => followupWords.has(word) || /^(?:[abc][12]|20\d{2})$/.test(word));
  if (followup && previous.subjectKey && previous.departmentId) {
    return subjects.find(subject => subject.subject_key === previous.subjectKey && subject.department_id === previous.departmentId) ?? null;
  }
  return null;
}

export async function resolveApprovedFacts(message: string, options: { section: string; language: SupportedLanguage; previous: ConversationState }): Promise<FactResolution> {
  const fields = requestedFields(message);
  const section = options.section === 'all' ? null : options.section;
  const catalog = await query(`SELECT DISTINCT subject_key, subject_label, department_id, subject_aliases
    FROM public_knowledge_facts WHERE ($1::text IS NULL OR $1 = ANY(sections))
    ORDER BY subject_key LIMIT 1001`, [section]);
  if (catalog.rows.length > 1000) return { status: 'unavailable', fields };
  const subjects = catalog.rows.filter((row): row is SubjectRow => typeof row.subject_key === 'string' && typeof row.department_id === 'string' && Array.isArray(row.subject_aliases));
  const previous = options.previous.section === options.section ? options.previous : {};
  const subject = resolveSubject(message, subjects, previous);
  if (subject === 'ambiguous') return { status: 'ambiguous', fields };
  if (!subject) return { status: 'unavailable', fields };

  const result = await query(`SELECT * FROM public_knowledge_facts
    WHERE subject_key = $1 AND department_id = $2 AND field = ANY($3::text[])
      AND ($4::text IS NULL OR $4 = ANY(sections))
    ORDER BY field, id LIMIT 101`, [subject.subject_key, subject.department_id, fields, section]);
  if (result.rows.length > 100) return { status: 'unavailable', fields };
  const validFacts = result.rows.map(row => validateApprovedFact(row)).filter((fact): fact is ApprovedFact => fact !== null);
  const hasExplicitSubject = subject.subject_aliases.some(alias => hasPhrase(message, alias));
  const inherited = !hasExplicitSubject && previous.subjectKey === subject.subject_key ? previous.qualifiers ?? {} : {};
  const scopeText = `${message} ${Object.values(inherited).join(' ')}`;
  const qualified = validFacts.filter(fact => Object.values(fact.qualifiers).every(value => hasPhrase(scopeText, value)));
  if (qualified.length === 0) return { status: validFacts.length ? 'ambiguous' : 'unavailable', fields };
  // Any explicit year must belong to the selected records; never answer this
  // year's question with last year's approved but differently scoped data.
  const years = message.match(/\b20\d{2}\b/g) ?? [];
  const requestedCodes = normalizeEntity(message).match(/\b(?:[abc][12]|delf|dalf|tcf)\b/gu) ?? [];
  const audienceGroups = [
    ['adult', 'adults', 'adulte', 'adultes', 'ενηλικων', 'ενηλικες'],
    ['child', 'children', 'enfant', 'enfants', 'παιδια', 'παιδιων'],
    ['teen', 'teens', 'adolescent', 'adolescents', 'εφηβων', 'εφηβοι'],
  ];
  const requestedAudiences = audienceGroups.filter(group => group.some(value => hasPhrase(message, value)));
  const facts = qualified.filter(fact => {
    const approvedScope = `${fact.subject_label} ${fact.subject_key} ${Object.values(fact.qualifiers).join(' ')}`;
    return years.every(year => Object.values(fact.qualifiers).some(value => value.includes(year)) || fact.value.includes(year))
      && requestedCodes.every(code => hasPhrase(approvedScope, code))
      && requestedAudiences.every(group => group.some(value => hasPhrase(approvedScope, value)));
  });
  if (!facts.length) return { status: 'unavailable', fields };
  // Distinct approved values for one field/scope represent a conflict; source
  // authority cannot safely guess whether two phone numbers refer to one desk.
  const values = new Map<string, Set<string>>();
  for (const fact of facts) {
    const key = `${fact.field}:${JSON.stringify(Object.entries(fact.qualifiers).sort())}:${['email', 'phone'].includes(fact.field) ? 'shared' : fact.language}`;
    const existing = values.get(key) ?? new Set<string>(); existing.add(fact.value); values.set(key, existing);
  }
  if ([...values.values()].some(values => values.size > 1)) return { status: 'ambiguous', fields };
  const preferred = facts.filter(fact => fact.language === options.language || fact.language === 'und' || ['email', 'phone'].includes(fact.field));
  if (!preferred.length || fields.some(field => !preferred.some(fact => fact.field === field))) return { status: 'unavailable', fields };
  const dedup = [...new Map(preferred.map(fact => [`${fact.field}:${fact.value}:${JSON.stringify(fact.qualifiers)}`, fact])).values()];
  if (dedup.length > 3) return { status: 'ambiguous', fields };
  const qualifiers = Object.assign({}, ...dedup.map(fact => fact.qualifiers));
  return { status: 'ready', fields, facts: dedup, scope: { subjectKey: subject.subject_key, subjectLabel: subject.subject_label, departmentId: subject.department_id, qualifiers } };
}

/** Recheck publication/withdrawal and expiry after any provider work. */
export async function revalidateApprovedFacts(facts: ApprovedFact[]): Promise<ApprovedFact[] | null> {
  const result = await query('SELECT * FROM public_knowledge_facts WHERE id = ANY($1::uuid[])', [facts.map(fact => fact.id)]);
  const current = result.rows.map(row => validateApprovedFact(row)).filter((fact): fact is ApprovedFact => fact !== null);
  if (current.length !== facts.length) return null;
  const identity = (fact: ApprovedFact) => JSON.stringify({ id: fact.id, source: fact.source_id, version: fact.version_id, department: fact.department_id, subject: fact.subject_key, label: fact.subject_label, field: fact.field, value: fact.value, language: fact.language, qualifiers: Object.entries(fact.qualifiers).sort(), evidence: fact.evidence_chunk_id, quote: fact.evidence_quote });
  return facts.every(fact => current.some(item => identity(item) === identity(fact))) ? facts : null;
}
