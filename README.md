# Sophie — IFG verified information assistant

Sophie serves Greek, French and English institutional information for the Institut Français de Grèce. This branch implements the remediation of the [21 October audit](docs/audit-2026-10-21/AUDIT.md). It is a staged release: existing ungoverned chunks are deliberately excluded from public answers until the institution reviews the new corpus and facts.

## Public answer boundary

The public endpoint resolves an explicitly named subject against approved aliases, checks department, category, qualifiers and validity, and returns exact approved values with their source version and evidence quote. Email addresses, phone numbers, dates, addresses and fees are rendered without a model. Missing evidence, conflicting contacts, ambiguous subjects and mismatched course levels produce an abstention or clarification.

For policy questions, an optional model may select approved fact IDs. It cannot supply the displayed answer text. Public model selection is disabled by default. Database views, immutable evidence, explicit review and deterministic rendering enforce the boundary. Incorrect human approval or an incomplete alias catalog remain real risks; this is not a guarantee that every user question will be understood correctly.

`src/lib/retrieval.ts` also provides approved-only dense plus PostgreSQL full-text search with reciprocal-rank fusion. It is available for evidence discovery; the public chat does **not** use unrestricted chunk synthesis. Its lexical rank is PostgreSQL `ts_rank_cd`, not BM25. Exact filtered search prioritizes recall and authorization correctness; benchmark representative corpus sizes before introducing approximate retrieval.

## Local setup

Use Node 26 for deployment and CI (the parser requires Node 25.8 or newer), PostgreSQL with pgvector supporting `halfvec`, and `npm ci`. Copy `.env.example` to `.env.local` and configure a local database. No credential is committed.

```sh
npm ci
npm run db:migrate
npm run dev
```

`db:migrate` requires an explicit `MIGRATION_DATABASE_URL`. It bootstraps a fresh database, applies ordered migrations with a checksum ledger and advisory lock, and refuses modified applied migrations. `schema.sql` alone is only the historical bootstrap baseline. For an existing database, take and verify a backup first; there is no automatic destructive downgrade.

`DATABASE_URL` is the operational application account. `PUBLIC_DATABASE_URL` is a separate account with SELECT on the two public views only. Production rejects a reader account which can select the raw document/fact tables. See [operations](docs/production-hardening.md) and [reader role provisioning](ops/public-reader.sql).

## Ingestion

```sh
# Parse without database writes or embedding calls; reports partial coverage honestly.
npm run ingest -- ./datasets https://www.ifg.gr/sitemap_index.xml --scope=local --manifest=./datasets/ingestion-manifest.json
npm run ingest -- ./datasets https://www.ifg.gr/sitemap_index.xml --scope=web --limit=20

# After provider/data-processing approval and review of dry-run results:
npm run ingest -- ./datasets https://www.ifg.gr/sitemap_index.xml --manifest=./datasets/ingestion-manifest.json --write
```

Every local file needs an explicit manifest policy. See [the example](ops/ingestion-manifest.example.json). Local content defaults to private. Crawling follows allowlisted HTTPS links and linked PDFs, records tab/header/table/page context, decodes protected contacts and rejects unsafe redirects or private DNS answers. The crawler checks robots rules and bounds pages, depth, bytes and time. It deliberately excludes news/events/taxonomy feeds; maintain `requiredUrls` for all critical sources.

New content is staged into an immutable version. Embeddings are calculated before the short publication transaction. Unchanged content avoids repeat embedding; changed content resets source approval. PDF/DOCX/XLSX production parsers require a digest-pinned container with no network or application secrets and bounded resources; local development uses a separate subprocess. Weak PDF extraction, unresolved dynamic tabs, unsupported DOCX constructs and spreadsheet formulas require remediation/manual review. The optional OCR adapter is an integration point, not an installed OCR service. JavaScript-only content is not claimed as successfully scraped.

