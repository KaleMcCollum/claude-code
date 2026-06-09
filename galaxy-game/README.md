# Edge of the Outer Stars

A completely text-based galaxy RPG that runs in a **single HTML file** — perfect for playing on a phone with no app store or install.

## How to play on your phone
1. Get `galaxy-game/index.html` onto your phone (AirDrop, email it to yourself, a cloud drive, or host it).
2. Open it in your browser (Safari/Chrome).
3. Tap the share icon → **Add to Home Screen** for an app-like icon.
4. Progress **autosaves to the browser** after every action.
5. Use the **Save** tab to **export a backup `.json` file** you can store anywhere or import on another device.

## What's in this first build
- **Character creation**: name → species → path (specialization) → review.
- **6 species**, each with stat modifiers and a unique trait.
- **5 paths** (Warden, Ranger, Adept, Smuggler, Tamer), each granting a signature skill.
- **Random starter world** chosen from the quiet frontier (Tier 1: limited resources, weak beasts, thin markets).
- **Explore / fight / tame** creatures, build a **menagerie** of pets.
- **Inventory, equipment, market, travel**, leveling, XP, energy, credits.
- **Save system**: browser autosave + file export/import.

## Where to grow it next
The whole game is driven by the `DATA` object at the top of the `<script>`:
- Add worlds → `DATA.worlds` (set higher `tier` for harder zones)
- Add species → `DATA.species`
- Add creatures → `DATA.creatures`
- Add items/vehicles → `DATA.items`

Open design question we're deciding: how species and starting world relate (free pick vs. homeworld-locked vs. random).
