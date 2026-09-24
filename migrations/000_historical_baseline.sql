-- Historical: applied manually via the ad hoc root script `update_schema.ts`
-- before this migrations/ directory existed. Recorded here for reference only;
-- it has already been applied to the production database and this file is not
-- meant to be re-run against it. A fresh database created from schema.sql
-- already includes these columns.

ALTER TABLE chat_logs
  ADD COLUMN IF NOT EXISTS message_embedding vector(3072),
  ADD COLUMN IF NOT EXISTS section text;
