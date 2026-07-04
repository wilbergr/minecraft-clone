import { createSlotEl, renderSlot } from './slots.js'

// The held cursor stack (inventory overhaul): one stack "picked up" by the
// slot ops in src/inventory/stackOps.js, rendered as a slot-styled ghost that
// follows the pointer (transform-only moves — no layout thrash). One instance
// is shared by every screen; only one screen is ever open at a time.
//
// The ghost pins to the last pointer position, so touch tap-tap keeps the
// picked stack visible at the tapped slot. flushInto() is the close-time
// rule: a held stack returns to the inventory, overflow is thrown at the
// player's feet — items can never leak. The stack also rides the optional
// `cursor` save key (SaveManager.attachCursor) so a mid-drag refresh can't
// lose it.
export class SlotCursor {
  constructor() {
    this.stack = null
    this.listeners = []
    this.x = 0
    this.y = 0
    this.el = createSlotEl()
    this.el.classList.add('cursor-ghost', 'hidden')
    document.body.appendChild(this.el)
    const track = (e) => {
      this.x = e.clientX
      this.y = e.clientY
      this.#apply()
    }
    document.addEventListener('pointermove', track)
    document.addEventListener('pointerdown', track, true)
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  set(stack) {
    this.stack = stack && stack.count > 0 ? stack : null
    renderSlot(this.el, this.stack)
    this.el.classList.toggle('hidden', !this.stack)
    this.#apply()
    for (const fn of this.listeners) fn(this)
  }

  clear() {
    this.set(null)
  }

  #apply() {
    if (!this.stack) return
    this.el.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) translate(-50%, -50%)`
  }

  // Screen close: return the held stack via inventory.add; overflow (a full
  // inventory) is thrown as a ground drop so nothing vanishes. `drops` and
  // `camera` are optional — bare setups just add.
  flushInto(inventory, drops = null, camera = null) {
    const s = this.stack
    if (!s) return
    this.clear()
    const leftover = inventory.add(s.id, s.count, s.durability)
    if (leftover > 0 && camera) drops?.throwFrom?.(camera, s.id, leftover, s.durability)
  }

  // The optional `cursor` save slot: just the held stack (or null).
  serialize() {
    return this.stack ? { ...this.stack } : null
  }
}
