// ---------------------------------------------------------------------------
// TREASURE_MESSAGE — the final message revealed when all three treasure
// tokens are collected. Captain: personalize this text before release. Keep
// it a plain string; the reveal overlay (src/ui/treasureReveal.js) and the
// completed quest log render it verbatim.
// ---------------------------------------------------------------------------
export const TREASURE_MESSAGE =
  'Congratulations, adventurer! You found the hidden treasure!'

// ---------------------------------------------------------------------------
// CHALLENGE_MESSAGE — the payoff revealed when The King's Trial is complete
// (all four stages; the boss falls in a later phase). Captain: personalize
// this text before release. Keep it a plain string; the quest log renders it
// verbatim once the trial is done.
// ---------------------------------------------------------------------------
export const CHALLENGE_MESSAGE =
  'The Hollow King has fallen. The realm is yours, champion!'

// Treasure hunt tunables (Phase 6). Three glowing tokens sit at
// seed-deterministic spots: the first a ring-distance from spawn, each next
// one a ring-distance from the previous token, at seed-chosen bearings — so
// clues chain into a journey. To extend the hunt, add a ring + name + clue
// (the three arrays are matched by index). {dist}, {dir}, and {name} in a
// clue are filled from the generated positions.
export const TREASURE = {
  seedSalt: 0x7e5a, // mixed into WORLD.seed so spots don't correlate with terrain features
  rings: [
    { minDist: 60, maxDist: 90 }, // token 1: this far from spawn, in blocks
    { minDist: 70, maxDist: 110 }, // token 2: this far from token 1
    { minDist: 80, maxDist: 130 }, // token 3: this far from token 2
  ],
  names: ['Sunstone', 'Moonstone', 'Heart of the World'],
  clues: [
    'A weathered map margin reads: “From where you first awoke, journey {dist} blocks {dir}. The {name} hums beneath the open sky.”',
    'Etched on the Sunstone: “My sibling, the {name}, rests {dist} blocks {dir} of where you found me.”',
    'Etched on the Moonstone: “{dist} blocks {dir} lies the {name} — claim it, and the treasure is yours.”',
  ],
  collectRadius: 2.25, // walk within this many blocks (horizontal) to collect
  hoverHeight: 1.6, // token center floats this far above the terrain surface
  spinSpeed: 1.5, // token rotation, radians per second
  bob: { amplitude: 0.2, speed: 2 }, // gentle vertical float
  tokenColor: 0xffd75e, // unlit gold — reads as glowing against lit terrain
  beam: { color: 0xffe9a0, radius: 0.2, opacity: 0.35 }, // sky-beam marker
  toastSeconds: 4, // how long the "found it" banner lingers
}

// Stage 2 beacon shape (captain-retunable): a 5×5 platform flush with the
// ground, four corner pillars with a torch atop each, and a two-block gold-ore
// core at the center — the gold is the intended difficulty gate (iron pickaxe
// + deep mining). `beaconCells` expands this readable description into the
// cell list the structure checker walks; edit the shape here, never the cells.
const BEACON_SHAPE = {
  platformSize: 5, // odd — centered on the anchor column, at ground level
  pillarHeight: 3, // pillar cells dy 1..pillarHeight at the four corners
  pillarIds: [3, 7, 5], // each pillar cell: stone / planks / wood
  torchId: 13, // atop each pillar — exact block, the "lit" signature
  coreId: 12, // gold ore — the progression gate
  coreHeight: 2, // core cells dy 1..coreHeight at the center
}

// Expand the shape into [{ dx, dy, dz, ids }] — offsets from the anchor
// column's surface block (dy 0 = the ground layer, so natural terrain can
// satisfy platform cells). `ids: null` means "any solid block" (forgiving);
// explicit id lists are strict. 5×5 + 4×(3+1) + 2 = 43 cells.
function beaconCells(shape) {
  const cells = []
  const r = Math.floor(shape.platformSize / 2)
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      cells.push({ dx, dy: 0, dz, ids: null }) // platform: any solid block
    }
  }
  for (const [dx, dz] of [[-r, -r], [-r, r], [r, -r], [r, r]]) {
    for (let dy = 1; dy <= shape.pillarHeight; dy++) {
      cells.push({ dx, dy, dz, ids: shape.pillarIds })
    }
    cells.push({ dx, dy: shape.pillarHeight + 1, dz, ids: [shape.torchId] })
  }
  for (let dy = 1; dy <= shape.coreHeight; dy++) {
    cells.push({ dx: 0, dy, dz: 0, ids: [shape.coreId] })
  }
  return cells
}

