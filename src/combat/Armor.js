import { COMBAT } from '../config.js'
import { ITEMS } from '../inventory/items.js'

// Equipped armor (Phase 13): four wear slots (head/chest/legs/feet), each
// holding { id, durability } or null. Right-clicking an armor item (the
// Phase 9 use verb — see BlockInteraction.useItemHook wiring in main.js)
// wears it, swapping any piece already in that slot back into the inventory;
// clicking an equipped piece in the inventory screen takes it off.
//
// Equipped pieces sum their `armor.points`; combat damage (mob melee,
// arrows, explosions) is reduced by points × COMBAT.armor.reductionPerPoint,
// capped — fall, void, and starvation damage bypass armor entirely (they
// never route through reduce()).
//
// Durability (fidelity pack): every reduced hit ticks 1 point off each
// equipped piece (MC's per-hit wear, simplified); at zero the piece
// shatters — the optional onBreak(id) hook lets main.js play the snap.
// Durability follows the piece through equip/unequip via the
// Inventory.add(id, count, durability) third arg tools already use.
//
// UI subscribes via onChange (Inventory pattern); the slot map round-trips
// through serialize()/deserialize() for the save system (attachArmor) —
// deserialize also accepts the pre-durability shape (bare item-id strings),
// which migrates in place as full-durability pieces, no schema bump.
export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet']

export class Armor {
  constructor(inventory) {
    this.inventory = inventory
    this.slots = { head: null, chest: null, legs: null, feet: null }
    this.listeners = []
    this.onBreak = null // optional callback(itemId) — a piece just shattered
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  get points() {
    let total = 0
    for (const piece of Object.values(this.slots)) {
      if (piece) total += ITEMS[piece.id]?.armor?.points ?? 0
    }
    return total
  }

  // Incoming combat damage after armor. Never rounds a real hit to zero.
  // Reduced hits wear the armor: each equipped piece loses 1 durability
  // (computed from the points BEFORE wear, so the hit that shatters a piece
  // is still softened by it).
  reduce(amount) {
    const { reductionPerPoint, maxReduction } = COMBAT.armor
    const points = this.points
    if (points > 0 && amount > 0) this.#wear()
    const factor = 1 - Math.min(maxReduction, points * reductionPerPoint)
    return amount * factor
  }

  #wear() {
    for (const slot of ARMOR_SLOTS) {
      const piece = this.slots[slot]
      if (!piece) continue
      piece.durability -= 1
      if (piece.durability <= 0) {
        this.slots[slot] = null
        this.onBreak?.(piece.id)
      }
    }
    this.#emit()
  }

  // Wear one specific slot (the End: elytra grinds by glide TIME, not by
  // hits — PlayerControls ticks the chest once per glide.wearSeconds).
  // Shatters at zero like per-hit wear.
  wearSlot(slot, amount = 1) {
    const piece = this.slots[slot]
    if (!piece) return
    piece.durability -= amount
    if (piece.durability <= 0) {
      this.slots[slot] = null
      this.onBreak?.(piece.id)
    }
    this.#emit()
  }

  // Wear the selected hotbar item (already validated to carry `armor` by the
  // caller). The consumed piece leaves the hotbar; a displaced piece goes
  // back into the inventory with its remaining durability. Returns false
  // when nothing changed.
  equipSelected() {
    const stack = this.inventory.slots[this.inventory.selectedSlot]
    const item = stack ? ITEMS[stack.id] : null
    if (!item?.armor) return false
    const slot = item.armor.slot
    const previous = this.slots[slot]
    if (previous?.id === item.id) return false // already wearing this exact piece
    const durability = stack.durability ?? item.armor.durability
    this.inventory.consumeSelected()
    this.slots[slot] = { id: item.id, durability }
    if (previous) this.inventory.add(previous.id, 1, previous.durability)
    this.#emit()
    return true
  }

  // Direct slot write (the Inventory.setSlot convention): the ONE sanctioned
  // way for UI adapters (the inventory screen's armor slots) to put a piece
  // on or take it off — it emits, so the HUD, open screens, and the save
  // dirty flag all stay in sync. `piece` is { id, durability } or null;
  // type-checking (does this item belong in this slot?) is the caller's job
  // via ITEMS[id].armor.slot — see the armor adapter's canAccept.
  setSlot(slot, piece) {
    this.slots[slot] = piece
    this.#emit()
  }

  // Take a piece off, back into the inventory. Refused when it doesn't fit.
  unequip(slot) {
    const piece = this.slots[slot]
    if (!piece) return false
    if (this.inventory.add(piece.id, 1, piece.durability) > 0) return false // inventory full
    this.slots[slot] = null
    this.#emit()
    return true
  }

  // --- Persistence seam (SaveManager.attachArmor) ---------------------------

  serialize() {
    const out = {}
    for (const slot of ARMOR_SLOTS) {
      const piece = this.slots[slot]
      out[slot] = piece ? { ...piece } : null
    }
    return out
  }

  // Accepts both save shapes: { id, durability } (current) and the bare
  // item-id string the pre-durability saves wrote — those migrate in place
  // as full-durability pieces (no schemaVersion bump needed).
  deserialize(data) {
    for (const slot of ARMOR_SLOTS) {
      const raw = data?.[slot]
      const id = typeof raw === 'string' ? raw : raw?.id
      const item = id ? ITEMS[id] : null
      if (item?.armor?.slot === slot) {
        const durability = Number.isFinite(raw?.durability)
          ? raw.durability
          : item.armor.durability
        this.slots[slot] = { id, durability }
      } else {
        this.slots[slot] = null
      }
    }
    this.#emit()
  }
}
