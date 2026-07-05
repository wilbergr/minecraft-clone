import { INVENTORY } from '../config.js'
import { ITEMS } from '../inventory/items.js'
import { ARMOR_SLOTS } from '../combat/Armor.js'
import { RECIPES, canCraft, craft } from '../inventory/recipes.js'
import { sortedStacks } from '../inventory/stackOps.js'
import { createSlotEl, renderSlot, bindSlotPointer, makeSortRow } from './slots.js'
import { PlayerPreview } from './playerPreview.js'

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
// Armor (Phase 13, MC-layout overhaul): the four wear slots are a real
// container adapter on the same cursor model — drag a piece in to equip,
// out to unequip, with canAccept type-checking by ITEMS[id].armor.slot
// (generic across tiers: any future armor material slots in unchanged).
// Shift-click equips from the grids and unequips back into them. The column
// sits beside a live PlayerPreview figure that mirrors what's worn, MC's
// arrangement. Right-clicking a held piece in-game still equips (the use
// verb — untouched shortcut). `armor` is optional so bare setups keep
// working.
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

    // The wear slots as a container adapter (index-matched to ARMOR_SLOTS):
    // get/set translate between inventory stacks and Armor's { id, durability }
    // pieces via Armor.setSlot (emits — HUD, save dirty flag, and this screen
    // stay in sync). canAccept is the type gate: only the piece whose
    // armor.slot matches lands; anything else stays on the cursor.
    this.armorAdapter = armor
      ? {
          size: ARMOR_SLOTS.length,
          get: (i) => {
            const piece = armor.slots[ARMOR_SLOTS[i]]
            return piece ? { id: piece.id, count: 1, durability: piece.durability } : null
          },
          set: (i, stack) => {
            armor.setSlot(
              ARMOR_SLOTS[i],
              stack
                ? { id: stack.id, durability: stack.durability ?? ITEMS[stack.id].armor.durability }
                : null,
            )
          },
          canAccept: (i, stack) => ITEMS[stack.id]?.armor?.slot === ARMOR_SLOTS[i],
        }
      : null

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
    this.preview?.start()
    this.onToggle?.(true)
  }

  close() {
    this.isOpen = false
    // A held stack can't leak: it returns to the inventory (overflow is
    // thrown at the player — see SlotCursor.flushInto).
    this.cursor?.flushInto(this.inventory, this.drops, this.camera)
    this.preview?.stop()
    this.root.classList.add('hidden')
    this.player.lock()
    this.onToggle?.(false)
  }

  // Shift-click rule here: hotbar ↔ main grid — except armor, which
  // quick-equips into its wear slot first (canAccept routes the piece; MC's
  // shift-click-to-wear).
  #quickTargets(i) {
    const targets =
      i < INVENTORY.hotbarSlots
        ? [{ adapter: this.invAdapter, start: INVENTORY.hotbarSlots, end: this.inventory.size }]
        : [{ adapter: this.invAdapter, start: 0, end: INVENTORY.hotbarSlots }]
    const stack = this.inventory.slots[i]
    if (this.armorAdapter && stack && ITEMS[stack.id]?.armor) {
      targets.unshift({ adapter: this.armorAdapter, start: 0, end: ARMOR_SLOTS.length })
    }
    return targets
  }

  // Shift-click from a wear slot: back into the grids, main grid first.
  #armorQuickTargets() {
    return [
      { adapter: this.invAdapter, start: INVENTORY.hotbarSlots, end: this.inventory.size },
      { adapter: this.invAdapter, start: 0, end: INVENTORY.hotbarSlots },
    ]
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

    // Equipped armor (MC layout): a vertical column of the four wear slots
    // beside the live player figure, above the grids — Minecraft's
    // arrangement. Each slot is a full cursor-model slot on armorAdapter:
    // drag/click pieces in and out like any other slot.
    if (this.armor) {
      const equipPane = document.createElement('div')
      equipPane.id = 'inventory-equip'
      const armorCol = document.createElement('div')
      armorCol.className = 'inv-grid inv-armor-col'
      this.armorEls = ARMOR_SLOTS.map((slot, i) => {
        const el = createSlotEl()
        el.classList.add('armor-slot', `armor-slot-${slot}`)
        bindSlotPointer(el, {
          cursor: this.cursor,
          adapter: () => this.armorAdapter,
          index: i,
          quickTargets: () => this.#armorQuickTargets(),
          gatherAdapters: () => [this.invAdapter],
        })
        armorCol.appendChild(el)
        return { slot, el }
      })
      this.preview = new PlayerPreview()
      equipPane.append(armorCol, this.preview.canvas)
      slotsCol.appendChild(equipPane)
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
      'Click picks up a stack, click again to place — right click splits or places one, Shift-click moves a stack between rows, double-click gathers. Bottom row is the hotbar. Drag armor onto the figure’s slots to wear it (Shift-click also equips).'
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
      this.armorEls.forEach(({ el }, i) => {
        const stack = this.armorAdapter.get(i)
        renderSlot(el, stack)
        el.classList.toggle('empty', !stack) // CSS draws the slot-type glyph
      })
      this.preview?.refresh(this.armor)
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
