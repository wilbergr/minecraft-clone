// Block type registry. Extensible data table — later phases add fields here
// without touching the meshing or interaction code.
//
// `drop` is the inventory item id yielded when the block is broken (see
// src/inventory/items.js); null means the block drops nothing. Drops spawn as
// ground item entities that vacuum to the player (Phase 9, fx/GroundItems).
//
// Mining fields (Phase 4, reworked hold-to-break in Phase 9 — consumed by
// BlockInteraction): `hardness` is the seconds of held-button mining to break
// the block bare-handed; `tool: { kind, minTier }` names the matching tool —
// holding one divides the break time by tier (COMBAT.mining.speedPerTier),
// and minTier > 0 means the block cannot be broken at all without that tool
// at that tier (0 = the tool only speeds things up). Tiers: 1 wood, 2 stone,
// 3 iron. Hardness values are tuned so tiers read at a glance: stone takes
// ~7x as long as dirt.
//
// `material` (Phase 9) groups blocks into sound voices — dirt/stone/wood/sand
// — used for break/place/dig/footstep sounds (see src/audio/SoundEngine.js).

export const BLOCK_AIR = 0

export const BLOCKS = {
  [BLOCK_AIR]: { id: BLOCK_AIR, name: 'Air', solid: false, drop: null },
  1: {
    id: 1,
    name: 'Grass',
    solid: true,
    // Per-face colors: grassy top, mossy-earth sides, dirt underside.
    color: { top: 0x5d9c3f, side: 0x79893f, bottom: 0x8a5f3c },
    drop: 'dirt', // grass blocks drop dirt, like the original
    hardness: 0.3,
    material: 'dirt',
  },
  2: {
    id: 2,
    name: 'Dirt',
    solid: true,
    color: { top: 0x8a5f3c, side: 0x8a5f3c, bottom: 0x7a5233 },
    drop: 'dirt',
    hardness: 0.3,
    material: 'dirt',
  },
  3: {
    id: 3,
    name: 'Stone',
    solid: true,
    color: { top: 0x9a9a9a, side: 0x8d8d8d, bottom: 0x7f7f7f },
    drop: 'stone',
    hardness: 2, // ~7x dirt — the tier gap should be felt
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 }, // needs any pickaxe
  },
  4: {
    id: 4,
    name: 'Sand',
    solid: true,
    color: { top: 0xdccf94, side: 0xd2c489, bottom: 0xc2b47c },
    drop: 'sand',
    hardness: 0.3,
    material: 'sand',
  },
  5: {
    id: 5,
    name: 'Wood',
    solid: true,
    // Tree trunks: ringed cut faces on top/bottom, bark on the sides.
    color: { top: 0x9c7f4e, side: 0x6b4a2b, bottom: 0x9c7f4e },
    drop: 'wood',
    hardness: 1,
    material: 'wood',
    tool: { kind: 'axe', minTier: 0 }, // axes chop faster; hands still work
  },
  6: {
    id: 6,
    name: 'Leaves',
    solid: true,
    color: { top: 0x3e7a2e, side: 0x437f33, bottom: 0x376b29 },
    drop: null, // decorative; sapling/stick drops could land in a later phase
    hardness: 0.1,
    material: 'dirt', // soft rustle — closest of the four voices
  },
  7: {
    id: 7,
    name: 'Planks',
    solid: true,
    color: { top: 0xb08d57, side: 0xa5814e, bottom: 0x997747 },
    drop: 'planks',
    hardness: 1,
    material: 'wood',
    tool: { kind: 'axe', minTier: 0 },
  },
  8: {
    id: 8,
    name: 'Iron Ore',
    solid: true,
    // Stone flecked warmer — reads as ore without textures.
    color: { top: 0xb0a08c, side: 0xa4917c, bottom: 0x93816d },
    drop: 'iron_ore',
    hardness: 3,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 2 }, // needs stone pickaxe or better
  },
  9: {
    id: 9,
    name: 'Water',
    solid: false, // walked (swum) through: no collision, no raycast target
    liquid: true, // physics switches to WATER.physics while submerged in it
    color: { top: 0x3d7fdc, side: 0x2a6fd4, bottom: 0x2a6fd4 },
    drop: null, // can't be mined (raycast skips non-solid blocks anyway)
  },
  10: {
    id: 10,
    name: 'Furnace',
    solid: true,
    // Darker than stone with a charcoal top — reads as a worked block.
    color: { top: 0x4a4a4a, side: 0x5f5f5f, bottom: 0x424242 },
    drop: 'furnace',
    hardness: 2.5,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 },
    // `interactive` (Phase 12): right click / touch ▦ on this block routes to
    // BlockInteraction.useBlockHook (opens the smelting UI) instead of placing.
    interactive: true,
  },
}

export const BLOCK_WATER = 9

export function isSolid(id) {
  const block = BLOCKS[id]
  return block ? block.solid : false
}

export function isLiquid(id) {
  const block = BLOCKS[id]
  return block ? block.liquid === true : false
}
