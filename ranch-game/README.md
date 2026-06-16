# 🐄 Ranch Tycoon

A week-by-week cattle ranching life sim (BitLife-style) that runs in your browser.
**No install, no build step** — just open the file.

## How to play
Open `ranch-game/index.html` in any web browser (double-click it, or drag it into a browser tab).

1. **Pick your land** on the US map. Texas, Montana, and Colorado are playable now (3–4 real
   starter locations each). Where you ranch sets your weather, land cost, stocking rate, winter
   length, and which markets you can reach.
2. **Choose your operation** — Cow-Calf or Finisher.
3. **Live the year, one week at a time.** Each week gives you a scenario and decisions. Feed and
   living costs come out automatically; cattle gain weight; markets move. Make money, reinvest,
   grow. Run out of cash and you get one bailout loan — after that, it's bankruptcy and restart.

## The two operations
- **Cow-Calf** — You keep a permanent breeding herd (cows + a bull). Cows *calve* each spring; you
  raise the calves on grass, *wean* them around 560 lb, and sell them in the fall as **feeder
  calves**. Grass-based, lower feed bills, slow and steady. The foundation of the beef industry.
- **Finisher (Feedlot)** — You **buy feeder cattle** (~750 lb), feed a grain ration to put on weight
  fast, and sell **fed cattle** to packers around 1,340 lb. Fast cycles, big feed bills, higher
  risk/reward, swings with corn and beef prices.

## Cattle industry terms (the game teaches these too)
- **cwt** = hundredweight = 100 lb. Cattle sell by weight: *price/head = (weight ÷ 100) × $/cwt.*
  A 560 lb calf at $280/cwt = $1,568.
- **Carrying capacity** = land ÷ acres-per-cow. Overstock → you buy feed or lose cattle.
- **Premium vs commodity market** — Black Angus / Certified Angus Beef sells to restaurants for more
  per pound; Holstein and big uniform lots sell cheap and high-volume to box stores.
- **Common ways to go broke** — drought, overstocking, selling into a price crash, ignoring sick
  cattle (BRD), and feeding "open" (non-pregnant) cows all winter for nothing.

## Realism notes (current price assumptions)
Prices are quoted per cwt and drift weekly. Baselines reflect the recent high-cattle-price era:
feeder calves ~$280/cwt, fed cattle ~$192/cwt live, cull cows ~$116/cwt, bred cows ~$2,300/head,
hay ~$160/ton. All tunable in the `CONFIG` object at the top of the `<script>` in `index.html`.

## You play from the map
Once your ranch is set up, the **home screen is your land** — an illustrated terrain map with
grassland, patchwork fields, forests, a meandering river, a lake/pond, and a road to a nearby town.
Property lines are organic (not square); each parcel is a **160-acre quarter-section**. You interact
with the world directly:
- **Click the 🏪 Stockyard & Store** in town (or the **🏪 Shop** button) to buy/sell cattle & hay,
  and to **buy adjoining land** from the Land Agent.
- **Click a parcel you own** to build on it or fence it: **Barn** (shelter), **House** (lets you hire
  more hands), **Stables** (horses), or **Fence** (cross-fencing → rotational grazing → more capacity).
- **Click your 🏠 house** to manage crew & equipment.
- **Top-right:** zoom ➕/➖, 🏪 Shop, and ☰ Menu (Herd, Crew, Log, Save, Help).
- The **weekly decision** appears as a card overlaid on the map; resolve it and advance the week.

## Saving
The game **auto-saves** to your browser every week and after major actions. Use **💾 Save** to save
manually, and **▶ Continue Saved Game** on the title screen to pick up where you left off. (Saves live
in your browser's localStorage, so they're tied to that browser/device.)

## This is a vertical slice
Working now: clickable geographic map of the contiguous US with real state outlines (TX/MT/CO
playable) and a 📍 pin at each ranch's real-world location, operation choice, starting
herd/horse/barn/house, the weekly loop with a full first-year arc (calving → breeding → drought →
weaning sale → preg-check/cull → winter blizzard), markets, buying/selling cattle, the interactive
land-building map, crew/equipment upgrades, save/load, and the broke→bailout→bankruptcy path.

Natural next steps: more states & breeds, multi-herd management, longer-term contracts (selling to a
specific buyer/restaurant chain), banking/loans for expansion, hay inventory you grow yourself, and
employee skills.

## Playing online (auto-updating link)
This repo is set up for **GitHub Pages**. Once enabled (Settings → Pages → Source: *Deploy from a
branch* → pick this branch, folder `/root`), the game lives at a stable URL that updates on every
push:

```
https://kalemccollum.github.io/claude-code/ranch-game/
```

(Requires the repository to be public, or GitHub Pro for private Pages.)
