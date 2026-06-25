# 🇺🇸 ARMOIMC III — Rankings Site

A self-contained rankings webpage for the **3rd Annual Rard Man Open Invitational Master Classic**
(July 4, 2026). No build step — it's a single `index.html` you can open in any browser or host on
GitHub Pages.

## Tabs
- **Team Rankings** — six squads auto-ranked by a **Power Index** (the average rating of each team's
  five players).
- **Player Rankings** — every player ranked, with filters across the top:
  - **Show:** Everyone / Boys / Girls
  - **Rank by:** Overall / Best Golfers / Best Drinkers
  - **View:** List or Tier list (S/A/B/C/D)
  - plus a search box. Tap any player for their scouting report.
- **About** — event info, course information, and the official rules.

## How the rankings are calculated
Rankings are **derived automatically** from the per-player ratings you set in the admin panel:

- Each player has a **⛳ golf** rating and a **🍺 drinking** rating (1–5 stars).
- **Overall (RMR)** = `(golf × golfWeight + drink × drinkWeight) × 20`, giving a 0–100 score.
  The golf/drink weight split is adjustable in the Rank Players panel (default 60/40).
- **Tiers:** S ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60, D below.
- **Team Power Index** = the average Overall of that team's five players.

### ✨ AI rankings (real Claude, no backend)
In admin mode, **✨ AI Rankings** sends every player's stars + your scouting comments straight to the
Claude API from your browser and gets back the **official** overall score, tier, and a scouting
blurb for each player, plus a blurb for every team.

- Paste a **Claude API key** — it's stored only in your browser (`localStorage`) and is **never**
  included when you Publish.
- Pick a model (Sonnet 4.6 for speed, Opus 4.8 for the best writeups).
- The AI results are baked into your data; once you Publish, **visitors see them with no key needed.**
- A **Engine: ✨ AI / Formula** toggle appears on the rankings so you can compare the AI ordering with
  the raw star formula. **Clear AI data** reverts to the formula.

> Security note: a browser-side API key can be read by anyone with access to that device, which is why
> Anthropic calls this "dangerous direct browser access." Only the commissioner uses it, on their own
> device, and it never leaves the browser or gets published — fine for this use case. Use a key you
> can rotate. (A server-side proxy is the move if you ever want zero key exposure.)

## Admin mode (editing)
The public can only view. To edit, click the faint **· admin ·** link at the very bottom of the page.

- **Default password:** `armoimc2026`
- Once logged in you can:
  - **⭐ Rank Players** — set each player's gender, golf/drinking stars, and comments. Rankings
    recompute live.
  - Edit team **names & blurbs** and the entire **About** tab inline (just click the text).
  - **⬇ Publish (export)** — downloads a `data.json` file. Commit that file into this `armoimc/`
    folder and the live site will show it to everyone (see below).
  - **⬆ Import** — load a `data.json` back in.
  - **Discard local** — throw away unpublished local edits and reload the published data.

Admin edits are saved in *your browser* immediately (so you can tinker), but they only become
public once you **publish** the `data.json` and it's committed to the repo.

### Changing the admin password
The password is stored as a SHA-256 hash in `index.html` (constant `ADMIN_HASH`). To change it,
generate a new hash and replace the constant:

```bash
printf '%s' 'your-new-password' | sha256sum
```

(Client-side gating only — fine for a friend group, not real security. Don't put anything sensitive
behind it.)

## Publishing data (making edits public)
1. Log in as admin and make your changes.
2. Click **⬇ Publish (export)** to download `data.json`.
3. Put that file at `armoimc/data.json` and commit it.
4. The live page loads `armoimc/data.json` on startup, so everyone now sees your edits.

## Hosting on GitHub Pages
The repo already has `.nojekyll`, so static files are served as-is.
1. In the repo: **Settings → Pages**.
2. Set **Source = Deploy from a branch**, branch **`main`**, folder **`/ (root)`**.
3. The site will be at `https://<user>.github.io/claude-code/armoimc/`.

(This page lives on a feature branch right now — merge it to `main` to publish.)