// The King's Trial (endgame challenge chain): a four-stage quest — scavenger
// → build → siege → boss — that unlocks when the treasure hunt completes.
// It anchors at the Trial Grounds, a seed-deterministic site ringed off the
// third treasure token (marked with scene meshes, never stamped into terrain
// generation — the purity rule). Stage 1 (Relics of the Deep) ships first;
// the `beacon`/`siege`/`boss` blocks below are the later stages' knobs,
// pre-declared with the design's proposed values so those PRs only add code.
export const CHALLENGE = {
  seedSalt: 0x7a11, // mixed into WORLD.seed for the Trial Grounds placement stream
  site: {
    minDist: 80, // ring distance from the third treasure token, in blocks
    maxDist: 130,
    flatSpread: 4, // reject sites whose terrainHeight varies more than this ±4 blocks
    deliverRadius: 6, // stand within this of the anchor (with all shards) to deliver
    marker: {
      ringRadius: 5, // flat glowing ring on the ground marking the arena center
      ringWidth: 0.6,
      color: 0xffb066, // ember-orange — distinct from the gold treasure beams
      opacity: 0.5,
      beam: { color: 0xffc890, radius: 0.3, opacity: 0.3 }, // sky-beam landmark
    },
  },
  // Stage 1 — Relics of the Deep: five relic shards hidden across the world's
  // systems (three far biomes, one deep cave pocket, one seabed), collected by
  // proximity like treasure tokens but carried as items and DELIVERED at the
  // Trial Grounds. Placement is a pure function of WORLD.seed (own salt) —
  // shard entries are index-matched to the save's `relics.found` array, so
  // extend/reorder only alongside a fresh world. Clue templates take {dist} /
  // {dir} / {name}, filled from the generated positions relative to spawn.
  relics: {
    seedSalt: 0x3e1c, // placement stream for the five shards
    // The Tide Shard's primary placement pass requires a column at least this
    // many blocks under WATER.level (deep water made real oceans exist), so
    // retrieving it takes a genuine breath-managed dive — the ±4 vertical
    // collect band can no longer be reached by treading the surface. The
    // relaxation ladder in RelicHunt.#findSeaSpot still falls back to
    // shallower seas on pathological seeds, so placement never fails.
    minDiveDepth: 10,
    collectRadius: 2.25, // walk within this many blocks (horizontal) to collect
    hoverHeight: 1.4, // surface shards float this far above the terrain
    tokenColor: 0x7fe7d0, // unlit sea-glass green — reads as glowing, unlike gold tokens
    beam: { color: 0xa8f5e2, radius: 0.2, opacity: 0.3 },
    spinSpeed: 1.5,
    bob: { amplitude: 0.2, speed: 2 },
    toastSeconds: 4,
    shards: [
      { name: 'Ember Shard', kind: 'biome', biome: 'desert', minDist: 150, maxDist: 300,
        clue: 'Where the sun scorches bare sand, {dist} blocks {dir} — the {name} smolders.' },
      { name: 'Verdant Shard', kind: 'biome', biome: 'forest', minDist: 150, maxDist: 300,
        clue: 'Beneath thick canopies {dist} blocks {dir}, the {name} has taken root.' },
      { name: 'Frost Shard', kind: 'biome', biome: 'snow', minDist: 150, maxDist: 300,
        clue: 'High in the snows {dist} blocks {dir}, the {name} waits in the cold.' },
      { name: 'Deep Shard', kind: 'cave', minDist: 60, maxDist: 140, maxY: 24,
        clue: 'Travel {dist} blocks {dir}, then dig: far beneath the stone the {name} glimmers in the dark.' },
      { name: 'Tide Shard', kind: 'sea', minDist: 60, maxDist: 160,
        clue: '{dist} blocks {dir}, beneath the waves — the {name} rests on the seabed.' },
    ],
    deliverClue: 'Carry all five shards to the Trial Grounds, {dist} blocks {dir} of where you first awoke.',
  },
  // Retry policy for the combat stages (captain's decision): failed siege /
  // boss attempts cost nothing — re-arm at the core and try again. Later
  // stage PRs read this; 'free' is the only implemented value.
  retry: 'free',
  // Stage 2 — Raise the Beacon: voxel-checked build at the anchor. The ghost
  // preview shows every unsatisfied cell; the checker is forgiving in
  // materials (per-cell id sets, null = any solid), extras (blocks outside
  // the spec ignored), and terrain (natural blocks count) but strict in shape
  // and the signature cells (torches + gold core). Completion latches
  // `beaconBuilt` — later damage never regresses the stage.
  beacon: {
    checkRadius: 12, // world edits within this of the anchor re-run the structure check
    shape: BEACON_SHAPE, // the readable spec — retune the build here
    cells: beaconCells(BEACON_SHAPE), // expanded cell list the checker walks
    ghost: {
      color: 0x5fb4ff, // translucent blue — a missing cell
      opacity: 0.35,
      pulseColor: 0x7dff9e, // green burst when a cell is satisfied
      doneColor: 0x9fd8ff, // the completion burst
    },
  },
  // Stage 3 — The Siege: arm at the beacon's gold core, then survive the
  // escalating night waves below, cleared before dawn (src/quest/SiegeEvent).
  // Worst case (wave 3) is 8 mobs × ~6 parts ≈ 48 draw calls — comparable to
  // the night cap of 6; ambient + passive spawns are suppressed during the
  // event, so keep wave sizes modest for the same reason those caps are low.
  siege: {
    waves: [{ zombie: 4 }, { zombie: 3, skeleton: 3 }, { zombie: 3, skeleton: 3, creeper: 2 }],
    spawnRadius: 14, // waves crest this far from the anchor
    arenaRadius: 24, // leaving this ring too long disperses the horde
    leaveGraceSeconds: 6,
    breatherSeconds: 10, // pause between waves
    // Telegraphed entrances: each spawn point flares (red particle column +
    // horn) this long before the mobs actually rise, so the player can pre-aim.
    flare: { leadSeconds: 1.2, color: 0xff4545, particles: 40 },
    clearedBeamColor: 0xff6a3c, // blood-orange anchor beam once the siege is won — the King is ready
  },
  // Stage 4 — The Hollow King: the 3-phase end boss (src/combat/Boss.js +
  // src/quest/BossFight.js). Summoned by re-clicking the gold core after the
  // siege; every attack telegraphs (emissive flash + pose) for at least
  // `telegraphSeconds` and no attack one-shots through iron armor (max 10
  // pre-armor vs 20 HP × 60% reduction). ~12 body parts + ≤2 zombie minions
  // is the whole event population — ambient spawns stay suppressed.
  boss: {
    health: 120, // ≈18 full bow shots or ~26 iron-sword swings pre-crit
    aabb: { width: 1.1, height: 2.8 },
    knockbackFactor: 0.15, // fraction of normal knockback the boss takes
    phases: [0.66, 0.33], // health fractions where phases 2 and 3 begin
    phaseSpeeds: [2.2, 2.8, 2.8], // walk speed per phase, blocks/s
    phase3CooldownFactor: 0.75, // Breaker phase: every attack cools down faster
    roarSeconds: 2, // invulnerable phase-transition roar (crown spins fast)
    summonSeconds: 3, // core-click rumble before the King rises
    leash: { playerSeconds: 8, losSeconds: 10 }, // out-of-arena / no-line-of-sight reset timers
    drop: 'kings_crown', // the trophy, through the normal kill-drop path
    extraDrop: { id: 'gold_ore', count: [4, 8] },
    attacks: {
      // A — Crownfall Slam: arms overhead, white ramp, then an AoE around the
      // boss. Counter: back off — the radius reads from the arm pose.
      slam: { telegraphSeconds: 0.9, cooldownSeconds: 5, radius: 3.5, damage: 8, triggerRange: 3 },
      // B — Charge: crouch + 3 flashes, then a straight rush. Hitting a wall
      // (body.hitWall) staggers it — bait it into the beacon pillars.
      charge: { telegraphSeconds: 0.8, cooldownSeconds: 8, speed: 11, maxSeconds: 2,
        damage: 6, hitRange: 1.4, staggerSeconds: 2.5, staggerDamageFactor: 1.5,
        minRange: 5, maxRange: 18 },
      // C — Bone Volley (phase ≥ 2): 3 arrows in a fan with ballistic lead,
      // line-of-sight gated like the skeleton. Counter: strafe or take cover.
      volley: { telegraphSeconds: 0.9, cooldownSeconds: 6, arrows: 3, fanDegrees: 15,
        arrowSpeed: 18, arrowDamage: 3, minRange: 4, maxRange: 18 },
      // D — Summon (phase ≥ 2): raises zombie minions, hard-capped alive.
      summon: { telegraphSeconds: 1.2, cooldownSeconds: 12, count: 2, maxMinions: 2, ringRadius: 3 },
      // E — Quake (phase 3): marks the player's cell, then world.explode
      // there — dodgeable by walking; the craters accumulate and the arena
      // erodes. The world itself keeps score.
      quake: { telegraphSeconds: 1.2, cooldownSeconds: 10, radius: 2.2, damage: 10,
        damageRadius: 3, minRange: 2, maxRange: 14,
        marker: { color: 0xffb066, radius: 1.4, opacity: 0.55 } },
    },
    crown: { color: 0xffd75e, hover: 3.15, spinSpeed: 1.2, roarSpinSpeed: 10, staggerDrop: 1.7 },
    core: { color: 0xff5533, pulseSpeed: 3 }, // the exposed chest core (visual flavor)
    defeatNova: { color: 0xffd75e, particles: 140 }, // crown-colored victory burst
  },
}

