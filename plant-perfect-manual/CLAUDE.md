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

These hold whatever the app code does (see `drizzle/0003` and `0004`):

- Only a note's author, acting as a signed-in user, can change its wording.
  The earlier wording is saved and the "edited" time is stamped by a trigger.
- A note's author, time and day never change. Its day always matches its
  time in US Central time. (The time itself is supplied by the app: tests
  pass a fixed `now` to `addNote`. The database does not force it to "now".)
- Filings (`note_sections`) are add-only records; taking one out sets
  `removed_at` once. Filing again adds a new row.
- Comments and earlier wordings can never be changed. Nothing can be deleted.
- Stored text must be a document (`type: "doc"` with a `content` array).

## What the database guarantees for decisions (Phase 3)

These hold whatever the app code does (see `drizzle/0007`):

- A proposal is made in your own name, open, at revision 1. Only its
  proposer can change its content, only while it is open and nobody else
  has approved or endorsed it; the revision number then goes up by itself.
- Deciding happens in your own name. Approving needs the `approve`
  permission and your own approval row. Withdrawing is for the proposer,
  declining for another Owner. A decided proposal never changes again, not
  even for the system role.
- Approvals and endorsements are add-only, in your own name, and cannot be
  added to a declined or withdrawn proposal.
- An official version can only be added for an approved, non-structure
  proposal of the same section with the same words, by the person who
  decided it, and each proposal produces at most one version.
- A comment is on a note or on a proposal, never both or neither.

How the rules layer uses this (`src/lib/proposals.ts`, `src/lib/official.ts`):

- Every change to official text or to the section structure made through a
  proposal goes: lock the proposal row, check what the person saw (`Seen`:
  revision and current official version), record the approval, then apply
  the change in the same transaction (`finalize`). If applying fails,
  everything is undone, including the approval.
- "Edit official" and "Restore" call `saveDirectly`, which creates a
  proposal with `direct = true` and approves it at once. Never write an
  official version any other way.
- Screens ask the helpers which buttons to show (`approveChoices`,
  `canApproveToo`, `canEndorse`, `canEditProposal`) and send back exactly
  the `seen` values they rendered.
- Lists outside a section show `displayTitle(view, tree)`, because direct
  edits have no written title.

## When you add a database table

1. Add it to `src/db/schema.ts` with `created_at`, `created_by`, `updated_at`,
   `updated_by` where it makes sense, then run `npm run db:generate`.
2. In a migration, turn on row level security for it, add policies, and grant
   `ppf_app` only what is needed. Never grant DELETE. Follow
   `drizzle/0001_security.sql`.
3. `tests/db-security.test.ts` fails if a table has no row level security or
   if `ppf_app` can delete from it.

## Before calling work done

```bash
npm run lint && npm run typecheck
npm test
TEST_DATABASE_URL=postgres://... npm test   # when a Postgres server is available
npm run build && scripts/run-e2e.sh start   # browser test, computer and phone sizes
```

Add tests for new rules in `tests/` and new screens in `e2e/` (one
`e2e/phaseN.cjs` per phase; an optional `e2e/phaseN.seed.ts` puts test-only
starting data into the fresh database). For each database rule, make sure a
test fails when the rule is taken away. Look at the phone screenshots
yourself before showing them to the owner.

## Things worth knowing

- This is Next.js 16: read the bundled docs (see `AGENTS.md`) before using an
  API from memory. `cacheComponents` is off on purpose: every page is behind
  sign-in and rendered fresh.
- Local development and tests use PGlite (Postgres inside the process).
  Production uses a real Postgres through `DATABASE_URL`. Both are tested.
- The editor (`RichTextEditor`) is loaded only in the browser, on demand, so
  it uses `immediatelyRender: true`. Keep it out of server rendering.
- JSON stored in Postgres can come back with its fields in a different
  order. Compare documents with `sameDoc`, not `JSON.stringify`.
- Inside `asUser(...)` or any transaction, run every query on the `tx` you
  were given. A query on another handle (`asSystem`, a second `asUser`) from
  inside it waits forever on the embedded database, which has one connection.
- The editor has auto-formatting switched off (`enableInputRules` and
  `enablePasteRules` are false) so typed characters such as `*` and `_` are
  never swallowed. Keep it that way: words are stored exactly as typed.
