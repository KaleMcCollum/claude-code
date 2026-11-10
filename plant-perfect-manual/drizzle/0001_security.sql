-- Database-level permission rules (row level security).
--
-- The app never talks to the database as an all-powerful user while acting
-- for a signed-in person. Each request switches to the limited "ppf_app"
-- role and states which user it is acting for (app.user_id). The rules
-- below then decide what that user may read or change, so a bug in the app
-- cannot let an Advisor edit, and nothing can ever be hard-deleted:
-- ppf_app has no DELETE permission on any table.
--
-- Every new table added later MUST enable row level security here too
-- (tests/db-security.test.ts fails if one is missed).

INSERT INTO "roles" ("key", "name", "permissions") VALUES
  ('owner', 'Owner', ARRAY['read','comment','endorse','edit_official','approve','structure','manage_users','settings']),
  ('advisor', 'Advisor', ARRAY['read','comment','endorse'])
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ppf_app') THEN
    CREATE ROLE ppf_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT ppf_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ppf_app;
--> statement-breakpoint
CREATE FUNCTION public.app_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
-- True when the acting user (still active) has a role that includes `perm`.
-- The role is looked up from the users table on every check, never taken
-- from the app's word.
CREATE FUNCTION public.app_can(perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.key = u.role_key
    WHERE u.id = public.app_user_id()
      AND u.removed_at IS NULL
      AND perm = ANY (r.permissions)
  )
$$;
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "login_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "official_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- roles: any signed-in user can read; nobody changes them through the app.
GRANT SELECT ON "roles" TO ppf_app;--> statement-breakpoint
CREATE POLICY roles_read ON "roles" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint

-- users: everyone signed in can read; only user managers add or change.
GRANT SELECT, INSERT, UPDATE ON "users" TO ppf_app;--> statement-breakpoint
CREATE POLICY users_read ON "users" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY users_insert ON "users" FOR INSERT TO ppf_app WITH CHECK (public.app_can('manage_users'));--> statement-breakpoint
CREATE POLICY users_update ON "users" FOR UPDATE TO ppf_app USING (public.app_can('manage_users')) WITH CHECK (public.app_can('manage_users'));--> statement-breakpoint

-- login_tokens and sessions: no access at all for ppf_app. Sign-in runs
-- before any user is known and is handled by the system code path only.

-- sections: everyone signed in can read; structure changes need "structure".
-- Saving official text also stamps the section's "last updated" fields.
GRANT SELECT, INSERT, UPDATE ON "sections" TO ppf_app;--> statement-breakpoint
CREATE POLICY sections_read ON "sections" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY sections_insert ON "sections" FOR INSERT TO ppf_app WITH CHECK (public.app_can('structure'));--> statement-breakpoint
CREATE POLICY sections_update ON "sections" FOR UPDATE TO ppf_app
  USING (public.app_can('structure') OR public.app_can('edit_official'))
  WITH CHECK (public.app_can('structure') OR public.app_can('edit_official'));--> statement-breakpoint

-- official_versions: add-only. A version can never be edited or removed.
GRANT SELECT, INSERT ON "official_versions" TO ppf_app;--> statement-breakpoint
CREATE POLICY official_versions_read ON "official_versions" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY official_versions_insert ON "official_versions" FOR INSERT TO ppf_app
  WITH CHECK (public.app_can('edit_official') AND created_by = public.app_user_id());--> statement-breakpoint

-- approvals: add-only, and only in your own name.
GRANT SELECT, INSERT ON "approvals" TO ppf_app;--> statement-breakpoint
CREATE POLICY approvals_read ON "approvals" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY approvals_insert ON "approvals" FOR INSERT TO ppf_app
  WITH CHECK (public.app_can('approve') AND user_id = public.app_user_id());--> statement-breakpoint

-- activity_log: add-only, and only in your own name.
GRANT SELECT, INSERT ON "activity_log" TO ppf_app;--> statement-breakpoint
GRANT USAGE ON SEQUENCE "activity_log_id_seq" TO ppf_app;--> statement-breakpoint
CREATE POLICY activity_log_read ON "activity_log" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY activity_log_insert ON "activity_log" FOR INSERT TO ppf_app
  WITH CHECK (public.app_can('read') AND user_id = public.app_user_id());
