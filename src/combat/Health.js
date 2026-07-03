import { COMBAT } from '../config.js'

// Player health: a value in [0, COMBAT.maxHealth] with slow out-of-combat
// regeneration. UI layers subscribe via onChange (same pattern as Inventory);
// hitting zero fires onDeath once — respawning calls reset().
//
// State is plain data but is NOT persisted yet — the save/load phase (5) can
// serialize `value` if death should survive a reload.
export class Health {
  constructor() {
    this.max = COMBAT.maxHealth
    this.value = this.max
    this.sinceDamage = Infinity // seconds since the player last took a hit
    this.listeners = []
    this.onDeath = null // callback() — fired once when health reaches zero
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
    this.#emit()
    if (this.isDead) this.onDeath?.()
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

  // Regen tick: after COMBAT.regen.delaySeconds without damage, drift back up.
  update(delta) {
    if (this.isDead) return
    this.sinceDamage += delta
    if (this.sinceDamage >= COMBAT.regen.delaySeconds) {
      this.heal(COMBAT.regen.perSecond * delta)
    }
  }
}
