import { HUNGER } from '../config.js'

// Player hunger (Phase 12): a value in [0, HUNGER.max] drained by time,
// sprinting, and mining (main.js feeds the activity flags each frame).
// Eating food (the Phase 9 right-click use verb) restores points; health
// regen is gated on being well-fed via Health.regenGate, and at zero hunger
// onStarve fires on an interval (main.js wires it to health damage with a
// floor — starvation weakens, it never kills).
//
// Same shape as Health: UI subscribes via onChange, and the value
// round-trips through serialize()/deserialize() for the save system.
export class Hunger {
  constructor() {
    this.max = HUNGER.max
    this.value = this.max
    this.listeners = []
    this.onStarve = null // callback() — fired every starve interval at zero hunger
    this.starveTimer = 0
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  get isFull() {
    return this.value >= this.max
  }

  // Restore points (eating). Returns false — consuming nothing — when full,
  // so food isn't wasted on a topped-up bar.
  eat(points) {
    if (this.isFull) return false
    this.value = Math.min(this.max, this.value + points)
    this.#emit()
    return true
  }

  reset() {
    this.value = this.max
    this.starveTimer = 0
    this.#emit()
  }

  // Metabolism tick. Flags name what the player is doing this frame; each
  // adds its drain rate on top of the idle baseline.
  update(delta, { sprinting = false, mining = false } = {}) {
    let rate = HUNGER.drainPerSecond
    if (sprinting) rate += HUNGER.sprintExtraPerSecond
    if (mining) rate += HUNGER.miningExtraPerSecond
    const next = Math.max(0, this.value - rate * delta)
    if (next !== this.value) {
      this.value = next
      this.#emit()
    }
    if (this.value <= 0) {
      this.starveTimer += delta
      if (this.starveTimer >= HUNGER.starve.intervalSeconds) {
        this.starveTimer = 0
        this.onStarve?.()
      }
    } else {
      this.starveTimer = 0
    }
  }

  // --- Persistence seam (SaveManager.attachHunger) ---------------------------

  serialize() {
    return this.value
  }

  deserialize(value) {
    const v = Number(value)
    this.value = Number.isFinite(v) ? Math.min(this.max, Math.max(0, v)) : this.max
    this.starveTimer = 0
    this.#emit()
  }
}
