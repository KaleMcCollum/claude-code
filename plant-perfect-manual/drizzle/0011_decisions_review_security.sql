-- Database rules from the second review of Phase 3 (Decisions).
--
-- What the database now also keeps, whatever the app code does:
--  * two people's approval never lands on official text that changed after
--    the proposal was written or last checked: such an out-of-date proposal
--    can only be approved by one person, which is flagged for the other;
--  * no approval or endorsement is added to a proposal that was declined or
--    withdrawn at the very same moment;
--  * the sentence an approved section change is recorded under is written
--    only in the step that approves it;
--  * names are compared in one standard form, without characters that
--    cannot be seen, and such characters cannot be stored in a name;
--  * the name of someone who has signed in cannot be changed;
--  * who and when on people, sections and notes are the signed-in person
--    and the real time.

-- ---------------------------------------------------------------- people

-- The rule "no two people with one name" is rebuilt below with a new way of
-- comparing, so it comes off first.
DROP INDEX "users_name_unique";--> statement-breakpoint

-- Characters that draw nothing on a screen: control characters, soft
-- hyphen, zero-width and joiner characters, direction marks, variation
-- selectors, blank fillers and the like. A name with one of these in it
-- looks exactly like the same name without it. Written as the inside of a
-- regular-expression character class. (Tab and the line-break characters
-- are not in this list: where names are compared they count as spaces.)
-- The same list is in src/lib/names.ts; tests/names.test.ts checks that the
-- two agree.
CREATE FUNCTION public.unseen_characters() RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT '\u0001-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F'
      || '­͏؜ᅟᅠ឴឵᠋-᠏'
      || '​-‏‪-‮⁠-⁯⠀ㅤ'
      || '︀-️﻿ﾠ￰-￻'
      || '\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF'
