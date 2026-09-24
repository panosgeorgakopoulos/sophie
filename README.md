# Sophie — IFG Chat Widget & Backend

Sophie is a RAG (retrieval-augmented generation) chatbot for the [Institut
Français de Grèce](https://www.ifg.gr) (ifg.gr). It's embedded as a small
widget on the public site and answers questions about courses, exams, pricing,
studies in France, and the library — grounded only in content actually
ingested from ifg.gr and internal policy documents.

## Architecture

A single Next.js 16 app plays four roles:

1. **Backend API** (`src/app/api/chat`, `src/app/api/feedback`) — a
   retrieval-augmented chat endpoint backed by Postgres + [pgvector](https://github.com/pgvector/pgvector)
   and the [Gemini API](https://ai.google.dev) (free tier). See
   [How the RAG pipeline works](#how-the-rag-pipeline-works) below.
2. **Embeddable widget** (`src/widget/`) — a small React chat UI, built
   separately by Vite into a single `public/widget.js` IIFE bundle that any
   page can embed with one `<script>` tag (see
   [Embedding the widget](#embedding-the-widget)).
3. **Ingestion pipeline** (`src/scripts/run_ingestion.ts`) — a CLI script that
   crawls ifg.gr and reads local policy documents (PDF/DOCX/XLSX/MD), chunks
   and embeds the content, and stores it in `documents` for retrieval.
4. **Staff admin dashboard** (`src/app/admin/`) — an internal, password-protected
   UI for non-technical IFG staff to review conversations, feedback, and
   flagged questions, and see what content Sophie actually knows about. See
   [Staff Admin Dashboard](#staff-admin-dashboard) below.

Two additional features exist in this repo but are **not covered by the
production hardening described here** and should not be exposed until
separately addressed:

- **Outlook add-in** (`src/app/outlook/`, `public/manifest.xml`,
  `/api/draft-email`) — an internal staff email-drafting assistant. Its
  manifest still hardcodes `localhost:3000`.
- **Google Form webhook** (`/api/webhook/google-form`) — auto-drafts and
  sends enrollment emails from form submissions. It has no signature/shared-secret
  verification (anyone who finds the URL can trigger it) and sends student PII
  (name, email, age, discount category) to the Gemini free tier without
  minimization. This is a known, accepted risk, deferred by explicit product
  decision — see [Known Limitations](#known-limitations).

## Prerequisites

1. A Postgres database with the `vector` extension available (Neon, Supabase's
   Postgres, or any self-hosted Postgres with pgvector installed all work —
   this app talks to it with the plain `pg` driver, not a vendor SDK).
2. A [Gemini API key](https://aistudio.google.com/apikey) (the free tier is
   sufficient for the MVP).

## Environment Variables

Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` and
`GEMINI_API_KEY` at minimum. See `.env.example` for what each variable does.

## Setup

```bash
npm install

# Apply the schema (creates tables, indexes; safe to re-run)
psql "$DATABASE_URL" -f schema.sql

npm run dev
```

`npm run dev` runs the Next.js dev server and a Vite watch-build of the widget
concurrently. The API is available at `http://localhost:3000/api/chat`, and
the widget is loaded on the Next app's own home page (`/`) for quick local
testing, as well as via `/preview` (proxies a live ifg.gr page with the widget
injected). A `public/demo.html` snapshot may also exist locally for offline
preview — it's gitignored (not committed) since it's a full saved copy of a
live ifg.gr page, including that page's own third-party API keys.

## Running the Ingestion Pipeline

```bash
npx tsx src/scripts/run_ingestion.ts [datasetsDir] [sitemapIndexUrl] [--limit=N]
```

- `datasetsDir` (default `./datasets`): local folder of PDF/DOCX/XLSX/MD
  policy documents to ingest. PDF ingestion is currently disabled by default
  in `main()` pending verification of the installed `pdf-parse` version's
  export shape — DOCX/XLSX/MD cover the current dataset.
- `sitemapIndexUrl` (default `https://www.ifg.gr/sitemap_index.xml`): crawled
  recursively. Thin auto-generated taxonomy sitemaps (category/tag/author) and
  high-volume/time-sensitive ones (events, newsletters) are excluded by
  default — see the `EXCLUDED_SITEMAP_PATTERNS` comment in
  `run_ingestion.ts` for the reasoning. `/news/` posts older than
  `NEWS_MAX_AGE_DAYS` (default 365) are skipped so stale announcements aren't
  treated as current fact.
- `--limit=N`: caps the number of website pages processed — useful for a
  smoke test before burning free-tier embedding quota on a full run.

Each source is re-ingested idempotently (delete-then-reinsert its chunks
inside a transaction, so a crash mid-run can't leave a page with zero chunks).
Re-run this periodically (manually, or via an external scheduler — it's a
long-running rate-limited CLI job, not suited to a serverless function's
timeout) to pick up new/changed content, since ifg.gr changes over time.

## How the RAG Pipeline Works

1. The user's message is embedded (`gemini-embedding-2`) and matched against
   `documents` by cosine similarity (pgvector, HNSW-indexed via a `halfvec`
   expression — see `migrations/001_vector_indexes_and_cleanup.sql` for why).
2. Matches below `RAG_MIN_SIMILARITY` (default 0.55, empirically calibrated —
   see `src/lib/retrieval.ts`) are discarded. If nothing clears the bar, the
   API returns a canned "I don't have verified information on this" reply in
   the detected language (French/English/Greek) instead of calling the LLM —
   this guarantees no hallucination on genuinely out-of-scope questions and
   saves a Gemini call.
3. Otherwise, the surviving chunks are assembled into a context block and
   sent to `gemini-3.5-flash-lite` alongside the system prompt
   (`src/config/systemPrompt.ts`), which enforces IFG's persona, conversation
   rules (e.g. asking clarifying questions before quoting course pricing),
   and a "never state a fact that isn't in the context" grounding rule.
4. The reply, plus deduplicated sources (with clickable URLs where
   applicable), are returned to the widget and logged to `chat_logs`.

An earlier version of this pipeline also re-injected past `is_helpful=true`
chat logs as live few-shot examples ("RAG on logs"). That was removed: it was
an unmoderated feedback loop (a user's own thumbs-up could reshape future
answers with no human review) and was exploitable before the `/api/feedback`
IDOR fix. `chat_logs.is_helpful` is retained purely as an analytics signal for
manual review, not as live prompt input.

## Building the Widget

```bash
npx vite build
```

Outputs `public/widget.js`, a self-contained IIFE. `npm run build` runs this
automatically before `next build`, so a production build never ships a stale
widget bundle.

## Embedding the Widget on ifg.gr

```html
<script src="https://your-deployment-url/widget.js" data-api-url="https://your-deployment-url/api/chat" defer></script>
```

The backend must have `ALLOWED_ORIGINS` set to include the real ifg.gr
origin(s) for the widget's cross-origin requests to succeed (see
`src/lib/cors.ts`).

## Staff Admin Dashboard

An internal dashboard at `/admin` lets IFG staff — not just IT — see how
Sophie is doing without touching the database or code:

- **Overview**: conversation volume, helpful/not-helpful feedback rate, how
  many conversations need review, and what's in the knowledge base by
  category.
- **Conversations**: browse every question and answer, filterable by
  category.
- **Needs review**: conversations where Sophie couldn't find a confident
  answer — the fastest way to spot a missing or outdated page. Staff can mark
  items resolved once they've acted on them (e.g. asked IT to add a page, or
  determined it's a one-off).
- **Knowledge base**: every page/document Sophie has actually read, with a
  link back to the live page where applicable — answers what "does Sophie
  know about X" without needing DB access.

It is **not** the widget's public API and is not exposed to ifg.gr visitors.

### Creating a staff account

There's no public sign-up form by design. Create or reset an account from the
server with:

```bash
npx tsx src/scripts/create_admin_user.ts "marie@ifg.gr" "a-strong-password" "Marie Dupont" staff
```

The last argument (`role`) is currently informational (`staff` or `admin`) —
a hook for role-based permissions later without changing the schema. Anyone
with an account can currently see everything; add per-role restrictions in
`src/app/admin/(protected)/` if that becomes necessary.

Requires `ADMIN_SESSION_SECRET` to be set (see `.env.example`) — the app
fails fast on startup of any admin route if it's missing, same as a missing
`GEMINI_API_KEY`.

## Testing

```bash
npm test              # Vitest unit tests (chunking, section mapping, validation, retrieval)
npx tsx src/scripts/smoke_test.ts       # hits a running dev server, checks for non-empty replies
npx tsx src/scripts/test_scenarios.ts   # writes qualitative multilingual scenario transcripts to docs/scenario_results.md
```

See `docs/golden-questions.md` for a curated list of real questions with
expected facts, meant for manual review after prompt/ingestion changes —
full natural-language answer correctness can't be reliably automated without
a separate LLM-judge layer, which is out of scope for this MVP.

## Known Limitations

- **Free-tier Gemini quota is opaque and Google-controlled.** Exact
  RPM/TPM/RPD limits are only visible per-project in AI Studio, not published,
  and can change. `src/lib/gemini.ts` retries transient 429s with backoff, and
  `src/lib/rateLimit.ts` throttles per-IP request volume, but sustained load
  can still degrade to "please try again" responses.
- **Grounding reduces but cannot fully guarantee zero hallucination.** Even
  with a similarity threshold and an explicit anti-hallucination system
  prompt rule, an LLM can still misstate or conflate retrieved facts. Mitigated,
  not solved, by the golden-question review process above.
- **The `/api/feedback` IDOR fix relies on a client-supplied, non-authenticated
  `session_id`** (the app has no login system). It closes the "rate any
  arbitrary log_id" attack but isn't cryptographic auth. Acceptable since
  feedback is no longer read by the live prompt pipeline.
- **The Google Form webhook and Outlook add-in are explicitly out of scope**
  for the hardening in this repo's current state (see
  [Architecture](#architecture)) — do not expose them publicly as-is.
- **Rate limiting is in-memory, per server process**, not a shared/distributed
  store. On a platform running multiple concurrent instances, each enforces
  its own limit rather than a global one. A meaningful mitigation for the MVP;
  if traffic grows enough to matter, swap `src/lib/rateLimit.ts`'s
  implementation for a shared store (e.g. Redis) behind the same
  `checkRateLimit()` signature.
- **Admin dashboard accounts are flat** — any staff account can see every
  conversation and the whole knowledge base; there's no per-role restriction
  yet (the `role` column on `admin_users` is there for this, unused so far).
  Fine for a small, trusted staff group; add checks in
  `src/app/admin/(protected)/` before opening it up more widely.
- **Ingestion coverage depends on ifg.gr's sitemap being complete and its URL
  structure staying stable.** A page under an unrecognized path still gets
  ingested (just untagged, served only under the "All" filter) rather than
  silently dropped — see `src/lib/sectionMapping.ts`.
- **`xlsx` has a known high-severity advisory with no upstream fix
  available** (prototype pollution / ReDoS). It's only used by the offline
  ingestion script against admin-supplied local files, not reachable from the
  public API surface, so this is an accepted, documented risk rather than a
  live one.