// The King's Trial guidance layer (Herald / wisps / stele / testament): all
// player-facing lines and every visual knob live here — purely additive, no
// keys inside CHALLENGE. The Herald's lines carry a deliberate TONE ARC:
// empathetic and encouraging at the unlock and early stages, gaining urgency
// with each stage latch, and lightly scolding (a weary champion, never harsh)
// on boss-stage deaths. Keep that arc when editing. Each line is one sentence
// (`text`) plus one flavor line (`flavor`) — the banner renders both.
export const GUIDANCE = {
  banner: {
    minSeconds: 3.5, // each queued line holds the banner at least this long
    lingerSeconds: 7, // the final line fades after this
    maxQueue: 5, // oldest queued (unshown) message drops past this
  },
  herald: {
    offset: { x: 0, z: -3.5 }, // resident spot relative to the anchor column
    speakRadius: 8, // walking within this of the figure re-speaks the stage line
    faceRadius: 24, // the figure turns to face the player inside this
    hearRadius: 28, // whisper volume fades to zero at this distance
    hover: 0.15, // the figure floats this far above the ground
    apparitionDistance: 4, // the unlock ghost materializes this far ahead
    apparitionSeconds: 6, // …lingers this long, then flows to the Trial Grounds
    dissolveSeconds: 2.5, // completion farewell fade-out
    moteBursts: 6, // wisp bursts along the dissolve stream
    color: 0x9fd8ff, // spectral ghost-blue (the beacon-ghost family)
    opacity: 0.5,
    flicker: { amount: 0.12, speed: 2.1 }, // slow spectral opacity shimmer
    bob: { amplitude: 0.1, speed: 1.5 },
    // The stage script. Keys are derived from challenge/siege/boss state
    // (Herald.lineKeyFor); `unlock`/`bossRetry`/`bossLeash`/`bossPhase2`/
    // `bossPhase3`/`complete` are scripted beats.
    lines: {
      unlock: {
        text: 'Champion… the Heart you carry has woken something old.',
        flavor: 'Come — follow the light. The Trial Grounds remember, and so do I.',
      },
      relics: {
        text: 'Five shards the rite asks — the compass already knows the first.',
        flavor: 'I gathered them once, long ago. Take heart; the way is kinder than it looks.',
      },
      deliver: {
        text: 'You carry all five — lay them within the ring.',
        flavor: 'How they hum. Mine did too.',
      },
      beacon: {
        text: 'Raise the pyre as the blue memory shows — gold at its heart, fire at its corners.',
        flavor: 'Build it true, champion. The night is already watching.',
      },
      siegeDisarmed: {
        text: 'When your walls and nerve are ready, wake the gold core — the horde answers at dusk.',
        flavor: 'Do not linger. The King grows no weaker while you wait.',
      },
      siegeArmed: {
        text: 'It is done — they come at dusk. Do not leave the ring.',
        flavor: 'Steel yourself. This is where I faltered.',
      },
      siegeActive: {
        text: 'Hold the ring, champion — dawn decides it!',
        flavor: 'Every wave announces itself. Meet them.',
      },
      siegeFailed: {
        text: 'The horde is only beaten by standing — wake the core and stand again.',
        flavor: 'Dusk returns. So must you.',
      },
      boss: {
        text: 'Wake the core once more, and the Hollow King himself answers.',
        flavor: 'No more errands, champion. The crown, or the dark.',
      },
      bossRumble: {
        text: 'He comes. Stand ready!',
        flavor: 'Do not blink.',
      },
      bossFight: {
        text: 'Watch him — every blow is announced before it lands.',
        flavor: 'Strike after the telegraph. Bait the charge into stone.',
      },
      bossPhase2: {
        text: 'He calls the dead to him — cut the minions down fast!',
        flavor: 'Faster now. He is angry.',
      },
      bossPhase3: {
        text: 'The Breaker wakes — the ground itself is no longer safe!',
        flavor: 'Keep moving. Nothing he marks survives.',
      },
      bossRetry: {
        text: 'Again? The crown does not wait forever.',
        flavor: 'I have watched a hundred fall. Do not make me remember you the same way.',
      },
      bossLeash: {
        text: 'You fled the ring, and so he fled you.',
        flavor: 'Summon him again — and this time, stay.',
      },
      complete: {
        text: 'It is done. The crown dims, the realm breathes… and I may finally rest.',
        flavor: 'Farewell, champion. Wear it better than the last king did.',
      },
    },
  },
  // The in-world compass: faint motes drifting a few blocks ahead of the
  // player along the bearing to the current objective, color-keyed per stage
  // (colors match the beams/flares already established in TREASURE/CHALLENGE
  // so the palette teaches itself). Supplements the HUD compass, never
  // replaces it. Also owns the gold-core "wake me" shimmer.
  wisps: {
    intervalSeconds: 0.4, // one mote volley this often (~7 particles/s)
    distances: [3, 5, 7], // blocks ahead of the player along the bearing
    jitter: 0.9, // random offset per mote, blocks
    dropBelowEye: 0.6, // motes spawn this far under eye height (waist-high)
    suppressRadius: 12, // inside this of the target the beams/ghost take over
    colors: {
      treasure: 0xffd75e, // gold — the original hunt
      relics: 0x7fe7d0, // sea-glass green (stage 0)
      beacon: 0x5fb4ff, // ghost-blue (stage 1)
      siege: 0xff4545, // flare-red (stage 2)
      boss: 0xff6a3c, // blood-orange (stage 3)
    },
    // While the core waits to be clicked (siege disarmed / King summonable),
    // an ember shimmer pulses on the two gold-core cells: "this glows, use it".
    coreShimmer: { intervalSeconds: 1.1, color: 0xffd75e, count: 2 },
  },
  // The Prophecy Stele: a rune-carved monolith on the anchor ring whose four
  // glyph lines (one per stage) ignite as stages latch — the glanceable
  // "where am I in the arc" board. Glyphs only, never English: the Herald is
  // the translator (stand near and it speaks the active line's meaning).
  stele: {
    offset: { x: 0, z: 4 }, // beside the ring, clear of the beacon footprint
    width: 1.2,
    height: 3.6,
    depth: 0.5,
    stoneColor: 0x201d28, // dark basalt monolith
    faceColor: '#151019', // canvas background behind the runes
    litColor: '#ffb066', // completed lines burn ember-orange
    activeColor: '#8a6a45', // the current stage's line, faintly warm
    dimColor: '#241d16', // future lines: near-black engravings
    glyphsPerLine: 9,
    igniteParticles: 26, // burst when a line catches
    pulse: { speed: 2.2, min: 0.04, max: 0.3 }, // active-line glow plane
  },
  // The Champion's Testament: the quest log's Trial rows reskinned in the
  // fallen champion's first-person voice. Index-matched to STAGES; `closings`
  // append to completed rows, `sealedStub` teases unreached pages.
  testament: {
    passages: [
      'From my testament: “Five shards I sought where sun, root, frost, stone and tide keep them. Each one hummed louder as the next drew near.”',
      '“I raised the pyre by the old blue memory — gold at its heart, flame at its corners. The night noticed.”',
      '“At dusk they came, wave upon wave. Hold the ring, whatever it costs. I did not.”',
      '“The King wears a hollow crown. Every blow he strikes, he announces first — that is his pride, and his weakness.”',
    ],
    closings: [
      '“The shards are laid. The grounds are awake.”',
      '“The beacon burns. Let them come.”',
      '“The horde is broken. He knows your name now.”',
      '“The crown has fallen.”',
    ],
    sealedStub: '…the rest of the page is ash.',
  },
}

