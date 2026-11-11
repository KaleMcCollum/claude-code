-- Tighter database rules for Phase 3 (Decisions), from an independent review.
--
-- What the database now also keeps, whatever the app code does:
--  * times on new records are the real time (they cannot be back-dated
--    through the app's limited role);
--  * an approval or endorsement is tied to the wording it was given on, and
--    cannot land on wording that was changed at the same moment;
--  * changes to one section's official text go one after the other, and the
--    database itself numbers the versions;
--  * "approved" always means "applied in the same step": a text proposal
--    that is approved has exactly one official version, saved in the very
--    transaction that approved it;
--  * whether a decision was made by one person is worked out here, at the
--    moment of deciding, from the people who can approve at that moment;
--  * no two people can have the same name;
--  * a structure change must be one the app knows how to carry out.

-- ---------------------------------------------------------------- times

-- Switches for people with full database access only: row level security is
-- on and the app's role is given nothing, so it can neither read nor set one.
ALTER TABLE "system_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- True while the automated tests (or a test seed) are allowed to save
-- records with a time in the past. Nothing in the app sets this flag.
CREATE FUNCTION public.time_may_be_set() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.system_flags f WHERE f.key = 'allow_set_time')
$$;
--> statement-breakpoint
-- For the app's limited role, the time on a new record (the column named in
-- the trigger) must be the current time. An hour either way is allowed, not
-- seconds, so that a small difference between the app server's clock and the
-- database's clock can never stop the app from working. This function runs
-- with the caller's own rights on purpose: it has to see who is calling.
CREATE FUNCTION public.recent_time_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  given timestamptz;
BEGIN
  IF current_user <> 'ppf_app' OR public.time_may_be_set() THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO given USING NEW;
  IF given IS NOT NULL AND (given < now() - interval '1 hour' OR given > now() + interval '1 hour') THEN
    RAISE EXCEPTION 'The time on a new record must be the current time (%.% was %)', TG_TABLE_NAME, TG_ARGV[0], given
      USING ERRCODE = 'PPF02';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER proposals_recent_time BEFORE INSERT ON "proposals"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER approvals_recent_time BEFORE INSERT ON "approvals"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER endorsements_recent_time BEFORE INSERT ON "endorsements"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER official_versions_recent_time BEFORE INSERT ON "official_versions"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER comments_recent_time BEFORE INSERT ON "comments"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER proposal_notes_recent_time BEFORE INSERT ON "proposal_notes"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER activity_log_recent_time BEFORE INSERT ON "activity_log"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('at');--> statement-breakpoint
CREATE TRIGGER notes_recent_time BEFORE INSERT ON "notes"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER note_revisions_recent_time BEFORE INSERT ON "note_revisions"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER note_sections_recent_time BEFORE INSERT ON "note_sections"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER daily_logs_recent_time BEFORE INSERT ON "daily_logs"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
-- The time a proposal was decided, too. (The guard below fills it in when it
-- is left empty; this runs after it and checks a time that was sent.)
CREATE TRIGGER proposals_recent_decided_time BEFORE UPDATE ON "proposals"
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.recent_time_only('decided_at');--> statement-breakpoint

-- ---------------------------------------------------------------- people

-- How two names are compared: capitals do not count, and a run of spaces
-- counts as one space.
CREATE FUNCTION public.user_name_key(text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT lower(btrim(regexp_replace($1, '\s+', ' ', 'g')))
$$;
--> statement-breakpoint
-- If two people already share a name, the one added later gets " (2)" after
-- theirs, so the two can be told apart on everything they approved. The
-- change is written to the activity log.
DO $$
DECLARE
  person record;
  n integer;
  candidate text;
BEGIN
  FOR person IN
    SELECT u.id, u.name
    FROM public.users u
    WHERE EXISTS (
      SELECT 1 FROM public.users earlier
      WHERE public.user_name_key(earlier.name) = public.user_name_key(u.name)
        AND (earlier.created_at, earlier.id) < (u.created_at, u.id)
    )
    ORDER BY u.created_at, u.id
  LOOP
    n := 2;
    LOOP
      candidate := person.name || ' (' || n || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.users other
        WHERE public.user_name_key(other.name) = public.user_name_key(candidate)
      );
      n := n + 1;
    END LOOP;
    UPDATE public.users SET name = candidate WHERE id = person.id;
    INSERT INTO public.activity_log (action, entity_type, entity_id, summary, data)
    VALUES (
      'user.renamed', 'user', person.id::text,
      format('Renamed %s to %s, because two people had the same name', person.name, candidate),
      jsonb_build_object('from', person.name, 'to', candidate)
    );
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX users_name_unique ON "users" (public.user_name_key("name"));--> statement-breakpoint

