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
//
// Textures (Phase 13): `tex: { top, side, bottom }` names 16×16 tiles in the
// procedural atlas (src/world/atlas.js) that the chunk mesher UV-maps onto
// each face. `color` stays: it still paints particles, ground drops, the
// viewmodel, and the water pass. `biomeTint: 'top' | 'all'` marks faces whose
// atlas tile is drawn grayscale and colored at mesh time by the column's
// biome tint riding the vertex-color layer.

export const BLOCK_AIR = 0

export const BLOCKS = {
  [BLOCK_AIR]: { id: BLOCK_AIR, name: 'Air', solid: false, drop: null },
  1: {
    id: 1,
    name: 'Grass',
    solid: true,
    // Per-face colors: grassy top, mossy-earth sides, dirt underside.
    color: { top: 0x5d9c3f, side: 0x79893f, bottom: 0x8a5f3c },
    tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
    biomeTint: 'top', // grayscale grass_top tile colored per biome
    drop: 'dirt', // grass blocks drop dirt, like the original
    hardness: 0.3,
    material: 'dirt',
  },
  2: {
    id: 2,
    name: 'Dirt',
    solid: true,
    color: { top: 0x8a5f3c, side: 0x8a5f3c, bottom: 0x7a5233 },
    tex: { top: 'dirt', side: 'dirt', bottom: 'dirt' },
    drop: 'dirt',
    hardness: 0.3,
    material: 'dirt',
  },
  3: {
    id: 3,
    name: 'Stone',
    solid: true,
    color: { top: 0x9a9a9a, side: 0x8d8d8d, bottom: 0x7f7f7f },
    tex: { top: 'stone', side: 'stone', bottom: 'stone' },
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
    tex: { top: 'sand', side: 'sand', bottom: 'sand' },
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
    tex: { top: 'wood_top', side: 'wood_side', bottom: 'wood_top' },
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
    tex: { top: 'leaves', side: 'leaves', bottom: 'leaves' },
    biomeTint: 'all', // grayscale leaf tile colored per biome
    drop: null, // decorative; sapling/stick drops could land in a later phase
    hardness: 0.1,
    material: 'dirt', // soft rustle — closest of the four voices
  },
  7: {
    id: 7,
    name: 'Planks',
    solid: true,
    color: { top: 0xb08d57, side: 0xa5814e, bottom: 0x997747 },
    tex: { top: 'planks', side: 'planks', bottom: 'planks' },
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
    tex: { top: 'iron_ore', side: 'iron_ore', bottom: 'iron_ore' },
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
    tex: { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top' },
    drop: 'furnace',
    hardness: 2.5,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 },
    // `interactive` (Phase 12): right click / touch ▦ on this block routes to
    // BlockInteraction.useBlockHook (opens the smelting UI) instead of placing.
    interactive: true,
  },
  11: {
    id: 11,
    name: 'Coal Ore',
    solid: true,
    // Stone flecked darker — soot-black seams.
    color: { top: 0x6e6e6e, side: 0x606060, bottom: 0x555555 },
    tex: { top: 'coal_ore', side: 'coal_ore', bottom: 'coal_ore' },
    drop: 'coal', // drops the fuel item directly, like the original
    hardness: 2.5,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 }, // any pickaxe
  },
  12: {
    id: 12,
    name: 'Gold Ore',
    solid: true,
    // Stone flecked warm yellow — the deep-tier prize.
    color: { top: 0xc9b458, side: 0xb8a24b, bottom: 0xa38f3e },
    tex: { top: 'gold_ore', side: 'gold_ore', bottom: 'gold_ore' },
    drop: 'gold_ore',
    hardness: 3.5,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 3 }, // needs an iron pickaxe
  },
  13: {
    id: 13,
    name: 'Torch',
    solid: false, // walk-through — it doesn't fill its cell
    // `targetable` (Phase 11) lets the raycast stop on a non-solid block so
    // torches can be aimed at and broken; `shape: 'torch'` makes the mesher
    // emit a small post instead of a full cube, and `emissive` exempts it
    // from depth darkening (the torch is the thing making the light).
    targetable: true,
    shape: 'torch',
    emissive: true,
    color: { top: 0xffe9a8, side: 0xc98d4b, bottom: 0x8a5f3c },
    tex: { top: 'torch', side: 'torch', bottom: 'torch' },
    drop: 'torch',
    hardness: 0.1,
    material: 'wood',
  },
  14: {
    id: 14,
    name: 'Snow',
    solid: true,
    // Snow biome surface block (Phase 13): white cap over a dirt body.
    color: { top: 0xf2f5f7, side: 0xd8ddd0, bottom: 0x8a5f3c },
    tex: { top: 'snow', side: 'snow_side', bottom: 'dirt' },
    drop: 'snow',
    hardness: 0.3,
    material: 'dirt',
  },
}

export const BLOCK_WATER = 9
export const BLOCK_TORCH = 13

export function isSolid(id) {
  const block = BLOCKS[id]
  return block ? block.solid : false
}

// Solid blocks plus non-solid ones flagged `targetable` (torches): what the
// block-interaction raycast is allowed to stop on (Phase 11).
export function isTargetable(id) {
  const block = BLOCKS[id]
  return block ? block.solid || block.targetable === true : false
}

export function isLiquid(id) {
  const block = BLOCKS[id]
  return block ? block.liquid === true : false
}
