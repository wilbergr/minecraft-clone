import { INVENTORY } from '../config.js'
import { SMELT_RECIPES, FUEL_SECONDS } from '../inventory/recipes.js'
import { createSlotEl, renderSlot, bindSlotPointer } from './slots.js'

// The furnace screen (Phase 12): opened by right-clicking a placed furnace
// block (BlockInteraction.useBlockHook). Shows the furnace's input / fuel /
// output slots with a flame + progress arrow, plus the full inventory grid.
// Item moving is the shared cursor-stack model (inventory overhaul, see
// src/inventory/stackOps.js) — a picked stack is OUT of the furnace, so the
// tick can never smelt away a stack mid-move. Shift-click routes smeltables
// to the input slot, fuels to the fuel slot, furnace slots to the inventory.
//
// The furnace keeps smelting while this screen is open (main.js runs
// Furnaces.update whenever the player is locked OR this is open), so you can
// watch the arrow fill. Clicking the output slot pulls everything straight
// into the inventory; nothing can be deposited into it.

// Furnace adapter slot order (see #furnaceAdapter).
const FURNACE_SLOTS = ['input', 'fuel', 'output']
const OUTPUT = 2

export class FurnaceScreen {
  constructor(furnaces, inventory, player, cursor = null, drops = null, camera = null) {
    this.furnaces = furnaces
    this.inventory = inventory
    this.player = player
    this.cursor = cursor
    this.drops = drops
    this.camera = camera
    this.root = document.getElementById('furnace-screen')
    this.isOpen = false
    this.state = null // the Furnaces state entry being viewed
    this.onToggle = null // callback(isOpen) — keeps the play overlay away

    this.invAdapter = {
      size: inventory.size,
      get: (i) => inventory.slots[i],
      set: (i, stack) => inventory.setSlot(i, stack), // emits — hotbar/save stay in sync
      canAccept: () => true,
    }
    // The furnace rig as a 3-slot container: 0 input, 1 fuel, 2 output. The
    // output refuses deposits (canAccept), preserving the old rule.
    this.furnaceAdapter = {
      size: 3,
      get: (i) => this.state?.[FURNACE_SLOTS[i]] ?? null,
      set: (i, stack) => {
        this.state[FURNACE_SLOTS[i]] = stack
        this.furnaces.markChanged()
      },
      canAccept: (i) => i !== OUTPUT,
    }

    this.#build()
    inventory.onChange(() => {
      if (this.isOpen) this.render()
    })
    furnaces.onChange(() => {
      if (this.isOpen) this.render()
    })
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) this.close()
    })
  }

  // Open on the furnace block at (x, y, z), creating its state on first use.
  openAt(x, y, z) {
    this.state = this.furnaces.at(x, y, z)
    this.isOpen = true
    this.root.classList.remove('hidden')
    this.player.unlock()
    this.render()
    this.onToggle?.(true)
  }

  close() {
    this.isOpen = false
    this.cursor?.flushInto(this.inventory, this.drops, this.camera)
    this.state = null
    this.root.classList.add('hidden')
    this.player.lock()
    this.onToggle?.(false)
  }

  // Shift-click rules: furnace slot → inventory; inventory → input if the
  // item smelts, fuel slot if it burns, otherwise nothing moves.
  #quickTargets(where, index) {
    if (where === 'furnace') {
      return [{ adapter: this.invAdapter, start: 0, end: this.inventory.size }]
    }
    const stack = this.inventory.slots[index]
    if (!stack) return []
    if (SMELT_RECIPES[stack.id]) return [{ adapter: this.furnaceAdapter, start: 0, end: 1 }]
    if (FUEL_SECONDS[stack.id]) return [{ adapter: this.furnaceAdapter, start: 1, end: 2 }]
    return []
  }

  #gatherAdapters() {
    return [this.invAdapter, this.furnaceAdapter]
  }

  #build() {
    const panel = document.createElement('div')
    panel.id = 'furnace-panel'
    panel.innerHTML =
      '<h2>Furnace <button id="furnace-close-btn" class="panel-close-btn" type="button" aria-label="Close">✕</button></h2>'
    panel.querySelector('#furnace-close-btn').addEventListener('click', () => this.close())

    // --- The smelting rig: input over fuel (with the flame between), the
    // progress arrow, and the output slot.
    const rig = document.createElement('div')
    rig.id = 'furnace-rig'

    const left = document.createElement('div')
    left.id = 'furnace-left'
    this.inputEl = this.#furnaceSlot(0)
    this.flame = document.createElement('div')
    this.flame.id = 'furnace-flame'
    this.flame.textContent = '🔥'
    this.fuelEl = this.#furnaceSlot(1)
    left.append(this.inputEl, this.flame, this.fuelEl)

    const arrow = document.createElement('div')
    arrow.id = 'furnace-arrow'
    this.arrowFill = document.createElement('div')
    this.arrowFill.id = 'furnace-arrow-fill'
    arrow.appendChild(this.arrowFill)

    // Output is take-only: any press with an empty cursor collects the whole
    // stack into the inventory (the old one-click rule); a held stack can
    // never be deposited.
    this.outputEl = createSlotEl()
    this.outputEl.classList.add('furnace-slot', 'furnace-output')
    this.outputEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return
      e.preventDefault()
      if (!this.cursor?.stack) this.#takeOutput()
    })

    rig.append(left, arrow, this.outputEl)
    panel.appendChild(rig)

    const hint = document.createElement('p')
    hint.className = 'inv-hint'
    hint.textContent =
      'Top slot smelts (ore, raw meat); bottom slot burns fuel (wood, planks, sticks, coal). Shift-click routes items; tap the result to collect it.'
    panel.appendChild(hint)

    // --- The player's inventory, for moving items in and out.
    this.slotEls = new Array(this.inventory.size)
    const makeGrid = (from, to, extraClass) => {
      const grid = document.createElement('div')
      grid.className = `inv-grid${extraClass ? ` ${extraClass}` : ''}`
      for (let i = from; i < to; i++) {
        const el = createSlotEl()
        bindSlotPointer(el, {
          cursor: this.cursor,
          adapter: () => (this.state ? this.invAdapter : null),
          index: i,
          quickTargets: () => this.#quickTargets('inv', i),
          gatherAdapters: () => this.#gatherAdapters(),
        })
        this.slotEls[i] = el
        grid.appendChild(el)
      }
      return grid
    }
    panel.appendChild(makeGrid(INVENTORY.hotbarSlots, this.inventory.size))
    panel.appendChild(makeGrid(0, INVENTORY.hotbarSlots, 'inv-hotbar-row'))

    this.root.appendChild(panel)
  }

  #furnaceSlot(index) {
    const el = createSlotEl()
    el.classList.add('furnace-slot')
    bindSlotPointer(el, {
      cursor: this.cursor,
      adapter: () => (this.state ? this.furnaceAdapter : null),
      index,
      quickTargets: () => this.#quickTargets('furnace', index),
      gatherAdapters: () => this.#gatherAdapters(),
    })
    return el
  }

  #takeOutput() {
    const out = this.state?.output
    if (!out) return
    const leftover = this.inventory.add(out.id, out.count)
    this.state.output = leftover > 0 ? { ...out, count: leftover } : null
    this.furnaces.markChanged()
    this.render()
  }

  render() {
    if (!this.state) return
    const s = this.state
    renderSlot(this.inputEl, s.input)
    renderSlot(this.fuelEl, s.fuel)
    renderSlot(this.outputEl, s.output)
    // Fuel slot hints when it holds something that will never burn.
    this.fuelEl.classList.toggle('invalid-fuel', !!s.fuel && !FUEL_SECONDS[s.fuel.id])

    const recipe = this.furnaces.recipeFor(s)
    const progress = recipe ? Math.min(1, s.progress / recipe.seconds) : 0
    this.arrowFill.style.width = `${Math.round(progress * 100)}%`
    const burn = s.fuelTotal > 0 ? s.fuelRemaining / s.fuelTotal : 0
    this.flame.style.opacity = s.fuelRemaining > 0 ? 0.35 + 0.65 * burn : 0.12

    this.slotEls.forEach((el, i) => {
      renderSlot(el, this.inventory.slots[i])
    })
  }
}
