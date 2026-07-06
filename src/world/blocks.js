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
// 3 iron, 4 diamond. Hardness values are tuned so tiers read at a glance:
// stone takes ~7x as long as dirt.
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
    tool: { kind: 'shovel', minTier: 0 }, // shovels dig faster; hands still work
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
    tool: { kind: 'shovel', minTier: 0 },
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
    // `gravity` (falling blocks): when an edit leaves the cell below
    // non-solid, the block converts into a falling entity and settles on the
    // first solid surface (src/fx/FallingBlocks.js). Edit-driven only —
    // generated beaches never spontaneously collapse.
    gravity: true,
    color: { top: 0xdccf94, side: 0xd2c489, bottom: 0xc2b47c },
    tex: { top: 'sand', side: 'sand', bottom: 'sand' },
    drop: 'sand',
    hardness: 0.3,
    material: 'sand',
    tool: { kind: 'shovel', minTier: 0 },
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
    tool: { kind: 'shovel', minTier: 0 },
  },
  15: {
    id: 15,
    name: 'Bed',
    // A 1-cell bed (deliberate simplification of MC's 2-cell bed): walk-
    // through like the torch — non-solid but targetable so it can be aimed
    // at, used, and broken. `shape: 'bed'` makes the mesher emit a low
    // mattress box instead of a full cube; `interactive` routes right click
    // to the use dispatcher in main.js (sleep / set spawn).
    solid: false,
    targetable: true,
    shape: 'bed',
    interactive: true,
    color: { top: 0xb03a3a, side: 0xa5814e, bottom: 0x997747 },
    tex: { top: 'bed_top', side: 'bed_side', bottom: 'planks' },
    drop: 'bed',
    hardness: 0.4,
    material: 'wood',
  },
  16: {
    id: 16,
    name: 'Chest',
    // Item storage (inventory overhaul): a plain full cube — no custom
    // mesher shape. `interactive` routes right click to the use dispatcher
    // in main.js (opens the chest screen); contents live in
    // src/crafting/Chests.js keyed by world position, and spill as ground
    // drops when the block breaks (mined OR exploded).
    solid: true,
    interactive: true,
    color: { top: 0xa5814e, side: 0x9c7444, bottom: 0x8a6238 },
    tex: { top: 'chest_top', side: 'chest_side', bottom: 'planks' },
    drop: 'chest',
    hardness: 1,
    material: 'wood',
    tool: { kind: 'axe', minTier: 0 },
  },
  17: {
    id: 17,
    name: "King's Cache",
    // The King's Trial's tangible reward (ender-style personal chest): every
    // placed cache opens the SAME global 27-slot store (src/crafting/
    // EnderStore.js), so breaking it drops only the block — the contents
    // persist and follow the player to the next placement. `blastResistant`
    // exempts it from World.explode carving: the block is a one-time
    // completion grant with no recipe, so a creeper vaporizing it would lock
    // the store's contents away forever.
    solid: true,
    interactive: true,
    blastResistant: true,
    color: { top: 0x4a3a63, side: 0x3e3054, bottom: 0x322645 },
    tex: { top: 'kings_cache_top', side: 'kings_cache_side', bottom: 'kings_cache_bottom' },
    drop: 'kings_cache',
    hardness: 2.5,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 },
  },
  18: {
    id: 18,
    name: 'Diamond Ore',
    solid: true,
    // Stone flecked ice-cyan — the endgame prize. Drops the gem directly
    // (no smelting), like coal, and gates on an iron-or-better pickaxe.
    color: { top: 0x9ed9d4, side: 0x8fc9c4, bottom: 0x7fb5b0 },
    tex: { top: 'diamond_ore', side: 'diamond_ore', bottom: 'diamond_ore' },
    drop: 'diamond',
    hardness: 4,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 3 }, // needs an iron pickaxe or better
  },
  19: {
    id: 19,
    name: 'Lava',
    // The underground hazard (lava feature): water's flag set — swum
    // through, unminable, unraycastable — but opaque, full-bright (its mesh
    // pass uses an unlit material), and a damage source. Generated in
    // World.terrainBlock: carved cave cells at or below
    // WORLD.terrain.lava.level. No tex — the liquid passes emit no UVs;
    // `color` feeds the lava mesh pass and particles. Not obtainable, so no
    // item and no atlas tile, exactly like water.
    solid: false,
    liquid: true,
    color: { top: 0xff8a1e, side: 0xe2590e, bottom: 0xc44708 },
    drop: null,
  },
  20: {
    id: 20,
    name: 'Obsidian',
    // Nether prep: generated as a crust around lava (solid cells adjacent
    // to a pool in World.terrainBlock) and the diamond tier's signature
    // gate — ONLY a diamond pickaxe mines it, and even then slowly.
    // Blast-resistant like the King's Cache: creepers and quakes can't
    // crack a pool open through its shell.
    solid: true,
    blastResistant: true,
    color: { top: 0x241c33, side: 0x1e1729, bottom: 0x191325 },
    tex: { top: 'obsidian', side: 'obsidian', bottom: 'obsidian' },
    drop: 'obsidian',
    hardness: 8, // the slowest mine in the game (~1.6s with a diamond pick)
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 4 }, // diamond only
  },
  21: {
    id: 21,
    name: 'Netherrack',
    // The Nether's body rock: soft (mines fast, MC-authentic) but still
    // pickaxe-gated so bare hands can't tunnel the dimension.
    solid: true,
    color: { top: 0x7a3230, side: 0x6e2c2a, bottom: 0x612624 },
    tex: { top: 'netherrack', side: 'netherrack', bottom: 'netherrack' },
    drop: 'netherrack',
    hardness: 0.5,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 },
  },
  22: {
    id: 22,
    name: 'Soul Sand',
    // Basin-floor patches near the lava seas. `slow` (N4) is the generic
    // walked-on speed factor: PlayerControls and Mob.locomote multiply their
    // move speed by it when the block under the feet is this one — owner-side
    // only, PhysicsBody never reads it.
    solid: true,
    slow: 0.4,
    color: { top: 0x584434, side: 0x503d2f, bottom: 0x48372a },
    tex: { top: 'soul_sand', side: 'soul_sand', bottom: 'soul_sand' },
    drop: 'soul_sand',
    hardness: 0.4,
    material: 'sand',
    tool: { kind: 'shovel', minTier: 0 },
  },
  23: {
    id: 23,
    name: 'Glowstone',
    // Ceiling-cluster light source. `emissive` exempts its faces from depth
    // darkening (the torch rule); PLACED glowstone also registers in the
    // torch light registry (World.setBlock) so it feeds the point-light
    // pool and lightAt spawn suppression — generated clusters are visual
    // landmarks only (the registry is edit-backed).
    solid: true,
    emissive: true,
    color: { top: 0xffd98a, side: 0xf5c96e, bottom: 0xe8b855 },
    tex: { top: 'glowstone', side: 'glowstone', bottom: 'glowstone' },
    drop: 'glowstone',
    hardness: 0.3,
    material: 'stone',
  },
  24: {
    id: 24,
    name: 'Quartz Ore',
    solid: true,
    // Netherrack flecked white — drops the quartz gem directly (the
    // coal/diamond convention; quartz never smelts).
    color: { top: 0x9a6a60, side: 0x8e5f56, bottom: 0x82554c },
    tex: { top: 'quartz_ore', side: 'quartz_ore', bottom: 'quartz_ore' },
    drop: 'quartz',
    hardness: 3,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 },
  },
  25: {
    id: 25,
    name: 'Bedrock',
    // The Nether's unbreakable floor/roof shell: no void falls, no
    // roof-walking. `unbreakable` is a generic gate in BlockInteraction's
    // mining path (beside the tool-tier gate); blastResistant keeps
    // explosions honest too. Deliberately absent from the overworld — its
    // mine-to-the-void floor stays as-is.
    solid: true,
    unbreakable: true,
    blastResistant: true,
    color: { top: 0x4a4a4a, side: 0x444444, bottom: 0x3e3e3e },
    tex: { top: 'bedrock', side: 'bedrock', bottom: 'bedrock' },
    drop: null,
    hardness: Infinity,
    material: 'stone',
  },
  26: {
    id: 26,
    name: 'Nether Portal',
    // The portal field (N3): non-solid AND non-targetable — walked through,
    // never aimed at, never mined (break the obsidian frame instead), and
    // NEVER MESHED (the chunk mesher skips it like a liquid; it has no
    // tex). It renders as translucent scene panels driven by the
    // world.portals registry (src/fx/PortalPanels.js), which setBlock keeps
    // in lockstep with the edit overlay exactly like torches. No item —
    // created by flint-&-steel ignition only.
    solid: false,
    color: { top: 0x9a4dd8, side: 0x9a4dd8, bottom: 0x9a4dd8 },
    drop: null,
  },
  27: {
    id: 27,
    name: 'Quartz Block',
    // The quartz gem's sink (N4): a clean decorative building block, crafted
    // 4 quartz → 1 (see recipes.js). Purely cosmetic — the bright block in a
    // dimension of dark red rock.
    solid: true,
    color: { top: 0xe8e4da, side: 0xe0dbd0, bottom: 0xd6d0c4 },
    tex: { top: 'quartz_block', side: 'quartz_block', bottom: 'quartz_block' },
    drop: 'quartz_block',
    hardness: 1.5,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 },
  },
  28: {
    id: 28,
    name: 'Gravel',
    // Sand's gray sibling (falling blocks): the second gravity block. Not
    // generated anywhere yet — placeable/obtainable via drops only; a
    // generation pocket (MC-style underground veins) is a future follow-up.
    solid: true,
    gravity: true,
    color: { top: 0x7e7872, side: 0x767068, bottom: 0x6b655e },
    tex: { top: 'gravel', side: 'gravel', bottom: 'gravel' },
    drop: 'gravel',
    hardness: 0.4,
    material: 'sand',
    tool: { kind: 'shovel', minTier: 0 },
  },
  29: {
    id: 29,
    name: 'End Stone',
    // The End island's body rock (the End): pale speckled stone, drops
    // itself — the take-home souvenir block.
    solid: true,
    color: { top: 0xe6e2a8, side: 0xded9a0, bottom: 0xd2cd96 },
    tex: { top: 'end_stone', side: 'end_stone', bottom: 'end_stone' },
    drop: 'end_stone',
    hardness: 3,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 },
  },
  30: {
    id: 30,
    name: 'End Portal Frame',
    // The craftable gate to the End (obsidian + quartz block + diamond —
    // see recipes.js): lay twelve as a flat 3×3-interior ring and it
    // SELF-ACTIVATES (no eye-of-ender item exists — the flint-&-steel
    // "no flint" divergence precedent). Detection/collapse live in
    // src/world/EndPortal.js. Blast-resistant like obsidian; drops itself,
    // so a mis-laid ring is recoverable.
    solid: true,
    blastResistant: true,
    color: { top: 0x3a4a3e, side: 0x2e3a32, bottom: 0x27302a },
    tex: { top: 'end_frame_top', side: 'end_frame_side', bottom: 'end_frame_side' },
    drop: 'end_portal_frame',
    hardness: 4,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 3 },
  },
  31: {
    id: 31,
    name: 'End Portal',
    // The End portal field: the block-26 archetype verbatim — non-solid,
    // non-targetable, walked through, never mined (break the frame instead),
    // and NEVER MESHED (the chunk mesher skips it; no tex). Rendered as
    // horizontal translucent panels driven by the world.endPortals registry
    // (src/fx/EndPortalPanels.js), which setBlock keeps in lockstep with the
    // edit overlay exactly like nether-portal cells. No item — created by
    // ring completion only.
    solid: false,
    color: { top: 0x140a24, side: 0x140a24, bottom: 0x140a24 },
    drop: null,
  },
  32: {
    id: 32,
    name: 'Dragon Egg',
    // The Ender Dragon's trophy (the End): stamped beside the exit portal on
    // victory. A pure placeable keepsake — the King's Crown precedent says
    // trophies can just be the point. Blast-resistant so a stray creeper
    // back home can't vaporize the one copy.
    solid: true,
    blastResistant: true,
    color: { top: 0x1a0f21, side: 0x150c1c, bottom: 0x110a17 },
    tex: { top: 'dragon_egg', side: 'dragon_egg', bottom: 'dragon_egg' },
    drop: 'dragon_egg',
    hardness: 1.5,
    material: 'stone',
    tool: { kind: 'pickaxe', minTier: 1 },
  },
}

export const BLOCK_WATER = 9
export const BLOCK_FURNACE = 10
export const BLOCK_TORCH = 13
export const BLOCK_BED = 15
export const BLOCK_CHEST = 16
export const BLOCK_KINGS_CACHE = 17
export const BLOCK_LAVA = 19
export const BLOCK_OBSIDIAN = 20
export const BLOCK_NETHERRACK = 21
export const BLOCK_SOUL_SAND = 22
export const BLOCK_GLOWSTONE = 23
export const BLOCK_QUARTZ_ORE = 24
export const BLOCK_BEDROCK = 25
export const BLOCK_PORTAL = 26
export const BLOCK_GRAVEL = 28
export const BLOCK_END_STONE = 29
export const BLOCK_END_FRAME = 30
export const BLOCK_END_PORTAL = 31
export const BLOCK_DRAGON_EGG = 32

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