// World layout (Phase 2: chunked procedural terrain).
export const WORLD = {
  blockSize: 1,
  seed: 1337, // terrain seed — same seed always yields the same world
  chunkSize: 16, // blocks per chunk along x and z
  // Phase 11 doubled the world height (48 → 96) and shifted the surface up
  // (baseHeight 14 → 62) so there is ~60 blocks of stone to mine into. All
  // height-anchored tunables moved with it: sandLevel, WATER.level,
  // DAYNIGHT.clouds.height, and the ore bands below.
  chunkHeight: 96, // world height in blocks (y = 0..chunkHeight-1)
  renderDistance: 3, // chunks loaded in each direction around the player
  chunkGenBudgetPerFrame: 2, // max chunks generated+meshed per frame
  terrain: {
    baseHeight: 62, // average surface height, in blocks
    amplitude: 9, // hills rise/fall this far around baseHeight
    frequency: 1 / 56, // horizontal noise scale (smaller = wider hills)
    octaves: 4, // FBM octaves — more = more small detail
    lacunarity: 2, // frequency multiplier per octave
    gain: 0.5, // amplitude multiplier per octave
    dirtDepth: 3, // dirt layers under the grass surface before stone
    sandLevel: 59, // surfaces at or below this height are sand ("beaches")
    trees: {
      chance: 0.012, // per grass column probability of spawning a tree
      minTrunk: 4, // trunk height range, in blocks
      maxTrunk: 6,
    },
    // Caves (Phase 11): stone is carved to air where a squashed 3D value
    // noise field exceeds `threshold` — a pure function of (seed, x, y, z)
    // like all terrain, so unloaded-chunk queries and border meshing agree.
    caves: {
      seedSalt: 0xca5e, // mixed into WORLD.seed for the cave field
      frequency: 1 / 16, // horizontal noise scale (smaller = larger caverns)
      ySquash: 1.7, // vertical frequency multiplier — flattens caves into tunnels
      threshold: 0.70, // carve where 2-octave noise [0,1] exceeds this
      minY: 4, // never carve at/below this — keeps a solid world floor
      // Columns whose surface touches the sea keep this many top blocks
      // solid so caves never puncture the seabed (there is no water flow).
      seabedKeep: 4,
    },
    // Lava (lava feature): carved cave cells at or below `level` fill with
    // lava instead of air — one branch in World.terrainBlock, the single
    // choke point both generation paths share, so purity holds with no
    // mirroring. Level 10 floods ~20% of cave volume and puts ~1 in 23
    // diamond veins directly against a pool (the "diamonds guarded by lava"
    // tension). Solid cells touching a pool crust into obsidian (block 20).
    // Retune with `node tools/probe-lava.mjs`.
    lava: {
      level: 10, // carved cave cells at or below this height fill with lava
    },
    // Ore bands (Phase 11, MC-style depth tiers): deep stone rolls against
    // each band in order — first hit wins — so overlapping bands stay cheap.
    ores: [
      { blockId: 18, chance: 0.008, minY: 1, maxY: 12, salt: 0xd1a3 }, // diamond: deepest + rarest
      { blockId: 12, chance: 0.018, minY: 1, maxY: 16, salt: 0x601d }, // gold: deep + rare
      { blockId: 8, chance: 0.045, minY: 4, maxY: 40, salt: 0x1e55 }, // iron: mid band
      { blockId: 11, chance: 0.06, minY: 24, maxY: 72, salt: 0xc0a1 }, // coal: shallow + common
    ],
    // Biomes (Phase 13): a second, very low-frequency FBM picks a climate
    // band per column — a pure function of (seed, x, z) like all terrain.
    // Bands are ordered cold→hot along the noise axis so only neighboring
    // climates ever touch. `amplitude` scales terrain relief SMOOTHLY from
    // the raw noise value (not the discrete band), so biome borders never
    // cliff; grass/leaf tints ride the vertex-color tint layer (Phase 13
    // textures multiply texture × vertex color).
    biomes: {
      seedSalt: 0xb105,
      frequency: 1 / 240, // biome patches span many chunks
      octaves: 2,
      lacunarity: 2,
      gain: 0.5,
      // Terrain relief scaling across the biome-noise axis [-1, 1]:
      // desert end flat, snow end mountainous. Lerped from the raw noise.
      amplitude: { min: 0.5, max: 1.6 },
      // First band whose `max` >= the biome noise value wins.
      bands: [
        { name: 'desert', max: -0.3, treeChance: 0, surface: 'sand', grassTint: 0xbfb755, leafTint: 0x8a9a4a },
        { name: 'plains', max: 0.12, treeChance: 0.004, surface: 'grass', grassTint: 0x82c05a, leafTint: 0x55a03a },
        { name: 'forest', max: 0.45, treeChance: 0.03, surface: 'grass', grassTint: 0x4e9e3d, leafTint: 0x3c8a2e },
        { name: 'snow', max: Infinity, treeChance: 0.008, surface: 'snow', grassTint: 0x8fb987, leafTint: 0x5a8a52 },
      ],
    },
    // Ocean basins (deep water): a third, low-frequency FBM — the
    // "continentalness" field — smoothly depresses terrainHeight toward
    // `floorHeight` where the mask exceeds `maskStart` (fully oceanic past
    // `maskFull`). smoothstep across the band makes shores SHELVE instead of
    // cliff, and where the mask is zero heights are byte-identical to the
    // pre-ocean generator (~86% of columns on seed 1337). Deliberately NOT a
    // `biomes.bands` entry — that table is a climate axis and ocean is
    // orthogonal to it; sand floors / no trees / sealed seabeds all follow
    // from the height rules alone. Retune with `node tools/probe-ocean.mjs`.
    ocean: {
      seedSalt: 0x0cea, // mixed into WORLD.seed for the continentalness field
      frequency: 1 / 320, // basins span ~10–20 chunks
      octaves: 2,
      lacunarity: 2,
      gain: 0.5,
      maskStart: 0.35, // shore begins shelving past this noise value
      maskFull: 0.7, // fully oceanic past this
      floorHeight: 44, // deep seabed target: 13 blocks under WATER.level 57
    },
  },
}

// Inventory / hotbar layout (Phase 3).
export const INVENTORY = {
  hotbarSlots: 9, // slots in the always-visible hotbar (keys 1-9)
  mainRows: 3, // rows of 9 extra slots shown in the inventory screen
  maxStack: 64, // default max items per stack (tools override to 1)
}

// Placed chests (inventory overhaul) — see src/crafting/Chests.js.
export const CHEST = {
  slots: 27, // 3×9: reuses the 9-column inventory grid CSS as-is
}

// Player movement tunables.
export const PLAYER = {
  eyeHeight: 1.7, // camera height above the player's feet, in blocks
  moveSpeed: 5, // walk speed, blocks per second
  // Sprint speed factor (deliberately above MC's 1.3 — quest legs here run
  // 100+ blocks). Sprint is MC's scheme: double-tap forward to latch it
  // (forward-only), full joystick deflection on touch.
  sprintMultiplier: 1.8,
  sprint: {
    doubleTapSeconds: 0.25, // second forward press within this latches sprint
    minHunger: 6, // no sprinting at or below this many hunger points (MC rule)
  },
  damping: 12, // higher = snappier stop (velocity decay per second)
  reach: 5, // max distance for breaking/placing blocks, in blocks
  spawnPoint: { x: 0.5, z: 8.5 }, // initial spawn AND respawn-on-death column
}

// Physics & movement feel (Phase 8): gravity, jumping, and AABB voxel
// collision, shared by the player and mobs — see src/physics/PhysicsBody.js.
export const PHYSICS = {
  gravity: 32, // blocks/s² (Minecraft-ish; higher = heavier feel)
  terminalVelocity: 50, // max fall speed, blocks/s
  jumpVelocity: 9, // initial jump speed; apex = v²/2g ≈ 1.27 blocks (clears a 1-block step)
  playerAABB: { width: 0.6, height: 1.8 }, // player collision box, in blocks
  mobAABB: { width: 0.6, height: 1.9 }, // zombie collision box
  // Tallest ledge climbed automatically while walking. 0.6 is Minecraft's
  // value: full blocks take a jump (zombies hop them on their own); raise
  // past 1.0 to auto-step whole blocks instead.
  stepHeight: 0.6,
  sneak: {
    speedMultiplier: 0.3, // sneak (Shift / C) walk-speed factor
    eyeDrop: 0.15, // camera crouches this far while sneaking
  },
  fall: {
    graceBlocks: 3, // falls up to this many blocks are free (Minecraft's grace)
    damagePerBlock: 1, // health lost per whole block fallen beyond the grace
  },
  voidY: -12, // below this y (out the world floor) the fall is lethal
  ejectSpeed: 4, // upward self-heal speed when embedded in solid blocks, blocks/s
  touchJumpBufferSeconds: 0.25, // a tapped touch jump waits this long to be grounded
  sprintFov: { boost: 8, lerp: 8 }, // extra FOV degrees while sprint-moving + follow rate
}

