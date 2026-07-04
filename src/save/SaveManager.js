import { SAVE, WORLD } from '../config.js'

// localStorage persistence (Phase 5). One versioned key holds the whole game:
//
//   {
//     schemaVersion,            // SAVE.schemaVersion — mismatch = start fresh
//     seed,                     // WORLD.seed — mismatch = start fresh
//     player: { position: [x, y, z], pitch, yaw },
//     health,                   // number in [1, COMBAT.maxHealth]
//     inventory: { slots, selectedSlot },   // Inventory.serialize()
//     edits: { "cx,cz": [[blockIndex, blockId], ...] },  // sparse deltas only
//     treasure: { found: [bool per token], celebrated },  // TreasureHunt.serialize()
//     daynight: { time },       // DayNight.serialize() — clock, fraction of a day (Phase 10)
//     hunger,                   // number in [0, HUNGER.max] (Phase 12; absent = full)
//     furnaces: { "x,y,z": { input, fuel, output, ... } },  // Furnaces.serialize()
//     armor: { head, chest, legs, feet },  // Armor.serialize() (Phase 13; item ids or null)
//   }
//
// `hunger`, `furnaces`, and `armor` are optional keys (Phases 12–13): older
// saves simply lack them and load with a full bar / no furnace contents /
// nothing worn — absent keys never invalidate a save on their own.
//
// Terrain is never saved — it regenerates from the seed, and only the player's
// block-edit overlay (World.edits) is persisted, so storage stays proportional
// to what the player changed. Live mobs are also not saved; the ambient
// spawner repopulates naturally after load.
//
// Writes are dirty-flag + interval batched: gameplay events (block edit,
// inventory change, health change) mark the save dirty and the flush happens
// at most every SAVE.autosaveSeconds, plus once on beforeunload. Nothing is
// serialized per frame.
export class SaveManager {
  constructor({ world, player, inventory, health }) {
    this.world = world
    this.player = player
    this.inventory = inventory
    this.health = health
    this.treasure = null // Phase 6 writes hunt progress here; it round-trips
    this.daynightData = null // loaded clock slot, applied by attachDayNight (Phase 10)
    this.daynight = null // live DayNight ref — serialize() reads the clock from it
    this.hunger = null // wired by attachHunger (Phase 12)
    this.hungerData = null // loaded value held until attachHunger applies it
    this.furnaces = null // wired by attachFurnaces (Phase 12)
    this.furnaceData = null
    this.armor = null // wired by attachArmor (Phase 13)
    this.armorData = null
    this.dirty = false
    this.sinceAutosave = 0
    this.saveCount = 0 // informational (browser verification hooks onto this)
    this.enabled = true // reset() clears this so unload can't resurrect the save
    this.warnedSize = false

    const markDirty = () => (this.dirty = true)
    world.onEdit = markDirty
    inventory.onChange(markDirty)
    health.onChange(markDirty)
    window.addEventListener('beforeunload', () => {
      if (this.enabled) this.save()
    })
  }

  // Wire the day/night clock into the `daynight` slot (Phase 10), mirroring
  // attachTreasure. Unlike treasure the clock changes every frame, so instead
  // of dirty-flagging (which would flush constantly) serialize() reads it
  // live — the regular while-playing autosave interval keeps it fresh. Saves
  // predating the slot (or without the clock attached) just start at the
  // default morning time; the schemaVersion guard in load() covers any
  // future incompatible reshape.
  attachDayNight(daynight) {
    daynight.deserialize(this.daynightData)
    this.daynight = daynight
  }

  // Wire the treasure hunt into the reserved `treasure` slot (Phase 6).
  // Called once, after load(): applies whatever the slot held to the hunt,
  // then keeps the slot — and the dirty flag — in sync as tokens are found.
  attachTreasure(hunt) {
    hunt.deserialize(this.treasure)
    this.treasure = hunt.serialize()
    hunt.onChange(() => {
      this.treasure = hunt.serialize()
      this.dirty = true
    })
  }

  // Same pattern for the hunger bar (Phase 12): called once after load().
  attachHunger(hunger) {
    this.hunger = hunger
    if (this.hungerData !== null) hunger.deserialize(this.hungerData)
    hunger.onChange(() => (this.dirty = true))
  }