$$;
--> statement-breakpoint
-- How two names are compared. As before: capitals do not count, and a run
-- of spaces counts as one space. New: the name is first brought to one
-- standard form (so full-width letters, or a no-break space, are the same
-- as the plain ones) and characters that draw nothing are left out.
-- (If this function or the list above ever changes again, drop and re-create
-- the index users_name_unique around the change, as this step does.)
CREATE OR REPLACE FUNCTION public.user_name_key(text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT lower(btrim(regexp_replace(
    regexp_replace(normalize($1, NFKC), '[' || public.unseen_characters() || ']', '', 'g'),
    '[\s\u0085   ]+', ' ', 'g'
  )))
$$;
--> statement-breakpoint
-- Names already stored with a character in them that cannot be seen (or a
-- tab or line break) are cleaned, and the change is written to the activity
-- log. A name with nothing left becomes the first part of the email address.
DO $$
DECLARE
  person record;
  cleaned text;
BEGIN
  FOR person IN
    SELECT u.id, u.name, u.email
    FROM public.users u
    WHERE u.name ~ ('[\u0009-\u000D\u0085  ' || public.unseen_characters() || ']')
    ORDER BY u.created_at, u.id
  LOOP
    cleaned := btrim(regexp_replace(
      regexp_replace(person.name, '[' || public.unseen_characters() || ']', '', 'g'),
      '[\s\u0085   ]+', ' ', 'g'
    ));
    IF cleaned = '' THEN
      cleaned := btrim(regexp_replace(
        regexp_replace(split_part(person.email, '@', 1), '[' || public.unseen_characters() || ']', '', 'g'),
        '[\s\u0085   ]+', ' ', 'g'
      ));
    END IF;
    IF cleaned = '' THEN
      cleaned := 'Person';
    END IF;
    UPDATE public.users SET name = cleaned WHERE id = person.id;
    INSERT INTO public.activity_log (action, entity_type, entity_id, summary, data)
    VALUES (
      'user.renamed', 'user', person.id::text,
      format('Took characters that cannot be seen out of the name %s', cleaned),
      jsonb_build_object('from', person.name, 'to', cleaned)
    );
  END LOOP;
END
$$;
--> statement-breakpoint
-- As in the step before this one: if two people now have the same name
-- (compared the new way), the one added later gets " (2)" after theirs, and
-- the change is written to the activity log. A removed person who never
-- signed in is left out: the rule below no longer counts them.
DO $$
DECLARE
  person record;
  n integer;
  candidate text;
BEGIN
  FOR person IN
    SELECT u.id, u.name
    FROM public.users u
    WHERE (u.removed_at IS NULL OR u.last_active_at IS NOT NULL)
      AND EXISTS (
        SELECT 1 FROM public.users earlier
        WHERE (earlier.removed_at IS NULL OR earlier.last_active_at IS NOT NULL)
          AND public.user_name_key(earlier.name) = public.user_name_key(u.name)
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
-- No two people have the same name. A removed person who never signed in
-- does not count: nothing was ever written or approved under that entry, so
-- a mistyped email address can be removed and the person added again under
-- the same name.
CREATE UNIQUE INDEX users_name_unique ON "users" (public.user_name_key("name"))
  WHERE "removed_at" IS NULL OR "last_active_at" IS NOT NULL;--> statement-breakpoint
-- A name holds no character that cannot be seen, and no tab or line break.
ALTER TABLE "users" ADD CONSTRAINT users_name_can_be_seen CHECK (
  "name" !~ ('[\u0009-\u000D\u0085  ' || public.unseen_characters() || ']')
);--> statement-breakpoint

-- Who and when on a person, for the app's limited role. (These functions
-- run with the caller's own rights on purpose: they have to see who is
-- calling. Setup scripts and sign-in, which have full database access, are
-- not bound.)
--  * A person is added in your own name, not yet removed, and not yet
--    marked as having signed in.
--  * A name can change only until the person has signed in for the first
--    time: after that it is on what they wrote and approved.
--  * A person is removed in your own name; when they are brought back, who
--    removed them is cleared with it.
--  * "Last changed by / at" is stamped here, whatever is sent.
CREATE FUNCTION public.users_who_and_when() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  acting_user uuid := public.app_user_id();
BEGIN
  IF current_user <> 'ppf_app' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM acting_user THEN
      RAISE EXCEPTION 'A person can only be added in your own name' USING ERRCODE = '42501';
    END IF;
    IF NEW.removed_at IS NOT NULL OR NEW.removed_by IS NOT NULL OR NEW.last_active_at IS NOT NULL THEN
      RAISE EXCEPTION 'A person who is being added has not been removed and has not signed in'
        USING ERRCODE = '42501';
    END IF;
    NEW.updated_by := acting_user;
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name AND OLD.last_active_at IS NOT NULL THEN
    RAISE EXCEPTION 'The name of a person who has signed in cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.removed_at IS NULL THEN
    NEW.removed_by := NULL;
  ELSIF NEW.removed_at IS DISTINCT FROM OLD.removed_at THEN
    IF NEW.removed_by IS DISTINCT FROM acting_user THEN
      RAISE EXCEPTION 'A person can only be removed in your own name' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.removed_by IS DISTINCT FROM OLD.removed_by THEN
    RAISE EXCEPTION 'Who removed a person is set only when they are removed' USING ERRCODE = '42501';
  END IF;
  NEW.updated_by := acting_user;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER users_who_and_when BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION public.users_who_and_when();--> statement-breakpoint
CREATE TRIGGER users_recent_time BEFORE INSERT ON "users"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER users_recent_removed_time BEFORE UPDATE ON "users"
  FOR EACH ROW WHEN (NEW.removed_at IS DISTINCT FROM OLD.removed_at)
  EXECUTE FUNCTION public.recent_time_only('removed_at');--> statement-breakpoint

-- -------------------------------------------------------------- sections

-- Who and when on a section, for the app's limited role.
--  * A section is added in your own name, and not already archived.
--  * When and by whom it was added never change.
--  * A section is archived in your own name; when it is restored, who
--    archived it is cleared with it.
--  * "Last updated by" is you whenever the section's name or its "last
--    updated" time changes. (Reordering, moving and archiving are not
--    content changes and leave "last updated" alone, as the app intends.)
CREATE FUNCTION public.sections_who_and_when() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  acting_user uuid := public.app_user_id();
BEGIN
  IF current_user <> 'ppf_app' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM acting_user THEN
      RAISE EXCEPTION 'A section can only be added in your own name' USING ERRCODE = '42501';
    END IF;
    IF NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL THEN
      RAISE EXCEPTION 'A section that is being added is not archived' USING ERRCODE = '42501';
    END IF;
    NEW.updated_by := acting_user;
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'When and by whom a section was added cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.archived_at IS NULL THEN
    NEW.archived_by := NULL;
  ELSIF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    IF NEW.archived_by IS DISTINCT FROM acting_user THEN
      RAISE EXCEPTION 'A section can only be archived in your own name' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    RAISE EXCEPTION 'Who archived a section is set only when it is archived' USING ERRCODE = '42501';
  END IF;
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at
     OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
     OR NEW.title IS DISTINCT FROM OLD.title THEN
    NEW.updated_by := acting_user;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER sections_who_and_when BEFORE INSERT OR UPDATE ON "sections"
  FOR EACH ROW EXECUTE FUNCTION public.sections_who_and_when();--> statement-breakpoint
