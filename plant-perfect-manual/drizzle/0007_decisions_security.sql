-- Database-level rules for Phase 3 (Decisions): proposals, approvals,
-- endorsements, and how official text is tied to them.
--
-- The promises the database itself keeps, whatever the app code does:
--  * nothing becomes official without a recorded approval by the person
--    making it official;
--  * an official version can only be the exact text of an approved proposal
--    for that same section, and a proposal can produce one version at most;
--  * approvals and endorsements are only ever added, in your own name;
--  * only the person who made a proposal can change it, and only until
--    someone else has approved or endorsed it;
--  * once a proposal is approved, declined or withdrawn it never changes;
--  * nothing can be deleted.

UPDATE "roles"
SET "permissions" = array_append("permissions", 'propose')
WHERE "key" = 'owner' AND NOT ('propose' = ANY ("permissions"));
--> statement-breakpoint
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "proposal_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "endorsements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- What a proposal may hold.
ALTER TABLE "proposals" ADD CONSTRAINT proposals_kind_matches_content CHECK (
  ("type" = 'structure' AND "structure_change" IS NOT NULL AND "proposed_official" IS NULL)
  OR ("type" <> 'structure' AND "structure_change" IS NULL AND "section_id" IS NOT NULL
      AND "proposed_official" IS NOT NULL AND "proposed_official_text" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT proposals_decided_has_when CHECK (
  ("status" = 'open') = ("decided_at" IS NULL)
);--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT proposals_text_is_document CHECK (
  "proposed_official" IS NULL
  OR (jsonb_typeof("proposed_official") = 'object' AND "proposed_official"->>'type' = 'doc'
      AND jsonb_typeof("proposed_official"->'content') = 'array') IS TRUE
);--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT proposals_description_is_document CHECK (
  "description" IS NULL
  OR (jsonb_typeof("description") = 'object' AND "description"->>'type' = 'doc'
      AND jsonb_typeof("description"->'content') = 'array') IS TRUE
);--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT proposals_structure_is_object CHECK (
  "structure_change" IS NULL OR jsonb_typeof("structure_change") = 'object'
);--> statement-breakpoint
-- A comment is on a note or on a proposal, never both and never neither.
ALTER TABLE "comments" ADD CONSTRAINT comments_one_subject CHECK (
  ("note_id" IS NULL) <> ("proposal_id" IS NULL)
);--> statement-breakpoint

-- proposals: made only in your own name, always starting as open. Who made
-- it, its kind, its section and whether it was a direct edit can never be
-- changed (those columns are not updatable).
GRANT SELECT, INSERT ON "proposals" TO ppf_app;--> statement-breakpoint
GRANT UPDATE (
  "title", "description", "description_text", "business_tag",
  "proposed_official", "proposed_official_text", "base_version_id", "structure_change",
  "created_section_id", "revision", "status", "decided_at", "decided_by", "decline_reason",
  "updated_at", "updated_by"
) ON "proposals" TO ppf_app;--> statement-breakpoint
CREATE POLICY proposals_read ON "proposals" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY proposals_insert ON "proposals" FOR INSERT TO ppf_app
  WITH CHECK (
    public.app_can('propose')
    AND proposed_by = public.app_user_id()
    AND status = 'open' AND decided_at IS NULL AND decided_by IS NULL
    AND revision = 1 AND created_section_id IS NULL
  );--> statement-breakpoint
CREATE POLICY proposals_update ON "proposals" FOR UPDATE TO ppf_app
  USING (public.app_can('propose') OR public.app_can('approve'))
  WITH CHECK (public.app_can('propose') OR public.app_can('approve'));--> statement-breakpoint

-- Every change to a proposal passes through here. There is no exception for
-- code running without a signed-in user: a decided proposal is final for
-- everyone, and deciding always needs a person.
CREATE FUNCTION public.proposals_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  acting_user uuid := public.app_user_id();
  content_changed boolean;
BEGIN
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'A proposal that has been decided cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF acting_user IS NULL THEN
    RAISE EXCEPTION 'A proposal can only be changed by a signed-in person' USING ERRCODE = '42501';
  END IF;

  content_changed :=
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.description_text IS DISTINCT FROM OLD.description_text
    OR NEW.business_tag IS DISTINCT FROM OLD.business_tag
    OR NEW.proposed_official IS DISTINCT FROM OLD.proposed_official
    OR NEW.proposed_official_text IS DISTINCT FROM OLD.proposed_official_text
    OR NEW.base_version_id IS DISTINCT FROM OLD.base_version_id
    OR NEW.structure_change IS DISTINCT FROM OLD.structure_change;

  IF content_changed THEN
    IF OLD.proposed_by IS DISTINCT FROM acting_user THEN
      RAISE EXCEPTION 'Only the person who made a proposal can change it' USING ERRCODE = '42501';
    END IF;
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'A proposal cannot be changed and decided in the same step' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.approvals a WHERE a.proposal_id = OLD.id AND a.user_id <> acting_user)
       OR EXISTS (SELECT 1 FROM public.endorsements e WHERE e.proposal_id = OLD.id AND e.user_id <> acting_user) THEN
      RAISE EXCEPTION 'A proposal that someone else has approved or endorsed cannot be changed'
        USING ERRCODE = '42501';
    END IF;
    -- People who open it later must see they are looking at a newer wording.
    NEW.revision := OLD.revision + 1;
  ELSIF NEW.revision IS DISTINCT FROM OLD.revision THEN
    RAISE EXCEPTION 'The revision number changes only when the proposal does' USING ERRCODE = '42501';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NEW.decided_by IS DISTINCT FROM acting_user THEN
      RAISE EXCEPTION 'A proposal can only be decided in your own name' USING ERRCODE = '42501';
    END IF;
    IF NEW.decided_at IS NULL THEN
      NEW.decided_at := now();
    END IF;
    IF NEW.status = 'approved' THEN
      IF NOT public.app_can('approve') THEN
        RAISE EXCEPTION 'Only an Owner can approve' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.approvals a WHERE a.proposal_id = OLD.id AND a.user_id = acting_user) THEN
        RAISE EXCEPTION 'Nothing becomes official without a recorded approval' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.status = 'withdrawn' THEN
      IF OLD.proposed_by IS DISTINCT FROM acting_user THEN
        RAISE EXCEPTION 'Only the person who made a proposal can withdraw it' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.status = 'declined' THEN
      IF NOT public.app_can('approve') THEN
        RAISE EXCEPTION 'Only an Owner can decline' USING ERRCODE = '42501';
      END IF;
      IF OLD.proposed_by IS NOT DISTINCT FROM acting_user THEN
        RAISE EXCEPTION 'Your own proposal is withdrawn, not declined' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.status <> 'declined' AND NEW.decline_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Only a declined proposal has a reason' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.decided_at IS DISTINCT FROM OLD.decided_at
     OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
     OR NEW.decline_reason IS DISTINCT FROM OLD.decline_reason THEN
    RAISE EXCEPTION 'When, by whom and why are set only when a proposal is decided' USING ERRCODE = '42501';
  END IF;

  IF NEW.created_section_id IS DISTINCT FROM OLD.created_section_id AND NEW.status <> 'approved' THEN
    RAISE EXCEPTION 'A new section is recorded only when its proposal is approved' USING ERRCODE = '42501';
  END IF;

  NEW.updated_by := acting_user;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER proposals_guard
  BEFORE UPDATE ON "proposals"
  FOR EACH ROW EXECUTE FUNCTION public.proposals_guard();
