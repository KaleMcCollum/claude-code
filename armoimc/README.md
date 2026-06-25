# 🇺🇸 ARMOIMC III — Rankings Site

A webpage for the **3rd Annual Rard Man Open Invitational Master Classic** (July 4, 2026) where
**everyone votes** on the players and **AI builds the official rankings** from the pooled votes.

- `index.html` — the whole site (one file).
- `supabase-setup.sql` — run once to create the shared "vote box" database.

## How it works
1. You send everyone the link.
2. On the **⭐ Vote** tab, each person types their name and rates every competitor — ⛳ golf and
   🍺 drinking (1–5 stars) — plus optional comments.
3. All ballots pool together in a free cloud database (Supabase).
4. The **Team** and **Player** rankings show the live **crowd averages**.
5. In admin mode you hit **✨ Build AI Rankings** and Claude turns everyone's votes + comments into
   the official scores, tiers, and scouting reports. Those save to the cloud so **everyone sees the
   same official rankings** — no key needed to view.

## One-time setup (≈5 minutes)
1. Make a free account at **https://supabase.com** → **New project** (any name; pick a password;
   wait ~1 min for it to spin up).
2. Open **SQL Editor → New query**, paste in everything from `supabase-setup.sql`, click **Run**.
3. Go to **Project Settings → API** and copy two things:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string)
4. Paste both into the top of `index.html`:
   ```js
   const SUPABASE_URL = "https://abcd1234.supabase.co";
   const SUPABASE_ANON_KEY = "your-anon-public-key";
   ```
   (Both are safe to be public — the anon key is designed for use in browsers.)
5. Commit/publish, and voting is live. Until these are filled in, the site runs in **preview mode**
   (seeded ratings, voting paused) — which is harmless.

> Send me your Project URL + anon key and I'll paste them in for you.

## Admin mode
Click the faint **· admin ·** link at the very bottom of the page.
- **Default password:** `armoimc2026`
- Admin can: **✨ Build AI Rankings**, **↻ Refresh votes**, edit team names/blurbs and the About tab
  inline, and **Clear AI rankings** (revert to crowd averages).

### ✨ AI rankings (real Claude, no server)
The AI call goes straight from the browser to the Claude API.
- Paste a **Claude API key** (from console.anthropic.com). It's stored only in your browser and is
  **never** sent to the database or shared.
- Pick a model (Sonnet 4.6 = fast, Opus 4.8 = best writeups).
- The AI reads the pooled vote averages + comments and writes each player's official score, tier,
  and scouting blurb, plus a team blurb. The result is saved to the cloud for all viewers.
- A **Source: ✨ AI / Crowd avg** toggle on the rankings lets anyone compare.

### Changing the admin password
The password is a SHA-256 hash in `index.html` (`ADMIN_HASH`). To change it:
```bash
printf '%s' 'your-new-password' | sha256sum
```
Replace the `ADMIN_HASH` value with the output. (Client-side gating only — fine for a friend group,
not real security.)

## Hosting (GitHub Pages)
The repo has `.nojekyll`, so it serves static files as-is. After merging to `main`:
**Settings → Pages → Deploy from a branch → `main` → `/ (root)`**. The site will be at
`https://<user>.github.io/claude-code/armoimc/`.

## Privacy / security notes
- The vote tables are open to anyone with the link (no login), so friends can vote freely. Don't put
  anything sensitive in there. Votes are keyed to a random id in each voter's browser, so re-voting
  updates their ballot instead of duplicating.
- The Claude API key never leaves the admin's browser and is never written to the database.
