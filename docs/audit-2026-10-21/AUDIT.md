# Sophie / Institut Français de Grèce — codebase audit

Audit date: **21 October 2026 (Europe/Athens)**. Baseline: `f634064ff0f104ee1ab2b5f0cd15a53c94356076`.

**Assessment: this implementation does not meet the stated production requirements.** The main blockers are public access to the shared internal/public corpus, unauthenticated email endpoints, destructive contact-text parsing, insufficient evidence checks on generated facts, and missing PDF ingestion. A successful build and existing grounding prompt do not establish institutional accuracy or privacy compliance.

Scope: all 70 tracked files were inventoried; the 69 text files were inspected, including source, tests, configuration, SQL, documentation and static SVG/XML assets. The favicon was treated as a static binary asset. The 13 local dataset files were inspected for ingestion compatibility/structure; private contents are not reproduced. Generated `.next`, `node_modules` and `public/widget.js` were not manually reviewed file by file; dependency versions were checked from the lockfile. `.env.local` values were not reproduced. No production DB query, model request, mail send, ingestion job or production penetration test was performed. Public IFG pages and authoritative security/provider documentation were read. Deployment controls, database grants, actual billing, hosting region, vendor contracts and production data remain unverified.

Priorities: **P0** = block exposure until fixed; **P1** = fix before institutional production approval; **P2** = required reliability/maintainability work. A condition stated in a finding is part of its severity assessment. Internal documents may contain approved public policy; their confidentiality cannot be inferred from their filenames. The defect is that no technical mechanism distinguishes them.

Verification performed:

| Check | Result |
|---|---|
| `npm test` | 42 tests passed across four files. They do not cover the security and fidelity defects below. |
| `npx tsc --noEmit --incremental false` | Passed. |
| `npm run build` | Passed with dummy Gemini/admin credentials and a non-production, unreachable DB URL. Built all public, email, preview and admin routes. Deprecated middleware-convention warning. This is compile/build validation, not service integration validation. |
| `npm run lint` | Failed; generated `public/widget.js` is also linted. Source-only ESLint confirms 19 errors and five warnings, primarily the email/Outlook paths. |
| `npm audit --json` | 15 affected package nodes: two critical, ten high, three moderate. These are package nodes including transitive propagation, not 15 distinct exploitable vulnerabilities. |
| `npm audit --omit=dev --json` | Seven affected production package nodes: four high, three moderate; no critical nodes. Reachability is qualified below. |
| Safe local probes | Actual source transpiled/loaded with mock DB, model and email boundaries; chunk loss, missing output checks, unauthenticated routes, unbounded drafting input, forwarded-header rotation and preview script preservation reproduced. |
| Public ingestion checks | Eight PDF links on the IFG exam registration page; stripped Cloudflare contacts; French category mismatch. |
| Secret checks | No non-example environment file tracked in either of the two Git commits. A limited tracked-source secret-pattern scan found only the placeholder database URL in [.env.example](</Users/panosgeorgakopoulos/Downloads/sophie/.env.example>); this is not a complete secret-history assurance. |

Evidence and runnable probes are in this folder: [rag-probes.cjs](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/rag-probes.cjs>), [rag-evidence.md](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/rag-evidence.md>), [security-probes.cjs](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/security-probes.cjs>), [security-evidence.md](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/security-evidence.md>), [ingestion-probes.cjs](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/ingestion-probes.cjs>), and [ingestion-evidence.md](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/ingestion-evidence.md>). Saved outputs are [rag-probe-results.json](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/rag-probe-results.json>), [security-probe-results.jsonl](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/security-probe-results.jsonl>), and [ingestion-probe-results.json](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/ingestion-probe-results.json>). The two npm audit JSON files preserve the registry result; [source-eslint.json](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/source-eslint.json>) preserves lint diagnostics. The defect probes intentionally assert current broken behavior; they are audit reproductions, not the desired regression-test specification after repairs.

## 1. Critical Blockers (Security & Hallucination Risks)

### B01 — P0: the public chatbot can retrieve every ingested internal document

**Locations:** [src/lib/retrieval.ts:52–63](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:52>) (`searchDocuments`); [src/app/api/chat/route.ts:64–65,122–124](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:64>); [src/scripts/run_ingestion.ts:248–250,266–272,288–290](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts:248>); [schema.sql:5–12](</Users/panosgeorgakopoulos/Downloads/sophie/schema.sql:5>).

The only retrieval filter is optional `metadata.section`. `section=all` searches the whole `documents` table. Local DOCX/XLSX/MD files enter this same table without visibility, authorization, approval or publication status. Retrieved material is sent to Gemini and used in public replies; filenames are returned as sources. This is a direct publication path, even without a prompt-injection attack. If a staff-only file is added, its content is eligible for public disclosure.

**Fix:** introduce default-private source records with `audience`, `approval_status`, `department_id`, `active_version_id` and permitted roles. Enforce a public-and-approved predicate in the database query before candidates enter the model, and use a restricted public DB view/role or RLS. Give staff drafting a separately authenticated retrieval policy. Do not accept audience authorization from the client. Test that a high-similarity private fixture is never returned, embedded into a public prompt or cited.

### B02 — P0: unauthenticated draft and email-sending routes are shipped

**Locations:** [src/app/api/draft-email/route.ts:31–95](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/draft-email/route.ts:31>) (`POST`); [src/app/api/webhook/google-form/route.ts:11–102](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/webhook/google-form/route.ts:11>) (`POST`); [src/lib/email.ts:13–28](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/email.ts:13>); [src/middleware.ts:7–10](</Users/panosgeorgakopoulos/Downloads/sophie/src/middleware.ts:7>).

Neither endpoint requires authentication, a webhook signature, a trusted service identity or a rate limit. Drafting performs embedding, global retrieval and generation, returning internal source filenames. The webhook accepts an arbitrary truthy `studentEmail`, generates a reply and calls `sendEmail` with that recipient. There is no replay protection or idempotency. Live mail abuse requires configured SMTP; model/DB cost and disclosure risks require working provider/DB credentials. README warnings at [README.md:29–41,213–215](</Users/panosgeorgakopoulos/Downloads/sophie/README.md:29>) are not a runtime gate. Middleware only supplies the pathname.

**Reproduction:** mocked route calls without cookies or authorization accepted a 2,000,000-character draft inquiry and an arbitrary comma-separated recipient list. The actual handlers reached model/DB/mail mocks and returned success. No mail was sent.

**Fix:** disable both endpoints by default immediately. Before enabling, require staff authorization for drafting; authenticate the form integration with a signature over the raw body plus timestamp/event ID; reject replays; validate exactly one authorized recipient; bound bytes and fields; apply shared quotas. Queue delivery with persisted idempotency and require staff review for generated pricing/payment instructions.

### B03 — P1: chunking can delete emails, URLs and decimal prefixes

