# Plant Perfect Fargo Operations Manual

A private web app for the owners of Plant Perfect Fargo: one place to capture
notes and decisions, keep an organized manual of official policies, and see
who approved what and when. It works on a computer and on a phone.

This folder holds the app. It is being built in six phases, and each phase is
confirmed with the owner before the next one starts.

## Where things stand

| Phase | What it covers | Status |
| --- | --- | --- |
| 1. Foundation | Sign-in by email link, users and roles, Settings and Add user, the sidebar layout, the starting sections, section pages with Official and Discussion, the text editor | Built and tested. |
| 2. Capture | Daily Log, notes, sorting notes into sections, search, Today page | Built and tested. |
| 3. Decisions | Proposals, approvals by one or both owners, endorsements, Decisions Log, version history | Built and tested. Waiting for the owner's approval. |
| 4. Operations records | To-dos, order deadlines, quotes, payments, vendors, timeline, documents | Not started |
| 5. AI | Automatic sorting, to-do extraction, proposals from notes, Draft with AI, Suggest wording, undo | Not started |
| 6. Output and safety | Word and PDF export, handbook builder, notifications, backups, full export | Not started |

The app is **not online yet**. It runs on a developer machine only. Putting it
online needs the owner to create a few accounts (hosting, database, email).

### What works today (Phase 1)

- **Sign in with only an email.** The app emails a one-time link. No passwords.
  Links expire after 15 minutes and work once. A device stays signed in until
  it has gone 30 days without being used.
- **Two roles.** Owners can do everything. Advisors can read, and later comment
  and endorse, but cannot edit, approve, change sections or open Settings.
- **Settings (Owners only).** See users, add a user (they get an invitation
  email), change a role, remove a user.
- **The sidebar.** The same on every page: New note, Search, Today, Daily Log,
  Proposals, To-do, Documents, the numbered manual sections, Settings.
- **Manual sections.** The ten starting sections and their subsections.
  Owners can add, rename, reorder (arrows, or drag on a computer) and archive
  sections. Numbers update on their own. Archiving never deletes anything.
- **Section pages.** Official text on top with a bold "Approved by" line,
  Discussion below. Owners use "Edit official" to change the official text.
  Every save is kept as a new version with who approved it and when.
- **Text editor.** Bold, italic, underline, headings, bulleted and numbered
  lists, checkboxes, links and tables. Unsaved typing is kept on the device
  if the page closes.
- **Search** over section names and official text (notes and the rest join in
  later phases).
- **Phone home screen.** The app can be added to a phone's home screen with
  the Plant Perfect icon and opens on Today. (The icon is drawn from the
  logo in `assets/brand/` by `scripts/make-icons.cjs`. The screens
  themselves stay plain; the logo and brand colours are for the icon and,
  later, for exported documents.)

### What Phase 2 added

- **Daily Log.** Every day that has notes has its own page, listed newest
  first, with a date field to jump to any day. Each day shows all notes from
  all users in the order they were written.
- **Notes.** "New note" in the sidebar (the plus on a phone) opens the note
  box from anywhere. Save, or Ctrl/Cmd+Enter, and the box is ready for the
  next note. A note is stored and shown exactly as typed. Only its author can
  change its wording, and the earlier wording is kept and can be opened from
  the "Edited" line. Owners can remove a note; it is hidden, not deleted, and
  can be restored from its day or from "Removed notes" on the Daily Log page.
- **Sorting by hand.** Choose the sections a note belongs to (type to find
  one, or show them all), a business tag (Garden Center, Coffee Shop, Both)
  and tick "Sorted". The same note then shows, word for word, in each chosen
  section's Discussion with its author, original time and a link back to its
  day.
- **Discussion.** Each section page lists its notes newest first, with a
  switch to oldest first and a business filter.
- **Comments.** Owners and Advisors can comment on a note. Comments show
  wherever the note shows.
- **Today.** The opening countdown, the unsorted notes (sortable right
  there) and stale sections: sections with content that nobody has updated
  for a set number of days. The opening date and the number of days are in
  Settings.
- **Search.** Notes and comments join section names and official text.
  Every word must appear, in any order. Filters: date range, section,
  business, author.

### What Phase 3 added

- **Proposals.** An Owner proposes a change instead of making it: new or
  changed official text for a section (a decision, or wording only), or a
  change to the sections themselves (add, rename, move, archive). A proposal
  has a title, an optional "why", a business tag, the notes it came from,
  comments, and shows exactly what would change: removed words struck
  through, added words underlined.
- **Approving.** Proposing counts as the proposer's approval. When the other
  Owner approves, the change is applied and the section shows a bold
  "Approved by Kale and Casey" with the date. An Owner can also "Approve on
  my own": it becomes official with one name, and is flagged on Today for
  14 days so the other Owner sees it and can add "I approve too".
- **Decline and withdraw.** Another Owner can decline (with an optional
  reason); the proposer can withdraw. Nothing changes in either case. Only
  the proposer can change a proposal, and only until someone else has
  approved or endorsed it. Nobody can approve wording that changed after
  they opened the page.
- **Endorsements.** Advisors (and Owners who have not approved) can endorse.
  It shows as a faint italic line under the approval and never changes a
  proposal's status.
- **"Edit official" is a decision too.** A direct edit is recorded as a
  change approved by the Owner who made it, so it is flagged for the other
  Owner and listed in the Decisions Log like any other one-person decision.
- **Decisions Log.** Every approved change, newest first, with who approved
  and endorsed it, filtered by section, business, approver and dates. It is
  not a separate list: it shows the approved proposals themselves.
- **Version history.** Every version of a section's official text, with
  the dates it was official, who approved it, where it came from, and what
  changed from the version before. An Owner can restore an old version,
  which adds a new version; nothing is erased.