// Combat / mobs / tools (Phase 4). Health units: 1 heart = 2 health.
export const COMBAT = {
  maxHealth: 20,
  regen: {
    delaySeconds: 6, // no regen until this long after last damage taken
    perSecond: 1, // health regained per second once regen kicks in
  },
  attack: {
    reach: 3.5, // max distance to hit a mob, in blocks (< block reach)
    cooldownSeconds: 0.35, // min time between player attacks
    handDamage: 1, // bare hands / non-tool items
    toolDamage: 2, // pickaxes and axes (any tier) — better than a fist
    swordDamage: { 1: 4, 2: 5, 3: 7, 4: 8 }, // by tool tier (wood/stone/iron/diamond)
    knockback: 6, // horizontal impulse applied to a hit mob
    // Jump-attack crit (Phase 13): hits landed while falling (airborne and
    // descending, not swimming) deal extra damage, MC-style.
    critMultiplier: 1.5,
  },
  // Player knockback (Phase 13): a mob hit / arrow / explosion shoves the
  // player — a decaying horizontal impulse plus a small pop-up, so a hit at
  // a cliff or cave edge is real danger.
  playerKnockback: {
    horizontal: 7, // impulse along the hit direction, blocks/s
    vertical: 4.5, // upward pop (applied as a velocity floor)
  },
  // Armor (Phase 13): equipped pieces (right-click to wear) sum their
  // `armor.points`; incoming mob/arrow/explosion damage is reduced by
  // points * reductionPerPoint, capped. Fall/void/starvation ignore armor.
  armor: {
    reductionPerPoint: 0.04, // 4% per point (full iron = 15 pts = 60%)
    maxReduction: 0.8,
  },
  // Bow (Phase 13): hold right click to draw, release to loose an arrow —
  // speed and damage scale with charge. Touch ▦ fires a fixed mid-charge
  // shot (no hold-release on a tap).
  bow: {
    fullChargeSeconds: 1.0, // held this long = full power
    minCharge: 0.15, // releases earlier than this fire nothing (mis-clicks)
    tapCharge: 0.65, // charge used by tap-to-fire (touch / breakTargeted-style hooks)
    speed: { min: 10, max: 30 }, // arrow launch speed, blocks/s, by charge
    damage: { min: 1, max: 7 }, // by charge (full draw ≈ an iron sword)
    cooldownSeconds: 0.3, // min time between shots
  },
  // Arrow projectiles (Phase 13, player and skeleton): ballistic point
  // entities integrated against world.blockAt — see src/combat/Projectiles.js.
  projectiles: {
    gravity: 18, // blocks/s² — floatier than bodies, so arcs read as archery
    lifeSeconds: 10, // arrows despawn after this long (stuck or flying)
    stickSeconds: 3, // how long a landed arrow stays visible
    maxCount: 24, // oldest arrow despawns past this
  },
  mining: {
    // Matching tool speed: break cooldown = hardness / (1 + tier * this).
    speedPerTier: 1,
    gatedFlashSeconds: 0.25, // highlight flashes red when the tool is too weak
    // Environment penalties (fidelity pack): break time multiplies by these
    // while the player body is submerged / off the ground (MC's 5× rules).
    inWaterFactor: 5,
    airborneFactor: 5,
  },
  toolDurability: { 1: 64, 2: 128, 3: 256, 4: 512 }, // uses per tool, by tier
  // Armor wear (fidelity pack): every reduced hit ticks 1 point off each
  // equipped piece; at 0 the piece shatters. Values sit between the tool
  // tiers — a leather set survives ~80 hits, iron ~192, diamond ~384.
  armorDurability: { leather: 80, iron: 192, diamond: 384 },
  mobs: {
    maxCount: 4, // hard cap on live mobs (keep low — one draw call per part)
    spawnIntervalSeconds: 5, // try to top the population up this often
    spawnRadiusMin: 10, // spawn ring around the player, in blocks
    spawnRadiusMax: 18,
    despawnRadius: 48, // mobs farther than this from the player are removed
    // Light-based spawning (dark-places spawn): hostiles rise wherever the
    // local light (world.lightAt — depth sky light × time-of-day brightness,
    // maxed with torch falloff over LIGHTING.torch.distance) is at or below
    // maxLight. This replaces the old night-only gate: deep caves (sky floor
    // 0.15) spawn at any hour, the surface spawns only at night (~0.1), and
    // a torch carves a safe bubble the size of its visible glow. `attempts`
    // ring spots are tried per spawn tick (the passive-spawner pattern).
    spawnLight: { maxLight: 0.25, attempts: 6 },
    // Spawn mix (Phase 13): relative weights per hostile kind.
    hostileWeights: { zombie: 0.5, skeleton: 0.3, creeper: 0.2 },
    zombie: {
      health: 10,
      chaseSpeed: 2.8, // blocks/sec while chasing (player walks at 5)
      wanderSpeed: 1, // blocks/sec while idling around
      wanderSeconds: 3, // re-roll the wander direction this often
      aggroRange: 12, // starts chasing when the player is this close
      attackRange: 1.8, // melee reach
      attackDamage: 3, // 1.5 hearts per hit
      attackCooldownSeconds: 1.2,
      drop: 'rotten_flesh', // added straight to the inventory (no ground items)
    },
    // Skeleton (Phase 13): ranged hostile — keeps its distance and shoots
    // ballistic arrows (the same projectile system as the player's bow).
    skeleton: {
      health: 8,
      speed: 2.2,
      wanderSpeed: 1,
      wanderSeconds: 3,
      aggroRange: 15, // notices the player this far away
      minRange: 7, // backs away when the player is closer than this
      maxRange: 12, // steps closer when the player is farther than this
      shootIntervalSeconds: 2.4,
      arrowSpeed: 18,
      arrowDamage: 3,
      drop: 'arrow',
      dropCount: [1, 3],
    },
    // Creeper (Phase 13): walks up close, hisses through a fuse, then
    // explodes — carving a sphere of blocks and damaging the player by
    // proximity. Leaving fuse range mid-hiss lets the fuse tick back down.
    creeper: {
      health: 10,
      chaseSpeed: 3.0,
      wanderSpeed: 1,
      wanderSeconds: 3,
      aggroRange: 14,
      fuseRange: 3, // fuse advances while the player is this close
      fuseSeconds: 1.5,
      drop: null, // no TNT tier yet — nothing useful to drop
      explosion: {
        radius: 2.4, // blocks carved to air around the blast center
        maxDamage: 16, // at point-blank, before armor; falls off linearly
        damageRadius: 6, // no damage beyond this distance
        particles: 80,
        color: 0x9a9a9a,
      },
    },
    // Zombified piglin (N5, Nether): a Zombie variant that spawns NEUTRAL —
    // it wanders forever and only chases once `angered` (set by taking a
    // player hit; anger spreads to other piglins within angerRadius, so
    // shooting one raises the patrol). Drops gold ore: the risk-farmable
    // deep-mining prize.
    zombifiedPiglin: {
      health: 12,
      chaseSpeed: 3.2, // angry piglins close faster than zombies
      wanderSpeed: 1,
      wanderSeconds: 3,
      aggroRange: 14, // chase range ONCE angered — never before
      angerRadius: 12, // hitting one angers every piglin this close to it
      attackRange: 1.8,
      attackDamage: 4, // 2 hearts — meaner than a zombie
      attackCooldownSeconds: 1.2,
      drop: 'gold_ore',
    },
    // Magma cube (N5, Nether): a single-box bouncer — periodically hops
    // toward the player (the Mob.locomote hop on a timer, not hitWall),
    // melees on contact, and is lavaProof (it lives in the seas). Drops
    // nothing for now (the creeper precedent).
    magmaCube: {
      health: 8,
      hopIntervalSeconds: 1.3, // between hops while chasing
      idleHopIntervalSeconds: 3.5, // lazy ambient hops when nobody's close
      hopVelocity: 7, // upward launch per hop (~0.77-block apex)
      hopSpeed: 4.5, // horizontal drive while airborne
      aggroRange: 12,
      attackRange: 1.5,
      attackDamage: 3,
      attackCooldownSeconds: 1.0,
      drop: null, // no magma-cream sink exists yet
    },
  },
}

// Persistence (Phase 5): the whole game state lives in one versioned
// localStorage key — see src/save/SaveManager.js for the schema.
export const SAVE = {
  storageKey: 'minecraft-clone-save',
  schemaVersion: 4, // bump (and migrate in SaveManager.load) when the shape changes
  // v3 → v4 (deep water): ocean basins reshape the terrain under the same
  // seed, so v3 edit overlays no longer sit on the blocks they were made
  // against. No migration — old saves start fresh, as the load guard does.
  // v2 → v3 (Phase 13): biomes reshape the terrain under the same seed, so
  // v2 edit overlays no longer sit on the blocks they were made against.
  // No migration — old saves start fresh, as the load guard does.
  // v1 → v2 (Phase 11): chunkHeight 48 → 96 moved the terrain surface, so v1
  // edit overlays (indexed by the old chunkHeight) no longer map to the same
  // blocks. No migration — old saves start fresh, as the load guard does.
  autosaveSeconds: 5, // how often dirty state is flushed to localStorage
  // localStorage holds ~5MB of UTF-16 per origin. Past this payload size the
  // save is still attempted but a console warning fires (once), so a
  // pathological number of block edits degrades gracefully instead of
  // silently marching toward a thrown QuotaExceededError.
  warnPayloadChars: 4_000_000,
}

