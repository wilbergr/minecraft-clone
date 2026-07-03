import { COMBAT, INVENTORY } from '../config.js'
import { BLOCKS } from '../world/blocks.js'

// Item type registry. Items are what live in inventory slots; blocks are what
// live in the world. Placeable items carry a `blockId` (placing puts that
// block down); block drops point back here via BLOCKS[id].drop.
//
// Tools carry `tool: { kind, tier, durability }`. `durability` here is the
// item TYPE's maximum; each crafted tool tracks its remaining uses on its
// inventory stack (see Inventory.add / damageSelected). Kind + tier drive
// mining gating/speed (BlockInteraction) and attack damage (Combat).
//
// Icons: placeable items render as a swatch of their block's face colors;
// non-block items render a `glyph` (tinted, so tool tiers read at a glance).

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

const TIER_TINT = { 1: '#a5814e', 2: '#9a9a9a', 3: '#d8dde2' } // wood/stone/iron

export const ITEMS = {
  dirt: blockItem('dirt', 2, 'Dirt'),
  stone: blockItem('stone', 3, 'Stone'),
  sand: blockItem('sand', 4, 'Sand'),
  wood: blockItem('wood', 5, 'Wood'),
  planks: blockItem('planks', 7, 'Planks'),
  iron_ore: blockItem('iron_ore', 8, 'Iron Ore'),
  stick: { id: 'stick', name: 'Stick', maxStack: INVENTORY.maxStack, glyph: '/', tint: '#a5814e' },
  // Zombie drop. No use yet — food/eating is a later-phase candidate.
  rotten_flesh: {
    id: 'rotten_flesh',
    name: 'Rotten Flesh',
    maxStack: INVENTORY.maxStack,
    glyph: '♨',
    tint: '#7d8a3f',
  },
  iron_ingot: {
    id: 'iron_ingot',
    name: 'Iron Ingot',
    maxStack: INVENTORY.maxStack,
    glyph: '▬',
    tint: TIER_TINT[3],
  },
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

// CSS colors for an item's swatch icon (placeable items only).
export function itemSwatch(item) {
  if (item.blockId === undefined) return null
  const { top, side } = BLOCKS[item.blockId].color
  const hex = (c) => `#${c.toString(16).padStart(6, '0')}`
  return { top: hex(top), side: hex(side) }
}