-- The app's role may change only what the Settings page changes: a person's
-- name, role, and the "removed" and "last changed" stamps. Not the email
-- address a sign-in link goes to, and not who or when a person was added.
REVOKE UPDATE ON "users" FROM ppf_app;--> statement-breakpoint
GRANT UPDATE ("name", "role_key", "removed_at", "removed_by", "updated_at", "updated_by") ON "users" TO ppf_app;--> statement-breakpoint

-- ------------------------------------------------------------- proposals

-- A structure change is one of the four the app can carry out, with what
-- each needs: a name for add and rename, a destination for move (a section,
-- or an explicit "none" for the top level; leaving it out is not enough).
ALTER TABLE "proposals" ADD CONSTRAINT proposals_structure_is_known CHECK (
  "structure_change" IS NULL
  OR (
    -- (Anything that is not a JSON object has no action, and ends at ELSE.)
    CASE "structure_change"->>'action'
      WHEN 'add' THEN jsonb_typeof("structure_change"->'title') = 'string' AND btrim("structure_change"->>'title') <> ''
      WHEN 'rename' THEN jsonb_typeof("structure_change"->'title') = 'string' AND btrim("structure_change"->>'title') <> ''
      WHEN 'move' THEN jsonb_typeof("structure_change"->'parentId') IN ('string', 'null')
      WHEN 'archive' THEN true
      ELSE false
    END
  ) IS TRUE
);--> statement-breakpoint
-- Only an approved proposal can be marked as decided by one person.
ALTER TABLE "proposals" ADD CONSTRAINT proposals_alone_only_when_approved CHECK (
  NOT "decided_alone" OR "status" = 'approved'
);--> statement-breakpoint

-- A new proposal: as before, plus nothing forged in its side fields. "Last
-- changed by" is you (or empty), it is not yet tied to a deciding
-- transaction, and the version it was written against belongs to its own
-- section.
ALTER POLICY proposals_insert ON "proposals"
  WITH CHECK (
    public.app_can('propose')
    AND proposed_by = public.app_user_id()
    AND status = 'open' AND decided_at IS NULL AND decided_by IS NULL
    AND revision = 1 AND created_section_id IS NULL
    AND decided_txid IS NULL
    AND (updated_by IS NULL OR updated_by = public.app_user_id())
    AND (
      base_version_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.official_versions v
        WHERE v.id = proposals.base_version_id AND v.section_id = proposals.section_id
      )
    )
  );--> statement-breakpoint

-- Every change to a proposal still passes through here (see 0007). New:
--  * when a proposal is decided, the database records in which transaction
--    (decided_txid), and on approval whether it was decided by one person
--    (decided_alone): fewer than two people who can approve right now have
--    an approval on it, the approver's own included. The app cannot set
--    either column;
--  * "the section that was created" must really be the section the proposal
--    asked for, added by the person approving it;
--  * an edit cannot point "written against" at another section's version.
CREATE OR REPLACE FUNCTION public.proposals_guard() RETURNS trigger
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
    IF NEW.base_version_id IS DISTINCT FROM OLD.base_version_id AND NEW.base_version_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.official_versions v
         WHERE v.id = NEW.base_version_id AND v.section_id = OLD.section_id
       ) THEN
      RAISE EXCEPTION 'A proposal can only be written against a version of its own section'
        USING ERRCODE = '42501';
    END IF;
    -- People who open it later must see they are looking at a newer wording.
    NEW.revision := OLD.revision + 1;
  ELSIF NEW.revision IS DISTINCT FROM OLD.revision THEN
    RAISE EXCEPTION 'The revision number changes only when the proposal does' USING ERRCODE = '42501';
  END IF;

  -- Set here and nowhere else, whatever was sent.
  NEW.decided_alone := false;
  NEW.decided_txid := NULL;

  IF NEW.status <> OLD.status THEN
    IF NEW.decided_by IS DISTINCT FROM acting_user THEN
      RAISE EXCEPTION 'A proposal can only be decided in your own name' USING ERRCODE = '42501';
    END IF;
    IF NEW.decided_at IS NULL THEN
      NEW.decided_at := now();
    END IF;
    NEW.decided_txid := txid_current();
    IF NEW.status = 'approved' THEN
      IF NOT public.app_can('approve') THEN
        RAISE EXCEPTION 'Only an Owner can approve' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.approvals a WHERE a.proposal_id = OLD.id AND a.user_id = acting_user) THEN
        RAISE EXCEPTION 'Nothing becomes official without a recorded approval' USING ERRCODE = '42501';
      END IF;
      NEW.decided_alone := (
        SELECT count(*)
        FROM public.approvals a
        JOIN public.users u ON u.id = a.user_id
        JOIN public.roles r ON r.key = u.role_key
        WHERE a.proposal_id = OLD.id
          AND u.removed_at IS NULL
          AND 'approve' = ANY (r.permissions)
      ) < 2;
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

  IF NEW.created_section_id IS DISTINCT FROM OLD.created_section_id THEN
    IF NEW.status <> 'approved' THEN
      RAISE EXCEPTION 'A new section is recorded only when its proposal is approved' USING ERRCODE = '42501';
    END IF;
    -- (Only a structure proposal has a structure change at all.)
    IF NEW.created_section_id IS NOT NULL AND NOT ((
         OLD.structure_change->>'action' = 'add'
         AND EXISTS (
           SELECT 1 FROM public.sections s
           WHERE s.id = NEW.created_section_id
             AND s.created_by = acting_user
             AND s.parent_id IS NOT DISTINCT FROM OLD.section_id
             AND s.title = OLD.structure_change->>'title'
         )
       ) IS TRUE) THEN
      RAISE EXCEPTION 'The section recorded for a proposal must be the one it asked for, added by the person approving it'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_by := acting_user;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- At the end of every transaction that touched a proposal: an approved text
