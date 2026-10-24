-- Revocable opaque staff sessions and multi-instance rate limits.
-- Run with the migration owner, not the public application's restricted role.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;

-- Password, role and account status changes revoke sessions even outside the CLI.
CREATE OR REPLACE FUNCTION invalidate_staff_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at THEN
    NEW.session_version := OLD.session_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS admin_credentials_changed ON admin_users;
CREATE TRIGGER admin_credentials_changed BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION invalidate_staff_sessions();

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  session_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key text PRIMARY KEY CHECK (length(bucket_key) = 64),
  hits integer NOT NULL CHECK (hits > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx ON rate_limit_buckets(expires_at);

-- Schedule the retention maintenance command documented in the operations runbook.
-- Expired rows are never accepted even if maintenance is delayed.
