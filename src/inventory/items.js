import { COMBAT, INVENTORY } from '../config.js'

// Item type registry. Items are what live in inventory slots; blocks are what
// live in the world. Placeable items carry a `blockId` (placing puts that
// block down); block drops point back here via BLOCKS[id].drop.
//
// Tools carry `tool: { kind, tier, durability }`. `durability` here is the
// item TYPE's maximum; each crafted tool tracks its remaining uses on its
// inventory stack (see Inventory.add / damageSelected). Kind + tier drive
// mining gating/speed (BlockInteraction) and attack damage (Combat).
//
// Icons: placeable items render their block's procedural atlas tile
// (Phase 13, see ui/slots.js); non-block items render a `glyph` (tinted, so
// tool tiers read at a glance).

function blockItem(id, blockId, name) {
  return { id, name, blockId, maxStack: INVENTORY.maxStack }
}

function tool(id, name, kind, tier, tint, glyph) {
  return {
    id,
    name,
    maxStack: 1,
    glyph,
    tint,
    tool: { kind, tier, durability: COMBAT.toolDurability[tier] },
  }
}

// Food (Phase 12): `consumable` makes right-click eat it (the Phase 9 use
// verb); `food` is the hunger points restored (1 drumstick = 2 points).
// Raw ◗ / cooked ◖ glyph pairs so furnace output reads at a glance.
function food(id, name, hunger, glyph, tint) {
  return { id, name, maxStack: INVENTORY.maxStack, glyph, tint, consumable: true, food: hunger }
}

// Armor (Phase 13): right-click (the use verb) wears a piece into its
// `armor.slot`, swapping out whatever was there. Equipped points sum into
// damage reduction — see src/combat/Armor.js and COMBAT.armor. `durability`
// here is the item TYPE's maximum (the tool convention): each piece tracks
// its remaining wear on its inventory stack / armor slot, ticking down one
// per reduced hit and shattering at zero.
function armor(id, name, slot, points, material, tint, glyph) {
  return {
    id,
    name,
    maxStack: 1,
    glyph,
    tint,
    armor: { slot, points, durability: COMBAT.armorDurability[material] },
  }
}

const TIER_TINT = { 1: '#a5814e', 2: '#9a9a9a', 3: '#d8dde2', 4: '#6ee3db' } // wood/stone/iron/diamond
const LEATHER_TINT = '#8a5a33'

