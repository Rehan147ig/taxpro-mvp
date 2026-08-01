-- ================================================================
-- Auth pre-tenant lookup function (fixes login under NOBYPASSRLS)
-- ================================================================
-- Problem: the `users` table SELECT policy is `tenant_id = app_current_tenant_id()`.
-- During login/register there is NO tenant context yet (the user is unknown),
-- so app_current_tenant_id() returns NULL and RLS fails closed — the runtime
-- role (taxpro_app, NOBYPASSRLS) sees zero rows and authentication can never
-- succeed in a production-shaped stack.
--
-- Fix: a SECURITY DEFINER function owned by the schema-owner role
-- (taxpro_migrations). SECURITY DEFINER runs as its owner, who bypasses RLS
-- (table owner), so the function can read the email row regardless of tenant
-- context. The runtime role is granted EXECUTE only — it can look up a user
-- by email for auth, but cannot bypass RLS for any other access.
--
-- NOTE: return column types must match the actual users table exactly
-- (varchar(255) for email/password_hash, varchar(20) for role) — the
-- migrated table uses varchar, not text.
-- ================================================================

DROP FUNCTION IF EXISTS auth_find_user_by_email(text);

CREATE FUNCTION auth_find_user_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email varchar(255),
  password_hash varchar(255),
  role varchar(20),
  created_at timestamp
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.created_at
    FROM users u
    WHERE u.email = p_email
    LIMIT 1;
END;
$$;

-- Runtime role may call the function (auth lookup) but nothing else new.
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO taxpro_app;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO taxpro_migrations;

-- ================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS auth_find_user_by_email(text);
-- ================================================================
