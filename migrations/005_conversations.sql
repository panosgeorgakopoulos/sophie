-- No caller-authored model history. Store only approved subject context, never raw prompts.
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create index if not exists chat_sessions_expires_idx on chat_sessions(expires_at);

alter table chat_logs add column if not exists feedback_token_hash text;
alter table chat_logs add column if not exists conversation_id uuid references chat_sessions(id) on delete cascade;
create index if not exists chat_logs_conversation_idx on chat_logs(conversation_id);
alter table chat_logs add column if not exists expires_at timestamptz not null default now() + interval '30 days';
alter table chat_logs add column if not exists outcome text;
alter table chat_logs add column if not exists evidence jsonb not null default '[]'::jsonb;
alter table chat_logs add column if not exists model_metadata jsonb not null default '{}'::jsonb;
create index if not exists chat_logs_expiry_idx on chat_logs(expires_at);

-- Retention is an operational job as well as a query-time expiry boundary.
-- Remove expired retained rows; run at least hourly using the documented maintenance command.
create or replace function purge_expired_chat_data() returns void language plpgsql as $$
begin
  delete from chat_sessions where expires_at <= now();
  delete from chat_logs where expires_at <= now();
  delete from flagged_conversations where created_at < now() - interval '30 days';
end;
$$;
