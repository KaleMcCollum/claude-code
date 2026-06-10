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

## Two layers of genetic luck (character creation)
Who you are is decided by **two independent rolls**, both shown to you with real odds, both anchored to human norms so the numbers mean something:

1. **Species rarity** — how unusual the *people* you're born to are. Rarer peoples have **smaller populations** (so being born one is itself rare, population-weighted) and **drift further from the human baseline** (giants, tiny folk, long-lived ones). Common ≈ human-ish billions; Primordial ≈ a few dozen in the whole galaxy.
2. **Your genome** — where *you* land within your own species' range, per trait, as a **percentile** ("88th percentile height — exceptional for its kind"). Sampled near the middle, so prodigies and runts are rare. **Fixed for life.**

Every species shows rich, fixed genetics: **adult height** (with the species' own min–max range + your value + percentile + human anchor), **adult mass**, **age of maturity**, **natural lifespan**, six **attributes** (Strength/Agility/Endurance/Intellect/Attunement/Presence, each rolled *independently* — strong-but-slow is possible), three **biology** traits (**Metabolism, Perception, Fertility**), an inborn **Temperament** (Stoic, Aggressive, Cunning, Volatile…), a derived **Build**, and innate **powers**. Genetics are fixed; your *trained combat stats* are seeded from them and grow with levels.

### These genetics actually drive the game
- **Size** (height + mass) → maximum HP, heavier melee blows, slightly worse dodge.
- **Perception** → who gets the drop in an encounter (surprise vs. ambush), crit chance, and how much you find while exploring.
- **Metabolism** → energy/healing recovery and how much you get from medpacks/rations.
- **Temperament** → small combat/social modifiers (damage, crit, accuracy, tame/flee odds, XP).
- **Lifespan + an age/time clock** → every action spends days; you start at maturity and age as you play. Past ~85% of your lifespan you enter **twilight** (fading vitality); past your lifespan the *game* decides when your story ends, with an **epilogue** of the life you lived. A long-lived species = a long campaign. (The **Stalwart** temperament resists frailty.)

Galaxy constants (tunable, in `GALAXY`): ~**10,000** distinct sapient peoples, ~**1 trillion** total thinking beings.

## What's in this build
- **Procedural character creation**: name yourself → game rolls your **species** (two-layer rarity + full genetic readout) → you name it → rolls your **birthworld** (rarity, biome, tech, wealth, population, danger) → you name it → rolls your **starter ship** (class + Star/Flight/Ground power) → you name it → begin. Species and world are rolled **independently** (a common people can land on a rare hi-tech world).
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

## The galaxy & interstellar travel
The save is a whole **galaxy** of star systems laid out on a flat 2D plane (light-years).
- **Only systems have coordinates** — planets don't. Travel *within* a system is free; you fly to any world from the Shipyard.
- Crossing *between* systems needs an **interstellar hyperdrive**. Reach scales with the ship's **Star Power** (~1 ly per 120 SHp), so a base Star Clipper jumps ~8 ly, a Frigate ~11 ly, a Capital Ship ~27 ly — and rarer hulls reach farther.
- The **Star Map** (in any Shipyard) plots every system as a digestible text grid and lists them nearest-first with their distance and whether your current ship can make the jump.
- The Codex's **Planets & systems** tab shows the system you're in, its charted worlds (tap any to study it), and every system you've charted with its distance from you.

## Next up
- Name-on-discovery for creatures, guns, and flora as you explore (same rarity engine).
- Procedurally generated creatures & weapons.
- Ship-to-ship and fleet combat (gunners, mercenaries, carrier bays).
