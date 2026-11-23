# Notes for coding agents working on this app

@AGENTS.md

## Who you are building for

The owner is not a developer. Follow these every time:

- Explain things in plain English. No jargon; if a technical word is needed,
  define it in a few words.
- Do every step you can yourself. Only ask the owner for what needs a human
  (creating an account, paying, clicking an email link, approving).
- When the owner must act, give click-by-click steps, one at a time.
- Ask before anything that costs money, and state the monthly and yearly cost.
- Never ask the owner to paste secrets into files or chat.
- Build one phase at a time and get approval (with phone-sized screenshots)
  before starting the next. See the phase table in `README.md`.
- Do not add features, pages, toolbars or menus the spec does not ask for.

The full build spec is the owner's document and is not stored in this
repository (the repository is public). Ask the owner for it if it is not in
the conversation. Do not commit business details, real email addresses or
secrets here.

## Rules that must never be broken

1. Text a person writes is stored and shown exactly as typed. Never rewrite,
   trim, reorder or "clean up" it. AI rewrites are suggestions only.
   This covers everything written in a text box: notes, comments, official
   text, a proposal's "Why", the reason for declining. The one stated
   exception is one-line names: a proposal's title, a section's name and a
   person's name are trimmed and single-spaced (so two names can never
   differ only by spaces nobody can see), and never reworded.
2. Official and Discussion are separate, in the data and on screen.
3. Nothing becomes official without a recorded approval (who, when).
4. The AI never changes structure or official text directly. It proposes;
   a person approves.
5. No hard deletes. Archive or mark as removed. The database role the app
   uses has no DELETE permission, and that must stay true.
6. Every change records date, time and user (`logActivity`).
7. One record per fact. Other screens reference it; never copy data.
8. Visual rules: white background, near-black text, light gray lines, one
   dark teal accent, system font, no gradients, shadows, emoji or decorative
   icons, plain short labels. Two parts only: fixed left sidebar and a main
   document area. Settings is the one separate page.

## How the code is organized

- `src/lib/*` holds the rules. Pages and actions stay thin and call into it.
- Every function that changes data takes the `Actor`, calls `assertCan`, and
  does its work inside `asUser(actor.id, ...)` so the database's row level
  security applies. `asSystem` is only for sign-in, setup scripts and tests.
- Screen actions go through `runAction` (`src/lib/actions.ts`), which checks
  the session and turns `AppError` into a message for the user. Throw
  `AppError` for anything the user should read; its message is shown as-is,
  so write it in plain English.
- Values arriving in Server Actions come from a browser. Check every one.
- Rich text: always pass through `sanitizeDoc` before saving and draw it with
  `<RichText>`. Never store or inject HTML.
- Dates: format with `src/lib/time.ts` (US Central time).

## What the database guarantees for notes (Phase 2)

These hold whatever the app code does (see `drizzle/0003`, `0004`, `0009`
and `0011`):

- Only a note's author, acting as a signed-in user, can change its wording.
  The earlier wording is saved and the "edited" time is stamped by a trigger.
- A note's author, time and day never change. Its day always matches its
  time in US Central time. The app supplies the time and the database
  checks that it is the real time (see "Times are the real time" below).
- A note is added plain: not yet sorted, removed or edited, and "last
  changed by" its writer. The time of a sort or a removal is checked too.
- Filings (`note_sections`) are add-only records; taking one out sets
  `removed_at` once. Filing again adds a new row.
- Comments and earlier wordings can never be changed. Nothing can be deleted.
- Stored text must be a document (`type: "doc"` with a `content` array).

## What the database guarantees for decisions (Phase 3)

These hold whatever the app code does (see `drizzle/0007`, `0009` and
`0011`; the last two came out of independent reviews):

- A proposal is made in your own name, open, at revision 1. Only its
  proposer can change its content, only while it is open and nobody else
  has approved or endorsed it; the revision number then goes up by itself.