**Locations:** [src/lib/chunking.ts:14–16,45–56](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/chunking.ts:14>) (`splitIntoSentences`, `chunkText`); [src/lib/chunking.test.ts:38–45](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/chunking.test.ts:38>).

The sentence regex excludes every period from the text portion but accepts a period as a terminator only when whitespace or end-of-input follows. In a paragraph over 400 words, an interior dot in `library@example.invalid` causes matching to restart after the dot, silently discarding preceding content. The defect is not merely a poor chunk boundary: information is removed before embedding. Dotted URLs and decimal amounts have the same failure mode. Existing tests exercise ordinary English sentences only.

**Reproduction:** a synthetic long paragraph with a department heading and a complete contact email loses the complete email in all emitted chunks. A second fixture separates a heading from its contact line. See [rag-evidence.md](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/rag-evidence.md>).

**Fix:** replace the lossy regex with a lossless segmenter that returns source spans, protecting emails, URLs, decimals and identifiers. Add invariants that source text is preserved modulo whitespace/intentional overlap, plus Greek/French punctuation fixtures. Re-extract and re-embed the affected corpus; fixing the splitter alone does not repair stored chunks.

### B04 — P1: critical facts and their department attribution are not verified

**Locations:** [src/lib/retrieval.ts:68–80,89–114](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:68>); [src/app/api/chat/route.ts:67–85,122–124](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:67>); [src/lib/gemini.ts:25–27](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/gemini.ts:25>); [src/config/systemPrompt.ts:4–8,18–24,32–38](</Users/panosgeorgakopoulos/Downloads/sophie/src/config/systemPrompt.ts:4>).

One chunk above cosine similarity 0.55 is treated as sufficient context. This measures semantic proximity, not whether a phone belongs to the requested department or a fee applies to the requested year/audience. The generated string is returned unchanged. `toSources` lists retrieved candidates whether or not the answer uses or is supported by them. There is no evidence-span check, entity binding, conflict check or claim-level citation. Generation temperature/output limits are not explicitly configured. Lower temperature alone would not fix this.

The prompt also hardcodes a 5% discount, €10 adult placement fee, free teen evaluation and academic years, while instructing the model to use context only. Those duplicated policy facts can drift independently of the source. The current general fallback email and phone were verified on IFG's public contact page; they are **not reported as incorrect**, but need an owner and verification date.

**Reproduction:** the mock model returned an unsupported synthetic telephone number while retrieval supplied only a library-books sentence. The actual chat handler returned the number with the library source chip. This proves the absence of validation, not the live model's probability of making that error.

**Fix:** maintain approved contact/fee/date records keyed by department, program, audience, locale and validity period, with source/version/span references. Render critical fields deterministically from those records. Have the model propose structured claims and evidence IDs; reject unsupported or mismatched tuples. A phone merely occurring somewhere in the context is insufficient. For ambiguity/conflict, ask a clarifying question or abstain. Cite only evidence actually used.

### B05 — P1: client history and retrieved instructions can contaminate the model's authority

**Locations:** [src/lib/validation.ts:5–14](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/validation.ts:5>); [src/app/api/chat/route.ts:74–84](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:74>); [src/lib/retrieval.ts:89–98](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:89>); [src/app/api/draft-email/route.ts:64–84](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/draft-email/route.ts:64>); [src/app/api/webhook/google-form/route.ts:55–88](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/webhook/google-form/route.ts:55>).

The client supplies arbitrary `assistant` turns, which are converted into Gemini `model` turns without server provenance. Only leading assistant turns are removed. A caller can fabricate previous assistant statements or approvals. Retrieved text and source labels are interpolated into delimiters that the text itself can imitate. The chat system prompt does tell the model to ignore injected instructions, which is useful but not an enforced boundary. The draft path lacks the same grounding rules; the webhook places `SYSTEM_PROMPT` in a prior **user** message rather than a system instruction and discards document provenance.

**Fix:** load trusted assistant history server-side using an opaque session token; treat client history as untrusted hints if retained. Keep control instructions outside retrieved data, preserve source IDs in structured evidence, and quarantine suspicious uploads for review. Enforce authorization and fact validation outside the model. Test malicious instructions in both user turns and corpus documents, including requests to swap departmental contacts or output payment links. There is no model tool execution path here; the concrete risks are answer manipulation, corpus disclosure and outbound email abuse.

### B06 — P1: abuse limits depend on spoofable headers and process-local state

**Locations:** [src/lib/rateLimit.ts:18,31–52](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/rateLimit.ts:18>); [src/app/api/chat/route.ts:45–56](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:45>); [src/app/api/admin/auth/login/route.ts:18–27](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/admin/auth/login/route.ts:18>); [src/lib/cors.ts:19–25](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/cors.ts:19>).

`getClientKey` trusts the first `x-forwarded-for` value, then `x-real-ip`. A deployment that does not overwrite these at a trusted ingress lets callers rotate their quota identity. Local reproduction allowed 30 distinct caller-supplied headers through an 8-request login limit. If ingress sanitizes the headers, that specific bypass may be prevented, but limits still reset per process/instance. CORS is not caller authentication. JSON is fully buffered before Zod limits run; the draft/webhook paths lack substantive input limits altogether.

**Fix:** use the platform's trusted remote address; strip/rebuild forwarding headers at ingress; share limits across instances. Add account-and-IP limits for login, per-session limits for chat, global model budgets and concurrency caps. Limit request bytes before JSON parsing, including streamed/chunked bodies, and cap prompt/output tokens. Keep public chat usable without assuming an Origin header proves legitimacy.

### B07 — P1: preview imports third-party scripts into the admin application's origin

**Locations:** [src/app/preview/route.ts:6–30](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/preview/route.ts:6>); [src/app/admin/(protected)/layout.tsx:6–10](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/layout.tsx:6>); [next.config.ts:3–7](</Users/panosgeorgakopoulos/Downloads/sophie/next.config.ts:3>).

`/preview` fetches the live IFG homepage and returns its complete HTML/scripts under Sophie's origin. External scripts execute with that origin's privileges. If an upstream script is compromised and an authenticated staff member opens preview, it can read authenticated same-origin pages using `location.origin`; HttpOnly does not prevent authenticated fetches. The probe confirmed external and inline scripts survive and no CSP is set by this route. This is a trust-boundary risk, not a claim that IFG is compromised. Host/protocol headers are also interpolated into script markup without validation.

**Fix:** remove/disable preview in production or place it on a separate origin without staff cookies and with a sandboxed iframe/CSP. Use a fixed validated asset origin and serialize attributes safely. Configure admin CSP/frame restrictions and assess actual reverse-proxy security headers.

### B08 — P1: privacy controls and provider suitability are not established

