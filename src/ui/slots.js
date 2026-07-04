import { ITEMS } from '../inventory/items.js'
import { BLOCKS } from '../world/blocks.js'
import { tileURL } from '../world/atlas.js'

// Shared slot rendering for the hotbar and the inventory screen.
//
// Placeable items draw their block's atlas tile (Phase 13) — the same pixels
// the world renders, scaled up crisply by image-rendering: pixelated. Side
// tiles read best (grass shows its overhang strip); biome-tinted grayscale
// tiles get a neutral tint baked into the icon.

// Create an empty slot element: icon layer + count badge + durability bar.
export function createSlotEl() {
  const slot = document.createElement('div')
  slot.className = 'slot'
  const icon = document.createElement('div')
  icon.className = 'slot-icon'
  const count = document.createElement('span')
  count.className = 'slot-count'
  const durability = document.createElement('div')
  durability.className = 'slot-durability'
  slot.append(icon, count, durability)
  return slot
}

// Paint an item icon into an element: placeable items get their block's
// atlas tile, other items a tinted glyph.
function renderIcon(iconEl, itemId) {
  const item = ITEMS[itemId]
  if (item.blockId !== undefined) {
    const block = BLOCKS[item.blockId]
    // Grayscale biome-tinted tiles (leaves) get a neutral green baked in;
    // side tiles already carry their own color.
    const tint = block.biomeTint === 'all' ? '#4e9e3d' : null
    iconEl.textContent = ''
    iconEl.style.background = `url(${tileURL(block.tex.side, tint)}) center / cover`
    iconEl.style.color = ''
  } else {
    iconEl.textContent = item.glyph
    iconEl.style.background = 'none'
    iconEl.style.color = item.tint
  }
}

// Fill a slot element from an inventory stack ({ id, count } or null).
export function renderSlot(slotEl, stack) {
  const [iconEl, countEl, durabilityEl] = slotEl.children
  if (!stack) {
    iconEl.textContent = ''
    iconEl.style.background = 'none'
    countEl.textContent = ''
    durabilityEl.style.display = 'none'
    slotEl.title = ''
    return
  }
  renderIcon(iconEl, stack.id)
  countEl.textContent = stack.count > 1 ? stack.count : ''
  slotEl.title = ITEMS[stack.id].name
  renderDurability(durabilityEl, stack)
}

// Damaged tools show a bar that shrinks and shifts green → red as durability
// drains; pristine tools and non-tools show nothing.
function renderDurability(el, stack) {
  const tool = ITEMS[stack.id].tool
  if (!tool || stack.durability === undefined || stack.durability >= tool.durability) {
    el.style.display = 'none'
    return
  }
  const frac = Math.max(0, stack.durability / tool.durability)
  el.style.display = 'block'
  el.style.width = `${Math.round(frac * 100)}%`
  el.style.background = `hsl(${Math.round(frac * 110)}, 75%, 48%)`
}
