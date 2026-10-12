# Whitetail Country

An 8-bit, mostly text-based whitetail hunting game set in North Dakota-style country. It runs in the browser with no install and no build step: open `index.html`.

## How to play

1. **The lodge** is home. The hunter in the middle wears exactly what you have equipped and holds your rifle. Your best mounts hang on the wall.
2. **Shop** for tags, clothes, optics, calls, stands, trail cameras and consumables. The only way to earn money is to kill deer, so every hunt costs a little and gear takes saving up for.
3. **HUNT** opens the map. You can hunt:
   - stands on land you own (blue),
   - stands on a neighbor's land once you've paid for permission (gold),
   - spots you mark on public land (green; up to 3 per area and 10 total). Public land takes a mobile setup: a climber or hang-on in a tree, or a ground sit. Some public areas are bow-only and stay locked until bows arrive.
4. **Gear up**: pick morning, evening or all day, your clothes, belt and pack. The game tells you how cold it will feel and how long you can sit.
5. **On stand**, time moves in 10-minute steps (fast-forward through quiet stretches). The game never tells you what a deer is. You judge it by eye: far deer are a few pixels, and binoculars or the scope show more detail depending on the tier, the light and the distance. The rangefinder is the only thing that gives you a yardage.
6. Tap a deer to pick it, then **Shoot**. Shooting an antlered deer on a doe tag (or the other way around) costs you a $500 ticket and the deer.
7. After a harvest, guess the score, then see the full Boone & Crockett score sheet and four trophy views. The real age, weight and score are revealed only here.
8. **Hit list**: bucks you see clearly or catch on a trail camera are added automatically. You name them, set your own age guess (it goes up a year every season) and tag them Hit list / Pass / Cull / Doe / Watch. The game never tells you whether a deer is still alive.
9. **Land**: buy parcels when they come up for sale, put up stands, hang cameras, plant food plots and tree rows, dig water holes and set aside sanctuary. You don't know how good a spot is until you hunt it; stars fill in as you sit it.
10. **Wait** passes time. Rifle season runs Oct 1 to Dec 31. At the end of the season every deer on the map goes through winter, fawning, dispersal and antler growth.

The game saves itself in your browser after every hunt and purchase.

## What's simulated

- **World**: a seeded, generated map (200 x 150 tiles, 1 tile = 0.25 acre) with rivers, creeks, sloughs, timber, shelterbelts, crops, CRP, gravel roads, farmsteads and a town. Parcels have irregular borders that follow roads, rivers and tree lines. Property stats (food, water, bedding, security) are calculated from the tiles; soil and regional genetics are hidden.
- **Deer**: every deer on every parcel is an individual record with age, genes, body and antlers. Each year they go through hunting season, neighbor harvest (NPC hunters shoot by their own rules), winter, disease, fawning, dispersal to real neighboring parcels, and growth. A stabilizer keeps the whole-map population in range.
- **Antlers are measured, not rolled.** Each buck has a rack style that carries year to year. His rack is built from Boone & Crockett components into 3D tubes, and the score is measured from that geometry. The same model draws every image of him (hunt view, binoculars, trail cam, mount, trophy views), so what you see matches the score.
- **Hunts**: sighting odds per deer by age, wariness, pressure, rut phase, weather, stand placement and time of day; wind and scent, concealment and noise; comfort from clothing, wind chill, heaters and snacks; calls; shot placement from rifle, scope, skill, rest, range and light.
- **Progression**: levels 1 to 100 unlock rifles (from the free .223 Ruger American Ranch to a gold-plated 7mm at level 90 and a level-100 heirloom). Skill points go to Stealth, Marksmanship, Calling, Scent Discipline, Patience and Woodcraft.

## Files

| File | What it is |
|---|---|
| `config.js` | Every tunable number: deer biology, prices, rifles, stands, clothing, equipment, calendar |
| `sim.js` | Seeded RNG, world and parcel generation, deer herds and the yearly cycle (no DOM) |
| `antlers.js` | Rack genes, B&C components, 3D antler geometry, scoring from geometry, body measurements |
| `render.js` | The 3D deer model and the pixel-art ray-caster (outputs RGBA, works in Node too) |
| `game.js` | Game state, economy, land, gear math, the hunt engine, hit list, cameras, season rollover |
| `ui-*.js`, `index.html` | The screens: lodge, map, loadout, hunt view, shop, inventory, trophies, hit list |
| `calibrate.js` | Headless calibration: harvest score distributions per land tier, sightings by age, money, 50-year whole-map population test |
| `tests/antler-test.js` | 12,000-rack constraint and re-measure consistency test |
| `tests/gallery.js` | Writes the reference gallery PNGs to `tests/gallery/` |
| `tests/smoke.js` | Plays a season headless through the game API |
| `tools/build-artifact.js` | Inlines everything into one HTML file for sharing |

```
node calibrate.js 1000          # deer tables vs. the spec targets, plus the world test
node tests/antler-test.js       # antler limits + score consistency
node tests/gallery.js           # regenerate the art gallery
node tests/smoke.js             # headless season
node tools/build-artifact.js    # dist/whitetail-country.html
```

## Not in yet

- Bows, crossbows and muzzleloaders (bow-only public land and the saddle are locked until then). Rifle season is stretched over Oct to Dec as a stand-in.
- Lodge upgrades for more wall space, shed hunting, renaming bucks from inside the hunt.
- The owner's art reference image needs to be dropped into `art/style-reference.png` (see `art/README.md`).
