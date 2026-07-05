import { LAVA } from '../config.js'

// Player burning (lava feature) — Breath's structural sibling, but value-less:
// just timers and an onBurn callback. While the body's midsection is in lava
// a contact tick fires every LAVA.burn.intervalSeconds — the FIRST tick lands
// the frame you enter (lava bites instantly, unlike drowning's grace) — and
// leaving lava starts the after-burn: LAVA.afterburn.seconds of "on fire",
// ticking lighter damage, extinguished the moment the player is in water.
// main.js wires onBurn to health.damage() directly — un-armored, the
// codified fall/void/starve/drown environmental precedent — ticks it inside
// the hunger/breath gate (menus and death freeze burning like everything
// else), and resets it on respawn.
//
// Timings read from `cfg` (assigned LAVA) rather than the import so headless
// tests can shrink them — the breath.cfg / bossFight.cfg precedent. Burning
// is deliberately not persisted: it resets on load/respawn.
export class Burning {
  constructor() {
    this.cfg = LAVA
    this.contactTimer = 0 // counts down to the next in-lava tick (0 = due now)
    this.afterburn = 0 // seconds of on-fire remaining after leaving lava
    this.afterburnTimer = 0 // counts up to the next after-burn tick
    this.onBurn = null // callback(damage) — main.js wires health.damage + embers
  }

  // On fire in any sense (in lava or lingering) — feeds the tint layer.
  get isBurning() {
    return this.afterburn > 0
  }

  reset() {
    this.contactTimer = 0
    this.afterburn = 0
    this.afterburnTimer = 0
  }

  // Per-frame tick. `inLava` / `inWater` are the body-midsection flags —
  // mutually exclusive (main.js passes inWater && !inLava, since the body's
  // inWater means "in any liquid").
  update(delta, { inLava = false, inWater = false } = {}) {
    if (inLava) {
      this.afterburn = this.cfg.afterburn.seconds // refreshed while soaking
      this.afterburnTimer = 0
      if (this.contactTimer <= 0) {
        this.contactTimer = this.cfg.burn.intervalSeconds
        this.onBurn?.(this.cfg.burn.damage)
      }
      this.contactTimer -= delta
      return
    }
    this.contactTimer = 0 // re-entry bites immediately again
    if (inWater) {
      // Water extinguishes the after-burn within the frame.
      this.afterburn = 0
      this.afterburnTimer = 0
      return
    }
    if (this.afterburn > 0) {
      this.afterburn = Math.max(0, this.afterburn - delta)
      this.afterburnTimer += delta
      if (this.afterburnTimer >= this.cfg.afterburn.intervalSeconds) {
        this.afterburnTimer = 0
        this.onBurn?.(this.cfg.afterburn.damage)
      }
    } else {
      this.afterburnTimer = 0
    }
  }
}
