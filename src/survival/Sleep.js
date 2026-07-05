import { SLEEP } from '../config.js'
import { BLOCK_BED } from '../world/blocks.js'

// Bed sleeping (bed feature): right-clicking a placed bed routes here through
// the interactive-block dispatcher in main.js. Sleeping at night sets the
// respawn point to the bed's cell and skips the clock to dawn; by day the
// click still sets the spawn point — modern MC (1.15+) behavior — it just
// doesn't skip time. Night sleep is refused while hostile mobs prowl within
// SLEEP.monsterRadius of the bed, MC's "you may not rest now". The spawn
// point persists in the save's optional `spawn` key (SaveManager.attachSleep)
// and is validated at respawn time — a bed that was broken or blown up falls
// back to the origin spawn.
//
// Hooks are optional (bare/test setups run without them): `onMessage(text)`
// drives the toast, `onSleep()` the fade + sound (ui/sleepFx.js), `onChange()`
// the save dirty flag. `mobs` (the live MobManager) is attached by main.js —
// the mobs.daynight pattern; null skips the monster check.
export class Sleep {
  constructor(world, daynight) {
    this.world = world
    this.daynight = daynight
    this.mobs = null
    this.spawn = null // [x, y, z] bed block coords, or null (origin spawn)
    this.onMessage = null
    this.onSleep = null
    this.onChange = null
  }

  // Use-verb handler for the bed block. Always returns true — a bed click is
  // spent whether the sleep succeeded or was refused (never falls through to
  // placing the held block against the bed; sneak-click for that).
  tryAt(x, y, z) {
    if (!this.daynight?.isNight) {
      this.#setSpawn(x, y, z)
      this.onMessage?.('Spawn point set — sleep here at night to skip to dawn')
      return true
    }
    if (this.#monstersNear(x, y, z)) {
      this.onMessage?.("You can't sleep now — monsters are nearby")
      return true
    }
    this.#setSpawn(x, y, z)
    this.daynight.setTime(SLEEP.wakeTime)
    this.onSleep?.()
    this.onMessage?.('Spawn point set — you wake at dawn')
    return true
  }

  #setSpawn(x, y, z) {
    this.spawn = [x, y, z]
    this.onChange?.()
  }

  // Any live hostile within SLEEP.monsterRadius of the bed blocks the sleep.
  #monstersNear(x, y, z) {
    if (!this.mobs) return false
    const r2 = SLEEP.monsterRadius ** 2
    return this.mobs.mobs.some((m) => {
      if (m.passive) return false
      const p = m.group.position
      return (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 < r2
    })
  }

  // Respawn feet position for PlayerControls.spawnHook, or null for the
  // default origin spawn. A spawn point whose bed no longer exists is
  // cleared and reported — Minecraft's "your bed was missing" behavior.
  // (World.blockAt answers from the edit overlay even for unloaded chunks,
  // so this is correct however far away the player died.)
  respawnPoint() {
    if (!this.spawn) return null
    const [x, y, z] = this.spawn
    if (this.world.blockAt(x, y, z) !== BLOCK_BED) {
      this.spawn = null
      this.onChange?.()
      this.onMessage?.('Your bed was missing — respawned at the world spawn')
      return null
    }
    return { x: x + 0.5, y, z: z + 0.5 } // stand centered in the bed's cell
  }

  // --- Persistence seam (SaveManager.attachSleep) ---------------------------

  serialize() {
    return this.spawn
  }

  deserialize(data) {
    if (Array.isArray(data) && data.length === 3 && data.every(Number.isFinite)) {
      this.spawn = data
    }
  }
}
