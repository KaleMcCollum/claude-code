-- Database-level permission rules for the Phase 2 (Capture) tables.
-- Same approach as 0001_security.sql: the app acts through the limited
-- "ppf_app" role, which is never allowed to delete anything.

-- Owners can write notes. Advisors keep read / comment / endorse.
UPDATE "roles"
SET "permissions" = array_append("permissions", 'write_notes')
WHERE "key" = 'owner' AND NOT ('write_notes' = ANY ("permissions"));
--> statement-breakpoint
ALTER TABLE "daily_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- daily_logs: a day's row is added with its first note and never changed.
GRANT SELECT, INSERT ON "daily_logs" TO ppf_app;--> statement-breakpoint
CREATE POLICY daily_logs_read ON "daily_logs" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY daily_logs_insert ON "daily_logs" FOR INSERT TO ppf_app WITH CHECK (public.app_can('write_notes'));--> statement-breakpoint

-- notes: written only in your own name. Who wrote a note, when, and which
-- day it belongs to can never be changed (those columns are not updatable).
-- Removing a note only sets removed_at / removed_by; the row stays.
GRANT SELECT, INSERT ON "notes" TO ppf_app;--> statement-breakpoint
GRANT UPDATE ("body", "body_text", "business_tag", "sorted_at", "sorted_by", "edited_at", "updated_at", "updated_by", "removed_at", "removed_by")
  ON "notes" TO ppf_app;--> statement-breakpoint
CREATE POLICY notes_read ON "notes" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY notes_insert ON "notes" FOR INSERT TO ppf_app
  WITH CHECK (public.app_can('write_notes') AND created_by = public.app_user_id());--> statement-breakpoint
CREATE POLICY notes_update ON "notes" FOR UPDATE TO ppf_app
  USING (public.app_can('write_notes')) WITH CHECK (public.app_can('write_notes'));--> statement-breakpoint

-- A note always sits on the Daily Log of the US Central day it was written,
-- whatever the app sends.
ALTER TABLE "notes" ADD CONSTRAINT notes_log_date_matches_created_at
  CHECK ("log_date" = ("created_at" AT TIME ZONE 'America/Chicago')::date);
--> statement-breakpoint

-- "Owner words are never altered": the wording of a note can only be changed
-- by the person who wrote it, and the earlier wording is always kept. This is
-- done here, in the database, so no part of the app (including the AI
-- features added later) can skip it.
CREATE FUNCTION public.notes_keep_wording() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  acting_user uuid := public.app_user_id();
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.body_text IS DISTINCT FROM OLD.body_text THEN
    IF acting_user IS NOT NULL AND OLD.created_by <> acting_user THEN
      RAISE EXCEPTION 'Only the person who wrote a note can change its wording'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.note_revisions (note_id, body, body_text, created_by)
    VALUES (OLD.id, OLD.body, OLD.body_text, coalesce(acting_user, OLD.created_by));
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER notes_keep_wording
  BEFORE UPDATE ON "notes"
  FOR EACH ROW EXECUTE FUNCTION public.notes_keep_wording();
--> statement-breakpoint

-- note_revisions: readable history. Rows are only ever written by the
-- trigger above, so the app role cannot add, change or remove them.
GRANT SELECT ON "note_revisions" TO ppf_app;--> statement-breakpoint
CREATE POLICY note_revisions_read ON "note_revisions" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint

-- note_sections: each row is one act of filing a note under a section.
-- Taking it out again only sets removed_at / removed_by (the only columns
-- that can be updated); filing it again adds a new row. So who filed what,
-- when, and whether it was the AI can never be rewritten.
GRANT SELECT, INSERT ON "note_sections" TO ppf_app;--> statement-breakpoint
GRANT UPDATE ("removed_at", "removed_by") ON "note_sections" TO ppf_app;--> statement-breakpoint
CREATE POLICY note_sections_read ON "note_sections" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY note_sections_insert ON "note_sections" FOR INSERT TO ppf_app
  WITH CHECK (public.app_can('write_notes') AND created_by = public.app_user_id());--> statement-breakpoint
CREATE POLICY note_sections_update ON "note_sections" FOR UPDATE TO ppf_app
  USING (public.app_can('write_notes')) WITH CHECK (public.app_can('write_notes'));--> statement-breakpoint

-- comments: Owners and Advisors, only in your own name, add-only.
GRANT SELECT, INSERT ON "comments" TO ppf_app;--> statement-breakpoint
CREATE POLICY comments_read ON "comments" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY comments_insert ON "comments" FOR INSERT TO ppf_app
  WITH CHECK (public.app_can('comment') AND created_by = public.app_user_id());--> statement-breakpoint

-- settings: everyone signed in can read; only people with "settings" change.
GRANT SELECT, INSERT, UPDATE ON "settings" TO ppf_app;--> statement-breakpoint
CREATE POLICY settings_read ON "settings" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY settings_insert ON "settings" FOR INSERT TO ppf_app WITH CHECK (public.app_can('settings'));--> statement-breakpoint
CREATE POLICY settings_update ON "settings" FOR UPDATE TO ppf_app
  USING (public.app_can('settings')) WITH CHECK (public.app_can('settings'));
