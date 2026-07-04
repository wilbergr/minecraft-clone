import { CHEST } from '../config.js'
import { ITEMS } from '../inventory/items.js'

// The King's Cache backing store (the report's §5.7 "ender-style personal
// chest"): ONE global 27-slot container shared by every placed King's Cache
// block — deliberately NOT keyed by position like Chests, because the whole
// point is that the contents follow the player. Breaking a cache block drops
// only the block item; the contents persist here untouched.
//
// A Chests sibling in shape (markChanged as the external mutation seam,
// serialize/deserialize riding the optional `enderChest` save key via
// SaveManager.attachEnderStore, schemaVersion stays 3) minus everything
// positional: no map, no at(), no onBroken. Like chests it has NO update()
// tick — inert storage, nothing joins the main loop.
//
// `granted` is the one-time reward latch: main.js grants the kings_cache
// item when the King's Trial completes (challenge.isComplete) and latches
// this so reloads — and saves that finished the Trial before the reward
// existed — never grant twice.
export class EnderStore {
  constructor() {
    this.slots = new Array(CHEST.slots).fill(null)
    this.granted = false
    this.listeners = []
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

  // Latch the one-time completion grant (main.js flips it as it hands the
  // player the kings_cache item).
  markGranted() {
    if (this.granted) return
    this.granted = true
    this.#emit()
  }

  // --- Persistence seam (SaveManager.attachEnderStore) -----------------------

  serialize() {
    return {
      granted: this.granted,
      slots: this.slots.map((s) => (s ? { ...s } : null)),
    }
  }

  // Defensive like Chests.deserialize: unknown ids and bad counts are
  // dropped, tool durability re-derives its cap.
  deserialize(data) {
    if (!data || typeof data !== 'object') return
    this.granted = data.granted === true
    this.slots = new Array(CHEST.slots).fill(null)
    for (let i = 0; i < CHEST.slots; i++) {
      const s = data.slots?.[i]
      if (!s || !ITEMS[s.id] || !(s.count > 0)) continue
      this.slots[i] = { id: s.id, count: s.count }
      const tool = ITEMS[s.id].tool
      if (tool) this.slots[i].durability = s.durability ?? tool.durability
    }
    this.#emit()
  }
}
