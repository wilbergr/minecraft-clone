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
  // Stage 4 — The Hollow King (PR 4, inert): the 3-phase end boss.
  boss: {
    health: 120,
    aabb: { width: 1.1, height: 2.8 },
    knockbackFactor: 0.15, // fraction of normal knockback the boss takes
    phases: [0.66, 0.33], // health fractions where phases 2 and 3 begin
    leash: { playerSeconds: 8, losSeconds: 10 }, // out-of-arena / no-line-of-sight reset timers
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
    // Ore bands (Phase 11, MC-style depth tiers): deep stone rolls against
    // each band in order — first hit wins — so overlapping bands stay cheap.
    ores: [
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
  },
}

// Inventory / hotbar layout (Phase 3).
export const INVENTORY = {
  hotbarSlots: 9, // slots in the always-visible hotbar (keys 1-9)
  mainRows: 3, // rows of 9 extra slots shown in the inventory screen
  maxStack: 64, // default max items per stack (tools override to 1)
}

// Player movement tunables.
export const PLAYER = {
  eyeHeight: 1.7, // camera height above the player's feet, in blocks
  moveSpeed: 5, // walk speed, blocks per second
  sprintMultiplier: 1.8, // Shift-to-sprint speed factor
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
    speedMultiplier: 0.3, // sneak (C) walk-speed factor
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
    swordDamage: { 1: 4, 2: 5, 3: 7 }, // by tool tier (wood/stone/iron)
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
  },
  toolDurability: { 1: 64, 2: 128, 3: 256 }, // uses per tool, by tier
  mobs: {
    maxCount: 4, // hard cap on live mobs (keep low — one draw call per part)
    spawnIntervalSeconds: 5, // try to top the population up this often
    spawnRadiusMin: 10, // spawn ring around the player, in blocks
    spawnRadiusMax: 18,
    despawnRadius: 48, // mobs farther than this from the player are removed
    // Night spawn mix (Phase 13): relative weights per hostile kind.
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
  },
}

// Persistence (Phase 5): the whole game state lives in one versioned
// localStorage key — see src/save/SaveManager.js for the schema.
export const SAVE = {
  storageKey: 'minecraft-clone-save',
  schemaVersion: 3, // bump (and migrate in SaveManager.load) when the shape changes
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
    maxEntities: 32, // oldest drop despawns past this
    size: 0.24, // ground item cube edge, blocks
    // Spawn "pop": a short self-contained arc (NOT the physics pass — the
    // tween integrates its own gravity so drops work without it).
    pop: { horizontal: 1.6, up: 4.5, gravity: 13 },
    spinSpeed: 2.6, // radians/sec while on the ground
    pickupDelaySeconds: 0.5, // can't be vacuumed until the pop finishes
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
    // Night population cap. Day spawning is off entirely; keep this modest —
    // each mob body part is a draw call (see COMBAT.mobs.maxCount).
    nightMaxCount: 6,
    burnStaggerSeconds: 0.4, // dawn: one zombie ignites this often
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
    breachBoost: 0.85, // jump-out-of-water impulse, fraction of jumpVelocity
    moveMultiplier: 0.55, // horizontal speed factor while submerged
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
// the respawn point to the bed and skips the clock ahead to dawn; by day it
// refuses, MC-style. The spawn point persists in the save's optional `spawn`
// key (SaveManager.attachSleep) and falls back to PLAYER.spawnPoint when the
// bed no longer exists at respawn time.
export const SLEEP = {
  wakeTime: 0.0, // clock time sleeping skips to (0 = sunrise; see DAYNIGHT)
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
}