  // And for placed-furnace contents (Phase 12): called once after load().
  attachFurnaces(furnaces) {
    this.furnaces = furnaces
    if (this.furnaceData !== null) furnaces.deserialize(this.furnaceData)
    furnaces.onChange(() => (this.dirty = true))
  }

  // And for worn armor (Phase 13): called once after load().
  attachArmor(armor) {
    this.armor = armor
    if (this.armorData !== null) armor.deserialize(this.armorData)
    armor.onChange(() => (this.dirty = true))
  }

  // Restore a saved game, if one exists and matches the current seed and
  // schema. Any failure — absent, corrupt JSON, wrong shape — lands on a
  // fresh game, never a crash. Returns true when a save was applied.
  load() {
    let raw
    try {
      raw = localStorage.getItem(SAVE.storageKey)
    } catch {
      return false // storage unavailable (privacy mode etc.) — play unsaved
    }
    if (!raw) return false
    try {
      const data = JSON.parse(raw)
      if (data.schemaVersion !== SAVE.schemaVersion || data.seed !== WORLD.seed) {
        return false // other world / older schema: start fresh (overwritten on next save)
      }
      // Order matters only in that edits must land before the first chunk
      // generates — main.js calls load() before the render loop starts.
      this.world.deserializeEdits(data.edits ?? {})
      this.inventory.deserialize(data.inventory ?? {})
      this.health.deserialize(data.health)
      this.player.deserialize(data.player)
      this.treasure = data.treasure ?? null
      this.daynightData = data.daynight ?? null
      this.hungerData = data.hunger ?? null
      this.furnaceData = data.furnaces ?? null
      this.armorData = data.armor ?? null
      this.dirty = false
      return true
    } catch (err) {
      console.warn('[save] ignoring corrupt save — starting fresh', err)
      this.world.deserializeEdits({}) // don't keep a half-applied overlay
      return false
    }
  }

  serialize() {
    return {
      schemaVersion: SAVE.schemaVersion,
      seed: WORLD.seed,
      player: this.player.serialize(),
      health: this.health.serialize(),
      inventory: this.inventory.serialize(),
      edits: this.world.serializeEdits(),
      treasure: this.treasure,
      daynight: this.daynight ? this.daynight.serialize() : this.daynightData,
      hunger: this.hunger ? this.hunger.serialize() : (this.hungerData ?? undefined),
      furnaces: this.furnaces ? this.furnaces.serialize() : (this.furnaceData ?? undefined),
      armor: this.armor ? this.armor.serialize() : (this.armorData ?? undefined),
    }
  }

  // Flush to localStorage. Skipped while dead (respawn resolves the moment —
  // persisting mid-death-screen would load into it). Quota/storage errors
  // warn once and the game plays on unsaved.
  save() {
    if (this.health.isDead) return false
    try {
      const payload = JSON.stringify(this.serialize())
      if (payload.length > SAVE.warnPayloadChars && !this.warnedSize) {
        this.warnedSize = true
        console.warn(
          `[save] payload is ${payload.length} chars (${this.world.editCount()} block edits) — approaching the ~5MB localStorage cap`,
        )
      }
      localStorage.setItem(SAVE.storageKey, payload)
      this.dirty = false
      this.saveCount++
      return true
    } catch (err) {
      if (!this.warnedSize) {
        this.warnedSize = true
        console.warn('[save] save failed — progress will not persist', err)
      }
      return false
    }
  }

  // Autosave tick, driven by the main loop: flush when dirty, or on a plain
  // interval while actively playing (position changes don't mark dirty).
  update(delta) {
    this.sinceAutosave += delta
    if (this.sinceAutosave < SAVE.autosaveSeconds) return
    this.sinceAutosave = 0
    if (this.dirty || this.player.isLocked) this.save()
  }

  // Wipe the save and reload into a fresh world. The UI (ui/resetButton.js)
  // confirms before calling this — it erases all progress.
  reset() {
    this.enabled = false
    try {
      localStorage.removeItem(SAVE.storageKey)
    } catch {
      // storage unavailable — nothing to wipe
    }
    location.reload()
  }
}
