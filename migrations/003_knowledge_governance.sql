-- Run once via the migration runner. Legacy chunks stay intact but are not public.
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key text NOT NULL UNIQUE,
  source_name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('website','pdf','docx','xlsx','md')),
  audience text NOT NULL DEFAULT 'private' CHECK (audience IN ('private','public')),
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  department_id text NOT NULL,
  sections text[] NOT NULL DEFAULT '{}',
  language text NOT NULL DEFAULT 'mul' CHECK (language IN ('el','fr','en','mul')),
  authority integer NOT NULL DEFAULT 0 CHECK (authority BETWEEN 0 AND 100),
  active_version_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn','quarantined')),
  last_seen_at timestamptz,
  last_seen_run_id uuid,
  last_verified_at timestamptz,
  last_error text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES knowledge_sources(id),
  content_hash text NOT NULL,
  parser_version text NOT NULL,
  embedding_model text NOT NULL,
  effective_from timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, content_hash, parser_version, embedding_model),
  UNIQUE(source_id, id),
  CHECK (expires_at IS NULL OR effective_from IS NULL OR expires_at > effective_from)
);

DO $$ BEGIN
  ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_active_version_fk
    FOREIGN KEY(id, active_version_id) REFERENCES knowledge_versions(source_id, id) DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES knowledge_sources(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES knowledge_versions(id);
DO $$ BEGIN
  ALTER TABLE documents ADD CONSTRAINT documents_source_version_fk
    FOREIGN KEY(source_id, version_id) REFERENCES knowledge_versions(source_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS documents_version_chunk_idx
  ON documents(version_id, (metadata->>'chunk_index')) WHERE version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_source_version_idx ON documents(source_id,version_id);
CREATE INDEX IF NOT EXISTS documents_lexical_idx ON documents USING gin(to_tsvector('simple',content));
CREATE INDEX IF NOT EXISTS knowledge_sources_sections_idx ON knowledge_sources USING gin(sections);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','complete','partial','failed')),
  scope text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}'
);

CREATE OR REPLACE FUNCTION reset_source_approval_on_version_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.active_version_id IS DISTINCT FROM OLD.active_version_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.audience IS DISTINCT FROM OLD.audience
     OR NEW.sections IS DISTINCT FROM OLD.sections
     OR NEW.language IS DISTINCT FROM OLD.language
     OR NEW.authority IS DISTINCT FROM OLD.authority THEN
    NEW.approval_status := 'pending';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_sources_reset_approval ON knowledge_sources;
CREATE TRIGGER knowledge_sources_reset_approval BEFORE UPDATE ON knowledge_sources
FOR EACH ROW EXECUTE FUNCTION reset_source_approval_on_version_change();

CREATE TABLE IF NOT EXISTS knowledge_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES knowledge_sources(id),
  version_id uuid NOT NULL REFERENCES knowledge_versions(id),
  department_id text NOT NULL,
  subject_key text NOT NULL,
  subject_label text NOT NULL,
  subject_aliases text[] NOT NULL DEFAULT '{}',
  qualifiers jsonb NOT NULL DEFAULT '{}',
  audience text NOT NULL DEFAULT 'public' CHECK(audience IN ('public','private')),
  field text NOT NULL CHECK(field IN ('email','phone','address','date','fee','contact','policy')),
  value text NOT NULL CHECK(length(value) BETWEEN 1 AND 2000),
  language text NOT NULL CHECK(language IN ('el','fr','en')),
  evidence_chunk_id uuid NOT NULL REFERENCES documents(id),
  evidence_quote text NOT NULL,
  effective_from timestamptz,
  expires_at timestamptz,
  approval_status text NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(source_id,version_id) REFERENCES knowledge_versions(source_id,id),
  CHECK(expires_at IS NULL OR effective_from IS NULL OR expires_at > effective_from),
  CHECK(approval_status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS knowledge_facts_subject_idx ON knowledge_facts(department_id,subject_key,field);
CREATE INDEX IF NOT EXISTS knowledge_facts_version_idx ON knowledge_facts(source_id,version_id);

CREATE OR REPLACE VIEW public_knowledge_documents WITH (security_barrier=true) AS
  SELECT d.id, d.content, d.embedding, d.source_type, d.source_name,
    d.metadata || jsonb_build_object(
      'source_id',s.id,'version_id',v.id,'department_id',s.department_id,
      'sections',s.sections,'language',s.language,'authority',s.authority,
      'embedding_model',v.embedding_model,'verified_at',s.last_verified_at
    ) AS metadata,
    d.source_id, d.version_id, s.department_id, s.sections, s.language,
    s.authority, v.embedding_model, d.created_at
  FROM documents d
  JOIN knowledge_sources s ON s.id=d.source_id
  JOIN knowledge_versions v ON v.id=d.version_id AND v.source_id=s.id
  WHERE s.audience='public' AND s.approval_status='approved' AND s.status='active'
    AND s.active_version_id=v.id
    AND (v.effective_from IS NULL OR v.effective_from<=now())
    AND (v.expires_at IS NULL OR v.expires_at>now());

CREATE OR REPLACE VIEW public_knowledge_facts WITH (security_barrier=true) AS
  SELECT f.*, d.source_name, d.source_type, d.sections, d.language AS source_language,
    d.authority, d.content AS evidence_content, d.metadata AS evidence_metadata
  FROM knowledge_facts f JOIN public_knowledge_documents d
    ON d.id=f.evidence_chunk_id AND d.source_id=f.source_id AND d.version_id=f.version_id
       AND d.department_id=f.department_id
  WHERE f.audience='public' AND f.approval_status='approved'
    AND f.expires_at IS NOT NULL AND f.expires_at>now()
    AND (f.effective_from IS NULL OR f.effective_from<=now())
    AND length(f.evidence_quote)>0 AND position(f.evidence_quote in d.content)>0
    AND position(f.value in f.evidence_quote)>0;

REVOKE ALL ON public_knowledge_documents,public_knowledge_facts FROM PUBLIC;

CREATE TABLE IF NOT EXISTS knowledge_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  action text NOT NULL,
  source_id uuid REFERENCES knowledge_sources(id),
  fact_id uuid REFERENCES knowledge_facts(id),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
