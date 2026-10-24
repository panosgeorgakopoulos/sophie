-- Run once as the migration owner. Provision password separately through your
-- secret manager; never commit it or give this role membership in the owner role.
CREATE ROLE sophie_public NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO sophie_public;
GRANT SELECT ON public_knowledge_documents,public_knowledge_facts TO sophie_public;
-- Provision a LOGIN role which inherits ONLY sophie_public; PUBLIC_DATABASE_URL
-- must authenticate as that role. It must not SELECT documents or knowledge_facts.
-- Remove broad existing grants and inspect inherited roles before deployment.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
