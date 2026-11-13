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
  the newest version of its section. One person can approve it alone.
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
  `approveProposal` refuses it; `approveAlone` goes through only when the
  result is a one-person decision. Its proposer brings it up to date by
  saving it again from an edit page that showed the current official text:
  `editProposal(actor, id, input, { currentVersionId })`. Without that last
  argument an edit leaves "written against" exactly as it was. A new
  proposal made from a form sends `baseVersionId`, the version the form
  started from, and is refused if the text has changed since.
- Screens ask the helpers which buttons to show (`approveChoices`,
  `canApproveToo`, `canEndorse`, `canEditProposal`) and who a proposal is
  waiting for (`waitingOn`, `waitingText`; `countAwaiting` for the sidebar),
  and send back exactly the `seen` values they rendered. Never work any of
  that out on a screen.
- Lists outside a section show `displayTitle(view, tree)`: a direct edit
  or restore has no written title, so it is named by its section and the
  version it produced ("Edited directly: 2.1 Wages (version 3)"); an open
  section change is described from the sections as they are named and
  numbered now; an approved one shows the sentence it was approved under
  (`decidedTitle`). Activity log lines about a direct edit use the same
  words. The section line next to a proposal is `sectionText(view, tree)`.
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

For each database rule, and each check in `src/lib`, make sure a test fails
when the rule is taken away. The way to check: copy `src`, `tests` and
`drizzle` to a scratch folder, take ONE rule away there with a one-line
change, run the tests, and see that at least one fails; then the next rule.
The scripts used so far are kept on the build machine, outside the
repository, in `.data/probes/r3hmut/` (the first review) and
`.data/probes/r5a/` (the second): `list.sh` has one line per rule, `all.sh`
runs them all, and in `r5a` `syntax.ts` first checks that a change has not
simply broken the file, which would look like "noticed" for the wrong
reason. Where two layers refuse the same thing with the same words (the app
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
  one comparison to about 13 MB.
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
