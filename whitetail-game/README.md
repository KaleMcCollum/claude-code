# Whitetail Country

An 8-bit, mostly text-based whitetail hunting game set in North Dakota-style country. It runs in the browser with no install and no build step: open `index.html`.

## How to play

1. **The lodge** is home. It's a big view of your hunter, wearing exactly what you have equipped and holding your rifle.
2. **Shop** (the only place you buy anything) for tags, clothes, optics, calls, stands, trail cameras and consumables. The only way to earn money is to kill deer, so every hunt costs a little and gear takes saving up for.
3. **HUNT** opens the map. The simple view (default) uses four colors: green cover where deer bed, gold food where they feed, blue water, gray roads and farms. Your land has a blue outline, public land green, permission land gold; land you can't hunt is dimmed. The **?** button explains it all, and the **Best bets** list ranks your stands by what you've learned and today's wind. You can hunt:
   - stands on land you own (blue),
   - stands on a neighbor's land once you've paid for permission (gold),
   - spots you mark on public land (green; up to 3 per area and 10 total). Public land takes a mobile setup: a climber or hang-on in a tree, or a ground sit. Some public areas are bow-only and stay locked until bows arrive.
4. **Gear up**: pick morning, evening or all day and what to pack from what you own. Change clothes and equipment (and spend skill points) under **Gear**. The game tells you how cold it will feel and how long you can sit.
5. **On stand**, time moves in 10-minute steps (fast-forward through quiet stretches). Far deer are a few pixels. Tap one to get your read on it (a hit list deer you've seen clearly shows its name and the status you gave it, like Pass), and raise binoculars or the scope for a better one. The read depends on distance, light and how good your glass is: "has antlers, a medium rack" far off, "looks like an 8 to a 10 pointer" closer, and up close with good glass a call like "big 10" with a rough score and weight. The rangefinder is the only thing that gives you a yardage.
6. Tap a deer to pick it, then **Shoot**. Shooting an antlered deer on a doe tag (or the other way around) means the DNR takes the deer (no payout, no mount). There's no fine.
7. After a harvest, guess the score, then see the mount and the full Boone & Crockett score sheet. The real age, weight and score are revealed only here. To keep him, pay the taxidermist: a shoulder mount is $200, a European (skull) mount $50, a felt cap mount $20. The **Trophy Room** shows your mounts one at a time; use the arrows or swipe to pan through them.
8. **Hit list**: bucks you see clearly or catch on a trail camera are added automatically (+$25 for each new deer). Trail cam photos say when the deer is one from your hit list. You name them, set your own age guess (it goes up a year every season) and tag them Hit list / Pass / Cull / Doe / Watch. The game never tells you whether a deer is still alive.
9. **Land**: buy parcels when they come up for sale, put up stands, hang cameras, plant food plots and tree rows, dig water holes and set aside sanctuary. You don't know how good a spot is until you hunt it; stars fill in as you sit it.
10. **Wait** passes time. Rifle season runs Oct 1 to Dec 31. At the end of the season every deer on the map goes through winter, fawning, dispersal and antler growth.

Money comes from harvested deer, leveling up (a little more each level) and new hit list deer. There's no property tax. The game saves itself in your browser after every hunt and purchase.

## What's simulated

- **World**: a seeded, generated map (200 x 150 tiles, 1 tile = 0.25 acre) with rivers, creeks, sloughs, timber, shelterbelts, crops, CRP, gravel roads, farmsteads and a town. Parcels have irregular borders that follow roads, rivers and tree lines. Property stats (food, water, bedding, security) are calculated from the tiles; soil and regional genetics are hidden.
- **Deer**: every deer on every parcel is an individual record with age, genes, body and antlers. Each year they go through hunting season, neighbor harvest (NPC hunters shoot by their own rules), winter, disease, fawning, dispersal to real neighboring parcels, and growth. A stabilizer keeps the whole-map population in range.
- **Antlers are measured, not rolled.** Each buck has a rack style that carries year to year. His rack is stored as Boone & Crockett components (beam, spread, every tine, mass, abnormal points) and the score is measured from them.
- **Every deer picture is drawn from those same components**, front-facing, in the pixel-art style of `art/style-reference.png`: one hand-drawn face shared by all deer, three buck bodies by age (slim, medium, heavy) plus doe and fawn, and antlers drawn in 2D from the real measurements. If the score sheet says 9 points, the full-size picture shows 9. About 1 in 4 mature bucks carries a split tine for life (forked G2 or G3, split brow, or a forked beam tip), sometimes matching on both sides. Far deer and weak optics get smaller, coarser versions of the same picture.
- **Weather**: the first week of October is mild and calm, so starter clothes are enough for long sits. The first cold front arrives around Oct 8 and it slides toward winter from there; hunting later in the year takes real clothing.
- **What you see**: does and fawns move in daylight at any age and often travel together. The "old deer are hard to see" rule applies to bucks: most bucks you see are 1.5 and 2.5 years old.
- **Hunts**: sighting odds per deer by age, wariness, pressure, rut phase, weather, stand placement and time of day; wind and scent, concealment and noise; comfort from clothing, wind chill, heaters and snacks; calls; shot placement from rifle, scope, skill, rest, range and light.
- **Progression**: levels 1 to 100 unlock rifles (from the free .223 Ruger American Ranch to a gold-plated 7mm at level 90 and a level-100 heirloom). Skill points go to Stealth, Marksmanship, Calling, Scent Discipline, Patience and Woodcraft.

## Files

| File | What it is |
|---|---|
| `config.js` | Every tunable number: deer biology, prices, rifles, stands, clothing, equipment, calendar |
| `sim.js` | Seeded RNG, world and parcel generation, deer herds and the yearly cycle (no DOM) |
| `antlers.js` | Rack genes, B&C components, antler geometry and scoring, body measurements |
| `deerart.js` | Deer art: the face, the bodies, the 2D antler generator, five sizes (outputs RGBA, works in Node too) |
| `game.js` | Game state, economy, land, gear math, the hunt engine, hit list, cameras, season rollover |
| `ui-*.js`, `index.html` | The screens: lodge, map, loadout, hunt view, shop, inventory, trophies, hit list |
| `calibrate.js` | Headless calibration: harvest score distributions per land tier, sightings by age, money, 50-year whole-map population test |
| `tests/antler-test.js` | 12,000-rack constraint and re-measure consistency test |
| `tests/points-test.js` | Draws thousands of racks and checks the picture shows exactly the points on the score sheet |
| `tests/gallery.js` | Writes the reference gallery PNGs to `tests/gallery/` |
| `tests/smoke.js` | Plays a season headless through the game API |
| `tools/build-artifact.js` | Inlines everything into one HTML file for sharing |

```
node calibrate.js 1000          # deer tables vs. the spec targets, plus the world test
node tests/antler-test.js       # antler limits + score consistency
node tests/points-test.js       # drawn points match the score sheet
node tests/gallery.js           # regenerate the art gallery
node tests/smoke.js             # headless season
node tools/build-artifact.js    # dist/whitetail-country.html
```

## Not in yet

- Bows, crossbows and muzzleloaders (bow-only public land and the saddle are locked until then). Rifle season is stretched over Oct to Dec as a stand-in.
- Shed hunting, renaming bucks from inside the hunt.
- Only the front-facing view of deer is drawn for now (no side or quartering views).
