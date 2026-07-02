// ---------------------------------------------------------------------------
// TREASURE_MESSAGE — the final message revealed at the end of the treasure
// hunt (treasure system lands in a later phase). Captain: personalize this
// text before release. Keep it a plain string; the treasure UI will render it.
// ---------------------------------------------------------------------------
export const TREASURE_MESSAGE =
  'Congratulations, adventurer! You found the hidden treasure!'

// World layout (Phase 1: flat test world).
export const WORLD = {
  // Ground is a SIZE x SIZE grid of unit blocks centered on the origin.
  size: 48,
  blockSize: 1,
  // Player can walk this far past the ground edge before being clamped.
  boundsPadding: 2,
}

// Player movement tunables.
export const PLAYER = {
  eyeHeight: 1.7, // camera height above the ground surface, in blocks
  moveSpeed: 5, // walk speed, blocks per second
  sprintMultiplier: 1.8, // Shift-to-sprint speed factor
  damping: 12, // higher = snappier stop (velocity decay per second)
}

// Rendering / atmosphere tunables.
export const GRAPHICS = {
  skyColor: 0x87ceeb,
  fogNear: 20,
  fogFar: 90,
  fov: 75,
  maxPixelRatio: 2, // cap devicePixelRatio for consistent framerate
}
