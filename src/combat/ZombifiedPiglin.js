import { COMBAT } from '../config.js'
import { Zombie } from './Zombie.js'

// Zombified piglin (N5, the Nether's resident): the Zombie body and AI with a
// gold-and-rot palette and one behavioral twist — it spawns NEUTRAL. It
// wanders forever, ignoring the player entirely, until `angered` flips: any
// player hit angers it (the overridden hurt), and MobManager's onAngered hook
// spreads the anger to every other piglin within cfg.angerRadius — attack one
// and the patrol turns on you. Drops gold ore (cfg.drop): the risk-farmable
// alternative to deep mining.

// Decayed pig flesh, a rotting-green gut patch, gold-trimmed dark hide.
const COLORS = { skin: 0xc98d72, shirt: 0x7d8a3f, pants: 0x8a6d2e }

export class ZombifiedPiglin extends Zombie {
  constructor(world, x, z) {
    super(world, x, z, COMBAT.mobs.zombifiedPiglin, COLORS, 'zombified_piglin')
    this.angered = false
    this.voice = 'piglin' // ambient groan variant (MobManager's picker)
    this.onAngered = null // callback(mob) — MobManager spreads the anger
  }

  // Neutral until provoked: the base zombie's chase branch consults this.
  wantsToChase() {
    return this.angered
  }

  // Any hit provokes — including the killing blow, so one-shotting a piglin
  // still angers its neighbors (the hook fires before removal).
  hurt(amount, knockDir) {
    if (!this.angered) {
      this.angered = true
      this.onAngered?.(this)
    }
    return super.hurt(amount, knockDir)
  }
}
