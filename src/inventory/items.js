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
// damage reduction — see src/combat/Armor.js and COMBAT.armor.
function armor(id, name, slot, points, tint, glyph) {
  return { id, name, maxStack: 1, glyph, tint, armor: { slot, points } }
}

const TIER_TINT = { 1: '#a5814e', 2: '#9a9a9a', 3: '#d8dde2' } // wood/stone/iron
const LEATHER_TINT = '#8a5a33'

export const ITEMS = {
  dirt: blockItem('dirt', 2, 'Dirt'),
  stone: blockItem('stone', 3, 'Stone'),
  sand: blockItem('sand', 4, 'Sand'),
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
  // Sheep bonus drop — the bed-crafting ingredient.
  wool: { id: 'wool', name: 'Wool', maxStack: INVENTORY.maxStack, glyph: '❋', tint: '#e8e6df' },
  // Coal ore drop (Phase 11). The natural furnace fuel — fuel wiring into
  // the Phase 12 furnace is a follow-up.
  coal: { id: 'coal', name: 'Coal', maxStack: INVENTORY.maxStack, glyph: '◆', tint: '#3a3a3a' },
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
  // Cow bonus drop (Phase 13) — the leather armor ingredient.
  leather: { id: 'leather', name: 'Leather', maxStack: INVENTORY.maxStack, glyph: '▤', tint: LEATHER_TINT },
  // Armor sets (Phase 13). Points are MC-ish: full leather 7, full iron 15.
  leather_helmet: armor('leather_helmet', 'Leather Cap', 'head', 1, LEATHER_TINT, '⌓'),
  leather_chestplate: armor('leather_chestplate', 'Leather Tunic', 'chest', 3, LEATHER_TINT, '⛨'),
  leather_leggings: armor('leather_leggings', 'Leather Pants', 'legs', 2, LEATHER_TINT, '∏'),
  leather_boots: armor('leather_boots', 'Leather Boots', 'feet', 1, LEATHER_TINT, '⊔'),
  iron_helmet: armor('iron_helmet', 'Iron Helmet', 'head', 2, TIER_TINT[3], '⌓'),
  iron_chestplate: armor('iron_chestplate', 'Iron Chestplate', 'chest', 6, TIER_TINT[3], '⛨'),
  iron_leggings: armor('iron_leggings', 'Iron Leggings', 'legs', 5, TIER_TINT[3], '∏'),
  iron_boots: armor('iron_boots', 'Iron Boots', 'feet', 2, TIER_TINT[3], '⊔'),
  wooden_pickaxe: tool('wooden_pickaxe', 'Wooden Pickaxe', 'pickaxe', 1, TIER_TINT[1], '⛏'),
  wooden_axe: tool('wooden_axe', 'Wooden Axe', 'axe', 1, TIER_TINT[1], '¬'),
  wooden_sword: tool('wooden_sword', 'Wooden Sword', 'sword', 1, TIER_TINT[1], '†'),
  stone_pickaxe: tool('stone_pickaxe', 'Stone Pickaxe', 'pickaxe', 2, TIER_TINT[2], '⛏'),
  stone_axe: tool('stone_axe', 'Stone Axe', 'axe', 2, TIER_TINT[2], '¬'),
  stone_sword: tool('stone_sword', 'Stone Sword', 'sword', 2, TIER_TINT[2], '†'),
  iron_pickaxe: tool('iron_pickaxe', 'Iron Pickaxe', 'pickaxe', 3, TIER_TINT[3], '⛏'),
  iron_axe: tool('iron_axe', 'Iron Axe', 'axe', 3, TIER_TINT[3], '¬'),
  iron_sword: tool('iron_sword', 'Iron Sword', 'sword', 3, TIER_TINT[3], '†'),
}