Only a complete run can use `--reconcile` to withdraw previously indexed sources missing from its inventory. HTTP 404/410 withdraws that source. Failed extraction quarantines an existing source; partial crawls never mass-delete unseen pages. Keep critical facts time-bounded and monitor failed runs.

## Uploads and review

Staff may upload PDF, DOCX, XLSX or Markdown through `POST /api/admin/uploads`; this is an authenticated API, not yet a graphical upload form. Uploads are limited to 20 MiB, stored outside the application tree, queued and scanned by configured ClamAV before parsing. Run `npm run uploads:process` in the isolated ingestion worker. Scanner absence or failure never bypasses scanning. Replacing the same logical filename in the same department creates a new pending version. See the exact request and review sequence in [the runbook](docs/production-hardening.md#review-workflow).

Reviewers approve a source version and then individual, expiring facts through `/api/admin/knowledge`. Fact drafts require an exact value inside an exact evidence quote, a department-bound source version, subject aliases, language and any course/date/audience qualifiers. Source approval alone does not make unreviewed facts answerable. Conflicting values abstain; authority ranking does not resolve institutional policy disagreements automatically.

Create staff accounts with a hidden interactive password prompt:

```sh
npx tsx src/scripts/create_admin_user.ts reviewer@ifg.gr 'Reviewer Name' reviewer
```

Roles are `staff`, `reviewer`, and `admin`. Password/role/disable changes revoke existing sessions; logout deletes its opaque bearer token. Protect production staff access with the institution's approved SSO/MFA gateway. No identity provider has been fabricated or configured by this change.

## Privacy and integrations

The widget sends no caller-authored assistant history. It keeps displayed messages in page memory and a random conversation token in session storage. Server context contains only selected institutional subject/qualifiers/language and expires after 30 minutes. Application analytics omit raw questions and query embeddings. Clear conversation removes its context and associated logs, including concurrent insert protection. Schedule `npm run db:maintain` hourly; see the runbook for retention, legacy transcript removal and backup policy.

The public technical privacy page needs institutional legal/controller information before launch. Embeddings require both `GEMINI_PROCESSING_APPROVED=true` and `GEMINI_PAID_SERVICE_CONFIRMED=true`; public policy selection requires both `GEMINI_APPROVED_FOR_PUBLIC_USE=true` and paid-service confirmation. All gates default false. These controls do not themselves establish lawful processing, contractual suitability or data residency.

The unsafe automatic email webhook and draft endpoint return `503`; Outlook no longer reads or transmits messages. Re-enabling mail requires a separately reviewed authenticated approval/outbox workflow. Production `/preview` returns `404`; development uses a local fixture.

## Build and verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm audit

# Use only an isolated test database whose name starts with sophie_test_.
MIGRATION_DATABASE_URL=postgres://localhost/sophie_test_local npm run db:migrate
TEST_DATABASE_URL=postgres://localhost/sophie_test_local npm run test:db
TEST_DATABASE_URL=postgres://localhost/sophie_test_local npm run test:http
```

The CI workflow is configured to repeat checks and database integration against an isolated pgvector service; it has not been run on GitHub as part of this local change. `test:db` resets application tables in its explicitly named test database. The tests cover evidence permissions and version changes, multilingual exact subjects, private/expired/wrong-department exclusion, session revocation, concurrent quotas and real document parser fixtures. They use synthetic data and mocked model responses; they do not validate the live IFG corpus or provider quality. [The validation record](docs/validation-2026-10-24/README.md) records local results. [The rollout guide](docs/production-hardening.md) records the remaining launch gates and audit mapping.

The widget bundle is produced by Vite during `npm run build`:

```html
<script src="https://YOUR-DEPLOYMENT/widget.js" data-api-url="https://YOUR-DEPLOYMENT/api/chat" defer></script>
```

Configure exact widget origins, canonical `APP_ORIGIN` and an ingress-overwritten client IP header. Block direct access to the origin. CORS is a browser control, not authentication; shared server quotas remain mandatory.
