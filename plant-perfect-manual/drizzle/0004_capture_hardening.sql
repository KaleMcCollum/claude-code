-- Tighter database rules for the Phase 2 tables, from an independent review.
-- None of these gaps could be reached from the app's screens; they close
-- what a bug in the app (or a later feature) could otherwise do.

-- A note's wording, its "edited" mark, and the names on a removal or a
-- sort are all decided here, not by whatever the app sends:
--  * only the author can change the wording, and only while acting as a
--    signed-in user (there is no back door for background jobs);
--  * the earlier wording is kept, and the "edited" time is stamped here and
--    cannot be set, cleared or faked any other way;
--  * "removed by" and "sorted by" can only name the person actually doing
--    it, and "last changed by / at" is stamped here on every change.
CREATE OR REPLACE FUNCTION public.notes_keep_wording() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  acting_user uuid := public.app_user_id();
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.body_text IS DISTINCT FROM OLD.body_text THEN
    IF acting_user IS NULL OR OLD.created_by <> acting_user THEN
      RAISE EXCEPTION 'Only the person who wrote a note can change its wording'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.note_revisions (note_id, body, body_text, created_by)
    VALUES (OLD.id, OLD.body, OLD.body_text, acting_user);
    NEW.edited_at := now();
  ELSIF NEW.edited_at IS DISTINCT FROM OLD.edited_at THEN
    RAISE EXCEPTION 'The edited mark of a note is set only when its wording changes'
      USING ERRCODE = '42501';
  END IF;

  IF acting_user IS NOT NULL THEN
    IF NEW.removed_by IS DISTINCT FROM OLD.removed_by
       AND NEW.removed_by IS NOT NULL AND NEW.removed_by <> acting_user THEN
      RAISE EXCEPTION 'A note can only be removed in your own name' USING ERRCODE = '42501';
    END IF;
    IF NEW.sorted_by IS DISTINCT FROM OLD.sorted_by
       AND NEW.sorted_by IS NOT NULL AND NEW.sorted_by <> acting_user THEN
      RAISE EXCEPTION 'A note can only be marked sorted in your own name' USING ERRCODE = '42501';
    END IF;
    IF (NEW.removed_at IS NULL) <> (NEW.removed_by IS NULL) THEN
      RAISE EXCEPTION 'A removed note needs both when and who' USING ERRCODE = '42501';
    END IF;
    NEW.updated_by := acting_user;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- The app no longer sets the "edited" time itself.
REVOKE UPDATE ("edited_at") ON "notes" FROM ppf_app;
--> statement-breakpoint

-- A filing can only be taken out, once, in your own name. It cannot be put
-- back (filing again adds a new row) and its history cannot be re-stamped.
CREATE FUNCTION public.note_sections_take_out_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  acting_user uuid := public.app_user_id();
BEGIN
  IF acting_user IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'A filing that was taken out cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.removed_at IS NULL OR NEW.removed_by IS DISTINCT FROM acting_user THEN
    RAISE EXCEPTION 'A filing can only be taken out, in your own name' USING ERRCODE = '42501';
  END IF;
  NEW.removed_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER note_sections_take_out_only
  BEFORE UPDATE ON "note_sections"
  FOR EACH ROW EXECUTE FUNCTION public.note_sections_take_out_only();
--> statement-breakpoint
-- A new filing is always live, and by a person (the AI's filings arrive with
-- Phase 5, which will set its own rule for them).
ALTER POLICY note_sections_insert ON "note_sections"
  WITH CHECK (
    public.app_can('write_notes')
    AND created_by = public.app_user_id()
    AND removed_at IS NULL AND removed_by IS NULL
    AND by_ai = false
  );
--> statement-breakpoint

-- The day's row and settings changes also carry only your own name.
ALTER POLICY daily_logs_insert ON "daily_logs"
  WITH CHECK (public.app_can('write_notes') AND created_by = public.app_user_id());
--> statement-breakpoint
ALTER POLICY settings_insert ON "settings"
  WITH CHECK (public.app_can('settings') AND updated_by = public.app_user_id());
--> statement-breakpoint
ALTER POLICY settings_update ON "settings"
  USING (public.app_can('settings'))
  WITH CHECK (public.app_can('settings') AND updated_by = public.app_user_id());
--> statement-breakpoint

-- Whatever is stored as text must be a document the app can draw, so one
-- bad row can never stop a page from showing.
ALTER TABLE "notes" ADD CONSTRAINT notes_body_is_document
  CHECK ((jsonb_typeof("body") = 'object' AND "body"->>'type' = 'doc' AND jsonb_typeof("body"->'content') = 'array') IS TRUE);
--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT note_revisions_body_is_document
  CHECK ((jsonb_typeof("body") = 'object' AND "body"->>'type' = 'doc' AND jsonb_typeof("body"->'content') = 'array') IS TRUE);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT comments_body_is_document
  CHECK ((jsonb_typeof("body") = 'object' AND "body"->>'type' = 'doc' AND jsonb_typeof("body"->'content') = 'array') IS TRUE);
--> statement-breakpoint
ALTER TABLE "official_versions" ADD CONSTRAINT official_versions_content_is_document
  CHECK ((jsonb_typeof("content") = 'object' AND "content"->>'type' = 'doc' AND jsonb_typeof("content"->'content') = 'array') IS TRUE);