- **Today** shows what is waiting for approval and what one person decided.
  The sidebar shows how many proposals are waiting for you.
- **Notes** can start a proposal ("Propose") and show the proposals made
  from them. **Search** finds proposals. **Settings** has the activity log:
  every change, who made it and when.

To-do and Documents appear in the sidebar but show a "not built yet" page
until their phase.

### Known gaps

- Pictures and attachments are not available yet. They need file storage,
  which arrives with the Documents library in Phase 4.
- Notes are sorted by hand. Sorting with AI is Phase 5.
- To-dos and deadlines are not on the Today page yet (Phase 4).
- Moving a section to a different parent section is done through a
  proposal ("Move a section"), not yet from the Edit sections page.
- Emails about proposals waiting for approval are part of notifications
  (Phase 6). Until then the sidebar count and Today show them.
- There is no single Trash page yet: removed notes are restored from the
  Daily Log, archived sections from Edit sections.

## Rules the app is built around

These come from the owner's build spec and are enforced in code:

1. **Owner words are never altered.** Text is stored and shown exactly as
   typed. The editor never turns typed characters into formatting, and the
   database itself refuses a change to a note's wording by anyone but its
   author.
2. **Official and Discussion are always separate.**
3. **Nothing is official without a recorded approval** (who and when). The
   database itself only accepts official text that comes from an approved
   proposal with the same words, approved in the approver's own name, and
   a decided proposal can never be changed afterwards.
4. **Nothing is ever hard-deleted.** Sections are archived, users are removed
   but kept on record, and old versions stay forever. The database itself
   refuses deletes.
5. **Everything is timestamped** with who did it, in an activity log.
6. **One source of truth.** Numbers, dates and statuses live in one record;
   other screens read from it.
7. **Plain look.** White, near-black text, light gray lines, one dark teal
   accent, the device's own font. No decoration.

## For developers

### Run it locally

Needs Node.js 22 or newer. Nothing else to install: without a database
address the app uses a small built-in Postgres (PGlite) stored in `.data/`.

```bash
npm install
cp .env.example .env.local      # sets two example owners
npm run dev                     # http://localhost:3000
```

Sign in as `kale@example.com`. No email is sent locally: the sign-in link is
printed in the terminal and saved in `.data/outbox/`.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app for development |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | Code checks |
| `npm test` | Automated tests of the rules (sign-in, permissions, sections, official text, users, notes, search, Today, proposals and approvals) on the built-in database |
| `TEST_DATABASE_URL=postgres://... npm test` | The same tests on a real Postgres server |
| `scripts/run-e2e.sh` | Browser tests: for each phase, starts the app on a fresh database and clicks through everything on computer and phone sizes. `scripts/run-e2e.sh start` tests a production build; add names (`phase1 phase2`) to run only some. Needs Playwright with Chromium. |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run db:setup` | Apply migrations and first-time data to the database in `DATABASE_URL` |

### Settings (environment variables)

See `.env.example`. In production these live in the hosting service's
settings, never in files.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres address. Required in production. |
| `APP_URL` | The app's public address, used in sign-in emails. Required in production. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email sending (Resend). Required in production. |
| `SEED_OWNERS` | Owners to create the first time, e.g. `Kale <kale@example.com>, Casey <casey@example.com>`. Only used while there are no users. |

### How it is put together

- **Next.js** (App Router, TypeScript, server-rendered pages, Server Actions).
- **Postgres** through **Drizzle ORM**. Schema in `src/db/schema.ts`, SQL
  migrations in `drizzle/`.
- **Sign-in** is implemented here (`src/lib/auth/`) rather than with a hosted
  login service, so the app runs on any Postgres host and the rules in the
  spec (15-minute single-use links, 30-day sessions, same answer for unknown
  emails) are exact. Only hashes of link and session secrets are stored.
- **Permissions are enforced twice.** In the app (`assertCan` in `src/lib/`)
  and again by the database with row level security
  (`drizzle/0001_security.sql`). Every request acts through `asUser()`, which
  switches to a limited database role that cannot delete anything and cannot
  see sign-in data. `asSystem()` is only for sign-in and setup.
- **Rich text** is stored as the editor's JSON, never as HTML. It is checked
  on the server before saving (`src/lib/richtext.ts`) and drawn by our own
  component (`src/components/RichText.tsx`).
- **Notes** (`src/lib/notes.ts`) belong to the Daily Log of the US Central
  day they were written. Filing a note under a section is a link, never a
  copy. Removing is a mark on the note, never a delete.
- **Proposals** (`src/lib/proposals.ts`) are the single record of every
  change to official text and to the section structure. A direct "Edit
  official" save and a restore are proposals approved on the spot. An
  official version always points at the proposal that produced it, and
  approvals and endorsements hang off the proposal. The Decisions Log and
  the "decided by one person" list are views of these records, not copies.
- **Dates** are always shown in US Central time (`src/lib/time.ts`).

```
src/app/            pages and actions (login, the signed-in pages, settings)
src/components/     sidebar, editor, section manager, rich text, notes
src/lib/            the rules: auth, sections, official text, proposals,
                    users, notes, settings, Today, search, activity
src/db/             schema, database connection, first-time data
drizzle/            SQL migrations
tests/              automated tests of the rules
e2e/                browser tests, one per phase
```

### Going online (not done yet)

The plan, to be confirmed with the owner before any sign-up or cost:

1. A hosting service for the app, connected to this repository so every
   change deploys by itself.
2. A Postgres database with daily backups.
3. An email service for sign-in links and invitations.
4. Set the variables above, then the build runs `npm run db:setup` before
   `npm run build`.
5. Last of all, connect the custom web address.