// Touch controls (Phase 7): virtual joystick + drag-look, shown only on
// coarse-pointer (phone/tablet) devices — see src/player/TouchControls.js.
export const TOUCH = {
  lookSensitivity: 0.0045, // radians of camera rotation per pixel dragged
  joystick: {
    radius: 56, // px the nub can travel from center (also sizes the base)
    deadZone: 0.15, // deflection below this fraction is ignored
    sprintAt: 0.92, // deflection at or past this fraction sprints
  },
  tap: {
    maxSeconds: 0.3, // press longer than this is a look-drag, not a tap
    maxDrift: 12, // px of movement past which a press stops being a tap
  },
}

// Rendering / atmosphere tunables.
export const GRAPHICS = {
  skyColor: 0x87ceeb,
  // Loaded terrain always extends >= renderDistance*chunkSize (48) blocks from
  // the player, so fog fully hides the world edge before it can be seen.
  fogNear: 18,
  fogFar: 46,
  fov: 75,
  maxPixelRatio: 2, // cap devicePixelRatio for consistent framerate
}

// Feedback & game-feel (Phase 9): hold-to-break mining, break particles, the
// held-item viewmodel, and ground item drops. Sound knobs live in AUDIO.
export const FEEDBACK = {
  mining: {
    // A single tap / legacy breakTargeted() call advances mining by this many
    // seconds of held-button progress (so touch taps still chip at blocks).
    tapSeconds: 0.3,
    // Progress survives this long after the button releases, so repeated
    // taps accumulate; past it (or on target change) the cracks reset.
    tapGraceSeconds: 0.6,
    crackStages: 5, // distinct crack textures from first chip to shatter
  },
  particles: {
    poolSize: 256, // one THREE.Points holds every live particle (1 draw call)
    perBreak: 14, // particles per block break
    lifetimeSeconds: 0.55,
    speed: 3.2, // initial scatter velocity, blocks/sec
    gravity: 14, // downward acceleration, blocks/sec^2
    size: 0.12, // point size, world units
  },
  viewmodel: {
    position: [0.34, -0.3, -0.58], // camera-space anchor (bottom right)
    swingSeconds: 0.22, // one mine/attack swing arc
    useSeconds: 0.3, // one place/eat animation
    bob: { amount: 0.012, speed: 5.5 }, // idle sway
  },
  drops: {
    // Raised 32 → 64 with the Q-drop feature: oldest-drop destruction is
    // player-visible once whole stacks can be thrown on purpose.
    maxEntities: 64, // oldest drop despawns past this
    size: 0.24, // ground item cube edge, blocks
    // Spawn "pop": a short self-contained arc (NOT the physics pass — the
    // tween integrates its own gravity so drops work without it).
    pop: { horizontal: 1.6, up: 4.5, gravity: 13 },
    spinSpeed: 2.6, // radians/sec while on the ground
    pickupDelaySeconds: 0.5, // can't be vacuumed until the pop finishes
    // Thrown items (Q / Shift+Q / backdrop-drop in screens): fast enough to
    // clear magnetRadius, with a longer per-entity pickup delay covering the
    // flight — without both, a thrown item boomerangs straight back.
    throw: { speed: 6, up: 2.5, pickupDelaySeconds: 1.5 },
    magnetRadius: 1.5, // starts homing to the player within this distance
    magnetSpeed: 9, // homing speed, blocks/sec
    collectRadius: 0.6, // absorbed into the inventory at this distance
    inventoryFullRetrySeconds: 1.5, // back-off when the drop didn't fit
    despawnSeconds: 120,
  },
  consume: {
    // Bare-mode fallback (no hunger system attached): "eating" a consumable
    // restores a token half-heart. With hunger (Phase 12) food restores its
    // `food` points instead — see BlockInteraction.#consumeSelected.
    healAmount: 1,
  },
}

// Day/night cycle (Phase 10). `time` is the fraction of a full cycle:
// 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight. The clock only
// advances while the player is in control (menus pause time like they pause
// physics) and persists in the save (SaveManager.attachDayNight).
export const DAYNIGHT = {
  dayLengthSeconds: 600, // full day+night cycle (Minecraft's is 20 min)
  startTime: 0.1, // fresh worlds begin mid-morning
  // Hostile spawns are gated to this window (see MobManager); it sits just
  // inside the dusk/dawn sky transitions so mobs arrive once it's dark.
  night: { start: 0.54, end: 0.96 },
  // Sky keyframes: [time, skyColor, sunIntensity, ambientIntensity, lightColor].
  // scene.background, fog color, and both lights lerp between neighbors; the
  // first and last entries match so the cycle wraps seamlessly.
  keyframes: [
    [0.0, 0xff9e63, 0.5, 0.45, 0xffc48a], // sunrise
    [0.08, 0x87ceeb, 1.2, 0.6, 0xffffff], // morning
    [0.42, 0x87ceeb, 1.2, 0.6, 0xffffff], // afternoon
    [0.5, 0xff8a50, 0.45, 0.4, 0xffb27a], // sunset
    [0.58, 0x0b1026, 0.12, 0.22, 0x8899ff], // dusk — moonlight takes over
    [0.92, 0x0b1026, 0.12, 0.22, 0x8899ff], // deep night
    [1.0, 0xff9e63, 0.5, 0.45, 0xffc48a], // wraps back to sunrise
  ],
  sun: { distance: 150, size: 30, color: 0xffdd88 }, // billboard sprite
  moon: { distance: 150, size: 20, color: 0xdfe8ff },
  hostiles: {
    // Night population cap. By day the cap drops to COMBAT.mobs.maxCount and
    // the light gate (COMBAT.mobs.spawnLight) restricts spawns to dark cells
    // (caves, roofed rooms); keep both modest — each mob body part is a draw
    // call (see COMBAT.mobs.maxCount).
    nightMaxCount: 6,
    burnStaggerSeconds: 0.4, // dawn: one SKY-EXPOSED hostile ignites this often
    burnColor: 0xff8c3a, // ember-orange particle burst on each burn
    burnParticles: 22,
  },
  clouds: {
    count: 12, // quads per tile (geometry repeats 3x3 tiles — one draw call)
    height: 110, // cloud layer altitude (above chunkHeight, in blocks)
    tile: 220, // pattern repeat size, blocks
    speed: 1.5, // eastward drift, blocks/sec
    opacity: 0.5,
  },
}