- Deciding happens in your own name. Approving needs the `approve`
  permission and your own approval row. Withdrawing is for the proposer,
  declining for another Owner. A decided proposal never changes again, not
  even for the system role.
- Approvals and endorsements are add-only, in your own name, and cannot be
  added to a declined or withdrawn proposal, not even one that is declined
  or withdrawn at that very moment. Each names the proposal revision it was
  given on and is refused if the proposal has been changed since. Both are
  checked while the proposal is locked.
- Whether a decision was made by one person (`decided_alone`) is worked out
  by the database at the moment of approval, from the people who can
  approve right then. The app cannot set it.
- Two people cannot approve a text proposal that is out of date: the
  official version it was written against (`base_version_id`) must still be
  the newest version of its section. That is all the database refuses here:
  it counts the people who can approve at that moment, so for the database
  one person can approve an out-of-date proposal alone. That one person
  cannot approve it alone either, its proposer included, is a rule of the
  app (`approveAlone`, `approveChoices`), not of the database.
- An official version can only be added for an approved, non-structure
  proposal of the same section with the same words, by the person who
  decided it, in the same transaction that approved it. Each proposal
  produces exactly one version, and the database numbers the versions.
- A structure change is one of the four the app can carry out. The sentence
  an approved section change is recorded under (`decided_title`) can be
  written only in the step that approves it.
- A comment is on a note or on a proposal, never both or neither.

The database answers four of its refusals with a code of its own, so the
rules layer can tell the person what happened in plain words. Nobody should
ever read "Something went wrong" for one of these
(`tests/database-refusals.test.ts`):

| Code | Meaning | Put into words by |
| --- | --- | --- |
| `PPF01` | an approval or endorsement names an older revision | `addStamp` |
| `PPF02` | a time that is not the current time | `runAction` (the clock message) |
| `PPF03` | two people's approval of an out-of-date proposal | `finalize` |
| `PPF04` | the proposal was just declined or withdrawn | `addStamp` |

How the rules layer uses this (`src/lib/proposals.ts`, `src/lib/official.ts`):

- Every change to official text or to the section structure made through a
  proposal goes: lock the proposal row, then its section; check what the
  person saw (`Seen`: revision and current official version); record the
  approval; then apply the change in the same transaction (`finalize`). If
  applying fails, everything is undone, including the approval.
- "Edit official" and "Restore" call `saveDirectly`, which creates a
  proposal with `direct = true` and approves it at once. Never write an
  official version any other way.
- A waiting text proposal is out of date when its `baseVersionId` is not
  the section's current official version (`ProposalView.outOfDate`).
  Nobody can approve it then, together or alone, its proposer included:
  `approveProposal` and `approveAlone` both refuse it, and `approveChoices`
  offers neither button. Its proposer first brings it up to date ("Check
  and save again") by saving it again from an edit page that showed the
  current official text: `editProposal(actor, id, input, {
  currentVersionId })`. Then it can be approved as usual, alone too. A
  proposal its proposer can no longer change (someone else approved or
  endorsed it, or the proposer is no longer an Owner or was removed) can
  only be withdrawn or declined. Without that last argument an edit leaves
  "written against" exactly as it was. A new proposal made from a form
  sends `baseVersionId`, the version the form started from, and is refused
  if the text has changed since.
- Screens ask the helpers which buttons to show (`approveChoices`,
  `canApproveToo`, `canEndorse`, `canEditProposal`) and who a proposal is
  waiting for (`waitingOn`, `waitingText`; `countAwaiting` for the sidebar),
  take the notice above a proposal that cannot go ahead from
  `blockedNotice(view, approvers, viewerId)`, and send back exactly the
  `seen` values they rendered. Never work any of that out on a screen, and
  never write those sentences there.
- `waitingOn` answers one step, asked in this order: `gone` (its section
  has been archived, `view.sectionGone`), `same` (the official text already
  says what it proposes, `view.sameAsOfficial`), `check` (out of date,
  waiting for its proposer), `stuck` (out of date, and its proposer can no
  longer change it), `approve`. For `gone` and `same` nothing can be
  approved or endorsed: the helpers say no and the rules refuse. `gone`
  cannot be changed either. The way out is always to withdraw it (its
  proposer) or decline it (another Owner).
- `sectionGone` has one definition (`sectionIsGone`), the one approving
  refuses on: the proposal's own section (for "add a section", the one it
  would go under) is not among the sections in use. `sameAsOfficial` uses
  the comparison that refuses to propose "the same as the current text"
  (`saysWhatIsOfficial`).