CREATE TRIGGER sections_recent_time BEFORE INSERT ON "sections"
  FOR EACH ROW EXECUTE FUNCTION public.recent_time_only('created_at');--> statement-breakpoint
CREATE TRIGGER sections_recent_archived_time BEFORE UPDATE ON "sections"
  FOR EACH ROW WHEN (NEW.archived_at IS DISTINCT FROM OLD.archived_at)
  EXECUTE FUNCTION public.recent_time_only('archived_at');--> statement-breakpoint
CREATE TRIGGER sections_recent_updated_time BEFORE UPDATE ON "sections"
  FOR EACH ROW WHEN (NEW.updated_at IS DISTINCT FROM OLD.updated_at)
  EXECUTE FUNCTION public.recent_time_only('updated_at');--> statement-breakpoint

-- ----------------------------------------------------------------- notes

-- What was still open for notes after 0003 and 0004 (which already keep the
-- author, the wording, the "edited" mark and the names on a sort or a
-- removal): a note could be added already marked as sorted, removed or
-- edited, with someone else as "last changed by"; and the time of a sort or
-- a removal could be any date.
CREATE FUNCTION public.notes_start_plain() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user <> 'ppf_app' THEN
    RETURN NEW;
  END IF;
  IF NEW.sorted_at IS NOT NULL OR NEW.sorted_by IS NOT NULL
     OR NEW.removed_at IS NOT NULL OR NEW.removed_by IS NOT NULL
     OR NEW.edited_at IS NOT NULL THEN
    RAISE EXCEPTION 'A note that is being added has not been sorted, removed or edited yet'
      USING ERRCODE = '42501';
  END IF;
  NEW.updated_by := public.app_user_id();
  NEW.updated_at := NEW.created_at;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER notes_start_plain BEFORE INSERT ON "notes"
  FOR EACH ROW EXECUTE FUNCTION public.notes_start_plain();--> statement-breakpoint
CREATE TRIGGER notes_recent_sorted_time BEFORE UPDATE ON "notes"
  FOR EACH ROW WHEN (NEW.sorted_at IS DISTINCT FROM OLD.sorted_at)
  EXECUTE FUNCTION public.recent_time_only('sorted_at');--> statement-breakpoint
CREATE TRIGGER notes_recent_removed_time BEFORE UPDATE ON "notes"
  FOR EACH ROW WHEN (NEW.removed_at IS DISTINCT FROM OLD.removed_at)
  EXECUTE FUNCTION public.recent_time_only('removed_at');--> statement-breakpoint

-- ------------------------------------------------------------- proposals

