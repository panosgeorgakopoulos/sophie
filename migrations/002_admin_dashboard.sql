-- Staff accounts for the internal admin dashboard. Deliberately a real table
-- with hashed passwords (bcrypt) rather than a single shared env-var password,
-- so individual IFG staff (not just IT) can have their own login and this can
-- grow role-based permissions later without a rework.
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null,
  role text not null default 'staff',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_login_at timestamp with time zone
);

-- Lets staff triage "no relevant context found" / escalated conversations
-- from the dashboard instead of only seeing them accumulate silently.
alter table flagged_conversations add column if not exists resolved boolean not null default false;
alter table flagged_conversations add column if not exists resolved_at timestamp with time zone;
alter table flagged_conversations add column if not exists resolved_by text;

create index if not exists chat_logs_created_at_idx on chat_logs (created_at desc);
create index if not exists flagged_conversations_created_at_idx on flagged_conversations (created_at desc);
create index if not exists flagged_conversations_resolved_idx on flagged_conversations (resolved);
