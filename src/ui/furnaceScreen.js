import { INVENTORY } from '../config.js'
import { ITEMS } from '../inventory/items.js'
import { FUEL_SECONDS } from '../inventory/recipes.js'
import { createSlotEl, renderSlot } from './slots.js'

// The furnace screen (Phase 12): opened by right-clicking a placed furnace
// block (BlockInteraction.useBlockHook). Shows the furnace's input / fuel /
// output slots with a flame + progress arrow, plus the full inventory grid,
// following InventoryScreen's patterns — click-click to move stacks between
// any two slots, Escape (or ✕) to close, pointer lock released while open.
//
// The furnace keeps smelting while this screen is open (main.js runs
// Furnaces.update whenever the player is locked OR this is open), so you can
// watch the arrow fill. Clicking the output slot pulls everything straight
// into the inventory; nothing can be deposited into it.
export class FurnaceScreen {
  constructor(furnaces, inventory, player) {
    this.furnaces = furnaces
    this.inventory = inventory
    this.player = player
    this.root = document.getElementById('furnace-screen')
    this.isOpen = false
    this.state = null // the Furnaces state entry being viewed
    this.pending = null // first slot of a click-click move: { where, index? }
    this.onToggle = null // callback(isOpen) — keeps the play overlay away

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
    this.pending = null
    this.root.classList.remove('hidden')
    this.player.unlock()
    this.render()
    this.onToggle?.(true)
  }

  close() {
    this.isOpen = false
    this.state = null
    this.root.classList.add('hidden')
    this.player.lock()
    this.onToggle?.(false)
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
    this.inputEl = this.#furnaceSlot('input')
    this.flame = document.createElement('div')
    this.flame.id = 'furnace-flame'
    this.flame.textContent = '🔥'
    this.fuelEl = this.#furnaceSlot('fuel')
    left.append(this.inputEl, this.flame, this.fuelEl)

    const arrow = document.createElement('div')
    arrow.id = 'furnace-arrow'
    this.arrowFill = document.createElement('div')
    this.arrowFill.id = 'furnace-arrow-fill'
    arrow.appendChild(this.arrowFill)

    this.outputEl = this.#furnaceSlot('output')
    this.outputEl.classList.add('furnace-output')

    rig.append(left, arrow, this.outputEl)
    panel.appendChild(rig)

    const hint = document.createElement('p')
    hint.className = 'inv-hint'
    hint.textContent =
      'Top slot smelts (ore, raw meat); bottom slot burns fuel (wood, planks, sticks). Tap the result to collect it.'
    panel.appendChild(hint)

    // --- The player's inventory, for moving items in and out.
    this.slotEls = new Array(this.inventory.size)
    const makeGrid = (from, to, extraClass) => {
      const grid = document.createElement('div')
      grid.className = `inv-grid${extraClass ? ` ${extraClass}` : ''}`
      for (let i = from; i < to; i++) {
        const el = createSlotEl()
        el.addEventListener('click', () => this.#onClick({ where: 'inv', index: i }))
        this.slotEls[i] = el
        grid.appendChild(el)
      }
      return grid
    }
    panel.appendChild(makeGrid(INVENTORY.hotbarSlots, this.inventory.size))
    panel.appendChild(makeGrid(0, INVENTORY.hotbarSlots, 'inv-hotbar-row'))

    this.root.appendChild(panel)
  }

  #furnaceSlot(where) {
    const el = createSlotEl()
    el.classList.add('furnace-slot')
    el.addEventListener('click', () => this.#onClick({ where }))
    return el
  }

  // --- Click-click stack moving across the inventory + furnace slots --------

  #getStack(loc) {
    return loc.where === 'inv' ? this.inventory.slots[loc.index] : this.state[loc.where]
  }

  #setStack(loc, stack) {
    if (loc.where === 'inv') {
      this.inventory.setSlot(loc.index, stack) // emits — hotbar/save stay in sync
    } else {
      this.state[loc.where] = stack
      this.furnaces.markChanged()
    }
  }

  #onClick(loc) {
    if (!this.state) return
    if (this.pending === null) {
      // Output is take-only: one click collects the whole stack.
      if (loc.where === 'output') return this.#takeOutput()
      if (this.#getStack(loc)) this.pending = loc
      return this.render()
    }

    const from = this.pending
    this.pending = null
    const sameSlot = from.where === loc.where && from.index === loc.index
    if (sameSlot || loc.where === 'output') return this.render() // deposit into output refused

    const a = this.#getStack(from)
    const b = this.#getStack(loc)
    if (!a) return this.render() // picked stack vanished (smelted away) — no-op
    if (b && b.id === a.id) {
      const moved = Math.min(a.count, ITEMS[a.id].maxStack - b.count)
      b.count += moved
      a.count -= moved
      this.#setStack(loc, b)
      this.#setStack(from, a.count > 0 ? a : null)
    } else {
      this.#setStack(from, b)
      this.#setStack(loc, a)
    }
    this.render()
  }

  #takeOutput() {
    const out = this.state.output
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
    this.inputEl.classList.toggle('pending', this.pending?.where === 'input')
    this.fuelEl.classList.toggle('pending', this.pending?.where === 'fuel')
    // Fuel slot hints when it holds something that will never burn.
    this.fuelEl.classList.toggle('invalid-fuel', !!s.fuel && !FUEL_SECONDS[s.fuel.id])

    const recipe = this.furnaces.recipeFor(s)
    const progress = recipe ? Math.min(1, s.progress / recipe.seconds) : 0
    this.arrowFill.style.width = `${Math.round(progress * 100)}%`
    const burn = s.fuelTotal > 0 ? s.fuelRemaining / s.fuelTotal : 0
    this.flame.style.opacity = s.fuelRemaining > 0 ? 0.35 + 0.65 * burn : 0.12

    this.slotEls.forEach((el, i) => {
      renderSlot(el, this.inventory.slots[i])
      el.classList.toggle('pending', this.pending?.where === 'inv' && this.pending.index === i)
    })
  }
}