- Nobody can endorse an open proposal that is out of date (`canEndorse`;
  `endorseProposal` refuses a press from a page opened earlier): an
  endorsement stops the proposer changing the proposal, and so checking it.
  An approved proposal can still be endorsed. What someone who can approve
  is asked before their endorsement is recorded is `endorseQuestion(view)`:
  for an open proposal it names the proposer, who can no longer change it
  afterwards. (Advisors endorse with one tap.)
- What `waitingText` and `blockedNotice` tell someone to do depends on who
  reads it: the proposer while they can still withdraw
  (`view.proposerCanWithdraw`), someone else who can approve and so can
  decline, or anyone else. Nobody is told to press a button they do not
  have. The same holds for the refusal when a section change can no longer
  be carried out (`cannotBeDoneNow`).
- Lists outside a section show `displayTitle(view, tree)`: a direct edit
  or restore has no written title, so it is named by its section and the
  version it produced ("Edited directly: 2.1 Wages (version 3)"); an open
  section change is described from the sections as they are named and
  numbered now; an approved one shows the sentence it was approved under
  (`decidedTitle`). Activity log lines about a direct edit or a section
  change use the same words, as the proposal read on screen at that moment
  (`titleForLog`); only "Proposed", "Declined" and "Withdrew" carry the
  stored title. The section line next to a proposal is
  `sectionText(view, tree)`.
- A section that is no longer among the sections (archived, or under an
  archived one) is named by its stored name, "Hiring (archived)". Every
  reader hands that name back with the proposal (`sectionTitle`, and
  `destinationTitle` for a move); readers that do not return whole
  proposals (`proposalsForNotes`, search) return `ProposalTitleFields`, which
  is exactly what `displayTitle` needs. Never write that wording on a screen.
- The Decisions Log's section filter is built from the stored sections, not
  from the tree, so decisions about an archived subsection stay in its
  parent's list. "Edit official" and "Restore" refuse a section that is not
  in the tree, as approving a proposal does.
- One-person decisions stay listed for 14 days, every one of them
  (`listOneOwnerDecisions`); `groupOneOwnerDecisions` puts the text changes
  of one section together for showing, without leaving any out.
- When the sections changed while a section proposal waited, so that it
  can no longer be carried out, the approver is told so in approval-time
  words (`noLongerPossible`), not in the words of the proposing form
  (`moveProblem`). Both read the same check, `moveProblemKind`.

## The proposal form never loses what was typed

The form for a new proposal and the edit page (`ProposalForm`) hold the
title, the "Why", the business and the proposed text in the open page. A
reload would lose all but the text, so these two forms are never answered
with "Reload the page". Every sentence `createProposal`, `editProposal` and
their two actions can refuse with says what happened and what the person
can do on the form as it stands: choose again, press the button again,
copy what was typed, or (signed out, a sentence shared by every button in
the app) sign in again in a new tab and come back. Where a button on a
proposal's own page is refused for the same reason (not found, decided
meanwhile, could not be read), the form has a sentence of its own
(`requireOpen(row, "edit form")`, `NOT_FOUND_WHILE_EDITING`,
`FORM_UNREADABLE`) and the page's buttons keep "Reload the page", which is
right there. `tests/form-redraw.test.ts` checks every refused press of the
two forms for the word "reload"; a new refusal gets a case there.

