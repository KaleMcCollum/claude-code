# Edge of the Outer Stars

A completely text-based galaxy RPG that runs in a **single HTML file** — perfect for playing on a phone with no app store or install.

## How to play on your phone
1. Get `galaxy-game/index.html` onto your phone (AirDrop, email it to yourself, a cloud drive, or host it).
2. Open it in your browser (Safari/Chrome).
3. Tap the share icon → **Add to Home Screen** for an app-like icon.
4. Progress **autosaves to the browser** after every action.
5. Use the **Save** tab to **export a backup `.json` file** you can store anywhere or import on another device.

## Design pillars
- **You name, the galaxy rolls.** You choose names (character, species, world, ship, beast…). The game decides *everything else* — stats, power, rarity, life and death — by weighted randomness. **No re-rolls.**
- **Rarity drives power.** Every generated thing rolls a tier (Common → Primordial) with transparent odds ("a 1-in-10,000 origin"). Rarer = stronger, and may carry rarer powers (e.g. flight).
- **Universal metrics.** Shared units measure everything. First: the vehicle power triad — **Star / Flight / Ground Power**, all in *Stellar-Horsepower (SHp)*.

## What's in this build
- **Procedural character creation**: name yourself → game rolls your **species** (with rarity, archetype, stats, innate powers) → you name it → rolls your **birthworld** (rarity, biome, tech, wealth, population, danger) → you name it → rolls your **starter ship** (class + Star/Flight/Ground power) → you name it → begin. Species and world are rolled **independently** (a common people can land on a rare hi-tech world).
- **Rarity engine** (`RARITY`): 8 tiers, weights summing to 1,000,000 for clean odds.
- **Generators** (`Gen.species`, `Gen.world`, `Gen.vehicle`): rarity + archetype/biome tables.
- **Universal units** (`UNITS`): the vehicle power triad in SHp — the template for future metrics (gun power, etc.).
- **Play loop**: explore, turn-based combat, tame creatures into a menagerie, inventory/equipment, a market whose stock is gated by the world's tech & wealth, leveling, the Hangar showing ship power.
- **Save system**: browser autosave + `.json` export/import.

## Code map (top of the `<script>`)
- `UNITS` — universal measurements (the power triad)
- `RARITY` — weighted tier engine (roll / odds / power scaling)
- `ARCHETYPES`, `POWERS`, `BIOMES`, `POPULATIONS`, `VEHICLE_CLASSES` — generation tables
- `Gen` — procedural generators (return `name:null` for the player to christen)
- `DATA` — hand-authored creatures, items, skills (procedural versions are the next system)

## Next up
- Name-on-discovery for creatures, guns, and flora as you explore (same rarity engine).
- Procedurally generated creatures & weapons.
- Travel between multiple named worlds; a galaxy map.
