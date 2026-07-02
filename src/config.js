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
  },
}

// Player movement tunables.
export const PLAYER = {
  eyeHeight: 1.7, // camera height above the ground surface, in blocks
  moveSpeed: 5, // walk speed, blocks per second
  sprintMultiplier: 1.8, // Shift-to-sprint speed factor
  damping: 12, // higher = snappier stop (velocity decay per second)
  stepSmoothing: 10, // eye-height follow rate over terrain (higher = snappier)
  reach: 5, // max distance for breaking/placing blocks, in blocks
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
