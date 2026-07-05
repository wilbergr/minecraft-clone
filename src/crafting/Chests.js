import { CHEST } from '../config.js'
import { ITEMS } from '../inventory/items.js'

// Placed-chest contents (inventory overhaul), a deliberate Furnaces sibling
// so every established pattern transfers: state keyed by world position,
// markChanged() as the external mutation seam, onBroken() spilling contents
// when the block goes away (mined or exploded — see the blockBreakHandlers
// map in main.js), and serialize()/deserialize() riding the optional
// `chests` save key (SaveManager.attachChests, schemaVersion stays 3).
//
// Unlike furnaces, chests have NO update() tick — they are inert storage and
// never join the main-loop tick gate. Contents are keyed by position, so
// moving a chest = break (contents spill) + carry + re-place, the accepted
// furnace precedent.
export class Chests {
  constructor() {
    this.map = new Map() // "x,y,z" -> { slots } ("N|x,y,z" in the Nether)
    this.listeners = []
    // Dimension key prefix (set by Dimensions.travel) — the Furnaces twin:
    // '' in the overworld so old saves' keys stay valid, 'N|' in the Nether.
    this.dim = ''
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  // External mutation seam: the chest screen edits slot stacks directly,
  // then calls this so saves and open UIs hear about it.
  markChanged() {
    this.#emit()
  }

  #key(x, y, z) {
    return `${this.dim}${x},${y},${z}`
  }

  // State for the chest block at (x, y, z), created empty on first access.
  at(x, y, z) {
    const key = this.#key(x, y, z)
    let state = this.map.get(key)
    if (!state) {
      state = { slots: new Array(CHEST.slots).fill(null) }
      this.map.set(key, state)
    }
    return state
  }

  // The chest block was broken: spill its contents (spill(stack) is called
  // per non-empty slot — main.js spawns ground drops) and forget the state,
  // so a chest later placed at the same spot can never inherit stale items.
  onBroken(x, y, z, spill) {
    const key = this.#key(x, y, z)
    const state = this.map.get(key)
    if (!state) return
    for (const stack of state.slots) {
      if (stack) spill?.(stack)
    }
    this.map.delete(key)
    this.#emit()
  }

  // --- Persistence seam (SaveManager.attachChests) ---------------------------

  serialize() {
    const out = {}
    for (const [key, state] of this.map) {
      if (state.slots.every((s) => !s)) continue // empty — skip
      out[key] = { slots: state.slots.map((s) => (s ? { ...s } : null)) }
    }
    return out
  }

  deserialize(data) {
    this.map = new Map()
    if (!data || typeof data !== 'object') return
    for (const [key, entry] of Object.entries(data)) {
      const slots = new Array(CHEST.slots).fill(null)
      for (let i = 0; i < CHEST.slots; i++) {
        const s = entry.slots?.[i]
        if (!s || !ITEMS[s.id] || !(s.count > 0)) continue
        slots[i] = { id: s.id, count: s.count }
        const tool = ITEMS[s.id].tool
        if (tool) slots[i].durability = s.durability ?? tool.durability
      }
      this.map.set(key, { slots })
    }
    this.#emit()
  }
}
