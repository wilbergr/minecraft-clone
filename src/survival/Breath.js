import { BREATH } from '../config.js'

// Player breath (deep water) — a structural twin of Hunger: a value in
// [0, BREATH.max] that drains while the camera is submerged (main.js feeds
// the flag each frame — the same cell test as the #water-tint wash, so the
// meter and the blue wash can never disagree) and refills fast in air. At
// zero, onDrown fires on an interval; main.js wires it to health.damage()
// directly — un-armored and LETHAL, unlike starvation, because the surface
// is always the escape.
//
// Timings read from `cfg` (assigned BREATH) rather than the import so
// headless tests can shrink them — the bossFight.cfg precedent. Breath is
// deliberately not persisted: it resets full on load/respawn.
export class Breath {
  constructor() {
    this.cfg = BREATH
    this.max = BREATH.max
    this.value = this.max
    this.listeners = []
    this.onDrown = null // callback() — fired every drown interval at zero breath
    this.drownTimer = 0
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

  reset() {
    this.value = this.max
    this.drownTimer = 0
    this.#emit()
  }

  // Per-frame tick: drain while submerged, refill in air, and count down to
  // drowning damage at empty. The drown timer starts full so the first tick
  // lands one interval AFTER the bar empties, not the same frame.
  update(delta, { submerged = false } = {}) {
    const rate = submerged ? -this.cfg.drainPerSecond : this.cfg.refillPerSecond
    const next = Math.min(this.max, Math.max(0, this.value + rate * delta))
    if (next !== this.value) {
      this.value = next
      this.#emit()
    }
    if (submerged && this.value <= 0) {
      this.drownTimer += delta
      if (this.drownTimer >= this.cfg.drown.intervalSeconds) {
        this.drownTimer = 0
        this.onDrown?.()
      }
    } else {
      this.drownTimer = 0
    }
  }
}
