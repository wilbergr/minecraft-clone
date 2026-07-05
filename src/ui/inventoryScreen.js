import { INVENTORY } from '../config.js'
import { ITEMS } from '../inventory/items.js'
import { ARMOR_SLOTS } from '../combat/Armor.js'
import { RECIPES, canCraft, craft } from '../inventory/recipes.js'
import { sortedStacks } from '../inventory/stackOps.js'
import { createSlotEl, renderSlot, bindSlotPointer, makeSortRow } from './slots.js'

// The inventory screen: a full-screen overlay (E to toggle) showing every
// inventory slot plus the crafting panel. Opening releases pointer lock so
// the mouse can click slots and craft buttons; closing re-locks it.
//
// Item moving is the shared cursor-stack model (inventory overhaul): left
// click picks up / places / merges / swaps, right click splits half / places
// one, shift-click quick-transfers between hotbar and main grid, double
// click gathers — all via src/inventory/stackOps.js + the SlotCursor ghost.
// Note the crafting list counts only slotted items: a held cursor stack is
// invisible to countOf, exactly like Minecraft.
//
// Armor (Phase 13): a row of four wear slots above the grid shows what's
// equipped; clicking a worn piece takes it off (equipping happens in-game —
// right click the piece). `armor` is optional so bare setups keep working.
export class InventoryScreen {
  constructor(inventory, player, armor = null, cursor = null, drops = null, camera = null) {
    this.inventory = inventory
    this.player = player
    this.armor = armor
    this.cursor = cursor
    this.drops = drops
    this.camera = camera
    this.root = document.getElementById('inventory-screen')
    this.isOpen = false
    this.onToggle = null // callback(isOpen) — lets the play overlay stay away

    // The player-inventory container adapter (see stackOps.js). setSlot
    // emits, so the hotbar, save dirty flag, and open screens stay in sync.
    this.invAdapter = {
      size: inventory.size,
      get: (i) => inventory.slots[i],
      set: (i, stack) => inventory.setSlot(i, stack),
      canAccept: () => true,
    }

    this.#build()
    inventory.onChange(() => {
      if (this.isOpen) this.render()
    })
    armor?.onChange(() => {
      if (this.isOpen) this.render()
    })

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') {
        if (this.isOpen) this.close()
        else if (this.player.isLocked) this.open()
      } else if (e.code === 'Escape' && this.isOpen) {
        this.close()
      }
    })
  }

  // One entry point for the touch 🎒 button (keyboard stays on E/Escape).
  toggle() {
    if (this.isOpen) this.close()
    else this.open()
  }

  open() {
    this.isOpen = true
    this.root.classList.remove('hidden')
    this.player.unlock()
    this.render()
    this.onToggle?.(true)
  }

  close() {
    this.isOpen = false
    // A held stack can't leak: it returns to the inventory (overflow is
    // thrown at the player — see SlotCursor.flushInto).
    this.cursor?.flushInto(this.inventory, this.drops, this.camera)
    this.root.classList.add('hidden')
    this.player.lock()
    this.onToggle?.(false)
  }

  // Shift-click rule here: hotbar ↔ main grid.
  #quickTargets(i) {
    return i < INVENTORY.hotbarSlots
      ? [{ adapter: this.invAdapter, start: INVENTORY.hotbarSlots, end: this.inventory.size }]
      : [{ adapter: this.invAdapter, start: 0, end: INVENTORY.hotbarSlots }]
  }

  #build() {
    const panel = document.createElement('div')
    panel.id = 'inventory-panel'
    // The ✕ matters on touch (no Esc key), but is welcome on desktop too.
    panel.innerHTML =
      '<h2>Inventory <button id="inventory-close-btn" class="panel-close-btn" type="button" aria-label="Close">✕</button></h2>'
    panel
      .querySelector('#inventory-close-btn')
      .addEventListener('click', () => this.close())

    const columns = document.createElement('div')
    columns.id = 'inventory-columns'
    panel.appendChild(columns)

    // --- Slot grids: main slots on top, the hotbar row set apart below.
    const slotsCol = document.createElement('div')
    this.slotEls = new Array(this.inventory.size)

    // Equipped armor (Phase 13): a labeled 4-slot row; click to take off.
    if (this.armor) {
      const armorRow = document.createElement('div')
      armorRow.className = 'inv-grid inv-armor-row'
      this.armorEls = ARMOR_SLOTS.map((slot) => {
        const el = createSlotEl()
        el.addEventListener('click', () => {
          this.armor.unequip(slot)
        })
        armorRow.appendChild(el)
        return { slot, el }
      })
      const label = document.createElement('p')
      label.className = 'inv-hint'
      label.textContent = 'Worn armor — click a piece to take it off.'
      slotsCol.append(armorRow, label)
    }
    const makeGrid = (from, to, extraClass) => {
      const grid = document.createElement('div')
      grid.className = `inv-grid${extraClass ? ` ${extraClass}` : ''}`
      for (let i = from; i < to; i++) {
        const el = createSlotEl()
        bindSlotPointer(el, {
          cursor: this.cursor,
          adapter: () => this.invAdapter,
          index: i,
          quickTargets: () => this.#quickTargets(i),
          gatherAdapters: () => [this.invAdapter],
        })
        this.slotEls[i] = el
        grid.appendChild(el)
      }
      return grid
    }
    // Sort packs the MAIN grid only — players curate the hotbar themselves.
    slotsCol.appendChild(
      makeSortRow(() => {
        const sorted = sortedStacks(this.inventory.slots.slice(INVENTORY.hotbarSlots))
        this.inventory.setRange(INVENTORY.hotbarSlots, sorted)
      }),
    )
    slotsCol.appendChild(makeGrid(INVENTORY.hotbarSlots, this.inventory.size))
    slotsCol.appendChild(makeGrid(0, INVENTORY.hotbarSlots, 'inv-hotbar-row'))
    const hint = document.createElement('p')
    hint.className = 'inv-hint'
    hint.textContent =
      'Click picks up a stack, click again to place — right click splits or places one, Shift-click moves a stack between rows, double-click gathers. Bottom row is the hotbar.'
    slotsCol.appendChild(hint)
    columns.appendChild(slotsCol)

    // --- Crafting panel: one row per recipe in the RECIPES table.
    const crafting = document.createElement('div')
    crafting.id = 'crafting-panel'
    crafting.innerHTML = '<h3>Crafting</h3>'
    const list = document.createElement('ul')
    list.id = 'recipe-list'
    this.recipeEls = RECIPES.map((recipe) => {
      const [outId, outCount] = recipe.output
      const row = document.createElement('li')
      row.className = 'recipe'

      const iconSlot = createSlotEl()
      renderSlot(iconSlot, { id: outId, count: outCount })

      const info = document.createElement('div')
      info.className = 'recipe-info'
      const name = document.createElement('div')
      name.className = 'recipe-name'
      name.textContent =
        outCount > 1 ? `${ITEMS[outId].name} ×${outCount}` : ITEMS[outId].name
      const needs = document.createElement('div')
      needs.className = 'recipe-needs'
      const needEls = recipe.input.map(([id, count], k) => {
        const span = document.createElement('span')
        span.textContent =
          (k > 0 ? ' + ' : '') + `${count}× ${ITEMS[id].name}`
        needs.appendChild(span)
        return span
      })
      info.append(name, needs)

      const button = document.createElement('button')
      button.className = 'craft-btn'
      button.textContent = 'Craft'
      button.addEventListener('click', () => craft(this.inventory, recipe))

      row.append(iconSlot, info, button)
      list.appendChild(row)
      return { recipe, button, needEls }
    })
    crafting.appendChild(list)
    columns.appendChild(crafting)

    this.root.appendChild(panel)
  }

  render() {
    this.slotEls.forEach((el, i) => {
      renderSlot(el, this.inventory.slots[i])
    })
    if (this.armor) {
      for (const { slot, el } of this.armorEls) {
        const piece = this.armor.slots[slot]
        renderSlot(el, piece ? { id: piece.id, count: 1, durability: piece.durability } : null)
      }
    }
    for (const { recipe, button, needEls } of this.recipeEls) {
      button.disabled = !canCraft(this.inventory, recipe)
      recipe.input.forEach(([id, count], k) => {
        needEls[k].classList.toggle(
          'missing',
          this.inventory.countOf(id) < count,
        )
      })
    }
  }
}