- When a press of the form is refused, for whatever reason, its page is
  drawn again in place, in the same answer: `createProposalAction` and
  `editProposalAction` hand `runAction` an `afterRefusal` that calls
  `refresh()` from `next/cache` (`redrawFormPage` in
  `src/app/(app)/proposals/actions.ts`). The form is not rebuilt, so it
  keeps everything; it is handed the sections and the official text as they
  are now. For a new proposal the editor then sees that its text was typed
  against an older version and shows its notice with "The official text
  now" and the two choices; on the edit page the new official text appears
  above the proposed text and the next Save changes sends that version.
- The redraw must never take the form away. Where the page would no longer
  show the form (the proposal was decided or endorsed meanwhile, the
  section archived, the person may no longer propose), drawing it again
  would send the person elsewhere, and their typed words with it. So the
  action asks first, with the same helpers the pages use
  (`newFormStillShown`, `editFormStillShown`), and otherwise leaves the page
  as it is with the refusal on it. `tests/form-redraw.test.ts` holds every
  case; the browser tests check what the person then sees.
- For the same reason the address of the New proposal page always names
  the section the form is about (a note filed under one section leads there
  by a redirect), and the edit page decides with `canEditProposal` alone.
- What a box on the form shows is what is sent. The list of sections can
  change under an open form, so a section that is no longer offered counts
  as the first line of its box, "Choose a section" (`offered` in
  `ProposalForm`), and a press is refused. A place that has gone (where to
  add a section, where to move one) is different, because the first line of
  its box, "Top level", is a real place: the app would ask the person to
  choose and then take no choice for an answer. So that box then shows a
  first line that is not a choice, "Choose where it should go"
  (`placeGone`), and a press sends nothing until a place is picked, "Top
  level" included. The edit page of a move does the same when the place it
  was going to has been archived since.

## Text kept on a device belongs to the person who typed it

