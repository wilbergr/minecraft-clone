// Block type registry. Extensible data table — later phases add fields here
// without touching the meshing or interaction code.
//
// `drop` is the inventory item id yielded when the block is broken (see
// src/inventory/items.js); null means the block drops nothing. Phase 3 picks
// drops up instantly on break — ground item entities are a later phase.
//
// Mining fields (Phase 4, consumed by BlockInteraction.breakTargeted):
// `hardness` is the base seconds between breaks while holding the mouse;
// `tool: { kind, minTier }` names the matching tool — holding one divides the
// break time by tier (COMBAT.mining.speedPerTier), and minTier > 0 means the
// block cannot be broken at all without that tool at that tier (0 = the tool
// only speeds things up). Tiers: 1 wood, 2 stone, 3 iron.

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
  },
  2: {
    id: 2,
    name: 'Dirt',
    solid: true,
    color: { top: 0x8a5f3c, side: 0x8a5f3c, bottom: 0x7a5233 },
    drop: 'dirt',
    hardness: 0.3,
  },
  3: {
    id: 3,
    name: 'Stone',
    solid: true,
    color: { top: 0x9a9a9a, side: 0x8d8d8d, bottom: 0x7f7f7f },
    drop: 'stone',
    hardness: 1.5,
    tool: { kind: 'pickaxe', minTier: 1 }, // needs any pickaxe
  },
  4: {
    id: 4,
    name: 'Sand',
    solid: true,
    color: { top: 0xdccf94, side: 0xd2c489, bottom: 0xc2b47c },
    drop: 'sand',
    hardness: 0.3,
  },
  5: {
    id: 5,
    name: 'Wood',
    solid: true,
    // Tree trunks: ringed cut faces on top/bottom, bark on the sides.
    color: { top: 0x9c7f4e, side: 0x6b4a2b, bottom: 0x9c7f4e },
    drop: 'wood',
    hardness: 1,
    tool: { kind: 'axe', minTier: 0 }, // axes chop faster; hands still work
  },
  6: {
    id: 6,
    name: 'Leaves',
    solid: true,
    color: { top: 0x3e7a2e, side: 0x437f33, bottom: 0x376b29 },
    drop: null, // decorative; sapling/stick drops could land in a later phase
    hardness: 0.1,
  },
  7: {
    id: 7,
    name: 'Planks',
    solid: true,
    color: { top: 0xb08d57, side: 0xa5814e, bottom: 0x997747 },
    drop: 'planks',
    hardness: 1,
    tool: { kind: 'axe', minTier: 0 },
  },
  8: {
    id: 8,
    name: 'Iron Ore',
    solid: true,
    // Stone flecked warmer — reads as ore without textures.
    color: { top: 0xb0a08c, side: 0xa4917c, bottom: 0x93816d },
    drop: 'iron_ore',
    hardness: 2,
    tool: { kind: 'pickaxe', minTier: 2 }, // needs stone pickaxe or better
  },
}

export function isSolid(id) {
  const block = BLOCKS[id]
  return block ? block.solid : false
}