**Locations:** [src/app/api/chat/route.ts:64,82–92,99–115](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:64>); [schema.sql:16–35,50–51](</Users/panosgeorgakopoulos/Downloads/sophie/schema.sql:16>); [src/app/outlook/page.tsx:47–62](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/outlook/page.tsx:47>); [src/app/api/webhook/google-form/route.ts:29–42,55–62](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/webhook/google-form/route.ts:29>); [src/lib/email.ts:14–19](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/email.ts:14>); [src/widget/ChatWidget.tsx:36–49,69–73,248–252](</Users/panosgeorgakopoulos/Downloads/sophie/src/widget/ChatWidget.tsx:36>).

Raw questions go to embedding, full history/context to generation, raw interactions and embeddings into Postgres, and fallback histories into a second table. Outlook forwards the entire email body; the webhook forwards student/parent names, age, level and discount category. Contrary to the README, the webhook's `studentEmail` field is not itself in the model prompt; it is used for delivery and mock logging. No implemented retention/deletion workflow, minimization, privacy notice for these flows, or access audit was found. All staff can see conversation data. The chat embedding index remains although feedback no longer drives retrieval.

The README and [.env.example:5](</Users/panosgeorgakopoulos/Downloads/sophie/.env.example:5>) recommend free-tier Gemini. Current [Gemini terms](https://ai.google.dev/gemini-api/terms) require Paid Services for API clients available in the EEA and restrict clients directed at or likely to be accessed by under-18s. The teen-course use case therefore needs provider/contract review. Account billing and audience controls are unverified. The same terms have an EEA data-handling exception: **do not infer that all Greek free-tier traffic is used for training**. Nor does a paid key prove EU-only processing or GDPR compliance.

**Fix:** document the controller/processor relationship, purpose/legal basis, recipients, retention and transfer arrangements; have IFG's DPO validate them. Verify provider eligibility for the intended audience. Minimize/redact before embedding and generation, substitute names locally when possible, remove unnecessary query embeddings, implement coordinated deletion of logs/flags/caches/backups under an approved schedule, and link a French/Greek privacy notice from the widget. These gaps relate to [EDPB guidance on rights and transparency](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en) and [international transfers](https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en); this source audit is not a legal compliance certification.

### B09 — P1/P2: staff-session revocation and email-output safety are incomplete

**Locations:** [src/lib/adminAuth.ts:5,32–60](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/adminAuth.ts:5>); [src/lib/adminSession.ts:4–7](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/adminSession.ts:4>); [src/app/api/admin/auth/logout/route.ts:4–7](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/admin/auth/logout/route.ts:4>); [src/scripts/create_admin_user.ts:11–24](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/create_admin_user.ts:11>); [src/app/outlook/page.tsx:91–92](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/outlook/page.tsx:91>).

Admin tokens remain valid for 12 hours based only on HMAC and expiry. Deleting an account, resetting a password, changing its role or signing out does not revoke a copied token. Roles are displayed but never enforced; no MFA is implemented. Bootstrap passwords are accepted as command-line arguments and can enter shell history/process listings. Separately, generated draft text is passed to Outlook as HTML with only newline replacement, allowing injected links/images/formatting into a staff-inserted email. Actual script execution depends on Outlook sanitization and was not demonstrated.

**Fix:** use revocable server sessions or a checked session version, enforce account status/roles per operation, and integrate institutional SSO/MFA. Read bootstrap passwords from a hidden prompt. Render drafts as text or HTML-escape before adding controlled line breaks; allowlist any intentional links. Existing bcrypt cost 12, timing-safe HMAC verification and production HttpOnly/Secure cookies are strengths to retain.

## 2. RAG & Ingestion Pipeline Bottlenecks

### R01 — P1: linked PDFs and nested/dynamic content are not discovered

**Locations:** [src/scripts/run_ingestion.ts:62–94,166–190,197–215,308–320](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts:62>).

The crawler reads sitemap URLs and fetches static HTML only. It neither traverses `a[href]` nor PDF links, renders JS, follows tab/accordion relationships, or records hierarchy. Already-present static tab text may be captured, but AJAX-only or non-sitemap descendants are missed. `ingestPDFs` is commented out, and even enabled it reads only local files.

A public check of [IFG exam registration](https://www.ifg.gr/eksetaseis/dino-eksetaseis-2/) found eight linked PDFs, including the [2026–2027 calendar](https://www.ifg.gr/wp-content/uploads/2026/10/Calendrier_2026-2027_site.pdf) and [exam fees](https://www.ifg.gr/wp-content/uploads/2026/01/Tarifs_examens_2026_GR.pdf). The current discovery code cannot follow them. Five local PDFs are also skipped.

**Fix:** use an allowlisted crawl frontier seeded by sitemap plus relevant links, canonical URLs, `hreflang`, tab/accordion targets and PDF attachments. Render selected dynamic pages when needed. Retain parent URL, heading path, tab ID and language. Validate MIME, redirects, host/IP, byte/depth limits and fetch deadlines. Build a source coverage manifest with required exam/course documents.

### R02 — P1: extraction loses tables, contacts and OCR-only material

**Locations:** [src/scripts/run_ingestion.ts:123–136,174–176,225–232,248–250,267–272](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts:123>).

HTML selects headings, paragraphs, list items and `td`, but not `th`, and flattens each cell separately. Nested blocks can duplicate text; div-only text and `mailto`/`tel` attributes disappear whenever any selected block exists. Cloudflare placeholders are removed without recovering their encoded email values. On the public exam-registration page, three encoded email elements yielded zero extracted email addresses. Table headers are not bound to values. PDF parsing extracts only `data.text`, DOCX uses `extractRawText`, and XLSX sheets become CSV before generic word chunking; table/page/row/merged-cell provenance is absent.

Local parser checks found `require('pdf-parse')` callable and all five PDFs parseable at the container level; one two-page document yields zero trimmed text, another only 11 words. Simply uncommenting PDF ingestion would still miss substantive content. Empty PDF text would send zero chunks into the delete/replace function if the path were enabled.

**Fix:** extract a structured document tree and atomic tables/contact cards. Decode public contact encodings or render the DOM; retain link destinations. Use layout-aware PDF extraction with page/table coordinates, Greek/French OCR fallback and minimum-quality checks. Serialize each table row with repeated column headers, units and qualifying audience/year. Quarantine extraction failures instead of publishing an empty replacement.

### R03 — P1: department headings are not carried into chunks

**Locations:** [src/lib/chunking.ts:42–80](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/chunking.ts:42>); [src/scripts/run_ingestion.ts:185–190,248–250](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts:185>); [src/lib/retrieval.ts:95–96](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:95>).

The 400-word/50-word overlap scheme treats headings as ordinary text. A long section can push its contact line into a later chunk without its department heading, and the overlap can mix that line with the next department. The code reads `metadata.section_heading` when assembling context, but no ingester writes that field. Page/document titles are metadata only and are not prepended to the embedded chunk. A synthetic default-size fixture reproduced an unlabeled exam contact sharing a chunk with a library heading/contact.

**Fix:** chunk within semantic sections; prepend a stable breadcrumb to each child; keep contact cards and table rows atomic; never overlap across department boundaries. Store parent/child IDs and retrieve the relevant parent section alongside a selected child. Use token budgets appropriate to Greek and French, not only whitespace word counts.

### R04 — P1: category selection removes internal policies and French pages

**Locations:** [src/scripts/run_ingestion.ts:232,250,272,290](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts:232>); [src/lib/sectionMapping.ts:8–13](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/sectionMapping.ts:8>); [src/lib/retrieval.ts:50–58](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:50>); [src/widget/ChatWidget.tsx:255–267](</Users/panosgeorgakopoulos/Downloads/sophie/src/widget/ChatWidget.tsx:255>).

Local file metadata contains only a title and chunk index, while filtered retrieval requires an exact `section` value. Therefore every local document is excluded when a user chooses Courses, Exams, Studies, Synergies or Library. URL mapping recognizes only five Greek-path prefixes. [The French exams page](https://www.ifg.gr/fr/examens/) maps to undefined and is likewise excluded from Exams. This is a deterministic hybrid/multilingual coverage failure.

**Fix:** require reviewed department/category metadata for internal documents, support multi-category policies, map Greek/French aliases using canonical page identity and `hreflang`, and backfill existing rows. Keep topic filtering separate from access control. Test that the approved same policy remains retrievable in all relevant languages and category views.

### R05 — P1: removed and superseded sources remain authoritative indefinitely

**Locations:** [src/scripts/run_ingestion.ts:97–107,147–157,169–182,203–210](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts:97>); [schema.sql:5–12](</Users/panosgeorgakopoulos/Downloads/sophie/schema.sql:5>).

Only a successfully processed source with the same exact `source_name` replaces prior chunks. A 404/410, empty page, vanished sitemap URL, deleted/renamed local file, or news item now skipped as stale leaves old rows intact. Last-modified is used for one news exclusion rule, not persisted as source validity. Redirect/canonical/language aliases remain distinct identities. Source priority, effective dates, revision hashes, tombstones and supersession relations do not exist. Local Markdown contains substantial repeated passages from the DOCX files, so duplicate evidence is a present corpus concern.

**Fix:** introduce source/version/run tables with canonical ID, content hash, fetched/verified times, validity interval, approval and source authority. Stage successful runs and atomically publish versions. Reconcile deletions only after a complete successful discovery run; do not mass-delete on a failed/partial crawl. Quarantine stale critical facts and handle 404/410 explicitly. Deduplicate equivalent material and resolve conflicting policies before generation. Retain historical versions for audit but exclude them from current answers.

### R06 — P1: retrieval has no exact entity path, reranking or conversational query resolution

**Locations:** [src/lib/retrieval.ts:34–80](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:34>); [src/app/api/chat/route.ts:64–65,74–84](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:64>); [src/lib/gemini.ts:65–68](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/gemini.ts:65>).

Retrieval is dense-only cosine top-20, thresholded to six chunks. There is no BM25/full-text branch, exact email/phone/course-code lookup, department/year/audience filter, diversity cap, reranker or conflict policy. Six near-duplicate chunks can crowd out a distinct qualifying policy. Only the latest message is embedded, so `Et son numéro ?` loses the previously mentioned department before retrieval; history reaches generation only after selection.

**Fix:** resolve a standalone retrieval query from trusted conversation state; preserve department/program/audience constraints. Combine multilingual lexical retrieval with dense candidates, fuse/rerank them and enforce source diversity. Query normalized structured entities exactly. Calibrate answerability on hard negatives that share topic but differ in department/year/audience. Similarity is not a confidence percentage. For Embedding 2, evaluate query/document prompt wrappers and title context: Google's current [embedding documentation](https://ai.google.dev/gemini-api/docs/embeddings) explicitly says this model does **not** support the `task_type` field; do not blindly add Embedding 1 task-type enums.

### R07 — P2: multilingual behavior is only lightly exercised

**Locations:** [src/app/api/chat/route.ts:18–29](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:18>); [src/config/systemPrompt.ts:21–24,28,34](</Users/panosgeorgakopoulos/Downloads/sophie/src/config/systemPrompt.ts:21>); [src/lib/chunking.ts:15](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/chunking.ts:15>); [src/scripts/test_scenarios.ts:39–49](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/test_scenarios.ts:39>); [src/lib/sectionMapping.test.ts:5–24](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/sectionMapping.test.ts:5>).

French fallback detection is a small accented-character/word regex; a French sentence such as `Puis-je payer en plusieurs fois ?` falls back to English. Greek script is recognized but Greeklish is not. Greek question-mark punctuation (`;`), combining characters, bilingual paragraphs, decimal conventions and course-code lookalikes have no fidelity tests. The prompt's mandatory legal disclaimer is hardcoded in English despite the no-language-mixing instruction. The scenario script sends an empty history for every turn, so its multi-question scenarios do not test actual dialogue continuity. Embedding model multilingual capability alone does not establish Greek/French retrieval precision.

**Fix:** accept/persist a user language preference with reliable language detection as fallback; localize fixed templates. Preserve original text while normalizing a separate lexical field for accents/Unicode/course aliases. Add EL→EL, FR→FR, EL→FR and FR→EL retrieval/evidence tests, plus mixed-language, short-follow-up and code/number fixtures. Measure exact critical-entity accuracy per language.

### R08 — P1/P2: ingestion holds transactions open through remote calls and can falsely report success

**Locations:** [src/scripts/run_ingestion.ts:20,145–163,192–194,234–235,252–253,274–275,292–293,322–327](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts:20>).

Embedding and a fixed 4.5-second sleep occur after `BEGIN` and source deletion, for every chunk. One hundred chunks impose at least 450 seconds of intentional sleep inside a transaction, before provider latency/retries. Every run re-embeds unchanged content. There are no checkpoints or bounded worker queue. Each per-source failure is logged and swallowed, so `main` can print success after widespread failure. No per-source lock/unique version key protects overlapping ingestion runs; concurrent replace operations can leave duplicate sets. DB atomicity correctly preserves old rows on rollback, but does not solve these lifecycle issues.

**Fix:** fetch, parse, validate and embed outside a DB transaction; cache embeddings by normalized content/model/version; batch with quota-aware bounded concurrency. Publish a complete staged source revision in a short transaction under a per-source advisory lock, with a uniqueness constraint. Record job status/counts/errors/checkpoints and exit nonzero for required-source failures. Apply retries with jitter and a total deadline; do not retry permanent errors indefinitely.

## 3. Architecture & Code Quality

### A01 — P1/P2: inconsistent RAG implementations bypass shared protections and indexes

**Locations:** [src/app/api/draft-email/route.ts:40–85](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/draft-email/route.ts:40>); [src/app/api/webhook/google-form/route.ts:7–9,45–88](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/webhook/google-form/route.ts:7>); [src/lib/retrieval.ts:52–63](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:52>); [migrations/001_vector_indexes_and_cleanup.sql:14–18](</Users/panosgeorgakopoulos/Downloads/sophie/migrations/001_vector_indexes_and_cleanup.sql:14>).

Chat uses indexed halfvec cosine and thresholding; drafting uses raw vector Euclidean top-eight; the webhook uses raw vector cosine top-eight. The latter two do not match the only vector-index expressions and have no relevance refusal, shared retry policy or evidence validation. The webhook removes source labels. This increases query cost and allows low-relevance material into authoritative email outputs. At [src/app/api/webhook/google-form/route.ts:93–98](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/webhook/google-form/route.ts:93>), SMTP exceptions are swallowed and HTTP 200 with `success: true` is still returned; a mock SMTP failure reproduced this silent delivery loss. Missing SMTP also reports a mock send as successful ([src/lib/email.ts:14–20](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/email.ts:14>)).

**Fix:** centralize retrieval and answer validation behind explicit public/staff policies, one model adapter and measured index-compatible queries. Verify plans with `EXPLAIN (ANALYZE, BUFFERS)` on representative staging data. Persist delivery state in an idempotent outbox and report queued/sent/failed accurately; disallow mock delivery in production. No production planner claim was tested here.

### A02 — P2: external calls and database waits have no application deadlines

**Locations:** [src/lib/db.ts:7–13](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/db.ts:7>); [src/lib/gemini.ts:46–68](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/gemini.ts:46>); [src/app/api/chat/route.ts:84–118](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:84>); [src/scripts/run_ingestion.ts:63–64,169–174](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts:63>); [src/widget/ChatWidget.tsx:89–98](</Users/panosgeorgakopoulos/Downloads/sophie/src/widget/ChatWidget.tsx:89>).

Pool limits/timeouts are not explicitly sized for deployment; query/connection deadlines are absent. Retries only identify 429-like errors, lack jitter and Retry-After handling, and do not enforce a total request budget. Both embedding and generation can make four attempts; logging/flagging is also awaited on the response path. There is no client abort, shared concurrency bound, circuit breaker or retrieval cache. One pool per server instance multiplies connections as instances scale. TLS/DB roles may be configured externally; their security is unverified, not proven absent.

**Fix:** budget end-to-end latency with provider and DB deadlines, cancellation, limited jittered retries and a circuit breaker; size pools against maximum instance count. Cache query embeddings and retrieval results by normalized query, ACL, filters, model and corpus version. Add response caching only where no personal history can leak. Decouple operational logging with a bounded queue and explicit failure policy.

### A03 — P2: the HNSW category filter needs recall validation

**Locations:** [src/lib/retrieval.ts:52–58](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:52>); [schema.sql:47–54](</Users/panosgeorgakopoulos/Downloads/sophie/schema.sql:47>).

The halfvec index expression matches chat SQL, which is good. But filtered approximate search has no iterative-scan/ef-search strategy. If PostgreSQL chooses HNSW, post-filtering can underfill results for small categories even with a section B-tree present. This is a conditional scale risk; no live query plan or recall measurement was taken. [pgvector documentation](https://github.com/pgvector/pgvector#filtering) describes this behavior and iterative scans.

**Fix:** benchmark filtered ANN against exact search in staging; use exact filtered retrieval for small subsets or version-supported iterative scans/partial indexes. Add department/audience filters only with a measured recall plan.

### A04 — P2: the audit trail cannot reconstruct an answer or detect many wrong ones

**Locations:** [schema.sql:16–35](</Users/panosgeorgakopoulos/Downloads/sophie/schema.sql:16>); [src/app/api/chat/route.ts:90–115](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:90>); [src/app/admin/(protected)/page.tsx:14–45](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/page.tsx:14>); [src/app/admin/(protected)/documents/page.tsx:12–22](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/documents/page.tsx:12>); [src/app/admin/(protected)/flagged/page.tsx:23–29](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/flagged/page.tsx:23>).

Logs omit retrieved chunk/version IDs, scores, prompt/model version, citations, timings, tokens and validation result. Only zero-context responses are flagged; an in-scope generated refusal, unsupported contact or source conflict can pass unflagged. The knowledge-base screen calls `max(created_at)` last-updated, but re-ingestion time is not source modification or verification time. Aggregate counts scan growing tables; document listings have no pagination; flags show only the newest 100 without access to the rest.

**Fix:** record privacy-minimized request traces with retrieval/version IDs and guardrail outcomes, publish ingestion coverage/freshness metrics, alert on provider/DB failures and contact validation errors. Add keyset pagination and appropriate aggregate/index strategy. Retain audit records for a justified period and audit staff reads/resolutions.

### A05 — P1/P2: dependency advisories exceed the documented XLSX issue

**Locations:** [package.json:13,19–27,42–50](</Users/panosgeorgakopoulos/Downloads/sophie/package.json:13>); [package-lock.json:3773,4039,6743,6880,7940,8026,8122,8140,8879,9286](</Users/panosgeorgakopoulos/Downloads/sophie/package-lock.json:3773>); [README.md:231–235](</Users/panosgeorgakopoulos/Downloads/sophie/README.md:231>).

| Locked package | Registry result and application relevance | Action |
|---|---|---|
| `xlsx 0.18.5` | High prototype-pollution/ReDoS advisories; reachable when local spreadsheet ingestion runs. No public upload endpoint was found. | Replace or use a provenance-verified maintained distribution, isolate parsing and limit decompression/resources. [SheetJS's advisory](https://cdn.sheetjs.com/advisories/CVE-2024-22363) recommends 0.20.2+; README's claim of no upstream fix is too broad—npm's old package is the problem. |
| `next 16.3.6` | Audit reports six advisories, patched range at 16.3.8. Highest-severity image SSRF requires `images.remotePatterns`; none are configured, so that vector is not applicable here. Other advisories concern features/deployment conditions not established in this audit. | Update to an approved patched release, verify compatibility and route behavior. [Maintainer SSRF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4). |
| `sharp 0.35.4` | High bundled-librsvg advisory; attacker-controlled SVG decoding is not established in this code. | Update to a patched release; keep arbitrary image/SVG processing disabled or isolated. |
| `concurrently 10.0.5` → `shell-quote 1.9.0` | Two critical package nodes for one command-quoting issue; development chain with fixed commands here, not demonstrated public RCE. | Update to repaired versions; audit reports `shell-quote >=1.11.0`. |
| `vite 8.1.3`; `braces 3.0.3` through lint tooling | High/moderate development-tool advisories; not public API execution paths. | Update tools and keep development servers private. |
| `source-map-js 1.2.1`; `sprintf-js 1.0.3` via Mammoth/argparse | Resource-exhaustion advisories; malicious input reachability into the specific vulnerable operations was not demonstrated. | Triage and update compatible transitive versions. Do not blindly accept audit's downgrade of Mammoth to 0.3.29 or Next lint config to 14.x. |
| `@google/generative-ai 0.24.1` | Legacy client; not an npm security advisory. Google lists the legacy JavaScript SDK as no longer actively maintained. | Migrate to the maintained adapter and regression-test embedding/output behavior. [Official library guidance](https://ai.google.dev/gemini-api/docs/libraries). |

### A06 — P2: tests validate mechanics rather than institutional correctness

**Locations:** [src/lib/chunking.test.ts:17–23,38–45](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/chunking.test.ts:17>); [src/lib/retrieval.test.ts:29–83](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.test.ts:29>); [src/scripts/smoke_test.ts:51–59](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/smoke_test.ts:51>); [src/scripts/test_scenarios.ts:39–49,65–77](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/test_scenarios.ts:39>); [docs/golden-questions.md:3–16,70–78](</Users/panosgeorgakopoulos/Downloads/sophie/docs/golden-questions.md:3>); [eslint.config.mjs:9–18](</Users/panosgeorgakopoulos/Downloads/sophie/eslint.config.mjs:9>).

Retrieval tests mock rows and check SQL construction/thresholds; smoke tests accept any nonempty reply, including refusal or a wrong answer. Scenario errors are printed without a failing test verdict and history is always empty. The golden questions are manual and mostly describe general expectations rather than exact approved entity tuples. No auth/route/retention/parser/crawl lifecycle suite exists. No CI configuration is tracked. Generated widget lint noise obscures 19 real source errors.

**Fix:** add deterministic critical-field/citation assertions and retrieval fixtures; an LLM judge is optional, not required for email/phone/date/fee validation. Add private-document isolation, webhook signature/replay, stale-source deletion, table/OCR, multilingual and forged-history tests. Establish CI gates for typecheck, source lint, these tests, build and reviewed dependency advisories. Ignore generated output in lint and fix the real source diagnostics.

### A07 — P2: the widget can race requests and reject its own history

**Locations:** [src/widget/ChatWidget.tsx:77–98,100–112,118–144,275–286](</Users/panosgeorgakopoulos/Downloads/sophie/src/widget/ChatWidget.tsx:77>); [src/lib/validation.ts:5–14](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/validation.ts:5>); [src/lib/gemini.ts:25–27](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/gemini.ts:25>).

The send button is disabled while loading, but Enter calls `handleSend`, which does not guard `isLoading`. Multiple in-flight requests can produce out-of-order turns. Input has no matching client length cap; generated assistant text has no cap, yet a later request rejects any history entry over 4,000 characters. Such a reply remains in saved history and can block subsequent turns. Feedback updates the UI before delivery and ignores non-2xx responses. All network failures, 429s and validation failures show the same generic connection error.

**Fix:** guard the handler, sequence/abort requests, enforce matching input limits, bound or summarize stored history safely, handle Retry-After and validation separately, and confirm/roll back feedback on failure. Protect sessionStorage access against exceptions and provide a clear-conversation action. Plain React message rendering and safe external-link attributes are positive existing XSS defenses.

### A08 — P2: operational configuration and migration handling need explicit contracts

**Locations:** [src/lib/retrieval.ts:34](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:34>); [src/scripts/run_ingestion.ts:48,300–305](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts:48>); [schema.sql:1–71](</Users/panosgeorgakopoulos/Downloads/sophie/schema.sql:1>); [migrations/000_historical_baseline.sql:1–9](</Users/panosgeorgakopoulos/Downloads/sophie/migrations/000_historical_baseline.sql:1>); [.env.example:5,14–26](</Users/panosgeorgakopoulos/Downloads/sophie/.env.example:5>); [public/manifest.xml:9,22,74](</Users/panosgeorgakopoulos/Downloads/sophie/public/manifest.xml:9>); [src/app/outlook/layout.tsx:10–21](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/outlook/layout.tsx:10>).

Numeric environment values are not validated: an invalid similarity threshold becomes NaN and refuses every match; zero/negative values can admit irrelevant evidence. Sitemap recursion has no global visited set, HTTP-status/size/deadline validation or host restriction, making malformed/compromised inputs an ingestion-worker availability/SSRF risk, not an established public SSRF endpoint. Manual baseline/schema instructions lack a migration ledger; rerunning CREATE TABLE IF NOT EXISTS does not upgrade existing columns. The Outlook manifest remains localhost-only and its nested layout emits another html/body beneath the root.

**Fix:** validate startup/CLI configuration and reject invalid values; constrain crawling to approved HTTPS hosts and safe resolved IPs/redirects. Adopt ordered migrations and explicit schema/pgvector compatibility checks, backups and restore drills. Make provider/model/region policies explicit deployment configuration. Correct the Outlook integration separately before enabling it. Verify production TLS, DB least privilege, secrets rotation, headers, monitoring and recovery at deployment; this repository does not establish their presence or absence.

## 4. Actionable Remediation Plan

### Phase 0 — contain public exposure before the next deployment

1. **B01/B02:** default-disable draft/webhook/preview routes; inventory corpus sensitivity and serve only explicitly approved public sources through a restricted database policy. Add deny-by-default authorization tests before reenabling staff features.
2. **B03/B04:** repair contact-text loss; suspend generated critical facts unless they come from verified structured records. Remove policy values from the general system prompt and seed an approved, versioned fallback contact record.
3. **B06/B08:** enforce ingress byte/concurrency/shared quota limits; verify EEA provider billing, permitted audience and data-processing arrangements; stop unnecessary personal-data forwarding/logging.

Exit criteria: no unauthenticated staff operation; no private fixture in public retrieval; unsupported critical fields produce abstention; all reproduced loss/security cases are covered by regression tests.

### Phase 1 — rebuild ingestion and evidence provenance

Implement `sources → source_versions → sections/tables/contact_facts → chunks`, plus `ingestion_runs`. A source has canonical URL/file identity, audience, department, language, authority and review status. A version has hash, effective dates, fetch/verification time, parser/model version and original artifact reference. Chunks carry section breadcrumbs, page/table coordinates and parent IDs. Record public PDF attachment relationships and French/Greek equivalents.

Replace the monolithic CLI loop with discover/fetch/parse/validate/embed/publish stages, bounded workers and restartable checkpoints. Embed outside transactions; deduplicate by content hash/model version; atomically activate reviewed versions. Mark removals after successful reconciliation and expire critical facts on policy-defined verification deadlines. Provide an authenticated upload/review workflow if manual upload is a product requirement—none currently exists. Scan/type/size/decompression-check incoming files, parse in an isolated worker without DB/mail credentials, then grant approved publication separately.

Exit criteria: required IFG calendar/fees/regulations PDFs appear with page evidence; OCR failures quarantine; table headers/contacts survive extraction; changed/removed sources retire correctly; unchanged documents require no new embeddings; Greek/French category tests pass.

### Phase 2 — enforce answer correctness in code

Use a common authorized retriever for public chat and staff drafting with different policies. Resolve a structured query (`department`, `program`, `audience`, `academic_year`, `language`, `intent`) from trusted history. Search exact facts plus lexical/dense evidence, rerank and detect source conflicts. Do not silently choose the newest crawl or the highest cosine score as policy authority.

Have generation return a constrained structure such as:

```ts
type EvidenceAnswer = {
  status: 'answer' | 'clarify' | 'abstain';
  language: 'el' | 'fr' | 'en';
  claims: Array<{
    departmentId: string;
    audience?: string;
    field: 'email' | 'phone' | 'address' | 'date' | 'fee' | 'policy';
    factId: string;
    sourceVersionId: string;
    evidenceSpanId: string;
  }>;
};
```

The server must check every fact/evidence ID, authorization, department/audience relationship, validity and source approval. Generate critical display values from the validated facts, rather than trusting a free-form model string. Reject unsupported claims and cite exact evidence. Noncritical prose must not reintroduce unchecked numbers or contacts. For zero-hallucination requirements, this constrained behavior with abstention is the enforceable control; arbitrary generative text has no comparable guarantee.

Update the system instruction to say evidence is untrusted data, prior answers are not evidence, sources cannot grant permissions, and absent/conflicting/expired evidence requires clarification or abstention. Use true system instructions consistently. Specify supported generation limits explicitly and keep human approval for outbound institutional emails until quality gates are established.

Exit criteria: exhaustive approved contact tuples never cross departments; adversarial near-matches, injected documents and forged history cannot introduce unsupported facts; exact dates/fees/citations pass language-specific regression fixtures.

### Phase 3 — operational and privacy acceptance

Add revocable SSO/MFA sessions and role checks; coordinated retention/deletion and staff audit trails; bounded model/DB calls; queue-backed email delivery with retries/idempotency; version-aware caches and structured telemetry. Consolidate duplicated pipelines, update reviewed dependencies/SDK, fix source lint and enforce CI. Load-test representative public traffic and large ingestion runs, verify filtered retrieval recall, establish an IFG-approved p95 latency/error/coverage/freshness target, and exercise backup restore and provider outage behavior.

Release approval requires both source-level controls and deployment evidence: enforced DB grants/TLS, secret storage and rotation, provider/DPA/transfer documentation, actual webhook ingress policy, retention jobs, monitoring ownership and a signed critical-fact test set. A source review alone cannot verify these operational controls.

### File-by-file coverage ledger

Each tracked file is listed below. “No distinct finding” means inspected within this audit's scope; it is not a security certification. Shared findings apply across the listed callers.

| File | Review outcome / finding IDs |
|---|---|
| [.env.example](</Users/panosgeorgakopoulos/Downloads/sophie/.env.example>) | Free-tier guidance, missing production policy contracts, unchecked numeric config: B08, A08. Placeholder values only. |
| [.gitignore](</Users/panosgeorgakopoulos/Downloads/sophie/.gitignore>) | Env/local datasets/generated widget excluded; no distinct flaw found. Does not remove previously committed secrets by itself. |
| [CLAUDE.md](</Users/panosgeorgakopoulos/Downloads/sophie/CLAUDE.md>) | References absent AGENTS.md; no operative implementation guidance. |
| [README.md](</Users/panosgeorgakopoulos/Downloads/sophie/README.md>) | Documents MVP deferrals that are not route gates; overclaims zero-hallucination fallback and XLSX fix status: B02, B04, B08, A05. |
| [docs/golden-questions.md](</Users/panosgeorgakopoulos/Downloads/sophie/docs/golden-questions.md>) | Manual checks, no machine-readable critical fact oracle: A06. |
| [eslint.config.mjs](</Users/panosgeorgakopoulos/Downloads/sophie/eslint.config.mjs>) | Generated widget not excluded; lint noise: A06. |
| [migrations/000_historical_baseline.sql](</Users/panosgeorgakopoulos/Downloads/sophie/migrations/000_historical_baseline.sql>) | Historical-only manual schema record: A08. |
| [migrations/001_vector_indexes_and_cleanup.sql](</Users/panosgeorgakopoulos/Downloads/sophie/migrations/001_vector_indexes_and_cleanup.sql>) | Chat halfvec index alignment good; other routes mismatch: A01/A03. |
| [migrations/002_admin_dashboard.sql](</Users/panosgeorgakopoulos/Downloads/sophie/migrations/002_admin_dashboard.sql>) | No revocation/authorization metadata, manual migration path: B09/A08. |
| [next.config.ts](</Users/panosgeorgakopoulos/Downloads/sophie/next.config.ts>) | No route-disable/preview isolation/security-header policy: B02/B07; no image remotePatterns, relevant to A05. |
| [package.json](</Users/panosgeorgakopoulos/Downloads/sophie/package.json>) | Build/test scripts and direct package versions reviewed: A05/A06. |
| [package-lock.json](</Users/panosgeorgakopoulos/Downloads/sophie/package-lock.json>) | Locked/transitive dependency advisory triage: A05. |
| [postcss.config.mjs](</Users/panosgeorgakopoulos/Downloads/sophie/postcss.config.mjs>) | Static Tailwind plugin configuration; no distinct finding. |
| [public/file.svg](</Users/panosgeorgakopoulos/Downloads/sophie/public/file.svg>) | Static vector; no script/remote reference found. |
| [public/globe.svg](</Users/panosgeorgakopoulos/Downloads/sophie/public/globe.svg>) | Static vector; no script/remote reference found. |
| [public/manifest.xml](</Users/panosgeorgakopoulos/Downloads/sophie/public/manifest.xml>) | Localhost URLs and Outlook capabilities: A08. |
| [public/next.svg](</Users/panosgeorgakopoulos/Downloads/sophie/public/next.svg>) | Static vector; no script/remote reference found. |
| [public/vercel.svg](</Users/panosgeorgakopoulos/Downloads/sophie/public/vercel.svg>) | Static vector; no script/remote reference found. |
| [public/window.svg](</Users/panosgeorgakopoulos/Downloads/sophie/public/window.svg>) | Static vector; no script/remote reference found. |
| [schema.sql](</Users/panosgeorgakopoulos/Downloads/sophie/schema.sql>) | Shared corpus, no version/access/retention trace schema; unused query-vector index: B01/B08, R05, A03/A04/A08. |
| [src/app/admin/(protected)/AdminNav.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/AdminNav.tsx>) | Static navigation; no distinct finding. |
| [src/app/admin/(protected)/ClientLogoutButton.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/ClientLogoutButton.tsx>) | Clears browser session only; no server revocation: B09. |
| [src/app/admin/(protected)/conversations/page.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/conversations/page.tsx>) | All-staff access, count/offset scaling and no data-layer role checks: B08/B09, A04. React escapes displayed text. |
| [src/app/admin/(protected)/documents/page.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/documents/page.tsx>) | Inventory only, no upload; unbounded listing and misleading freshness: R01/R05, A04. |
| [src/app/admin/(protected)/flagged/actions.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/flagged/actions.ts>) | Session checked before parameterized update; no role enforcement/revocation: B09. |
| [src/app/admin/(protected)/flagged/page.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/flagged/page.tsx>) | Newest 100 flags only; shared authorization concerns: A04/B09. |
| [src/app/admin/(protected)/layout.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/layout.tsx>) | Login redirect exists; flat session/role policy: B09. |
| [src/app/admin/(protected)/page.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/(protected)/page.tsx>) | Aggregate scans; no answer-quality/source-freshness telemetry: A04. |
| [src/app/admin/login/page.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/admin/login/page.tsx>) | Password login only; server policy concerns B06/B09; no distinct client injection found. |
| [src/app/api/admin/auth/login/route.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/admin/auth/login/route.ts>) | Password hashing/cookies/timing defense good; abuse limits and input bounds incomplete: B06/B09. |
| [src/app/api/admin/auth/logout/route.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/admin/auth/logout/route.ts>) | Cookie deletion without server invalidation: B09. |
| [src/app/api/chat/route.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts>) | Public shared KB; latest-turn retrieval; trusted client history; unvalidated output; raw logging: B01/B04/B05/B08, R06/R07, A02/A04. |
| [src/app/api/draft-email/route.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/draft-email/route.ts>) | Unauthenticated/unbounded legacy RAG, raw errors: B02/B05/B06, A01/A05/A06. |
| [src/app/api/feedback/route.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/feedback/route.ts>) | Parameterized session-scoped analytics update; client session is not authentication. No live learning loop; B06 shared limiter applies. |
| [src/app/api/webhook/google-form/route.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/webhook/google-form/route.ts>) | Unauthenticated send, prompt/control conflation, personal data and delivery status: B02/B05/B08, A01. |
| [src/app/favicon.ico](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/favicon.ico>) | Static binary asset inventoried; no parser/visual forensic review. |
| [src/app/globals.css](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/globals.css>) | Styling only; no distinct finding. |
| [src/app/layout.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/layout.tsx>) | Conditional public widget; shared app/admin origin relates to B07. Font loading/build checked. |
| [src/app/outlook/layout.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/outlook/layout.tsx>) | Office.js third-party dependency and nested html/body: A08. |
| [src/app/outlook/page.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/outlook/page.tsx>) | Full-mail forwarding, model text→HTML, loose types: B08/B09, A06. |
| [src/app/page.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/page.tsx>) | Test landing page; no distinct security finding. |
| [src/app/preview/route.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/preview/route.ts>) | Upstream scripts on application origin, no fetch budget: B07/A02. |
| [src/config/systemPrompt.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/config/systemPrompt.ts>) | Useful grounding rule, conflicting hardcoded facts, English disclaimer: B04/B05/R07. |
| [src/lib/adminAuth.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/adminAuth.ts>) | Bcrypt/HMAC strengths; non-revocable 12-hour sessions: B09. |
| [src/lib/adminSession.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/adminSession.ts>) | Signature-only auth, no account-state recheck: B09. |
| [src/lib/apiError.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/apiError.ts>) | Generic client error good; full server error logging needs redaction policy: B08/A04. |
| [src/lib/chunking.test.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/chunking.test.ts>) | Lacks text-preservation and department-contact invariants: B03/R03/A06. |
| [src/lib/chunking.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/chunking.ts>) | Destructive period regex, unstructured overlap: B03/R03/R07. |
| [src/lib/cors.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/cors.ts>) | Exact origin matching good; no-origin allowed by design, localhost always allowed; not abuse authentication: B06. |
| [src/lib/db.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/db.ts>) | Shared pool/credentials with no explicit query/connect deadlines or role split: B01/A02/A08. |
| [src/lib/email.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/email.ts>) | Arbitrary recipient path, mock PII logs, mock success: B02/B08. |
| [src/lib/gemini.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/gemini.ts>) | Central models and 429 retry; no deadline/limits/versioned embedding provenance: B04, R06, A02/A05. |
| [src/lib/rateLimit.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/rateLimit.ts>) | Header trust, process-local buckets: B06. |
| [src/lib/retrieval.test.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.test.ts>) | SQL/mock mechanics only, no evidence entailment or private-data isolation: A06. |
| [src/lib/retrieval.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts>) | Dense-only, section-only filter, weak sufficiency/citations: B01/B04, R04/R06, A03. |
| [src/lib/sectionMapping.test.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/sectionMapping.test.ts>) | Greek paths only; no French alias coverage: R04/R07. |
| [src/lib/sectionMapping.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/sectionMapping.ts>) | Missing French/category aliases: R04. |
| [src/lib/validation.test.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/validation.test.ts>) | Useful shape/length checks; no byte/auth/history provenance tests: B05/B06/A06. |
| [src/lib/validation.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/validation.ts>) | Client model-history acceptance; validation after body parsing; output/history mismatch: B05/B06/A07. |
| [src/middleware.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/middleware.ts>) | Pathname propagation only; not an API authorization boundary: B02; convention deprecation warning. |
| [src/scripts/create_admin_user.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/create_admin_user.ts>) | Password on argv, reset doesn't revoke sessions: B09. |
| [src/scripts/run_ingestion.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/run_ingestion.ts>) | All discovery/parser/lifecycle/transaction defects: R01–R05/R08, A08. |
| [src/scripts/smoke_test.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/smoke_test.ts>) | Nonempty-response assertion only: A06. |
| [src/scripts/test_scenarios.ts](</Users/panosgeorgakopoulos/Downloads/sophie/src/scripts/test_scenarios.ts>) | Empty history, no fact assertions/failing verdict: R07/A06. |
| [src/widget/ChatWidget.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/widget/ChatWidget.tsx>) | Plain text escaping good; history/privacy/UI concurrency and feedback issues: B08/A07. |
| [src/widget/main.tsx](</Users/panosgeorgakopoulos/Downloads/sophie/src/widget/main.tsx>) | Script-tag configuration reviewed; deployment must supply data-api-url; no distinct secret exposure found. |
| [src/widget/widget.css](</Users/panosgeorgakopoulos/Downloads/sophie/src/widget/widget.css>) | Styling only; no distinct finding. |
| [tsconfig.json](</Users/panosgeorgakopoulos/Downloads/sophie/tsconfig.json>) | Strict TypeScript enabled; typecheck passed. No distinct finding. |
| [vite.config.mts](</Users/panosgeorgakopoulos/Downloads/sophie/vite.config.mts>) | IIFE artifact built successfully; public output explains lint noise: A06. |
| [vitest.config.ts](</Users/panosgeorgakopoulos/Downloads/sophie/vitest.config.ts>) | Node unit-test scope; no integration/e2e gates: A06. |

Untracked/generated context: [next-env.d.ts](</Users/panosgeorgakopoulos/Downloads/sophie/next-env.d.ts>) is generated and ignored; `.env.local` is ignored; generated widget/build products were regenerated during build validation. Dataset format/coverage findings are in [ingestion-evidence.md](</Users/panosgeorgakopoulos/Downloads/sophie/docs/audit-2026-10-21/ingestion-evidence.md>). Production application source files were not changed by this audit.
