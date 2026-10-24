CREATE TABLE ingestion_uploads (
  id uuid PRIMARY KEY,
  original_name text NOT NULL,
  canonical_key text NOT NULL,
  format text NOT NULL CHECK(format IN ('pdf','docx','xlsx','md')),
  content_hash text NOT NULL,
  byte_size integer NOT NULL CHECK(byte_size > 0 AND byte_size <= 20971520),
  policy jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES admin_users(id),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','quarantined','failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  lease_token uuid,
  source_id uuid REFERENCES knowledge_sources(id),
  result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  file_deleted_at timestamptz
);
CREATE INDEX ingestion_uploads_queue_idx ON ingestion_uploads(status,created_at);
CREATE INDEX ingestion_uploads_identity_idx ON ingestion_uploads(canonical_key,created_at);

-- Editing approved assertions always requires a new explicit review.
CREATE FUNCTION reset_fact_approval_on_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['approval_status','reviewed_by','reviewed_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['approval_status','reviewed_by','reviewed_at']) THEN
    NEW.approval_status := 'pending'; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_fact_changed BEFORE UPDATE ON knowledge_facts
  FOR EACH ROW EXECUTE FUNCTION reset_fact_approval_on_change();

-- Evidence is append-only; corrected content must become a new version.
CREATE FUNCTION forbid_evidence_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Evidence is immutable; publish a new source version'; END $$;
CREATE TRIGGER knowledge_version_immutable BEFORE UPDATE ON knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_evidence_rewrite();
CREATE TRIGGER knowledge_chunk_immutable BEFORE UPDATE ON documents
  FOR EACH ROW WHEN (OLD.version_id IS NOT NULL) EXECUTE FUNCTION forbid_evidence_rewrite();
