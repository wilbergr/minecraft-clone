import { ITEMS } from '../inventory/items.js'
import { BLOCKS } from '../world/blocks.js'
import { tileURL } from '../world/atlas.js'
import { leftClick, rightClick, quickMove, gather } from '../inventory/stackOps.js'

// Shared slot rendering for the hotbar and the inventory screen.
//
// Placeable items draw their block's atlas tile (Phase 13) — the same pixels
// the world renders, scaled up crisply by image-rendering: pixelated. Side
// tiles read best (grass shows its overhang strip); biome-tinted grayscale
// tiles get a neutral tint baked into the icon.
//
// The inventory overhaul added two more shared pieces: bindSlotPointer wires
// a slot element to the cursor-stack ops (stackOps.js) with one set of click
// semantics for every screen, and bindSlotTooltips runs one styled hover
// tooltip for every slot in the document.

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

// Fill a slot element from an inventory stack ({ id, count } or null). The
// stack is stashed on the element for the shared hover tooltip.
export function renderSlot(slotEl, stack) {
  const [iconEl, countEl, durabilityEl] = slotEl.children
  slotEl._stack = stack ?? null
  if (!stack) {
    iconEl.textContent = ''
    iconEl.style.background = 'none'
    countEl.textContent = ''
    durabilityEl.style.display = 'none'
    return
  }
  renderIcon(iconEl, stack.id)
  countEl.textContent = stack.count > 1 ? stack.count : ''
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

// A right-aligned "Sort" button row for a container grid (the main
// inventory grid and chest grids — never the hotbar, players curate that).
export function makeSortRow(onSort) {
  const row = document.createElement('div')
  row.className = 'sort-row'
  const button = document.createElement('button')
  button.className = 'craft-btn sort-btn'
  button.type = 'button'
  button.textContent = 'Sort'
  button.addEventListener('click', onSort)
  row.appendChild(button)
  return row
}

// --- Cursor-model slot interaction (inventory overhaul) ----------------------
// One binder shared by every screen grid. `ctx`:
//   cursor            the shared SlotCursor
//   adapter()         container adapter owning this slot (null → ignore)
//   index             slot index within the adapter
//   quickTargets()    ordered [{ adapter, start, end }] for shift-click
//   gatherAdapters()  adapters swept by double-click gather
//
// Click-and-drag and click-move-click are the same mechanic: pointerdown
// picks up (marking the drag origin), pointerup over a DIFFERENT slot places
// — release on the origin slot is just a click and the stack stays held.

const DOUBLE_CLICK_SECONDS = 0.4
let dragOrigin = null // slot element the current press picked up from

export function bindSlotPointer(el, ctx) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return
    e.preventDefault()
    const adapter = ctx.adapter()
    if (!adapter) return
    if (e.button === 2) {
      // A split (right click) never begins a double-click: a fast
      // right-then-left on the same slot must not read as a gather.
      el._lastDownAt = -Infinity
      if (rightClick(ctx.cursor, adapter, ctx.index) === 'picked') dragOrigin = el
      return
    }
    const now = performance.now() / 1000
    const doubled = now - (el._lastDownAt ?? -Infinity) < DOUBLE_CLICK_SECONDS
    el._lastDownAt = now
    if (e.shiftKey) {
      quickMove(adapter, ctx.index, ctx.quickTargets())
    } else if (doubled && ctx.cursor.stack) {
      gather(ctx.cursor, ctx.gatherAdapters())
    } else if (leftClick(ctx.cursor, adapter, ctx.index) === 'picked') {
      dragOrigin = el
    }
  })
  el.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !dragOrigin || dragOrigin === el || !ctx.cursor.stack) return
    const adapter = ctx.adapter()
    if (adapter) leftClick(ctx.cursor, adapter, ctx.index) // drag release places here
  })
}

// Element handlers run before this document-level listener (bubble order),
// so a drag-release place lands first.
if (typeof document !== 'undefined') {
  document.addEventListener('pointerup', () => (dragOrigin = null))
}

// --- Hover tooltips -----------------------------------------------------------
// One fixed-position element for every slot in the document (screens have no
// pointer lock, so hover works). Shows name, count, and a contextual line
// (durability / food / armor). Skipped in touch mode — there is no hover.

export function bindSlotTooltips() {
  if (document.getElementById('slot-tooltip')) return
  const tip = document.createElement('div')
  tip.id = 'slot-tooltip'
  tip.classList.add('hidden')
  document.body.appendChild(tip)
  const hide = () => tip.classList.add('hidden')
  const position = (e) => {
    tip.style.transform = `translate3d(${e.clientX + 14}px, ${e.clientY + 18}px, 0)`
  }
  document.addEventListener('pointerover', (e) => {
    const stack = e.target.closest?.('.slot')?._stack
    if (!stack || document.body.classList.contains('touch-mode')) return hide()
    const item = ITEMS[stack.id]
    let detail = ''
    if (item.tool && item.tool.durability && stack.durability !== undefined) {
      detail = `${stack.durability} / ${item.tool.durability} durability`
    } else if (item.consumable && item.food) {
      detail = `+${item.food} food`
    } else if (item.armor) {
      detail = `+${item.armor.points} armor`
    }
    tip.textContent = ''
    const name = document.createElement('div')
    name.className = 'tooltip-name'
    name.textContent = stack.count > 1 ? `${item.name} ×${stack.count}` : item.name
    tip.appendChild(name)
    if (detail) {
      const line = document.createElement('div')
      line.className = 'tooltip-detail'
      line.textContent = detail
      tip.appendChild(line)
    }
    tip.classList.remove('hidden')
    position(e)
  })
  document.addEventListener('pointermove', (e) => {
    if (!tip.classList.contains('hidden')) position(e)
  })
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest?.('.slot')) hide()
  })
  // The hovered slot's contents just changed hands — don't tooltip stale data.
  document.addEventListener('pointerdown', hide)
}