-- proposal has exactly one official version (approved means applied, in the
-- same step), and a direct edit is never left open.
CREATE FUNCTION public.proposals_applied_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  final public.proposals%ROWTYPE;
  versions integer;
BEGIN
  -- The row as it is now, at the end of the transaction.
  SELECT * INTO final FROM public.proposals p WHERE p.id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF final.direct AND final.status = 'open' THEN
    RAISE EXCEPTION 'A direct edit is approved in the same step it is made' USING ERRCODE = '42501';
  END IF;
  IF final.status = 'approved' AND final.type <> 'structure' THEN
    SELECT count(*) INTO versions FROM public.official_versions v WHERE v.proposal_id = final.id;
    IF versions <> 1 THEN
      RAISE EXCEPTION 'An approved proposal must have its official text saved in the same step'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER proposals_applied_at_commit
  AFTER INSERT OR UPDATE ON "proposals"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.proposals_applied_check();
--> statement-breakpoint

-- ------------------------------------------- approvals and endorsements

-- An approval or endorsement names the proposal revision the person had in
-- front of them. The proposal is locked while this is checked, so a change
-- to the proposal and an approval or endorsement of it always go one after
-- the other: whichever comes second is refused. (It runs with the rights of
-- the database owner so that an Advisor, who may not change a proposal, can
-- still take the lock.) The custom error code lets the app say what happened.
CREATE FUNCTION public.stamp_same_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_revision integer;
BEGIN
  SELECT p.revision INTO current_revision
  FROM public.proposals p WHERE p.id = NEW.proposal_id
  FOR UPDATE;
  IF FOUND AND NEW.revision IS NOT NULL AND NEW.revision <> current_revision THEN
    RAISE EXCEPTION 'This proposal was changed after it was read (it is at revision %, this was given on revision %)',
      current_revision, NEW.revision
      USING ERRCODE = 'PPF01';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER approvals_same_revision BEFORE INSERT ON "approvals"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_same_revision();--> statement-breakpoint
CREATE TRIGGER endorsements_same_revision BEFORE INSERT ON "endorsements"
  FOR EACH ROW EXECUTE FUNCTION public.stamp_same_revision();--> statement-breakpoint

-- ------------------------------------------------------ official versions

ALTER TABLE "official_versions" ADD CONSTRAINT official_versions_version_from_one CHECK ("version" >= 1);--> statement-breakpoint

-- The database, not the sender, numbers a section's versions and fills in
-- the plain-text copy. The section is locked first, so two changes to the
-- same section always go one after the other. A version that says it brings
-- back an earlier one must carry exactly that earlier version's words.
CREATE FUNCTION public.official_versions_prepare() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_version integer;
  proposal_text text;
BEGIN
  PERFORM 1 FROM public.sections s WHERE s.id = NEW.section_id FOR UPDATE;
  SELECT coalesce(max(v.version), 0) + 1 INTO next_version
  FROM public.official_versions v WHERE v.section_id = NEW.section_id;
  NEW.version := next_version;

  SELECT p.proposed_official_text INTO proposal_text
  FROM public.proposals p WHERE p.id = NEW.proposal_id;
  IF proposal_text IS NOT NULL THEN
    NEW.content_text := proposal_text;
  END IF;

  IF NEW.restored_from_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.official_versions earlier
    WHERE earlier.id = NEW.restored_from_version_id
      AND earlier.section_id = NEW.section_id
      AND earlier.content = NEW.content
  ) THEN
    RAISE EXCEPTION 'A restored version must carry the exact words of an earlier version of the same section'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER official_versions_prepare BEFORE INSERT ON "official_versions"
  FOR EACH ROW EXECUTE FUNCTION public.official_versions_prepare();--> statement-breakpoint

-- A version is the exact text of an approved proposal for that section,
-- saved by the Owner whose approval made it official (see 0007), and now
-- also: in the same transaction that approved it. It can no longer be added
-- later, on top of text that was agreed in the meantime.
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
        AND p.decided_txid = txid_current()
    )
  );