Unsaved text (official text, a proposal's text, a note, a comment) is kept
in the browser under a key that starts with the signed-in person's id
(`src/lib/drafts.ts`; `tests/drafts.test.ts`). The id comes from one small
context, `DraftOwner`, set in the layout of the signed-in pages and read
with `useDraftOwner()`. A piece that keeps such a copy must sit under that
layout (it throws otherwise, rather than fall back to a key shared by
everyone). Nothing is cleared at sign-out: on a shared device the next
person is simply never offered it, and its owner finds it again.

One browser holds one sign-in, and the layout (with the name at the bottom
of the menu and the id above) is drawn once and kept while a person moves
between pages. So a page left open would go on showing one person's name,
and offering their copies, while everything saved from it was recorded for
whoever signed in last from another page of the same browser. `SamePerson`,
in the same layout, closes that: each time a page is loaded it writes the
person's id to the browser's shared storage (`ppf:signed-in`), it listens
for another page writing a different id, and then loads itself again, once
(the page that comes back writes the new id, so the pages agree). A second
page opened by the same person causes no reload, which is what "sign in
again in a new browser tab" after being signed out relies on. Nothing is
written at sign-out. Storage access is wrapped, so a browser that blocks it
changes nothing. The page that loads itself again loses what was typed on
it and not kept on the device (a proposal's title and "Why"); it could no
longer have saved that under the right name. Settings and the activity
log are outside that layout and do not have it.

## What the database guarantees for people and sections

These bind the app's limited role (see `drizzle/0009` and `0011`). Setup
scripts, sign-in and database steps have full access and are not bound.

- No two people have the same name. Names are compared in one standard
  form (`user_name_key`): capitals, extra spaces, other forms of the same
  letters and characters that draw nothing do not count. A removed person
  who never signed in does not hold their name, so a mistyped email address
  can be removed and the person added again.
- A stored name has no character in it that cannot be seen, and no tab or
  line break. `src/lib/names.ts` holds the same list as the database
  (`unseen_characters()`), and `tests/names.test.ts` checks that they agree.
  Letters that merely look alike (a capital I for a small l) are not caught.
- A person's name can change only until they have signed in for the first
  time. Their email address, when and by whom they were added, and when
  they last signed in are out of the app's reach altogether. Someone added
  back keeps the name they had (`AddUserResult.keptName`).
- A person is added and removed in your own name, and "last changed by /
  at" is stamped by the database. A section is added and archived in your
  own name; when and by whom it was added never change; "last updated by"
  is whoever changed its name or its "last updated" time (reordering,
  moving and archiving are not content changes and leave it alone).

## Times are the real time

For the app's limited role, the database only accepts the current time (an
hour either way) wherever a record says when something happened: on every
new record, and on the time a proposal is decided, a person removed, a
section archived or marked as updated, a note sorted or removed
(`recent_time_only` in `drizzle/0009` and `0011`;
`tests/db-security-times.test.ts` holds the full list). Its refusal has the
code `PPF02`, which `runAction` turns into a message about the clock of the
computer that runs the app.

The `now` options on the rules exist for tests. A test or a test seed that
needs a time in the past needs the `allow_set_time` switch: a row in
`system_flags`, which only code with full database access can see or set.
`withTestDatabase()` switches it on for each test file;
`withRealTimeOnly(...)` switches it off around the tests of the rule itself;
the browser-test seeds (`e2e/*.seed.ts`) switch it on and take it away again
before the app starts. Nothing in `src/` sets it, and nothing ever should.

## When you add a database table

1. Add it to `src/db/schema.ts` with `created_at`, `created_by`, `updated_at`,
   `updated_by` where it makes sense, then run `npm run db:generate`.
2. In a migration, turn on row level security for it, add policies, and grant
   `ppf_app` only what is needed. Never grant DELETE. Follow
   `drizzle/0001_security.sql`.
3. `tests/db-security.test.ts` fails if a table has no row level security or
   if `ppf_app` can delete from it.

## When you write a database step

- There are two kinds, as in `0010` and `0011`: `npx drizzle-kit generate
  --name <name>` for a change to `src/db/schema.ts`, and `npx drizzle-kit
  generate --custom --name <name>_security` for rules written by hand.
  Never edit a step that has been applied to a real database.
- All the steps a deploy has to catch up on run in ONE transaction. Since
  `0009`, every proposal that a step touches leaves a check waiting for the
  end of that transaction (`proposals_applied_at_commit`), and the database
  refuses `ALTER TABLE "proposals"` while checks are waiting ("pending
  trigger events"). So a step that updates existing proposals must run
  `SET CONSTRAINTS ALL IMMEDIATE` straight after the update, before any
  further `ALTER TABLE` on proposals in the same deploy, in that step or a
  later one. Without it the deploy stops (nothing is harmed, but nothing is
  applied). It only shows on a database that already holds proposals, never
  on an empty one. `tests/carryover.test.ts` applies a made-up later step
  both ways to a database with proposals.
- A step that changes how names are compared (`user_name_key`,
  `unseen_characters`) must drop the index `users_name_unique` first, create
  it again afterwards, and rename people whose names now collide, with a
  line in the activity log, as `0011` does.
- Write every unusual character as its number (backslash, u, four hex
  digits), never as the character itself: `0011` is plain ASCII on purpose,
  so nothing in it is invisible. In TypeScript use
  `String.fromCodePoint(0x200b)`. And in a pattern, list the space
  characters one by one: what the shorthand `\s` covers differs between the
  embedded database and a real server.
- The rules that say "in your own name" and "the real time" bind the role
  `ppf_app` by its name. If production ever connects under another role
  name, those rules have to move with it.
- Add a case to `tests/carryover.test.ts` that starts from the step before
  yours, with the kinds of records a real database would hold.

## Before calling work done

```bash
npm run lint && npm run typecheck
npm test
TEST_DATABASE_URL=postgres://... npm test   # when a Postgres server is available
npm run build && scripts/run-e2e.sh start   # browser test, computer and phone sizes
```

Add tests for new rules in `tests/` and new screens in `e2e/` (one
`e2e/phaseN.cjs` per phase; an optional `e2e/phaseN.seed.ts` puts test-only
starting data into the fresh database). Look at the phone screenshots
yourself before showing them to the owner.

In a browser test, take pictures with `shot()` from `e2e/helpers.cjs`. It
first waits until the page has finished starting up in the browser
(`settled`). Taking a picture marks every text box for a moment, and on a
page that is still starting up the development build reports that as an
error ("A tree hydrated but some attributes ... didn't match"), which the
test would then count as an error of the app.

For each database rule, and each check in `src/lib`, make sure a test fails
when the rule is taken away. The way to check: copy `src`, `tests` and
`drizzle` to a scratch folder, take ONE rule away there with a one-line
change, run the tests, and see that at least one fails; then the next rule.
The scripts used so far are kept on the build machine, outside the
repository, in `.data/probes/r3hmut/` (the first review) and
`.data/probes/r5a/` and `r5b/` (the second: database rules, then readers
and wording) and `.data/probes/r6c/` and `r6d/` (the third: rules layer,
then what the screens' actions decide): `list.sh`
has one line per rule, `all.sh` runs them all, and
from `r5a` on `syntax.ts` first checks that a change has not simply broken
the file, which would look like "noticed" for the wrong reason. Where two layers refuse the same thing with the same words (the app
first, the database behind it), taking one away cannot be seen from
outside: test each on its own where you can (as
`tests/database-refusals.test.ts` does) and say so in your report where you
cannot. Tests of what happens "at the same moment"
(`tests/same-moment.test.ts`) only run against a real Postgres server.

## Things worth knowing

- This is Next.js 16: read the bundled docs (see `AGENTS.md`) before using an
  API from memory. `cacheComponents` is off on purpose: every page is behind
  sign-in and rendered fresh.
- Local development and tests use PGlite (Postgres inside the process).
  Production uses a real Postgres through `DATABASE_URL`. Both are tested.
- The editor (`RichTextEditor`) is loaded only in the browser, on demand, so
  it uses `immediatelyRender: true`. Keep it out of server rendering.
- Comparing two versions (`src/lib/diff.ts`): `compareDocs` answers
  "formatting" when the words are the same, with `links` and `checks` set
  when a link's address or a ticked checkbox differs, which is more than
  layout. `diffWords` drops the unchanged start and end first; read the
  comment on `MAX_DIFF_WORDS` before touching the limit, it is what keeps
  one comparison to about 13 MB. Its last step joins changes that have only
  unchanged spaces on one line between them, so a reworded sentence reads
  as one removed run and one added run (never across a line break or a
  tab, which is the next paragraph, list item or table cell; never where
  words were only added or only removed). The spaces go into both runs:
  both texts are still rebuilt exactly from the parts. `diffPieces` is the
  comparison before that step, for tests that count changes.
- Drawing it (`DiffView`): a changed run made only of words and single
  spaces is laid out as ordinary text (`run-plain`), so that where one of
  its lines ends on a phone the space there is not crossed out or
  underlined. A run with a line break, a tab or two spaces in a row keeps
  the layout that shows every one of them. Two changes get a little air
  between them only where no space separates them (`touching`).
- A button press can arrive twice (a lost answer, a second device). Saving
  official text that is already exactly the official text answers "no
  changes" before anything else is checked, and a second endorsement by the
  same person is quietly not added (`tests/same-moment.test.ts`).
- JSON stored in Postgres can come back with its fields in a different
  order. Compare documents with `sameDoc`, and anything else stored as JSON
  field by field (as `sameStructureChange` does), never with
  `JSON.stringify`.
- Inside `asUser(...)` or any transaction, run every query on the `tx` you
  were given. A query on another handle (`asSystem`, a second `asUser`) from
  inside it waits forever on the embedded database, which has one connection.
- The editor has auto-formatting switched off (`enableInputRules` and
  `enablePasteRules` are false) so typed characters such as `*` and `_` are
  never swallowed. Keep it that way: words are stored exactly as typed.
