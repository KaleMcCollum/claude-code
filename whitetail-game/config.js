/* Whitetail Country: every tunable number lives here.
   Loaded by index.html (browser) and calibrate.js (Node). Attaches to globalThis.WT.CONFIG. */
(function (root) {
  const WT = (root.WT = root.WT || {});

  WT.CONFIG = {
    version: 1,

    /* ------------------------------------------------------------ economy */
    economy: {
      startingCash: 450,
      propertyTaxRate: 0.015,          // of land value per year
      landSellFee: 0.08,               // fee when selling land back
      tags: { buck: 30, doe: 20, maxDoeTags: 3 },
      payouts: [                        // money only comes from deer
        { min: 0,   max: 120, label: 'young buck', young: [200, 300] },
        { min: 120, max: 130, pay: 450 },
        { min: 130, max: 140, pay: 700 },
        { min: 140, max: 150, pay: 1100 },
        { min: 150, max: 160, pay: 1800 },
        { min: 160, max: 170, pay: 3000 },
        { min: 170, max: 180, pay: 5000 },
        { min: 180, max: 200, pay: 8000 },
        { min: 200, max: 999, pay: 20000 },
      ],
      doePayout: 150,
      oldBuckUnder120: 260,             // mature buck that just never grew
      woundedLossPressure: 0.08,
    },

    /* ------------------------------------------------------------ progression */
    progression: {
      maxLevel: 100,
      xpForLevel: (lvl) => Math.round(150 + 40 * Math.pow(lvl, 0.75)),  // xp to go lvl -> lvl+1 (L10 ~2 seasons, L30 ~9, L100 is a lifetime)
      xpPerHourSat: 6,
      xpPerSighting: 3,
      xpDoe: 40,
      xpBuckBase: 70,
      xpPerInch: 1.2,                   // bonus per inch over 100"
      skillPointsPerLevel: 2,
      skillMax: 40,
    },

    skills: {
      stealth:  { name: 'Stealth',        desc: 'Quieter walk-ins and less noise when shifting.' },
      shooting: { name: 'Marksmanship',   desc: 'Steadier aim, handles recoil, fewer misses and wounds.' },
      calling:  { name: 'Calling',        desc: 'Grunts, rattling and snort-wheezes sound real.' },
      scent:    { name: 'Scent Discipline', desc: 'Less human odor, fewer deer winding you.' },
      patience: { name: 'Patience',       desc: 'Sit longer. 4 pts = +1 hr. All-day sits need ~10 hrs.' },
      woodcraft:{ name: 'Woodcraft',      desc: 'Spot deer sooner, judge age and score better, track wounded deer.' },
    },

    /* ------------------------------------------------------------ calendar */
    calendar: {
      // Day 0 = Oct 1. Rifle legal Oct 1 - Dec 31 (game rule until bows/muzzleloaders land).
      seasonDays: 92,
      monthStarts: [{ name: 'Oct', start: 0 }, { name: 'Nov', start: 31 }, { name: 'Dec', start: 61 }],
      rutPhases: [
        { name: 'Early season', from: 0,  to: 18, buck: 0.85, mature: 0.75, doe: 1.0 },
        { name: 'Pre-rut',      from: 19, to: 30, buck: 1.1,  mature: 1.05, doe: 1.0 },
        { name: 'Seeking & chasing', from: 31, to: 42, buck: 1.45, mature: 1.9, doe: 1.05 },
        { name: 'Peak breeding', from: 43, to: 52, buck: 1.2, mature: 1.25, doe: 0.9 },
        { name: 'Post-rut',     from: 53, to: 91, buck: 0.9,  mature: 0.8, doe: 1.0 },
      ],
      // Average temps (°F) by day index, linearly interpolated: [day, low, high]
      temps: [[0, 36, 60], [31, 25, 44], [61, 12, 28], [91, 2, 19]],
      sunrise: [[0, 7.45], [31, 7.95], [36, 7.05], [61, 7.85], [91, 8.3]],   // hour-of-day (DST ends ~Nov 5)
      sunset:  [[0, 19.2], [31, 18.15], [36, 17.1], [61, 16.8], [91, 16.95]],
      legalLightMin: 30,
    },

    sessions: {
      morning: { name: 'Morning', note: 'Dark to 11:00. Catch deer heading back to bed.' },
      evening: { name: 'Evening', note: '13:30 to dark. Deer head out to feed.' },
      allday:  { name: 'All day', note: 'Dark to dark. Needs ~10 hr of patience or a comfy stand.' },
    },

    /* ------------------------------------------------------------ world */
    world: {
      width: 200, height: 150,          // tiles; 1 tile = 0.25 acre
      acresPerTile: 0.25,
      roadSpacing: 44,
      parcelTargetAcres: 130,
      minParcelAcres: 40,
      publicShare: 0.16,
      bowOnlyShare: 0.35,               // of public areas
      permissionShare: 0.35,            // of NPC parcels willing to sell permission
      forSaleCount: 6,
      starterAcres: 100,
      pricePerAcre: { base: 62, cover: 0.55, water: 0.35, access: 0.08, noise: 0.15, bigDiscount: 0.07 },
      permissionFeePerAcre: [2.2, 4.5],
    },

    /* ------------------------------------------------------------ deer */
    deer: {
      genetics: { mean: 140, sd: 15, regionalShift: 9, giantChance: 1 / 400, giantBonus: [20, 40], min: 90, max: 215, heredity: 4 },
      ageCurve: { 0.5: 0, 1.5: [0.30, 0.40], 2.5: [0.55, 0.65], 3.5: [0.75, 0.82], 4.5: [0.88, 0.94], 5.5: [0.97, 1.0], 6.5: [0.97, 1.0], 7.5: [0.96, 1.0], 8.5: [0.91, 0.95], 9.5: [0.83, 0.87], 10.5: [0.78, 0.84] },
      maxAge: 10.5,
      yearlyVariance: 0.065,
      nutrition: { min: 0.88, max: 1.06, overCapacityPenalty: 0.25 },
      density: { poor: 4, elite: 14 },  // deer per 100 acres
      weights: {
        buck: { 0.5: [60, 95], 1.5: [125, 165], 2.5: [155, 200], 3.5: [185, 230], 4.5: [205, 285] },
        doe:  { 0.5: [55, 85], 1.5: [105, 135], 2.5: [120, 150], 3.5: [125, 160], 4.5: [125, 165] },
        bigBuckChance: 0.04, dressed: 0.78,
      },
      mortality: {              // non-player annual, private land, average neighbor pressure
        buck: { 0.5: [0.15, 0.25], 1.5: 0.25, 2.5: 0.25, 3.5: 0.29, 4.5: 0.30, 5.5: 0.32, 6.5: 0.38, 7.5: 0.44, 8.5: 0.52, 9.5: 0.6, 10.5: 0.75 },
        doe:  { 0.5: [0.15, 0.25], 1.5: 0.12, 2.5: 0.12, 3.5: 0.12, 4.5: 0.12, 5.5: 0.12, 6.5: 0.18, 7.5: 0.18, 8.5: 0.27, 9.5: 0.35, 10.5: 0.5 },
        publicBuck: [0.55, 0.70],
        inSeasonShare: 0.45,          // share of neighbor/hunter mortality that happens during the season
        winterBase: 0.03, winterSevere: 0.10,
      },
      fawning: { yearling: [0.8, 1.2], adult: [1.6, 1.9], survival: [0.40, 0.70] },
      dispersal: { yearlingBuck: [0.5, 0.7] },
      events: { diseaseChance: 0.04, diseaseKill: [0.2, 0.45], predatorYear: 0.08 },
      sighting: {
        baseActivity: 0.28,           // per-deer daylight-in-view chance for a standard 4 hr sit
        viewAcres: 110, viewExp: 0.8, // one stand only watches part of a big property
        ageMult: { 0.5: 1.0, 1.5: 1.0, 2.5: 0.70, 3.5: 0.40, 4.5: 0.22, 5.5: 0.14, 6.5: 0.10 },
        warinessK: 0.5,
        pressureK: 1.4,               // mature bucks go nocturnal under pressure
        shotOpportunity: { young: 0.55, mature: 0.32 },
      },
      pressure: { perSit: 0.05, decay: 0.8, publicFloor: 0.45 },
    },

    landTiers: {
      Poor:      { food: 0.30, water: 0.30, bedding: 0.30, security: 0.35, soil: 0.25, genetics: 0.30, price: 0.7 },
      Average:   { food: 0.55, water: 0.50, bedding: 0.50, security: 0.48, soil: 0.50, genetics: 0.52, price: 1.0 },
      Good:      { food: 0.65, water: 0.60, bedding: 0.60, security: 0.58, soil: 0.60, genetics: 0.58, price: 1.3 },
      Excellent: { food: 0.78, water: 0.72, bedding: 0.75, security: 0.70, soil: 0.75, genetics: 0.70, price: 1.7 },
      Elite:     { food: 0.92, water: 0.85, bedding: 0.90, security: 0.85, soil: 0.90, genetics: 0.85, price: 2.4 },
    },

    /* ------------------------------------------------------------ weapons */
    // Bows are coming later. level = level needed to buy. award = only unlocked, not sold.
    rifles: [
      { id: 'ruger_ranch',  level: 1,   name: 'Ruger American Ranch',        cal: '.223 Rem',        acc: 60, range: 35, power: 30, recoil: 10, mag: 5, price: 0 },
      { id: 'mossberg_pat', level: 3,   name: 'Mossberg Patriot',            cal: '.243 Win',        acc: 63, range: 50, power: 45, recoil: 22, mag: 5, price: 380 },
      { id: 'savage_axis',  level: 5,   name: 'Savage Axis II',              cal: '.243 Win',        acc: 68, range: 55, power: 50, recoil: 25, mag: 4, price: 420 },
      { id: 'ruger_pred',   level: 7,   name: 'Ruger American Predator',     cal: '6.5 Creedmoor',   acc: 72, range: 64, power: 57, recoil: 26, mag: 4, price: 560 },
      { id: 'marlin_336',   level: 9,   name: 'Marlin 336 Classic',          cal: '.30-30 Win',      acc: 62, range: 40, power: 64, recoil: 40, mag: 6, price: 1050 },
      { id: 'win_70',       level: 10,  name: 'Winchester Model 70',         cal: '.270 Win',        acc: 78, range: 70, power: 68, recoil: 45, mag: 5, price: 980 },
      { id: 'tikka_t3x',    level: 13,  name: 'Tikka T3x Hunter',            cal: '.308 Win',        acc: 81, range: 68, power: 72, recoil: 50, mag: 3, price: 900 },
      { id: 'bergara_b14',  level: 16,  name: 'Bergara B-14 Hunter',         cal: '6.5 PRC',         acc: 82, range: 78, power: 72, recoil: 40, mag: 3, price: 1100 },
      { id: 'rem_700',      level: 20,  name: 'Remington 700 BDL',           cal: '.30-06 Springfield', acc: 82, range: 75, power: 82, recoil: 60, mag: 4, price: 1300 },
      { id: 'wby_vanguard', level: 24,  name: 'Weatherby Vanguard',          cal: '.257 Wby Mag',    acc: 84, range: 84, power: 76, recoil: 48, mag: 3, price: 1150 },
      { id: 'xbolt_7mm',    level: 30,  name: 'Browning X-Bolt',             cal: '7mm Rem Mag',     acc: 90, range: 92, power: 90, recoil: 70, mag: 3, price: 1700 },
      { id: 'kimber_280',   level: 34,  name: 'Kimber Hunter',               cal: '.280 Ackley Imp', acc: 87, range: 86, power: 84, recoil: 52, mag: 3, price: 1250 },
      { id: 'sako_85',      level: 38,  name: 'Sako 85 Finnlight',           cal: '.300 WSM',        acc: 89, range: 89, power: 92, recoil: 72, mag: 3, price: 2450 },
      { id: 'christensen',  level: 44,  name: 'Christensen Ridgeline',       cal: '6.5 PRC',         acc: 92, range: 90, power: 80, recoil: 36, mag: 4, price: 2300 },
      { id: 'wby_mk5',      level: 50,  name: 'Weatherby Mark V',            cal: '.300 Wby Mag',    acc: 91, range: 95, power: 95, recoil: 82, mag: 3, price: 2750 },
      { id: 'pre64_win',    level: 55,  name: "Pre-'64 Winchester Model 70", cal: '.30-06 Springfield', acc: 86, range: 76, power: 84, recoil: 58, mag: 5, price: 3400, collect: true },
      { id: 'nosler_m21',   level: 60,  name: 'Nosler Model 21',             cal: '.28 Nosler',      acc: 93, range: 96, power: 92, recoil: 70, mag: 3, price: 2900 },
      { id: 'seekins_ph2',  level: 68,  name: 'Seekins Havak PH2',           cal: '6.8 Western',     acc: 94, range: 96, power: 93, recoil: 58, mag: 3, price: 2650 },
      { id: 'cooper_52',    level: 75,  name: 'Cooper Model 52 Jackson',     cal: '.280 Ackley Imp', acc: 96, range: 93, power: 87, recoil: 50, mag: 3, price: 3300 },
      { id: 'engraved_700', level: 82,  name: 'Engraved Remington 700 CDL',  cal: '.270 Win',        acc: 92, range: 82, power: 80, recoil: 44, mag: 4, price: 4800, collect: true },
      { id: 'gold_xbolt',   level: 90,  name: 'Gold-Plated X-Bolt',          cal: '7mm Rem Mag',     acc: 97, range: 96, power: 94, recoil: 66, mag: 3, price: 9500, collect: true },
      { id: 'grandpa_94',   level: 100, name: "Grandpa's Winchester 94",     cal: '.30-30 Win',      acc: 99, range: 60, power: 80, recoil: 30, mag: 7, price: 0, award: true, collect: true },
    ],

    scopes: [
      { id: 'none',    name: 'Iron sights',                 price: 0,    acc: -10, low: 0 },
      { id: 'simmons', name: 'Simmons 8-Point 3-9x40',      price: 0,    acc: 0,   low: 10, starter: true },
      { id: 'bushnell',name: 'Bushnell Banner 2 3-9x40',    price: 150,  acc: 4,   low: 30 },
      { id: 'vortex',  name: 'Vortex Diamondback 4-12x40',  price: 330,  acc: 7,   low: 50 },
      { id: 'leupold', name: 'Leupold VX-3HD 3.5-10x40',    price: 650,  acc: 10,  low: 72 },
      { id: 'zeiss',   name: 'Zeiss Conquest V4 3-12x56',   price: 1150, acc: 12,  low: 92 },
    ],

    /* ------------------------------------------------------------ stands */
    // place: portable (public OK), mobile (public OK), permanent (owned land only)
    // cover/noise/scent/accuracy/comfort/visibility are 0-100 bonuses; patienceHrs adds sit time.
    stands: [
      { id: 'ground',  name: 'Ground sit (no stand)', kind: 'mobile',    price: 0,    cover: 10, noise: 20, scent: 0,  accuracy: 0,  comfort: 0,  visibility: 30, patienceHrs: -0.5, starter: true, note: 'Sit against a tree. Free and miserable.' },
      { id: 'saddle',  name: 'Tethrd Phantom saddle',  kind: 'mobile',    price: 380,  cover: 55, noise: 60, scent: 60, accuracy: 10, comfort: 15, visibility: 60, patienceHrs: -0.5, bowOnly: true, note: 'Bow hunting rig. Usable once bows arrive.' },
      { id: 'hangon',  name: 'Hawk Helium hang-on',    kind: 'portable',  price: 160,  cover: 60, noise: 55, scent: 65, accuracy: 15, comfort: 20, visibility: 55, patienceHrs: 0 },
      { id: 'climber', name: 'Summit Viper climber',   kind: 'portable',  price: 330,  cover: 55, noise: 45, scent: 65, accuracy: 25, comfort: 40, visibility: 60, patienceHrs: 0.75 },
      { id: 'popup',   name: 'Primos pop-up blind',    kind: 'portable',  price: 190,  cover: 55, noise: 70, scent: 15, accuracy: 30, comfort: 45, visibility: 35, patienceHrs: 0.75, blind: true },
      { id: 'tripod',  name: 'Big Game 12 ft tripod',  kind: 'permanent', price: 260,  cover: 25, noise: 40, scent: 50, accuracy: 35, comfort: 40, visibility: 80, patienceHrs: 0.5 },
      { id: 'ladder',  name: 'Muddy 16 ft ladder',     kind: 'permanent', price: 240,  cover: 45, noise: 50, scent: 55, accuracy: 30, comfort: 40, visibility: 65, patienceHrs: 0.5 },
      { id: 'box',     name: 'Redneck 6x6 box blind',  kind: 'permanent', price: 2600, cover: 80, noise: 80, scent: 45, accuracy: 55, comfort: 80, visibility: 85, patienceHrs: 3.5, blind: true, windCut: true },
      { id: 'house',   name: 'Elevated hunting house', kind: 'permanent', price: 5400, cover: 90, noise: 90, scent: 55, accuracy: 60, comfort: 95, visibility: 95, patienceHrs: 5, blind: true, windCut: true, note: 'Insulated, carpeted, a chair that swivels. All-day sits.' },
    ],

    /* ------------------------------------------------------------ land improvements */
    improvements: {
      foodplot: {
        name: 'Food plot', perAcre: true,
        types: [
          { id: 'rye',     name: 'Winter rye / oats',  cost: 90,  food: 0.7, late: 0.8 },
          { id: 'clover',  name: 'Clover',              cost: 160, food: 0.8, late: 0.5, perennial: 4 },
          { id: 'brassica',name: 'Brassicas / turnips', cost: 140, food: 0.75, late: 1.2 },
          { id: 'soy',     name: 'Soybeans',            cost: 170, food: 0.8, late: 0.9 },
          { id: 'corn',    name: 'Standing corn',       cost: 220, food: 0.9, late: 1.3 },
        ],
        maxShare: 0.08,
      },
      waterhole: { name: 'Water hole', cost: 900, per100: 2 },
      trees: { name: 'Shelterbelt planting (row of 6)', cost: 240, matureYears: 3 },
      sanctuary: { name: 'Sanctuary tile', cost: 0 },
      camera: { per100: 5 },
    },
    standLimitPer100: 4,

    /* ------------------------------------------------------------ trail cameras */
    cameras: [
      { id: 'tasco',      name: 'Tasco 12MP',               price: 80,  detect: 0.35, night: 0.25, cell: false },
      { id: 'browning',   name: 'Browning Strike Force',    price: 140, detect: 0.5,  night: 0.5,  cell: false },
      { id: 'reveal',     name: 'Tactacam Reveal X (cell)', price: 150, detect: 0.5,  night: 0.5,  cell: true, plan: 60 },
      { id: 'spypoint',   name: 'Spypoint Flex G-36 (cell)',price: 280, detect: 0.65, night: 0.75, cell: true, plan: 100 },
    ],

    /* ------------------------------------------------------------ clothing */
    // Stats: w warmth, wd wind, wa water, c cooling, q quiet, s scent, cn concealment
    clothingSlots: ['head', 'hands', 'feet', 'base', 'mid', 'jacket', 'pants', 'bibs', 'muff', 'vest'],
    clothing: [
      { id: 'cap_mesh', slot: 'head', tier: 'Light', name: 'Mesh-back camo ball cap', price: 15, w: 1, wd: 0, wa: 5, c: 80, q: 90, s: 0, cn: 40 },
      { id: 'beanie_wal', slot: 'head', tier: 'Cheap', name: 'Walmart Realtree knit beanie', price: 8, w: 3, wd: 5, wa: 5, c: 40, q: 85, s: 0, cn: 30 },
      { id: 'beanie_carh', slot: 'head', tier: 'Medium', name: 'Carhartt watch cap (blaze)', price: 20, w: 5, wd: 15, wa: 15, c: 40, q: 85, s: 0, cn: 10, blaze: true },
      { id: 'beanie_fl', slot: 'head', tier: 'High', name: 'First Lite merino beanie', price: 45, w: 6, wd: 20, wa: 20, c: 60, q: 90, s: 20, cn: 50 },
      { id: 'beanie_sitka', slot: 'head', tier: 'Premier', name: 'Sitka Fanatic beanie', price: 55, w: 8, wd: 60, wa: 40, c: 55, q: 95, s: 25, cn: 70 },

      { id: 'gl_jersey', slot: 'hands', tier: 'Cheap', name: 'Brown jersey work gloves', price: 5, w: 2, wd: 5, wa: 0, c: 50, q: 80, s: 0, cn: 20 },
      { id: 'gl_carh', slot: 'hands', tier: 'Medium', name: 'Carhartt insulated gloves', price: 30, w: 5, wd: 30, wa: 40, c: 30, q: 60, s: 0, cn: 20 },
      { id: 'gl_scentlok', slot: 'hands', tier: 'High', name: 'ScentLok insulated gloves', price: 55, w: 6, wd: 50, wa: 50, c: 40, q: 80, s: 40, cn: 60 },
      { id: 'gl_sitka', slot: 'hands', tier: 'Premier', name: 'Sitka Fanatic gloves', price: 80, w: 8, wd: 70, wa: 60, c: 45, q: 95, s: 30, cn: 75 },

      { id: 'sneakers', slot: 'feet', tier: 'Starter', name: 'Old sneakers', price: 0, w: 1, wd: 5, wa: 0, c: 60, q: 70, s: 0, cn: 0, starter: true },
      { id: 'bt_ua', slot: 'feet', tier: 'Light', name: 'Under Armour hiking boots', price: 130, w: 3, wd: 20, wa: 50, c: 70, q: 75, s: 20, cn: 0 },
      { id: 'bt_rubber', slot: 'feet', tier: 'Cheap', name: 'Walmart rubber boots', price: 35, w: 4, wd: 30, wa: 90, c: 10, q: 60, s: 30, cn: 0 },
      { id: 'bt_lacrosse', slot: 'feet', tier: 'Medium', name: 'LaCrosse AlphaBurly Pro 800g', price: 180, w: 10, wd: 50, wa: 100, c: 20, q: 80, s: 70, cn: 0 },
      { id: 'bt_muck', slot: 'feet', tier: 'High', name: 'Muck Arctic Pro', price: 210, w: 13, wd: 60, wa: 100, c: 20, q: 75, s: 70, cn: 0 },
      { id: 'bt_baffin', slot: 'feet', tier: 'Premier', name: 'Baffin Impact', price: 260, w: 15, wd: 70, wa: 100, c: 15, q: 70, s: 60, cn: 0 },

      { id: 'tee', slot: 'base', tier: 'Starter', name: 'White cotton tee', price: 0, w: 2, wd: 0, wa: 0, c: 50, q: 90, s: 0, cn: 0, starter: true, cotton: true },
      { id: 'base_wal', slot: 'base', tier: 'Cheap', name: 'Walmart camo long sleeve', price: 12, w: 3, wd: 0, wa: 0, c: 55, q: 90, s: 0, cn: 40 },
      { id: 'base_ua', slot: 'base', tier: 'Medium', name: 'Under Armour ColdGear base', price: 45, w: 5, wd: 10, wa: 10, c: 70, q: 95, s: 10, cn: 30 },
      { id: 'base_fl', slot: 'base', tier: 'High', name: 'First Lite merino crew', price: 85, w: 7, wd: 10, wa: 10, c: 85, q: 95, s: 40, cn: 60 },
      { id: 'base_sitka', slot: 'base', tier: 'Premier', name: 'Sitka Core merino crew', price: 110, w: 8, wd: 15, wa: 15, c: 90, q: 95, s: 45, cn: 70 },

      { id: 'sweat_blaze', slot: 'mid', tier: 'Starter', name: 'Blaze orange sweatshirt', price: 0, w: 6, wd: 5, wa: 0, c: 40, q: 85, s: 0, cn: 0, blaze: true, starter: true },
      { id: 'mid_wal', slot: 'mid', tier: 'Cheap', name: 'Walmart camo hoodie', price: 25, w: 6, wd: 5, wa: 0, c: 40, q: 85, s: 0, cn: 40 },
      { id: 'mid_carh', slot: 'mid', tier: 'Medium', name: 'Carhartt midweight hoodie', price: 55, w: 7, wd: 15, wa: 10, c: 40, q: 85, s: 0, cn: 10 },
      { id: 'mid_fl', slot: 'mid', tier: 'High', name: 'First Lite fleece hoodie', price: 150, w: 9, wd: 20, wa: 10, c: 60, q: 95, s: 30, cn: 60 },
      { id: 'mid_sitka', slot: 'mid', tier: 'Premier', name: 'Sitka Fanatic hoodie', price: 230, w: 10, wd: 40, wa: 20, c: 60, q: 95, s: 35, cn: 75 },

      { id: 'jk_light', slot: 'jacket', tier: 'Light', name: 'Huntworth lightweight jacket', price: 40, w: 4, wd: 30, wa: 30, c: 75, q: 85, s: 10, cn: 60 },
      { id: 'jk_hw', slot: 'jacket', tier: 'Cheap', name: 'Huntworth insulated jacket', price: 70, w: 9, wd: 40, wa: 40, c: 30, q: 60, s: 5, cn: 50 },
      { id: 'jk_cabelas', slot: 'jacket', tier: 'Medium', name: "Cabela's insulated parka (blaze)", price: 140, w: 13, wd: 55, wa: 55, c: 30, q: 70, s: 15, cn: 60, blaze: true },
      { id: 'jk_scentlok', slot: 'jacket', tier: 'High', name: 'ScentLok BE:1 Fortress', price: 300, w: 17, wd: 70, wa: 70, c: 40, q: 85, s: 60, cn: 70 },
      { id: 'jk_sitka', slot: 'jacket', tier: 'Premier', name: 'Sitka Fanatic jacket', price: 480, w: 20, wd: 85, wa: 80, c: 50, q: 100, s: 50, cn: 85 },

      { id: 'jeans', slot: 'pants', tier: 'Starter', name: 'Blue jeans', price: 0, w: 3, wd: 20, wa: 0, c: 40, q: 70, s: 0, cn: 0, starter: true },
      { id: 'pt_hw', slot: 'pants', tier: 'Cheap', name: 'Huntworth camo pants', price: 40, w: 3, wd: 20, wa: 20, c: 55, q: 80, s: 5, cn: 50 },
      { id: 'pt_carh', slot: 'pants', tier: 'Medium', name: 'Carhartt double-front pants', price: 65, w: 4, wd: 35, wa: 20, c: 45, q: 60, s: 0, cn: 10 },
      { id: 'pt_fl', slot: 'pants', tier: 'High', name: 'First Lite Corrugate pants', price: 200, w: 5, wd: 50, wa: 40, c: 70, q: 90, s: 30, cn: 65 },
      { id: 'pt_sitka', slot: 'pants', tier: 'Premier', name: 'Sitka Fanatic pants', price: 380, w: 6, wd: 70, wa: 60, c: 65, q: 100, s: 35, cn: 80 },

      { id: 'bib_wal', slot: 'bibs', tier: 'Cheap', name: 'Walmart insulated camo bibs', price: 60, w: 9, wd: 40, wa: 40, c: 15, q: 55, s: 0, cn: 45 },
      { id: 'bib_carh', slot: 'bibs', tier: 'Medium', name: 'Carhartt duck bib overalls', price: 140, w: 13, wd: 70, wa: 50, c: 15, q: 40, s: 0, cn: 0 },
      { id: 'bib_arctic', slot: 'bibs', tier: 'High', name: 'ArcticShield Heat Echo bibs', price: 260, w: 16, wd: 75, wa: 70, c: 20, q: 85, s: 40, cn: 70 },
      { id: 'bib_sitka', slot: 'bibs', tier: 'Premier', name: 'Sitka Fanatic bibs', price: 500, w: 18, wd: 85, wa: 80, c: 30, q: 100, s: 50, cn: 85 },

      { id: 'muff_wal', slot: 'muff', tier: 'Cheap', name: 'Walmart camo hand muff', price: 15, w: 4, wd: 30, wa: 20, c: 0, q: 80, s: 0, cn: 40 },
      { id: 'muff_cab', slot: 'muff', tier: 'Medium', name: "Cabela's insulated muff", price: 35, w: 5, wd: 50, wa: 40, c: 0, q: 85, s: 0, cn: 55 },
      { id: 'muff_arctic', slot: 'muff', tier: 'High', name: 'ArcticShield hand muff', price: 60, w: 7, wd: 70, wa: 60, c: 0, q: 90, s: 30, cn: 65 },
      { id: 'muff_sitka', slot: 'muff', tier: 'Premier', name: 'Sitka Fanatic hand muff', price: 100, w: 8, wd: 85, wa: 70, c: 0, q: 95, s: 30, cn: 80 },

      { id: 'vest_blaze', slot: 'vest', tier: 'Cheap', name: 'Blaze orange vest', price: 12, w: 0, wd: 0, wa: 0, c: 90, q: 85, s: 0, cn: 0, blaze: true, overlay: true },
    ],
    warmthCaps: { head: 8, hands: 8, feet: 15, base: 8, mid: 10, jacket: 20, pants: 6, bibs: 18, muff: 8, vest: 0 },
    comfort: { neutralTemp: 70, minPerDegree: 10, minSitMin: 20, overheatMargin: 25, basePatienceHrs: 3.5, hrsPerPatiencePt: 0.25 },

    /* ------------------------------------------------------------ equipment */
    equipment: [
      { id: 'bino_bush', cat: 'binoculars', tier: 'Cheap', name: 'Bushnell 10x42', price: 60, spot: 150, low: 30, judge: 20 },
      { id: 'bino_diamond', cat: 'binoculars', tier: 'Medium', name: 'Vortex Diamondback HD', price: 250, spot: 250, low: 55, judge: 45 },
      { id: 'bino_viper', cat: 'binoculars', tier: 'High', name: 'Vortex Viper HD', price: 550, spot: 350, low: 75, judge: 65 },
      { id: 'bino_swaro', cat: 'binoculars', tier: 'Premier', name: 'Swarovski EL 10x42', price: 2800, spot: 450, low: 95, judge: 85 },

      { id: 'rf_bush', cat: 'rangefinder', tier: 'Cheap', name: 'Bushnell Bone Collector 850', price: 130, maxRange: 300, acc: 50 },
      { id: 'rf_vortex', cat: 'rangefinder', tier: 'Medium', name: 'Vortex Impact 850', price: 200, maxRange: 450, acc: 65 },
      { id: 'rf_leupold', cat: 'rangefinder', tier: 'High', name: 'Leupold RX-1600i', price: 350, maxRange: 600, acc: 80 },
      { id: 'rf_sig', cat: 'rangefinder', tier: 'Premier', name: 'Sig Sauer KILO3K', price: 700, maxRange: 1000, acc: 95 },

      { id: 'grunt_hs', cat: 'grunt', tier: 'Cheap', name: "Hunter's Specialties True Talker", price: 15, range: 100, realism: 40 },
      { id: 'grunt_primos', cat: 'grunt', tier: 'Medium', name: 'Primos Buck Roar', price: 25, range: 150, realism: 60 },
      { id: 'grunt_flex', cat: 'grunt', tier: 'High', name: "Flextone Rattlin' Grunt", price: 35, range: 175, realism: 75 },
      { id: 'grunt_wood', cat: 'grunt', tier: 'Premier', name: 'Custom wood grunt tube', price: 70, range: 200, realism: 90 },

      { id: 'snort_gen', cat: 'snort', tier: 'Cheap', name: 'Generic snort-wheeze call', price: 10, range: 80, realism: 35 },
      { id: 'snort_primos', cat: 'snort', tier: 'Medium', name: 'Primos snort-wheeze', price: 20, range: 120, realism: 55 },
      { id: 'snort_kh', cat: 'snort', tier: 'High', name: 'Knight & Hale snort-wheeze', price: 30, range: 150, realism: 70 },
      { id: 'snort_custom', cat: 'snort', tier: 'Premier', name: 'Custom snort-wheeze', price: 60, range: 175, realism: 85 },

      { id: 'rattle_bag', cat: 'rattle', tier: 'Cheap', name: 'Rattle bag', price: 15, range: 150, realism: 40 },
      { id: 'rattle_primos', cat: 'rattle', tier: 'Medium', name: "Primos Fightin' Horns", price: 35, range: 250, realism: 60 },
      { id: 'rattle_rack', cat: 'rattle', tier: 'High', name: "Rattlin' Rack antlers", price: 50, range: 300, realism: 75 },
      { id: 'rattle_sheds', cat: 'rattle', tier: 'Premier', name: 'Real matched sheds', price: 120, range: 350, realism: 90 },

      { id: 'light_wal', cat: 'light', tier: 'Cheap', name: 'Walmart LED flashlight', price: 10, bright: 30, life: 3, red: false },
      { id: 'light_energ', cat: 'light', tier: 'Medium', name: 'Energizer headlamp', price: 25, bright: 50, life: 5, red: true },
      { id: 'light_bd', cat: 'light', tier: 'High', name: 'Black Diamond Spot headlamp', price: 50, bright: 70, life: 7, red: true },
      { id: 'light_stream', cat: 'light', tier: 'Premier', name: 'Streamlight hunting headlamp', price: 90, bright: 90, life: 10, red: true },

      { id: 'heat_little', cat: 'heater', tier: 'Cheap', name: 'Mr. Heater Little Buddy', price: 70, warm: 15, hrsPerTank: 5, noise: 6 },
      { id: 'heat_port', cat: 'heater', tier: 'Medium', name: 'Mr. Heater Portable Buddy', price: 110, warm: 22, hrsPerTank: 3, noise: 6 },
      { id: 'heat_big', cat: 'heater', tier: 'High', name: 'Mr. Heater Big Buddy', price: 180, warm: 30, hrsPerTank: 2, noise: 8 },
      { id: 'heat_hunt', cat: 'heater', tier: 'Premier', name: 'Mr. Heater Hunting Buddy', price: 220, warm: 28, hrsPerTank: 3, noise: 2 },

      { id: 'ozonics', cat: 'scentdevice', tier: 'Premier', name: 'Ozonics HR500', price: 500, scentCut: 0.35 },
    ],

    consumables: [
      { id: 'handwarm', name: 'HotHands hand warmers (pair)', price: 1.5, hands: 4 },
      { id: 'toewarm', name: 'HotHands toe warmers (pair)', price: 2, feet: 4 },
      { id: 'bodywarm', name: 'HotHands body warmer', price: 2, core: 5 },
      { id: 'snickers', name: 'Snickers bar', price: 2, sitMin: 20, crinkle: 0.06 },
      { id: 'jerky', name: "Jack Link's beef jerky", price: 7, sitMin: 30 },
      { id: 'hamcheese', name: 'Gas station hot ham & cheese', price: 5, sitMin: 40, core: 3 },
      { id: 'coffee', name: 'Thermos of coffee', price: 3, core: 3, spot: 5 },
      { id: 'gatorade', name: 'Gatorade', price: 2.5, heatMin: 30, sweat: 0.3 },
      { id: 'water', name: 'Bottled water', price: 1, heatMin: 20, sitMin: 5 },
      { id: 'scentkiller', name: 'Scent Killer Gold (1 use)', price: 3, scentCut: 0.25, packOf: 5, packPrice: 15 },
      { id: 'coverscent', name: 'Earth cover scent (1 use)', price: 1.6, scentCut: 0.10, packOf: 5, packPrice: 8 },
      { id: 'tinks', name: "Tink's #69 doe estrous (1 use)", price: 4, rutLure: true, packOf: 3, packPrice: 12 },
      { id: 'propane', name: 'Coleman 1 lb propane', price: 7, fuel: true },
      { id: 'batteries', name: 'AA batteries (4-pack)', price: 6, battery: true },
    ],
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
