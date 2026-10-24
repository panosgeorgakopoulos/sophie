import { z } from 'zod';
import { COPY, type SupportedLanguage } from './language';
import { revalidateApprovedFacts, type ApprovedFact, type FactResolution } from './facts';
import type { ConversationState } from './conversation';
import { generateFactSelection } from './gemini';
import { SYSTEM_PROMPT } from '@/config/systemPrompt';
import { redactDirectIdentifiers } from './privacy';

export const CONTACT_PAGE = 'https://www.ifg.gr/fr/contact/';
export interface AnswerSource {
  source_name: string; source_type: string; source_id: string; version_id: string;
  evidence_chunk_id: string; fact_id: string; evidence_quote: string; url?: string;
}
export interface VerifiedAnswer {
  reply: string; sources: AnswerSource[]; outcome: 'verified' | 'unavailable' | 'ambiguous' | 'invalid_selection' | 'provider_unavailable';
  factIds: string[]; state: ConversationState;
}
const SelectionSchema = z.object({ fact_ids: z.array(z.string().uuid()).max(3) }).strict();

export function validateFactSelection(raw: string, facts: ApprovedFact[]): ApprovedFact[] | null {
  if (raw.length > 1500) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  const parsed = SelectionSchema.safeParse(data);
  if (!parsed.success || new Set(parsed.data.fact_ids).size !== parsed.data.fact_ids.length) return null;
  const lookup = new Map(facts.map(fact => [fact.id, fact]));
  if (parsed.data.fact_ids.some(id => !lookup.has(id))) return null;
  return parsed.data.fact_ids.map(id => lookup.get(id)!);
}

export function abstain(language: SupportedLanguage, outcome: VerifiedAnswer['outcome'] = 'unavailable'): VerifiedAnswer {
  return { reply: `${outcome === 'ambiguous' ? COPY[language].clarify : COPY[language].unavailable}\n\n${CONTACT_PAGE}`, sources: [], factIds: [], outcome, state: { language } };
}

export function renderApprovedFacts(facts: ApprovedFact[], resolution: Extract<FactResolution, { status: 'ready' }>, language: SupportedLanguage): VerifiedAnswer {
  // No model-provided text is rendered. Exact approved values remain attributed
  // to their approved subject and qualifiers, even if the model is compromised.
  const reply = [COPY[language].heading, ...facts.map(fact => {
    const qualifiers = Object.entries(fact.qualifiers).sort().map(([key, value]) => `${key}: ${value}`).join('; ');
    return `${fact.subject_label}${qualifiers ? ` (${qualifiers})` : ''}\n${COPY[language].fields[fact.field]}: ${fact.value}`;
  })].join('\n\n');
  if (reply.length > 6000) return abstain(language);
  return {
    reply, outcome: 'verified', factIds: facts.map(fact => fact.id),
    state: { ...resolution.scope, language },
    sources: facts.map(fact => ({
      source_name: fact.source_name, source_type: fact.source_type,
      source_id: fact.source_id, version_id: fact.version_id, evidence_chunk_id: fact.evidence_chunk_id,
      fact_id: fact.id, evidence_quote: fact.evidence_quote,
      ...(/^https:\/\/(?:www\.)?ifg\.gr(?:\/|$)/i.test(fact.source_name) ? { url: fact.source_name } : {}),
    })),
  };
}

export async function answerFromApprovedFacts(message: string, resolution: FactResolution, language: SupportedLanguage, signal?: AbortSignal): Promise<VerifiedAnswer> {
  if (resolution.status !== 'ready') return abstain(language, resolution.status);
  // Exact entity requests have already passed deterministic subject, field,
  // scope, conflict and validity checks. They do not need a model call.
  let facts = resolution.facts;
  if (resolution.fields.includes('policy')) {
    let raw: string;
    try {
      raw = await generateFactSelection(SYSTEM_PROMPT, {
      question: redactDirectIdentifiers(message), language,
      facts: facts.map(fact => ({ id: fact.id, subject: fact.subject_label, field: fact.field, qualifiers: fact.qualifiers, value: fact.value })),
      }, signal);
    } catch { return abstain(language, 'provider_unavailable'); }
    const selected = validateFactSelection(raw, facts);
    if (selected === null) return abstain(language, 'invalid_selection');
    if (!selected.length) return abstain(language);
    facts = selected;
  }
  const current = await revalidateApprovedFacts(facts);
  if (!current) return abstain(language);
  return renderApprovedFacts(current, resolution, language);
}
