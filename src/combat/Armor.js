import { COMBAT } from '../config.js'
import { ITEMS } from '../inventory/items.js'

// Equipped armor (Phase 13): four wear slots (head/chest/legs/feet) holding
// item ids. Right-clicking an armor item (the Phase 9 use verb — see
// BlockInteraction.useItemHook wiring in main.js) wears it, swapping any
// piece already in that slot back into the inventory; clicking an equipped
// piece in the inventory screen takes it off.
//
// Equipped pieces sum their `armor.points`; combat damage (mob melee,
// arrows, explosions) is reduced by points × COMBAT.armor.reductionPerPoint,
// capped — fall, void, and starvation damage bypass armor entirely (they
// never route through reduce()).
//
// UI subscribes via onChange (Inventory pattern); the slot map round-trips
// through serialize()/deserialize() for the save system (attachArmor).
export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet']

export class Armor {
  constructor(inventory) {
    this.inventory = inventory
    this.slots = { head: null, chest: null, legs: null, feet: null }
    this.listeners = []
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  get points() {
    let total = 0
    for (const id of Object.values(this.slots)) {
      if (id) total += ITEMS[id]?.armor?.points ?? 0
    }
    return total
  }

  // Incoming combat damage after armor. Never rounds a real hit to zero.
  reduce(amount) {
    const { reductionPerPoint, maxReduction } = COMBAT.armor
    const factor = 1 - Math.min(maxReduction, this.points * reductionPerPoint)
    return amount * factor
  }

  // Wear the selected hotbar item (already validated to carry `armor` by the
  // caller). The consumed piece leaves the hotbar; a displaced piece goes
  // back into the inventory. Returns false when nothing changed.
  equipSelected() {
    const stack = this.inventory.slots[this.inventory.selectedSlot]
    const item = stack ? ITEMS[stack.id] : null
    if (!item?.armor) return false
    const slot = item.armor.slot
    const previous = this.slots[slot]
    if (previous === item.id) return false // already wearing this exact piece
    this.inventory.consumeSelected()
    this.slots[slot] = item.id
    if (previous) this.inventory.add(previous, 1)
    this.#emit()
    return true
  }

  // Take a piece off, back into the inventory. Refused when it doesn't fit.
  unequip(slot) {
    const id = this.slots[slot]
    if (!id) return false
    if (this.inventory.add(id, 1) > 0) return false // inventory full
    this.slots[slot] = null
    this.#emit()
    return true
  }

  // --- Persistence seam (SaveManager.attachArmor) ---------------------------

  serialize() {
    return { ...this.slots }
  }

  deserialize(data) {
    for (const slot of ARMOR_SLOTS) {
      const id = data?.[slot]
      this.slots[slot] = id && ITEMS[id]?.armor?.slot === slot ? id : null
    }
    this.#emit()
  }
}
