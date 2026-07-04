import { CHEST, INVENTORY } from '../config.js'
import { BLOCK_CHEST } from '../world/blocks.js'
import { sortedStacks } from '../inventory/stackOps.js'
import { createSlotEl, renderSlot, bindSlotPointer, makeSortRow } from './slots.js'

// The chest screen (inventory overhaul): opened by right-clicking a placed
// chest block (the blockUseHandlers dispatcher in main.js). One 27-slot
// chest grid over the standard player grids, all moving items through the
// shared cursor-stack model (src/inventory/stackOps.js). Shift-click sends
// player stacks into the chest and chest stacks back to the inventory.
//
// Double chests are the "lite" adjacent view: when the opened chest has a
// chest block in one of its four horizontal neighbor cells, that neighbor's
// 27 slots are shown as a second, direction-labeled grid. State stays
// strictly per-block — no pairing metadata, no save re-keying; breaking one
// half spills only its own slots.

const NEIGHBORS = [
  { dx: 1, dz: 0, label: 'east' },
  { dx: -1, dz: 0, label: 'west' },
  { dx: 0, dz: 1, label: 'south' },
  { dx: 0, dz: -1, label: 'north' },
]

export class ChestScreen {
  constructor(chests, inventory, player, world, cursor = null, drops = null, camera = null, sounds = null) {
    this.chests = chests
    this.inventory = inventory
    this.player = player
    this.world = world
    this.cursor = cursor
    this.drops = drops
    this.camera = camera
    this.sounds = sounds
    this.root = document.getElementById('chest-screen')
    this.isOpen = false
    this.state = null // the opened chest's Chests state entry
    this.neighborState = null // adjacent chest's state (lite double view), or null
    this.onToggle = null // callback(isOpen) — keeps the play overlay away

    this.invAdapter = {
      size: inventory.size,
      get: (i) => inventory.slots[i],
      set: (i, stack) => inventory.setSlot(i, stack), // emits — hotbar/save stay in sync
      canAccept: () => true,
    }
    this.chestAdapter = this.#chestAdapter(() => this.state)
    this.neighborAdapter = this.#chestAdapter(() => this.neighborState)

    this.#build()
    inventory.onChange(() => {
      if (this.isOpen) this.render()
    })
    chests.onChange(() => {
      if (this.isOpen) this.render()
    })
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) this.close()
    })
  }

  #chestAdapter(getState) {
    return {
      size: CHEST.slots,
      get: (i) => getState()?.slots[i] ?? null,
      set: (i, stack) => {
        getState().slots[i] = stack
        this.chests.markChanged()
      },
      canAccept: () => true,
    }
  }

  // Open on the chest block at (x, y, z), creating its state on first use.
  openAt(x, y, z) {
    this.state = this.chests.at(x, y, z)
    // Lite double chest: show the first horizontal neighbor that is also a
    // chest. blockAt answers from the edit overlay even for unloaded chunks.
    const side = NEIGHBORS.find((n) => this.world.blockAt(x + n.dx, y, z + n.dz) === BLOCK_CHEST)
    this.neighborState = side ? this.chests.at(x + side.dx, y, z + side.dz) : null
    this.neighborLabel.textContent = side ? `Adjacent chest (${side.label})` : ''
    this.neighborLabel.classList.toggle('hidden', !side)
    this.neighborSortRow.classList.toggle('hidden', !side)
    this.neighborGrid.classList.toggle('hidden', !side)
    this.isOpen = true
    this.root.classList.remove('hidden')
    this.player.unlock()
    this.render()
    this.sounds?.play('chestOpen')
    this.onToggle?.(true)
  }

  close() {
    if (!this.isOpen) return
    this.isOpen = false
    this.cursor?.flushInto(this.inventory, this.drops, this.camera)
    this.state = null
    this.neighborState = null
    this.root.classList.add('hidden')
    this.player.lock()
    this.sounds?.play('chestClose')
    this.onToggle?.(false)
  }

  // Shift-click rules: chest → inventory; inventory → the opened chest
  // first, then the adjacent one.
  #quickTargets(where) {
    if (where === 'inv') {
      const targets = [{ adapter: this.chestAdapter, start: 0, end: CHEST.slots }]
      if (this.neighborState) {
        targets.push({ adapter: this.neighborAdapter, start: 0, end: CHEST.slots })
      }
      return targets
    }
    return [{ adapter: this.invAdapter, start: 0, end: this.inventory.size }]
  }

  #gatherAdapters() {
    const adapters = [this.invAdapter, this.chestAdapter]
    if (this.neighborState) adapters.push(this.neighborAdapter)
    return adapters
  }

  #build() {
    const panel = document.createElement('div')
    panel.id = 'chest-panel'
    panel.innerHTML =
      '<h2>Chest <button id="chest-close-btn" class="panel-close-btn" type="button" aria-label="Close">✕</button></h2>'
    panel.querySelector('#chest-close-btn').addEventListener('click', () => this.close())

    const makeGrid = (which, adapter, count, from = 0) => {
      const grid = document.createElement('div')
      grid.className = 'inv-grid'
      const els = []
      for (let i = from; i < from + count; i++) {
        const el = createSlotEl()
        bindSlotPointer(el, {
          cursor: this.cursor,
          adapter: () => (this.state ? adapter : null),
          index: i,
          quickTargets: () => this.#quickTargets(which),
          gatherAdapters: () => this.#gatherAdapters(),
        })
        els.push(el)
        grid.appendChild(el)
      }
      return { grid, els }
    }

    const sortState = (getState) => () => {
      const state = getState()
      if (!state) return
      state.slots = sortedStacks(state.slots)
      this.chests.markChanged()
    }
    panel.appendChild(makeSortRow(sortState(() => this.state)))
    const chest = makeGrid('chest', this.chestAdapter, CHEST.slots)
    this.chestEls = chest.els
    panel.appendChild(chest.grid)

    // The adjacent chest's grid (lite double view) — hidden unless openAt
    // finds a chest neighbor.
    this.neighborLabel = document.createElement('p')
    this.neighborLabel.className = 'inv-hint hidden'
    panel.appendChild(this.neighborLabel)
    this.neighborSortRow = makeSortRow(sortState(() => this.neighborState))
    this.neighborSortRow.classList.add('hidden')
    panel.appendChild(this.neighborSortRow)
    const neighbor = makeGrid('chest', this.neighborAdapter, CHEST.slots)
    this.neighborEls = neighbor.els
    this.neighborGrid = neighbor.grid
    this.neighborGrid.classList.add('hidden', 'chest-neighbor-grid')
    panel.appendChild(this.neighborGrid)

    const hint = document.createElement('p')
    hint.className = 'inv-hint'
    hint.textContent = 'Shift-click moves a stack between the chest and your inventory.'
    panel.appendChild(hint)

    // --- The player's inventory, for moving items in and out.
    this.slotEls = new Array(this.inventory.size)
    const makeInvGrid = (from, to, extraClass) => {
      const grid = document.createElement('div')
      grid.className = `inv-grid${extraClass ? ` ${extraClass}` : ''}`
      for (let i = from; i < to; i++) {
        const el = createSlotEl()
        bindSlotPointer(el, {
          cursor: this.cursor,
          adapter: () => (this.state ? this.invAdapter : null),
          index: i,
          quickTargets: () => this.#quickTargets('inv'),
          gatherAdapters: () => this.#gatherAdapters(),
        })
        this.slotEls[i] = el
        grid.appendChild(el)
      }
      return grid
    }
    panel.appendChild(makeInvGrid(INVENTORY.hotbarSlots, this.inventory.size))
    panel.appendChild(makeInvGrid(0, INVENTORY.hotbarSlots, 'inv-hotbar-row'))

    this.root.appendChild(panel)
  }

  render() {
    if (!this.state) return
    this.chestEls.forEach((el, i) => renderSlot(el, this.state.slots[i]))
    if (this.neighborState) {
      this.neighborEls.forEach((el, i) => renderSlot(el, this.neighborState.slots[i]))
    }
    this.slotEls.forEach((el, i) => renderSlot(el, this.inventory.slots[i]))
  }
}