// Sea water (Phase 10). Generation fills air at y <= level with water — a
// pure function of (seed, x, y, z) like all terrain, so border meshing and
// unloaded-chunk queries stay correct. Water is not solid: collision,
// raycasts, and mining ignore it; physics switches to the constants below
// while a body's midsection is submerged.
export const WATER = {
  level: 57, // water surface height; keep below WORLD.terrain.sandLevel so beaches ring the sea
  opacity: 0.62, // translucent chunk water pass (see Chunk buildMesh)
  surfaceDrop: 0.12, // open-air water tops render this far below the block top
  physics: {
    gravity: 6, // gentle sink, blocks/s²
    sinkSpeed: 3.2, // max sink rate (water "terminal velocity")
    drag: 4, // vertical velocity decay per second — kills dive momentum
    swimUpSpeed: 4.2, // held Space rises at this rate, blocks/s
    swimDownSpeed: 3.5, // held sneak (Shift / C) dives at this rate, blocks/s
    breachBoost: 0.85, // jump-out-of-water impulse, fraction of jumpVelocity
    moveMultiplier: 0.55, // horizontal speed factor while submerged
  },
  // Submerged fog (deep water): while the camera is underwater the scene fog
  // pulls in tight and tints toward the water color — depth feels dangerous
  // and the seabed can't be scouted from the surface. Restored to
  // GRAPHICS.fogNear/fogFar on surfacing (DayNight owns the color up there).
  fog: {
    near: 3,
    far: 16,
    color: 0x2a6fd4, // matches the water block's side color (blocks.js)
    colorBlend: 0.8, // how far fog color lerps from the sky toward `color`
  },
  // Water-visuals polish: the surface "breathes" via a slow sine on the
  // shared waterMaterial's opacity — ONE uniform write per frame, zero
  // remeshing (geometry animation is forbidden). Runs on real time like the
  // clouds, so water stays alive behind menus too.
  shimmer: {
    amplitude: 0.05, // opacity swings ± this around WATER.opacity
    periodSeconds: 4, // one full sine cycle
  },
  // Rising bubbles around the submerged player (and a puff on entry) via the
  // particle pool's per-burst gravityScale — negative = buoyant. Ambience,
  // so the emitter gates on player.isLocked like the lava pops.
  bubbles: {
    minSeconds: 0.5, // random wait between ambient emissions
    maxSeconds: 1.2,
    count: 3, // bubbles per ambient emission
    entryCount: 10, // extra rising burst on water entry (beside the spray)
    color: 0xcfe8ff,
    gravityScale: -0.28, // gentle upward acceleration (fraction of gravity)
    speed: 0.5, // initial scatter velocity — a wobble, not a pop
    lifetimeSeconds: 1.3, // longer than debris so the rise reads
    radius: 0.8, // horizontal scatter around the camera
  },
}

// Lava (lava feature): the underground hazard & light source. Generated in
// World.terrainBlock (cave cells at or below WORLD.terrain.lava.level — the
// generation knob lives THERE, this block is behavior). Like water it is not
// solid: raycasts pass through (can't be mined or targeted), collision
// ignores it, placement displaces it, and there is NO flow simulation —
// broken blocks leave air beside standing lava, exactly the sea's contract.
// Physics swaps to the viscous table below while the body midsection is in
// lava; burn timings are read via Burning.cfg (src/survival/Burning.js) so
// headless tests can shrink them (the bossFight.cfg precedent). Burn and
// after-burn damage go through health.damage() DIRECTLY — armor never
// reduces them, the codified fall/void/starve/drown environmental precedent.
export const LAVA = {
  surfaceDrop: 0.12, // open pool tops render this far below the block top
  // MC's "lava is viscous": roughly half water's speeds under heavier drag.
  // The WATER.physics sharp edge applies unchanged — drag runs AFTER the
  // owner sets velocity, so swim knobs are effectively capped by sinkSpeed.
  physics: {
    gravity: 5,
    sinkSpeed: 1.6,
    drag: 6,
    swimUpSpeed: 2.2,
    swimDownSpeed: 1.8,
    breachBoost: 0.85,
    moveMultiplier: 0.3,
  },
  // Contact burn: first tick lands the frame you enter (lava bites
  // instantly, unlike drowning's grace), then every interval. ~2 hearts/s —
  // lethal in ~5s untended, survivable if you climb out fast.
  burn: { damage: 4, intervalSeconds: 0.5 },
  // After-burn ("on fire"): keeps ticking after you climb out, extinguished
  // the moment the camera goes underwater — water pockets near lava matter.
  afterburn: { seconds: 4, damage: 1, intervalSeconds: 1 },
  // Camera-in-lava fog: near-blind, MC-authentic. Swapped by the same
  // one-flag updateUnderwater block that owns the water fog.
  fog: { near: 1, far: 5, color: 0xe2590e, colorBlend: 0.95 },
  ember: { color: 0xff8a1e, count: 14 }, // entry / burn-tick particle spits
  // Ambience: pops + ember spits while a pool's exposed surface is nearby
  // (the LavaLights registry supplies the nearest cell).
  pops: { radius: 14, minSeconds: 1, maxSeconds: 3, embers: 3 },
}

// The Nether (second dimension): a NetherWorld instance beside the overworld
// (src/world/NetherWorld.js) swapped by the dimension controller
// (src/world/Dimensions.js). Everything Nether-shaped lives here — the
// static atmosphere, the flat visibility floor, the per-world spawn profile,
// and (N2) the cavern generator's knobs.
export const NETHER = {
  skyColor: 0x1a0808, // static dark-red haze — scene background under the roof
  // Tighter than the overworld's 18/46: hides the roof, sells the scale.
  fog: { near: 12, far: 40, color: 0x1a0808 },
  lighting: {
    // Flat depth-light floor: every face under the roof renders at this
    // factor (the overworld's falloff curve would pin the whole dimension
    // at the 0.15 cave minimum). Glowstone/lava/torches carve brightness up
    // from here.
    minSkyLight: 0.35,
    ambientIntensity: 0.55,
    ambientColor: 0xffd9c8, // warm — everything reads ember-lit
  },
  // Per-world hostile spawn profile (MobManager reads it off the world).
  // The Nether's population (N5): zombified piglins in the majority, magma
  // cubes for spice. The sky term is pinned to 0 (no sky), so these spawn
  // broadly at any hour — torches, placed glowstone, and lava seas still
  // carve safe bubbles through world.lightAt.
  spawn: {
    weights: { zombified_piglin: 0.7, magma_cube: 0.3 },
    maxCount: 6,
    maxLight: 0.4, // sits above the visibility floor — darkness isn't the gate down here
  },
  // Ambience: a sparse low swell while in the dimension (the lava-pops
  // timer pattern, main.js).
  ambience: { minSeconds: 15, maxSeconds: 25 },
  // The portal (N3, src/world/Portals.js): a fixed 2×3 interior inside a
  // 4×5 obsidian ring (corners optional), lit with flint & steel. Standing
  // in the field charges the timer, then travel at 8:1 coordinate scale —
  // an existing portal within linkRadius of the scaled target links,
  // otherwise a return portal is BUILT there as ordinary edits.
  portal: {
    frameBlockId: 20, // obsidian
    blockId: 26, // the portal-field block (never meshed — registry-rendered)
    interior: { width: 2, height: 3 },
    chargeSeconds: 3, // stand in the field this long (leaving decays it)
    scale: 8, // 1 nether block = this many overworld blocks
    linkRadius: { overworld: 192, nether: 24 }, // same 8:1 ratio
    searchRadius: 24, // safe-pocket column search around the scaled target
    ledgeBlockId: { overworld: 2, nether: 21 }, // dirt / netherrack under a built frame
    panel: { color: 0x9a4dd8, opacity: 0.55 }, // the translucent field planes
    shimmer: { intervalSeconds: 0.6, color: 0xb06ae8, count: 2, radius: 24 },
  },
  // The cavern sandwich (probe-tuned — retune with `node
  // tools/probe-nether.mjs` after touching anything here): bedrock caps,
  // solid netherrack shoulders, FBM floor + ceiling relief with an open
  // band between, re-solidified by a vertically-STRETCHED 3D wall field
  // (overworld caves squash 1.7 into tunnels; 0.55 stretches walls into
  // pillars and curtains). All pure functions of (WORLD.seed, x, y, z).
  terrain: {
    bedrock: { floor: 2, roof: 94 }, // y < floor / y >= roof: unbreakable shell
    shoulders: { floor: 4, roof: 88 }, // solid netherrack outside the open band
    floor: { seedSalt: 0x6e01, base: 34, amplitude: 22, frequency: 1 / 48, octaves: 3, lacunarity: 2, gain: 0.5 },
    ceiling: { seedSalt: 0x6e02, base: 76, amplitude: 10, frequency: 1 / 64, octaves: 2, lacunarity: 2, gain: 0.5 },
    walls: { seedSalt: 0x6e03, frequency: 1 / 26, ySquash: 0.55, threshold: 0.6 },
    // Open cavern cells at or below this height flood with lava — the
    // Nether's seas, reusing the lava feature's rendering/damage wholesale.
    // Solid cells touching a sea crust into obsidian (the overworld rule).
    lava: { level: 26 },
    // Quartz ore: netherrack-body roll (first-hit like the overworld ore
    // bands) — roughly iron-abundance across a much taller band.
    quartz: { salt: 0x6e04, chance: 0.02, minY: 8, maxY: 80 },
    // Glowstone: hash-seeded teardrop clusters hanging from the ceiling
    // (the tree-canopy mirror-stamp pattern) — a lit landmark ~per chunk.
    glowstone: { salt: 0x6e05, chance: 0.004 },
    // Soul sand: floor-surface patches in low basins near the seas.
    soulSand: { salt: 0x6e06, chance: 0.28, basinAbove: 6 },
  },
}

