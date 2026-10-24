# IFG hardening validation — 24 October 2026

The changes are prepared locally on `codex/ifg-production-hardening`, following the [21 October audit](../audit-2026-10-21/AUDIT.md). The audit baseline was `f634064ff0f104ee1ab2b5f0cd15a53c94356076`. This record covers the current working tree; it is not evidence of a deployed release or certification.

## Results

| Check | Result | Evidence |
|---|---|---|
| TypeScript | Passed | [typecheck.log](typecheck.log) |
| ESLint | Passed | [lint.log](lint.log) |
| Unit and regression suite | 172 tests across 25 files passed | [unit-tests.log](unit-tests.log) |
| PostgreSQL integration | 41 assertions passed; zero embedding provider calls | [database-tests.log](database-tests.log) |
| Production HTTP integration | 25 assertions passed; zero external provider calls | [http-tests.log](http-tests.log) |
| Production build | Vite widget and Next application passed | [build.log](build.log) |
| Migration runner | Two repeated runs passed against the migrated isolated database | [migrations.log](migrations.log) |
| Dependency advisory scan | Zero known vulnerabilities reported by npm audit | [npm-audit.json](npm-audit.json) |
| Patch whitespace | `git diff --check` passed | Local command |
| Widget inspection | French synthetic answer and expanded source quote inspected in the browser | [23 October screenshot](../validation-2026-10-23/widget-fixture.png) |

Local checks used Node 25.8.1 on macOS, PostgreSQL 18.4 and pgvector in an isolated `sophie_test_release` database. Node 26 is the configured deployment/CI target; the GitHub workflow has been prepared but not run here. The database suite resets application tables only in the explicitly named test database. The HTTP suite starts the built application on a temporary loopback port with a restricted reader role and all provider gates disabled. HTTP fixtures use unique aliases and client identifiers; repeat execution was also checked without resetting the database.

The fresh database migration path was exercised during preparation, followed by repeated checksum-ledger runs. The saved migration log records the final idempotence checks, not a production migration or restore rehearsal.

## What the checks establish

- Public SQL views exclude private, pending, withdrawn, expired, obsolete-version and wrong-department evidence. A restricted reader cannot query raw corpus tables.
- Fact review binds an exact value and quote to the current source/version/chunk. Source replacement revokes public approval. Approved values are rendered deterministically with evidence identifiers; missing or ambiguous evidence causes abstention.
- Greek/French subject matching, contact punctuation, explicit and inherited qualifiers, conflicting values, malformed model output, hostile prompts and provider failure paths have regression coverage. This is a synthetic evaluation, not a measured live-corpus accuracy result.
- Opaque staff sessions revoke on logout and password/role changes. Authentication, role checks and same-origin mutations protect review/upload operations. Production fails closed without a canonical staff origin.
- Shared PostgreSQL quotas serialize concurrent requests. Provider calls require explicit processing/public-use gates and paid-service confirmation; deadlines and retry budgets bound external work.
- The real HTTP flow covers login, source review, fact drafting and approval, exact public answers, versioned citations, single-use feedback, conversation erasure, forged-history rejection, Greek upload filenames and disabled unsafe integrations.
- PDF, DOCX and XLSX fixtures exercise actual parsers. Lossless chunks preserve heading/table/contact context. Hostile ZIPs, weak PDF extraction, unsupported content and unresolved dynamic tabs are rejected or quarantined.
- Upload leases prevent stale owners from publishing or completing jobs. Publication and queue completion commit together. An interleaved-worker database regression proves that each newly claimed upload gets its own run, allowing the newest replacement to become current even when another worker published the prior generation during this worker's batch.
- Conversation deletion cascades to associated analytics and prevents late inserts from restoring deleted logs. Raw questions and query embeddings are not retained by the new chat path.

## Implementation entry points

| Area | Main files |
|---|---|
| Source/version/fact governance | `migrations/003_knowledge_governance.sql`, `migrations/006_review_and_uploads.sql`, `src/lib/knowledgeReview.ts` |
| Verified public answers | `src/lib/facts.ts`, `src/lib/answer.ts`, `src/lib/retrieval.ts`, `src/app/api/chat/route.ts` |
| Staff security and request limits | `src/lib/adminAuth.ts`, `src/lib/adminApi.ts`, `src/lib/requestSecurity.ts`, `src/lib/rateLimit.ts` |
| Ingestion and evidence publication | `src/lib/ingestion/`, `src/lib/chunking.ts`, `src/scripts/run_ingestion.ts` |
| Quarantine uploads and worker ordering | `src/lib/uploadStorage.ts`, `src/lib/uploadQueue.ts`, `src/lib/uploadWorker.ts`, `src/scripts/process_uploads.ts` |
| Privacy and retention | `src/lib/conversation.ts`, `src/scripts/maintenance.ts`, `src/widget/ChatWidget.tsx` |
| Release controls | `.github/workflows/verify.yml`, `src/scripts/migrate.ts`, `ops/public-reader.sql`, `ops/parser.Dockerfile` |

## Remaining launch requirements

Follow the [staged rollout guide](../production-hardening.md) in order. No production database, source approval, provider API, email delivery or deployment was changed during validation.

1. Rehearse backup/restore and migrations in staging; provision separate operational, migration and restricted public-reader accounts. Configure trusted TLS ingress, exact origins and institutional SSO/MFA.
2. Install/update ClamAV, build and scan the parser container, pin its digest, and test isolation on the deployment host. The local Docker daemon was unavailable, so production container execution and real malware scanning were not validated. Missing required parser/scanner configuration fails closed.
3. Classify the actual corpus, complete the required-source inventory, and review source versions, department/subject aliases and expiring facts. Existing ungoverned chunks do not become publicly answerable automatically. There is an authenticated upload/review API and a source dashboard, but no graphical upload/fact editor.
4. Resolve actual PDF/table fidelity, Greek/French OCR and JavaScript-only tab coverage. The OCR callback is an integration point; no OCR engine or browser-rendering service is deployed. Required sources with unresolved extraction remain a launch blocker.
5. Complete IFG controller/DPO, lawful-basis, processor, audience, transfer, retention and rights decisions, including the provider's EEA/minor-audience suitability. Keep all model gates false until those decisions are made. Reconcile historical transcripts, exports and backups through the approved erasure procedure.
6. Run an institution-reviewed Greek/French question set against approved live evidence; measure coverage, abstention and attribution errors. Load-test production-like corpus/concurrency, configure alerts and schedules, and execute the CI workflow on the target runtime.

Zero advisory findings do not prove absence of vulnerabilities. Exact evidence prevents model-authored critical values from entering the response, but human review errors, incomplete aliases and misunderstood questions remain possible. This work does not establish GDPR compliance or an absolute zero-error guarantee.

The widget screenshot uses the synthetic value `library-http@example.invalid` and a fixture URL, not a verified IFG contact or live institutional content.