--> statement-breakpoint

-- proposal_notes: the notes a proposal came from, linked by its proposer
-- while it is still open. Add-only.
GRANT SELECT, INSERT ON "proposal_notes" TO ppf_app;--> statement-breakpoint
CREATE POLICY proposal_notes_read ON "proposal_notes" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY proposal_notes_insert ON "proposal_notes" FOR INSERT TO ppf_app
  WITH CHECK (
    public.app_can('propose')
    AND created_by = public.app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = proposal_notes.proposal_id AND p.proposed_by = public.app_user_id() AND p.status = 'open'
    )
  );--> statement-breakpoint

-- approvals: only ever added, in your own name, on a proposal that is open
-- or already approved (the second Owner adding "I approve too").
ALTER POLICY approvals_insert ON "approvals"
  WITH CHECK (
    public.app_can('approve')
    AND user_id = public.app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = approvals.proposal_id AND p.status IN ('open', 'approved')
    )
  );--> statement-breakpoint

-- endorsements: the same, for anyone who may endorse.
GRANT SELECT, INSERT ON "endorsements" TO ppf_app;--> statement-breakpoint
CREATE POLICY endorsements_read ON "endorsements" FOR SELECT TO ppf_app USING (public.app_can('read'));--> statement-breakpoint
CREATE POLICY endorsements_insert ON "endorsements" FOR INSERT TO ppf_app
  WITH CHECK (
    public.app_can('endorse')
    AND user_id = public.app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = endorsements.proposal_id AND p.status IN ('open', 'approved')
    )
  );--> statement-breakpoint

-- official_versions: a version is the exact text of an approved proposal for
-- that section, saved by the Owner whose approval made it official.
ALTER POLICY official_versions_insert ON "official_versions"
  WITH CHECK (
    public.app_can('edit_official')
    AND created_by = public.app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = official_versions.proposal_id
        AND p.status = 'approved'
        AND p.type <> 'structure'
        AND p.section_id = official_versions.section_id
        AND p.proposed_official = official_versions.content
        AND p.decided_by = public.app_user_id()
    )
  );
