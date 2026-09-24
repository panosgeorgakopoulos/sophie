-- Enable pgvector extension
create extension if not exists vector;

-- Create documents table
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(3072) not null,
  metadata jsonb not null default '{}'::jsonb,
  source_type text not null, -- 'website' or 'pdf'
  source_name text not null, -- URL or filename
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create flagged_conversations table
create table if not exists flagged_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_history jsonb not null,
  flag_reason text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  resolved boolean not null default false,
  resolved_at timestamp with time zone,
  resolved_by text
);

-- Create chat_logs table for comprehensive interaction logging
create table if not exists chat_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_message text not null,
  assistant_reply text not null,
  is_helpful boolean, -- null initially, true/false if rated
  message_embedding vector(3072), -- for continuous learning
  section text, -- the section context of the interaction
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Similarity search is done directly from application code (src/lib/retrieval.ts)
-- using cosine distance (<=>), not a DB-side function -- this keeps retrieval
-- logic testable/versioned in TypeScript alongside validation and thresholds.

-- Vector indexes: documents.embedding / chat_logs.message_embedding are
-- vector(3072), which exceeds pgvector's 2000-dimension cap for HNSW/ivfflat
-- indexes on the native `vector` type. Index a half-precision (halfvec)
-- expression instead. Queries MUST cast to the identical
-- embedding::halfvec(3072) expression for the planner to use these indexes.
create index if not exists documents_embedding_hnsw_cosine_idx
  on documents using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

create index if not exists chat_logs_message_embedding_hnsw_cosine_idx
  on chat_logs using hnsw ((message_embedding::halfvec(3072)) halfvec_cosine_ops);

create index if not exists documents_section_idx
  on documents ((metadata->>'section'));

create index if not exists chat_logs_created_at_idx on chat_logs (created_at desc);
create index if not exists flagged_conversations_created_at_idx on flagged_conversations (created_at desc);
create index if not exists flagged_conversations_resolved_idx on flagged_conversations (resolved);

-- Staff accounts for the internal admin dashboard (src/app/admin/). Real
-- accounts with hashed passwords rather than one shared password, so
-- individual non-IT staff can have their own login.
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null,
  role text not null default 'staff',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_login_at timestamp with time zone
);
