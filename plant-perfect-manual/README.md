# Plant Perfect Fargo Operations Manual

A private web app for the owners of Plant Perfect Fargo: one place to capture
notes and decisions, keep an organized manual of official policies, and see
who approved what and when. It works on a computer and on a phone.

This folder holds the app. It is being built in six phases, and each phase is
confirmed with the owner before the next one starts.

## Where things stand

| Phase | What it covers | Status |
| --- | --- | --- |
| 1. Foundation | Sign-in by email link, users and roles, Settings and Add user, the sidebar layout, the starting sections, section pages with Official and Discussion, the text editor | Built and tested. Waiting for the owner to approve the look. |
| 2. Capture | Daily Log, notes, sorting notes into sections, full search, Today page | Not started |
| 3. Decisions | Proposals, approvals by one or both owners, endorsements, Decisions Log, version history screens | Not started |
| 4. Operations records | To-dos, order deadlines, quotes, payments, vendors, timeline, documents | Not started |
| 5. AI | Automatic sorting, to-do extraction, proposals from notes, Draft with AI, Suggest wording, undo | Not started |
| 6. Output and safety | Word and PDF export, handbook builder, notifications, backups, full export | Not started |

The app is **not online yet**. It runs on a developer machine only. Putting it
online needs the owner to create a few accounts (hosting, database, email),
which is the step after Phase 1 is approved.

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
- **Phone home screen.** The app can be added to a phone's home screen and
  opens on Today.

Daily Log, Proposals, To-do and Documents appear in the sidebar but show a
"not built yet" page until their phase.

### Known gaps in Phase 1

- Pictures inside text are not available yet. They need file storage, which
  arrives with the Documents library in Phase 4.
- Sections can be reordered within their group but not yet moved to a
  different parent section.
- The home screen icon is a placeholder ("PP" on dark teal) until the real
  logo is supplied.
- Old versions of official text are stored, but the screen for browsing and
  restoring them is part of Phase 3.

## Rules the app is built around

These come from the owner's build spec and are enforced in code:

1. **Owner words are never altered.** Text is stored and shown exactly as typed.
2. **Official and Discussion are always separate.**
3. **Nothing is official without a recorded approval** (who and when).
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
| `npm test` | Automated tests of the rules (sign-in, permissions, sections, official text, users) on the built-in database |
| `TEST_DATABASE_URL=postgres://... npm test` | The same tests on a real Postgres server |
| `scripts/run-e2e.sh` | Browser test: starts the app on a fresh database and clicks through everything on computer and phone sizes. `scripts/run-e2e.sh start` tests a production build. Needs Playwright with Chromium. |
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
- **Dates** are always shown in US Central time (`src/lib/time.ts`).

```
src/app/            pages and actions (login, the signed-in pages, settings)
src/components/     sidebar, editor, section manager, rich text
src/lib/            the rules: auth, sections, official text, users, search
src/db/             schema, database connection, first-time data
drizzle/            SQL migrations
tests/              automated tests of the rules
e2e/                browser test
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
