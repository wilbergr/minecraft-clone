import { SLEEP } from '../config.js'
import { BLOCK_BED } from '../world/blocks.js'

// Bed sleeping (bed feature): right-clicking a placed bed routes here through
// the interactive-block dispatcher in main.js. Sleeping at night sets the
// respawn point to the bed's cell and skips the clock to dawn; by day it
// refuses with a toast, MC-style (the spawn point is only ever set by a
// successful night sleep). The spawn point persists in the save's optional
// `spawn` key (SaveManager.attachSleep) and is validated at respawn time —
// a bed that was broken or blown up falls back to the origin spawn.
//
// Hooks are optional (bare/test setups run without them): `onMessage(text)`
// drives the toast, `onSleep()` the fade + sound (ui/sleepFx.js), `onChange()`
// the save dirty flag.
export class Sleep {
  constructor(world, daynight) {
    this.world = world
    this.daynight = daynight
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
      this.onMessage?.('You can only sleep at night')
      return true
    }
    this.spawn = [x, y, z]
    this.daynight.setTime(SLEEP.wakeTime)
    this.onSleep?.()
    this.onMessage?.('Spawn point set — you wake at dawn')
    this.onChange?.()
    return true
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
