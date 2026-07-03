// ---------------------------------------------------------------------------
// TREASURE_MESSAGE — the final message revealed at the end of the treasure
// hunt (treasure system lands in a later phase). Captain: personalize this
// text before release. Keep it a plain string; the treasure UI will render it.
// ---------------------------------------------------------------------------
export const TREASURE_MESSAGE =
  'Congratulations, adventurer! You found the hidden treasure!'

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
  eyeHeight: 1.7, // camera height above the ground surface, in blocks
  moveSpeed: 5, // walk speed, blocks per second
  sprintMultiplier: 1.8, // Shift-to-sprint speed factor
  damping: 12, // higher = snappier stop (velocity decay per second)
  stepSmoothing: 10, // eye-height follow rate over terrain (higher = snappier)
  reach: 5, // max distance for breaking/placing blocks, in blocks
  spawnPoint: { x: 0.5, z: 8.5 }, // initial spawn AND respawn-on-death column
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