// Hunger (Phase 12): a 10-drumstick bar (2 points each, same unit scheme as
// health) drained by time, sprinting, and mining. Health regen is gated on
// being well-fed (Health.regenGate, wired in main.js); at zero hunger the
// player starves down to a health floor but is never killed by hunger alone.
export const HUNGER = {
  max: 20,
  drainPerSecond: 1 / 25, // idle metabolism — a full bar lasts ~8 minutes
  sprintExtraPerSecond: 1 / 8, // sprinting burns roughly 4x on top of idle
  miningExtraPerSecond: 1 / 12, // held-button digging costs a bit too
  regenThreshold: 14, // health regen only at/above this many points (7 drumsticks)
  starve: {
    damage: 1, // health lost per starvation tick at zero hunger
    intervalSeconds: 4,
    minHealth: 2, // starvation stops at one heart — it weakens, never kills
  },
  fallbackFoodValue: 2, // consumables without a `food` field restore this
}

// Breath (deep water): a 10-bubble bar (2 points each, the health/hunger
// unit scheme) that drains while the CAMERA is underwater (the same cell
// test as the blue #water-tint wash, so meter and wash never disagree) and
// refills fast in air. At zero, onDrown fires on an interval — drowning
// damage is real and LETHAL (unlike starvation's floor): starvation has no
// escape action, but the surface is always the escape from drowning. It is
// dealt through health.damage() directly, so armor never reduces it (the
// fall/void/starve precedent). Breath is deliberately not saved — it resets
// full on load.
export const BREATH = {
  max: 20,
  drainPerSecond: 20 / 15, // ~15 seconds of air, MC-ish
  refillPerSecond: 8, // a breach refills fully in ~2.5 s
  drown: { damage: 2, intervalSeconds: 1.5 }, // one heart per tick at zero
}

// Passive mobs (Phase 12): pig/cow/sheep amble around, never aggro, and drop
// raw meat on death (cooked in the furnace for the farm → cook → eat loop).
// They share the mob list with zombies but have their own population cap and
// spawn cadence so hostile spawn scheduling is untouched.
export const PASSIVE_MOBS = {
  maxCount: 4, // cap on live passive mobs (each body part is a draw call)
  spawnIntervalSeconds: 8, // try to top the passive population up this often
  spawnAttempts: 6, // ring spots tried per attempt (grass columns only)
  aabb: { width: 0.7, height: 0.95 }, // collision box before per-kind scale
  wanderSpeed: 0.8, // blocks/sec while ambling
  wanderSeconds: 4, // re-roll the wander direction about this often
  panic: { seconds: 4, speedMultiplier: 2.5 }, // hit mobs bolt away briefly
  kinds: {
    pig: {
      health: 8,
      scale: 0.9,
      drop: 'raw_porkchop',
      dropCount: [1, 2],
      colors: { body: 0xe8a2a2, head: 0xefb0ac, legs: 0xd88f8f },
    },
    cow: {
      health: 10,
      scale: 1.15,
      drop: 'raw_beef',
      dropCount: [1, 2],
      // Phase 13: cows also shed leather — the leather-armor ingredient.
      extraDrop: { id: 'leather', count: [1, 2] },
      colors: { body: 0x6b4a33, head: 0x7a5640, legs: 0x54402e },
    },
    sheep: {
      health: 8,
      scale: 1.0,
      drop: 'raw_mutton',
      dropCount: [1, 2],
      // Bed feature: sheep also shed wool — the bed-crafting ingredient
      // (same extraDrop mechanism as cow leather).
      extraDrop: { id: 'wool', count: [1, 2] },
      colors: { body: 0xe8e6df, head: 0xcbb9a4, legs: 0xbfae99 },
    },
  },
}

// Sleeping in a bed (bed feature): right-clicking a placed bed at night sets
// the respawn point to the bed and skips the clock ahead to dawn; by day the
// click sets the spawn point without skipping time (modern MC behavior), and
// night sleep is refused while hostiles are within monsterRadius. The spawn
// point persists in the save's optional `spawn` key (SaveManager.attachSleep)
// and falls back to PLAYER.spawnPoint when the bed no longer exists at
// respawn time.
export const SLEEP = {
  wakeTime: 0.0, // clock time sleeping skips to (0 = sunrise; see DAYNIGHT)
  monsterRadius: 8, // hostiles within this of the bed block the night sleep
  fadeSeconds: 1.4, // full-screen fade-to-black while the night skips past
  toastSeconds: 3, // how long sleep-related toast messages linger
}

// Depth lighting (Phase 11) — the budget version, no flood-fill: chunk vertex
// colors darken with how far the face's air cell sits below its column's top
// solid block (sky light by depth), and placed torches are lit by a small
// fixed pool of real THREE point lights that tracks the nearest torches (a
// constant pool size keeps the shader program stable — no recompiles).
export const LIGHTING = {
  depth: {
    falloffBlocks: 20, // sky light fades to minSkyLight over this depth
    minSkyLight: 0.15, // floor brightness factor for unlit cave faces
  },
  torch: {
    poolSize: 6, // point lights available — the nearest N torches get one
    maxTrackDistance: 40, // torches farther than this from the camera unlight
    color: 0xffb066, // warm flame
    intensity: 40, // three r155+ physical falloff: candela-ish, decay 2
    distance: 14, // hard cutoff radius, blocks
    decay: 2,
  },
  // Lava glow (lava feature): a TorchLights-sibling pool assigned to the
  // nearest EXPOSED pool surface cells (each chunk records them while
  // building its lava mesh). `minSeparation` keeps one lake from eating the
  // whole pool on adjacent cells. `distance` doubles as the spawn-suppression
  // radius in world.lightAt — protective bubble ≡ visible glow, the torch
  // contract. `faceTint` is the mesh-time warm tint on solid faces directly
  // touching lava (radius 1, the Phase 11 no-flood-fill budget rule).
  lava: {
    poolSize: 3,
    minSeparation: 6, // skip candidates this close to an already-lit cell
    color: 0xff6a2a,
    intensity: 30,
    distance: 12,
    decay: 2,
    maxTrackDistance: 40,
    faceTint: 0xff9a4a, // vertex-color floor for pool floors/walls
  },
}

// Sound layer (Phase 9): everything is synthesized WebAudio (noise bursts and
// oscillator blips — no bundled samples), created lazily after the first user
// gesture. Per-block-material voices come from BLOCKS[id].material; the mute
// flag persists in its own localStorage key (audio preference outlives saves).
export const AUDIO = {
  storageKey: 'minecraft-clone-muted',
  masterVolume: 0.5,
  pitchVariance: 0.1, // every play is detuned ±this fraction
  footstep: {
    strideBlocks: 2.1, // one step sound per this much ground covered
    gain: 0.16,
  },
  zombie: {
    groanIntervalSeconds: 6, // one random live mob groans about this often
    hearRadius: 20, // groan volume fades to zero at this distance
  },
  // Underwater muffle (deep water): one BiquadFilter permanently in the
  // master chain (master → filter → destination); setUnderwater(true) ramps
  // its cutoff down so the WHOLE mix dulls, with zero per-play cost.
  underwater: {
    frequency: 700, // lowpass cutoff while submerged, Hz
    clearFrequency: 18000, // effectively transparent while surfaced
    rampSeconds: 0.15, // cutoff glide on enter/exit
  },
}
