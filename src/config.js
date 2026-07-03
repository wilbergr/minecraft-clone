// ---------------------------------------------------------------------------
// TREASURE_MESSAGE — the final message revealed when all three treasure
// tokens are collected. Captain: personalize this text before release. Keep
// it a plain string; the reveal overlay (src/ui/treasureReveal.js) and the
// completed quest log render it verbatim.
// ---------------------------------------------------------------------------
export const TREASURE_MESSAGE =
  'Congratulations, adventurer! You found the hidden treasure!'

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

// World layout (Phase 2: chunked procedural terrain).
export const WORLD = {
  blockSize: 1,
  seed: 1337, // terrain seed — same seed always yields the same world
  chunkSize: 16, // blocks per chunk along x and z
  chunkHeight: 48, // world height in blocks (y = 0..chunkHeight-1)
  renderDistance: 3, // chunks loaded in each direction around the player
  chunkGenBudgetPerFrame: 2, // max chunks generated+meshed per frame
  terrain: {
    baseHeight: 14, // average surface height, in blocks
    amplitude: 9, // hills rise/fall this far around baseHeight
    frequency: 1 / 56, // horizontal noise scale (smaller = wider hills)
    octaves: 4, // FBM octaves — more = more small detail
    lacunarity: 2, // frequency multiplier per octave
    gain: 0.5, // amplitude multiplier per octave
    dirtDepth: 3, // dirt layers under the grass surface before stone
    sandLevel: 11, // surfaces at or below this height are sand ("beaches")
    trees: {
      chance: 0.012, // per grass column probability of spawning a tree
      minTrunk: 4, // trunk height range, in blocks
      maxTrunk: 6,
    },
    ironOre: {
      chance: 0.05, // per stone block probability of being iron ore
      maxY: 12, // ore only spawns at or below this height
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
  },
}

// Persistence (Phase 5): the whole game state lives in one versioned
// localStorage key — see src/save/SaveManager.js for the schema.
export const SAVE = {
  storageKey: 'minecraft-clone-save',
  schemaVersion: 1, // bump (and migrate in SaveManager.load) when the shape changes
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
    // Hunger doesn't exist yet, so "eating" a consumable restores a token
    // half-heart — enough to make the use verb real. Revisit with hunger.
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
    height: 60, // cloud layer altitude (above chunkHeight, in blocks)
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
  level: 9, // water surface height; keep below WORLD.terrain.sandLevel so beaches ring the sea
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
