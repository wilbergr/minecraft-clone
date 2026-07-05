import { ITEMS } from '../inventory/items.js'
import { SMELT_RECIPES, FUEL_SECONDS } from '../inventory/recipes.js'

// How fast interrupted smelt progress unwinds (no fuel / input removed):
// twice as fast as it accumulated, like Minecraft.
const PROGRESS_DECAY = 2

// Furnace simulation (Phase 12). Every placed furnace block gets a state
// entry keyed by its world position:
//
//   { input, fuel, output,   // stacks ({ id, count } or null)
//     progress,              // seconds into the current smelt
//     fuelRemaining, fuelTotal }  // burn seconds left / of the last item lit
//
// update(delta) runs from the main loop while the player is in control OR
// the furnace UI is open (so you can watch it work), matching how the rest
// of the game pauses in menus. A furnace lights by consuming one fuel item
// (FUEL_SECONDS) whenever it has something smeltable and no flame; a lit
// flame keeps burning even if the input empties, MC-style.
//
// The whole map round-trips through serialize()/deserialize() via
// SaveManager.attachFurnaces. Breaking a furnace block calls onBroken so its
// contents spill as ground drops instead of vanishing.
export class Furnaces {
  constructor() {
    this.map = new Map() // "x,y,z" -> state ("N|x,y,z" in the Nether)
    this.listeners = []
    // Dimension key prefix (set by Dimensions.travel): '' in the overworld —
    // old saves' keys stay valid — 'N|' in the Nether, so a Nether furnace
    // never shares state with an overworld one at the same coordinates.
    this.dim = ''
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  // External mutation seam: the furnace screen edits slot stacks directly,
  // then calls this so saves and open UIs hear about it.
  markChanged() {
    this.#emit()
  }

  #key(x, y, z) {
    return `${this.dim}${x},${y},${z}`
  }

  // State for the furnace block at (x, y, z), created empty on first access.
  at(x, y, z) {
    const key = this.#key(x, y, z)
    let state = this.map.get(key)
    if (!state) {
      state = {
        input: null,
        fuel: null,
        output: null,
        progress: 0,
        progressId: null, // input id the progress belongs to — swap resets it
        fuelRemaining: 0,
        fuelTotal: 0,
      }
      this.map.set(key, state)
    }
    return state
  }

  // Smelt recipe for a state's current input, or null.
  recipeFor(state) {
    return state.input ? (SMELT_RECIPES[state.input.id] ?? null) : null
  }

  update(delta) {
    let changed = false
    for (const state of this.map.values()) {
      // Swapping the input mid-smelt restarts progress for the new item.
      const inputId = state.input?.id ?? null
      if (state.progressId !== inputId) {
        state.progressId = inputId
        if (state.progress > 0) changed = true
        state.progress = 0
      }

      const recipe = this.recipeFor(state)
      const canSmelt =
        recipe &&
        (!state.output ||
          (state.output.id === recipe.output &&
            state.output.count < ITEMS[recipe.output].maxStack))

      // Light the flame: consume one fuel item only when there's work to do.
      if (state.fuelRemaining <= 0 && canSmelt && state.fuel && FUEL_SECONDS[state.fuel.id]) {
        state.fuelTotal = state.fuelRemaining = FUEL_SECONDS[state.fuel.id]
        state.fuel.count -= 1
        if (state.fuel.count <= 0) state.fuel = null
        changed = true
      }

      if (state.fuelRemaining > 0) {
        state.fuelRemaining = Math.max(0, state.fuelRemaining - delta)
        changed = true
        if (canSmelt) {
          state.progress += delta
          if (state.progress >= recipe.seconds) {
            state.progress = 0
            state.input.count -= 1
            if (state.input.count <= 0) state.input = null
            if (state.output) state.output.count += 1
            else state.output = { id: recipe.output, count: 1 }
          }
          continue
        }
      }
      // Not smelting: unfinished progress unwinds instead of persisting forever.
      if (state.progress > 0) {
        state.progress = Math.max(0, state.progress - delta * PROGRESS_DECAY)
        changed = true
      }
    }
    if (changed) this.#emit()
  }

  // The furnace block was broken: spill its contents (spill(stack) is called
  // per non-empty slot — main.js spawns ground drops) and forget the state.
  onBroken(x, y, z, spill) {
    const key = this.#key(x, y, z)
    const state = this.map.get(key)
    if (!state) return
    for (const stack of [state.input, state.fuel, state.output]) {
      if (stack) spill?.(stack)
    }
    this.map.delete(key)
    this.#emit()
  }

  // --- Persistence seam (SaveManager.attachFurnaces) -------------------------

  serialize() {
    const out = {}
    for (const [key, s] of this.map) {
      if (!s.input && !s.fuel && !s.output && s.fuelRemaining <= 0) continue // empty — skip
      out[key] = {
        input: s.input,
        fuel: s.fuel,
        output: s.output,
        progress: s.progress,
        fuelRemaining: s.fuelRemaining,
        fuelTotal: s.fuelTotal,
      }
    }
    return out
  }

  deserialize(data) {
    this.map = new Map()
    if (!data || typeof data !== 'object') return
    const stack = (s) => (s && ITEMS[s.id] && s.count > 0 ? { ...s } : null)
    for (const [key, s] of Object.entries(data)) {
      const input = stack(s.input)
      this.map.set(key, {
        input,
        fuel: stack(s.fuel),
        output: stack(s.output),
        progress: Number(s.progress) || 0,
        progressId: input?.id ?? null,
        fuelRemaining: Number(s.fuelRemaining) || 0,
        fuelTotal: Number(s.fuelTotal) || 0,
      })
    }
    this.#emit()
  }
}
