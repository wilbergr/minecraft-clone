import { COMBAT } from '../config.js'

// Player health: a value in [0, COMBAT.maxHealth] with slow out-of-combat
// regeneration. UI layers subscribe via onChange (same pattern as Inventory);
// hitting zero fires onDeath once — respawning calls reset().
//
// `value` round-trips through serialize()/deserialize() for the save system
// (SaveManager skips saving while dead, so a loaded value is always >= 1).
export class Health {
  constructor() {
    this.max = COMBAT.maxHealth
    this.value = this.max
    this.sinceDamage = Infinity // seconds since the player last took a hit
    this.listeners = []
    this.onDeath = null // callback() — fired once when health reaches zero
    // Optional () => bool checked before each regen tick (Phase 12 gates
    // regeneration on the hunger bar being well-fed). Unset = always regen.
    this.regenGate = null
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  get isDead() {
    return this.value <= 0
  }

  damage(amount) {
    if (this.isDead) return
    this.value = Math.max(0, this.value - amount)
    this.sinceDamage = 0
    // onDeath runs BEFORE the emit so the fatal onChange describes the
    // post-death world: the death-screen render reads state the death hook
    // just settled (did the inventory spill? — see Combat.deathSpillHook).
    if (this.isDead) this.onDeath?.()
    this.#emit()
  }

  heal(amount) {
    if (this.isDead || this.value >= this.max) return
    this.value = Math.min(this.max, this.value + amount)
    this.#emit()
  }

  reset() {
    this.value = this.max
    this.sinceDamage = Infinity
    this.#emit()
  }

  // --- Persistence seam (Phase 5) -------------------------------------------

  serialize() {
    return this.value
  }

  // Clamped to [1, max] so a corrupt (or somehow dead) save can never load
  // straight into the death screen.
  deserialize(value) {
    const v = Number(value)
    this.value = Number.isFinite(v) ? Math.min(this.max, Math.max(1, v)) : this.max
    this.sinceDamage = Infinity
    this.#emit()
  }

  // Regen tick: after COMBAT.regen.delaySeconds without damage, drift back up.
  update(delta) {
    if (this.isDead) return
    this.sinceDamage += delta
    if (this.sinceDamage >= COMBAT.regen.delaySeconds && (this.regenGate?.() ?? true)) {
      this.heal(COMBAT.regen.perSecond * delta)
    }
  }
}
