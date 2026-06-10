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

## The galaxy, your birthplace & travel
The save is a whole **galaxy** on a flat 2D plane (light-years), with the **core at (0,0)**.
- **You're born somewhere in it.** At creation you roll galactic coordinates. The **core is dense and well-settled** (more systems, bigger systems, most worlds inhabited); the **rim is sparse and mostly empty**. A core birth is a lucky roll you keep for life.
- **Only systems have coordinates** — planets don't. Travel *within* a system is free.
- Crossing *between* systems needs an **interstellar hyperdrive**. Reach scales with **Star Power** (~1 ly per 120 SHp): a base Star Clipper jumps ~8 ly, a Frigate ~11 ly, a Capital Ship ~27 ly — rarer hulls reach farther.
- **Uninhabited worlds have no shipyard, trade, or settlement** — just the wilds.

## Fleets & moving ships
All ship movement lives in **Crew → Ships / Fleets** (not the Shipyard).
- A **fleet** is a named group of ships that travel together. **Create** one (you must be in the same system as the ships you add), **edit** it from anywhere (a ship you add must be in the fleet's system), and **disband** it only when you're with it.
- A fleet's **jump range is its weakest ship's**, and it can only jump between systems if **every** ship aboard is interstellar-class — one in-system-only ship grounds the whole fleet to its star.
- **You ride along only if your active ship is in the group.** Send a fleet you're not aboard and it (and its crew) relocate without you; you can only dispatch it to worlds you've already charted.
- To move a single ship, use the **Ships** tab — if it's in a fleet, that takes you to the fleet.
- The **Star Map** plots your local cluster as a text grid; the Codex's **Planets & systems** tab shows your system, its charted worlds, and known systems with distances.

## Deep space: hyperdrive drift & ship encounters
When no star is within a single jump, you can **hyperdrive in a straight line into open space** — covering one jump's distance toward a heading and **drifting between the stars**. From the void (the World tab becomes a Deep Space view) you can jump to any star now in range or keep hopping, chaining jumps to cross gaps no single ship could span. Each hop has a chance to **cross paths with other ships** — from a lone **cargo freighter** or **transport convoy** (common) to **pirates**, a **war fleet**, or — vanishingly rarely — a **grand armada**. For now you can hail, salvage derelicts, or evade them; ship-to-ship combat (and PvP) is the next system this sets up.

## The galaxy Map (bottom tab)
A dedicated **Map** tab shows the whole galaxy on its flat plane, with the **core marked at (0,0)** and your distance from it called out.
- **Zoom in/out**, pan with the arrows, snap to **Center on me**, or zoom all the way to **Whole galaxy** (see the rim and where you sit in it).
- **Fog of war:** you only see systems you've **charted**, plus **sensor contacts** within **50 ly** of your charted systems. Everything beyond your known frontier stays hidden until you explore toward it.

## People, careers & credits
Every NPC now has a **career** and a **credit balance** that fits it, and careers carry their own rarity — you mostly meet ordinary folk, and the powerful are rare:
- **Civilians (common):** laborers, farmers, factory workers, dockhands, miners, merchants, ranchers, couriers, pilots, mechanics, medics, hunters, scholars. Wealth ranges from a few hundred to (for a thriving merchant) tens of thousands — rolled skewed low, so most are poor and a few are well-off.
- **Fringe (uncommon):** mercenaries, gunners, smugglers.
- **Outlaws & rebels (rare, ~1 in 90):** Outlaws, Gang Enforcers, Pirates, Rebel Fighters — attackable for a bounty, some running an armed ship and a few hands.
- **Commanders (very rare, ~1 in 330):** Crime Lords and Rebel Commanders — a gunship or two and a crew of their own, worth hundreds of thousands.
- **Warlords (extremely rare, ~1 in 2000):** command a whole **fleet**, often **hold a world**, and are worth **millions** — with a bounty to match.

A **Shipwright's** worth scales with what their world can build: a speeder-only yard is worth tens of thousands; a capital-ship yard, millions. Defeating any hostile figure yields their bounty (scaled by threat); the toughest are guarded, so taking them on alone is desperate work — their ships and crews are the seed for the fleet-vs-fleet combat to come.

## Worlds, habitability & settlements
A world's **biome decides how likely it is to be inhabited.** Mild, temperate worlds (forests, grasslands, shallows) are readily settled; harsh ones (frozen tundra, glacial expanse, toxic wastes, airless rock, molten wastes) almost never are. This stacks with galactic position — a temperate world near the core is almost certainly inhabited, while a molten rock on the rim is empty wilderness.

Inhabited worlds grow into a **settlement type** that decides what services they offer:
- **Capital City** *(semi-rare — only on advanced, wealthy worlds, and not in every system)* — every service open, and the only shipyard that sells **corvettes, freighters, and capital ships**. A real prize to find.
- **Trade Hub** — full services; shipyard up to corvettes.
- **Industrial World** — depot, market, shipyard (up to frigates); builds more than it buys.
- **Agricultural World** — farmland: tavern, depot, market (the galaxy's pantry; future: buy farms).
- **Mining Colony** — depot + market, raw ore.
- **Scrap World** — salvage shipyard of bargain hulls (up to haulers) + depot.
- **Frontier Outpost** — a dock, a bar, not much else.

Only one Capital City can form per system, and a world's tech/wealth gate which settlements it can become — so a planetary system might hold a capital, a farmworld, and a mining colony, each worth visiting for different reasons. (Buying income-producing assets on these worlds — farms, factories — is the planned next step.)

## On foot: encounters, foes & gear
What you run into when you explore depends on **where you are**:
- **Cities** (capitals, trade hubs, urban worlds) → **bad people**: pickpockets, thieves, muggers, thugs, armed robbers, and — on dangerous worlds — gang enforcers and raiders. They loot credits and XP, never tame.
- **Wild worlds** → **beasts** suited to the biome.
- **Dead, near-lifeless worlds** (molten, airless, glacial) → often just empty silence.
The explore button reads the world: *Prowl the streets* in a city, *Explore the outskirts* on a frontier, *Wander the wilds* out in the open.

The **Outfitter (Market)** is now an equipment shop. Buy and equip across six slots — **weapon, head, chest, legs, feet, back** — from vibroknives to plasma edges, scrap helms to powered cuirasses, trek boots, jetpacks and grav-harnesses. Armor adds max HP and **flat damage reduction**; boots and jetpacks add **dodge** (and the jetpack helps you flee). Stock is gated by world tech, so the best gear lives on advanced worlds. You can also **sell your haul** here.

## Starting out: scavenge to survive
You begin with **nothing** — no gear, no supplies, no credits — and a child's fraction of your potential. The early game is **scavenging and staying alive**: exploring most often turns up **rusted parts, scrap, and the occasional circuit board**, which you sell at a market to afford your first knife, pistol, or vest. You're too weak to win many fights yet, so **running** from beasts and back-alley robbers is usually the smart play until you've armed up.

## Next up
- Name-on-discovery for creatures, guns, and flora as you explore (same rarity engine).
- Procedurally generated creatures & weapons.
- Ship-to-ship and fleet combat (gunners, mercenaries, carrier bays).
