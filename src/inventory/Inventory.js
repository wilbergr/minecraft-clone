import { INVENTORY } from '../config.js'
import { ITEMS } from './items.js'

// Player inventory: a flat array of stacks ({ id, count } or null). The first
// INVENTORY.hotbarSlots slots are the hotbar; `selectedSlot` indexes into
// those and drives block placement. UI layers subscribe via onChange.
//
// Tool stacks additionally carry `durability` (remaining uses — tools never
// stack, so per-stack state is per-tool state). Using a tool goes through
// damageSelected(); at zero the tool breaks and vanishes from its slot.
//
// The whole state is plain serializable data — serialize()/deserialize() are
// the seam for the persistence phase (localStorage save/load, Phase 5).
export class Inventory {
  constructor() {
    this.size = INVENTORY.hotbarSlots * (1 + INVENTORY.mainRows)
    this.slots = new Array(this.size).fill(null)
    this.selectedSlot = 0
    this.listeners = []
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  // Item definition held in the selected hotbar slot, or null.
  get selectedItem() {
    const stack = this.slots[this.selectedSlot]
    return stack ? ITEMS[stack.id] : null
  }

  select(index) {
    if (index < 0 || index >= INVENTORY.hotbarSlots) return
    this.selectedSlot = index
    this.#emit()
  }

  // Add `count` of an item, filling existing stacks first, then empty slots
  // (hotbar first). Returns how many did NOT fit (0 = all added).
  add(itemId, count = 1) {
    const item = ITEMS[itemId]
    if (!item) return count
    let left = count
    for (let i = 0; i < this.size && left > 0; i++) {
      const stack = this.slots[i]
      if (stack && stack.id === itemId && stack.count < item.maxStack) {
        const take = Math.min(left, item.maxStack - stack.count)
        stack.count += take
        left -= take
      }
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(left, item.maxStack)
        this.slots[i] = { id: itemId, count: take }
        // Fresh tools start at full durability (tools never stack, so a new
        // stack is always a single new tool).
        if (item.tool) this.slots[i].durability = item.tool.durability
        left -= take
      }
    }
    if (left !== count) this.#emit()
    return left
  }

  countOf(itemId) {
    let total = 0
    for (const stack of this.slots) {
      if (stack && stack.id === itemId) total += stack.count
    }
    return total
  }

  // Remove `count` of an item from anywhere in the inventory. Returns false
  // (and removes nothing) if there aren't enough.
  consume(itemId, count) {
    if (this.countOf(itemId) < count) return false
    let left = count
    for (let i = 0; i < this.size && left > 0; i++) {
      const stack = this.slots[i]
      if (!stack || stack.id !== itemId) continue
      const take = Math.min(left, stack.count)
      stack.count -= take
      left -= take
      if (stack.count === 0) this.slots[i] = null
    }
    this.#emit()
    return true
  }

  // Spend one use of the selected tool; at zero durability it breaks and is
  // removed. No-op when the selected item isn't a tool. Returns true if the
  // tool broke.
  damageSelected(amount = 1) {
    const stack = this.slots[this.selectedSlot]
    if (!stack || !ITEMS[stack.id].tool) return false
    stack.durability -= amount
    const broke = stack.durability <= 0
    if (broke) this.slots[this.selectedSlot] = null
    this.#emit()
    return broke
  }

  // Remove one item from the selected hotbar stack (placement cost).
  consumeSelected() {
    const stack = this.slots[this.selectedSlot]
    if (!stack) return false
    stack.count -= 1
    if (stack.count === 0) this.slots[this.selectedSlot] = null
    this.#emit()
    return true
  }

  // Replace a slot's stack outright (Phase 12: the furnace screen moves
  // stacks between the inventory and furnace slots). `stack` is
  // { id, count, durability? } or null; listeners are notified.
  setSlot(index, stack) {
    if (index < 0 || index >= this.size) return
    this.slots[index] = stack
    this.#emit()
  }

  // Swap two slots; if both hold the same item, merge b into a instead (up
  // to max stack). Inventory-screen click interaction.
  swap(a, b) {
    if (a === b) return
    const sa = this.slots[a]
    const sb = this.slots[b]
    if (sa && sb && sa.id === sb.id) {
      const max = ITEMS[sa.id].maxStack
      const moved = Math.min(sa.count, max - sb.count)
      sb.count += moved
      sa.count -= moved
      if (sa.count === 0) this.slots[a] = null
    } else {
      this.slots[a] = sb
      this.slots[b] = sa
    }
    this.#emit()
  }

  // --- Persistence seam (Phase 5 wires this to localStorage) ---------------

  serialize() {
    return {
      slots: this.slots.map((s) => (s ? { ...s } : null)),
      selectedSlot: this.selectedSlot,
    }
  }

  deserialize(data) {
    this.slots = new Array(this.size).fill(null)
    for (let i = 0; i < this.size; i++) {
      const s = data.slots?.[i]
      if (!s || !ITEMS[s.id]) continue
      this.slots[i] = { id: s.id, count: s.count }
      const tool = ITEMS[s.id].tool
      if (tool) this.slots[i].durability = s.durability ?? tool.durability
    }
    this.selectedSlot = data.selectedSlot ?? 0
    this.#emit()
  }
}
