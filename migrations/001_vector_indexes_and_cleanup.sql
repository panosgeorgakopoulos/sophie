-- Drop the dead, dimension-mismatched match_documents function. It declares
-- query_embedding vector(768) while documents.embedding is vector(3072), so it
-- would error if ever called -- and nothing calls it; all app code queries
-- documents/chat_logs directly via src/lib/retrieval.ts instead.
DROP FUNCTION IF EXISTS match_documents(vector(768), int);

-- documents.embedding and chat_logs.message_embedding are vector(3072), which
-- exceeds pgvector's 2000-dimension cap for HNSW/ivfflat indexes on the native
-- `vector` type. Index a half-precision (halfvec) expression instead -- the
-- standard pgvector approach for >2000-dim columns (halfvec supports up to
-- 4000 dims). Application queries MUST cast to the identical
-- embedding::halfvec(3072) expression for the planner to use these indexes
-- (see src/lib/retrieval.ts) -- ordering by the raw vector column will not.
CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_cosine_idx
  ON documents USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS chat_logs_message_embedding_hnsw_cosine_idx
  ON chat_logs USING hnsw ((message_embedding::halfvec(3072)) halfvec_cosine_ops);

-- The chat route filters retrieval by metadata->>'section'.
CREATE INDEX IF NOT EXISTS documents_section_idx
  ON documents ((metadata->>'section'));