-- The sentence a section change was approved under ("decided_title") is
-- written by the person approving, in the approving step, and nowhere else.
GRANT UPDATE ("decided_title") ON "proposals" TO ppf_app;--> statement-breakpoint
-- A new proposal: as in 0009, and it does not arrive with that sentence.
ALTER POLICY proposals_insert ON "proposals"
  WITH CHECK (
    public.app_can('propose')
    AND proposed_by = public.app_user_id()
    AND status = 'open' AND decided_at IS NULL AND decided_by IS NULL
    AND revision = 1 AND created_section_id IS NULL
    AND decided_txid IS NULL
    AND decided_title IS NULL
    AND (updated_by IS NULL OR updated_by = public.app_user_id())
    AND (
      base_version_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.official_versions v
        WHERE v.id = proposals.base_version_id AND v.section_id = proposals.section_id
      )
    )
  );--> statement-breakpoint

-- Every change to a proposal still passes through here (see 0007 and 0009).
-- New:
--  * an approval by two people needs the proposal to be up to date: the
--    official version it was written against (or last checked against) must
--    still be the newest version of its section. Otherwise the official
--    text was changed after the proposer last looked, and their approval
--    was never given on top of that newer text. One person can still
--    approve it alone, which is recorded as a one-person decision. The
--    section is locked first, so its text cannot change while this is
--    checked. Its own error code lets the app say what happened;
--  * the sentence a section change was approved under can be set only in
--    the step that approves a structure proposal.
CREATE OR REPLACE FUNCTION public.proposals_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  acting_user uuid := public.app_user_id();
  content_changed boolean;
  newest_version uuid;
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
      IF OLD.type <> 'structure' AND NOT NEW.decided_alone THEN
        PERFORM 1 FROM public.sections s WHERE s.id = OLD.section_id FOR UPDATE;
        SELECT v.id INTO newest_version
        FROM public.official_versions v
        WHERE v.section_id = OLD.section_id
        ORDER BY v.version DESC
        LIMIT 1;
        IF newest_version IS DISTINCT FROM OLD.base_version_id THEN
          RAISE EXCEPTION 'The official text of this section has changed since this proposal was written or last checked, so two people cannot approve it as it stands'
            USING ERRCODE = 'PPF03';
        END IF;
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

  -- (A proposal that is not open never gets this far, so "approved" here
  -- means: being approved in this very step.)
  IF NEW.decided_title IS DISTINCT FROM OLD.decided_title
     AND NOT (NEW.status = 'approved' AND OLD.type = 'structure') THEN
    RAISE EXCEPTION 'The sentence a section change was approved under is recorded only when that change is approved'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_by := acting_user;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- ------------------------------------------- approvals and endorsements

-- As in 0009, an approval or endorsement locks its proposal and names the
-- revision the person had in front of them. New: the proposal's status is
-- read together with the revision, under that lock. The rule from 0007
-- ("only on a proposal that is open or approved") looks at the proposal as
-- it was when the command started, so a decline or withdrawal that finished
-- while this waited for the lock went unseen. Its own error code lets the
-- app say what happened.
CREATE OR REPLACE FUNCTION public.stamp_same_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_revision integer;
  current_status public.proposal_status;
BEGIN
  SELECT p.revision, p.status INTO current_revision, current_status
  FROM public.proposals p WHERE p.id = NEW.proposal_id
  FOR UPDATE;
  IF FOUND AND current_status NOT IN ('open', 'approved') THEN
    RAISE EXCEPTION 'This proposal has been declined or withdrawn, so nothing more can be added to it'
      USING ERRCODE = 'PPF04';
  END IF;
  IF FOUND AND NEW.revision IS NOT NULL AND NEW.revision <> current_revision THEN
    RAISE EXCEPTION 'This proposal was changed after it was read (it is at revision %, this was given on revision %)',
      current_revision, NEW.revision
      USING ERRCODE = 'PPF01';
  END IF;
  RETURN NEW;
END
$$;