export const ITEMS = {
  dirt: blockItem('dirt', 2, 'Dirt'),
  stone: blockItem('stone', 3, 'Stone'),
  sand: blockItem('sand', 4, 'Sand'),
  // Falling blocks feature: sand's gray gravity sibling (block 28).
  gravel: blockItem('gravel', 28, 'Gravel'),
  wood: blockItem('wood', 5, 'Wood'),
  planks: blockItem('planks', 7, 'Planks'),
  iron_ore: blockItem('iron_ore', 8, 'Iron Ore'),
  furnace: blockItem('furnace', 10, 'Furnace'),
  gold_ore: blockItem('gold_ore', 12, 'Gold Ore'),
  torch: blockItem('torch', 13, 'Torch'),
  snow: blockItem('snow', 14, 'Snow'),
  // Bed feature: sleep at night to set your respawn point (see src/survival/Sleep.js).
  bed: blockItem('bed', 15, 'Bed'),
  // Item storage (inventory overhaul): right click a placed chest to open it.
  chest: blockItem('chest', 16, 'Chest'),
  // The King's Trial reward (granted once at completion, no recipe): every
  // placed cache opens the same global store — see src/crafting/EnderStore.js.
  kings_cache: blockItem('kings_cache', 17, "King's Cache"),
  // Lava-crust block (Nether prep): mined with a diamond pickaxe only —
  // the future portal frame material.
  obsidian: blockItem('obsidian', 20, 'Obsidian'),
  // The Nether's blocks (N2): body rock (also a furnace fuel), basin sand,
  // the placeable ceiling light, and the quartz gem its ore drops.
  netherrack: blockItem('netherrack', 21, 'Netherrack'),
  soul_sand: blockItem('soul_sand', 22, 'Soul Sand'),
  glowstone: blockItem('glowstone', 23, 'Glowstone'),
  quartz: { id: 'quartz', name: 'Quartz', maxStack: INVENTORY.maxStack, glyph: '❖', tint: '#e8e4da' },
  // The quartz sink (N4): a bright decorative block for the dark dimension.
  quartz_block: blockItem('quartz_block', 27, 'Quartz Block'),
  // The End island's body rock — mined and carried home like any block.
  end_stone: blockItem('end_stone', 29, 'End Stone'),
  // The gate to the End (craftable — recipes.js): twelve laid as a flat
  // 3×3-interior ring self-activate into an End portal.
  end_portal_frame: blockItem('end_portal_frame', 30, 'End Portal Frame'),
  // Flint & steel (N3): tool kind 'igniter' matches no block, so it can't
  // mine (the bow precedent) — its whole job is lighting portal frames
  // through interaction.useItemHook. Durability wears one per ignition.
  flint_and_steel: {
    id: 'flint_and_steel',
    name: 'Flint & Steel',
    maxStack: 1,
    glyph: '⌁',
    tint: '#d8dde2',
    tool: { kind: 'igniter', tier: 1, durability: 16 },
  },
  // Sheep bonus drop — the bed-crafting ingredient.
  wool: { id: 'wool', name: 'Wool', maxStack: INVENTORY.maxStack, glyph: '❋', tint: '#e8e6df' },
  // Coal ore drop (Phase 11). The natural furnace fuel — fuel wiring into
  // the Phase 12 furnace is a follow-up.
  coal: { id: 'coal', name: 'Coal', maxStack: INVENTORY.maxStack, glyph: '◆', tint: '#3a3a3a' },
  // Diamond ore drop — the endgame tool/armor ingredient (dropped directly
  // by the ore, coal-style; diamonds never smelt).
  diamond: { id: 'diamond', name: 'Diamond', maxStack: INVENTORY.maxStack, glyph: '◇', tint: TIER_TINT[4] },
  stick: { id: 'stick', name: 'Stick', maxStack: INVENTORY.maxStack, glyph: '/', tint: '#a5814e' },
  // Zombie drop. Real food since Phase 12 (barely: it's zombie).
  rotten_flesh: {
    id: 'rotten_flesh',
    name: 'Rotten Flesh',
    maxStack: INVENTORY.maxStack,
    glyph: '♨',
    tint: '#7d8a3f',
    consumable: true,
    food: 4,
  },
  // Passive mob drops (Phase 12) — cooked in the furnace for more hunger.
  raw_porkchop: food('raw_porkchop', 'Raw Porkchop', 3, '◗', '#e8918d'),
  cooked_porkchop: food('cooked_porkchop', 'Cooked Porkchop', 8, '◖', '#b06a3a'),
  raw_beef: food('raw_beef', 'Raw Beef', 3, '◗', '#c94d3d'),
  cooked_beef: food('cooked_beef', 'Steak', 8, '◖', '#8a5228'),
  raw_mutton: food('raw_mutton', 'Raw Mutton', 3, '◗', '#d98880'),
  cooked_mutton: food('cooked_mutton', 'Cooked Mutton', 6, '◖', '#9c6030'),
  iron_ingot: {
    id: 'iron_ingot',
    name: 'Iron Ingot',
    maxStack: INVENTORY.maxStack,
    glyph: '▬',
    tint: TIER_TINT[3],
  },
  // Ranged combat (Phase 13): the bow rides the tool infrastructure (never
  // stacks, tracks durability, kind 'bow' matches no block so it can't mine).
  bow: {
    id: 'bow',
    name: 'Bow',
    maxStack: 1,
    glyph: ')',
    tint: '#a5814e',
    tool: { kind: 'bow', tier: 1, durability: 96 },
  },
  arrow: { id: 'arrow', name: 'Arrow', maxStack: INVENTORY.maxStack, glyph: '➶', tint: '#d8dde2' },
  // King's Trial stage 1: relic shards are collected by walking into them
  // (src/quest/RelicHunt.js) and consumed on delivery at the Trial Grounds.
  relic_shard: {
    id: 'relic_shard',
    name: 'Relic Shard',
    maxStack: INVENTORY.maxStack,
    glyph: '◈',
    tint: '#7fe7d0',
  },
  // King's Trial stage 4: the Hollow King's trophy — dropped on the boss
  // kill through the normal drop path. No use; it IS the point.
  kings_crown: {
    id: 'kings_crown',
    name: "King's Crown",
    maxStack: 1,
    glyph: '♛',
    tint: '#ffd75e',
  },
  // Cow bonus drop (Phase 13) — the leather armor ingredient.
  leather: { id: 'leather', name: 'Leather', maxStack: INVENTORY.maxStack, glyph: '▤', tint: LEATHER_TINT },
  // Armor sets (Phase 13). Points are MC-ish: full leather 7, full iron 15.
  leather_helmet: armor('leather_helmet', 'Leather Cap', 'head', 1, 'leather', LEATHER_TINT, '⌓'),
  leather_chestplate: armor('leather_chestplate', 'Leather Tunic', 'chest', 3, 'leather', LEATHER_TINT, '⛨'),
  leather_leggings: armor('leather_leggings', 'Leather Pants', 'legs', 2, 'leather', LEATHER_TINT, '∏'),
  leather_boots: armor('leather_boots', 'Leather Boots', 'feet', 1, 'leather', LEATHER_TINT, '⊔'),
  iron_helmet: armor('iron_helmet', 'Iron Helmet', 'head', 2, 'iron', TIER_TINT[3], '⌓'),
  iron_chestplate: armor('iron_chestplate', 'Iron Chestplate', 'chest', 6, 'iron', TIER_TINT[3], '⛨'),
  iron_leggings: armor('iron_leggings', 'Iron Leggings', 'legs', 5, 'iron', TIER_TINT[3], '∏'),
  iron_boots: armor('iron_boots', 'Iron Boots', 'feet', 2, 'iron', TIER_TINT[3], '⊔'),
  // Diamond set (top tier): full set = 20 points, which lands exactly on
  // COMBAT.armor.maxReduction (0.8) — the best protection the cap allows.
  diamond_helmet: armor('diamond_helmet', 'Diamond Helmet', 'head', 3, 'diamond', TIER_TINT[4], '⌓'),
  diamond_chestplate: armor('diamond_chestplate', 'Diamond Chestplate', 'chest', 8, 'diamond', TIER_TINT[4], '⛨'),
  diamond_leggings: armor('diamond_leggings', 'Diamond Leggings', 'legs', 6, 'diamond', TIER_TINT[4], '∏'),
  diamond_boots: armor('diamond_boots', 'Diamond Boots', 'feet', 3, 'diamond', TIER_TINT[4], '⊔'),
  wooden_pickaxe: tool('wooden_pickaxe', 'Wooden Pickaxe', 'pickaxe', 1, TIER_TINT[1], '⛏'),
  wooden_axe: tool('wooden_axe', 'Wooden Axe', 'axe', 1, TIER_TINT[1], '¬'),
  wooden_sword: tool('wooden_sword', 'Wooden Sword', 'sword', 1, TIER_TINT[1], '†'),
  stone_pickaxe: tool('stone_pickaxe', 'Stone Pickaxe', 'pickaxe', 2, TIER_TINT[2], '⛏'),
  stone_axe: tool('stone_axe', 'Stone Axe', 'axe', 2, TIER_TINT[2], '¬'),
  stone_sword: tool('stone_sword', 'Stone Sword', 'sword', 2, TIER_TINT[2], '†'),
  iron_pickaxe: tool('iron_pickaxe', 'Iron Pickaxe', 'pickaxe', 3, TIER_TINT[3], '⛏'),
  iron_axe: tool('iron_axe', 'Iron Axe', 'axe', 3, TIER_TINT[3], '¬'),
  iron_sword: tool('iron_sword', 'Iron Sword', 'sword', 3, TIER_TINT[3], '†'),
  // Diamond tools (top tier — mines everything the game gates). The shovel
  // is the kind's debut: soft blocks (grass/dirt/sand/snow) name it at
  // minTier 0, the axe-on-wood pattern — it only speeds digging.
  diamond_pickaxe: tool('diamond_pickaxe', 'Diamond Pickaxe', 'pickaxe', 4, TIER_TINT[4], '⛏'),
  diamond_axe: tool('diamond_axe', 'Diamond Axe', 'axe', 4, TIER_TINT[4], '¬'),
  diamond_sword: tool('diamond_sword', 'Diamond Sword', 'sword', 4, TIER_TINT[4], '†'),
  diamond_shovel: tool('diamond_shovel', 'Diamond Shovel', 'shovel', 4, TIER_TINT[4], '♠'),
}

