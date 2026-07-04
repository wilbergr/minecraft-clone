import { CHALLENGE, DAYNIGHT } from '../config.js'

// King's Trial stage 3 — The Siege: the wave runner. Armed at the beacon's
// gold core (Challenge.tryUseBlock routes the click here), it waits for dusk,
// then raises the CHALLENGE.siege.waves in order on a ring around the anchor
// — each entrance telegraphed by a flare + horn a beat before the mobs rise.
//
// A wave's mobs are tracked by PINNED OBJECT REFERENCES (the documented
// pattern — mob-list indexes shift under the ambient systems), and the wave
// is cleared when none of them remain in mobs.mobs. That one check counts
// sword kills, arrow kills, creeper self-detonations, and void falls
// uniformly, with zero changes to kill plumbing — deliberately NOT
// onMobKilled, which is single-slot (owned by Combat) and silent on creeper
// detonations.
//
// While the event runs, mobs.event suppresses ambient hostile + passive
// spawning (wave counts stay exact, draw calls stay bounded) and defers the
// dawn burn. Failure is dawn (checked FIRST each tick, so the event ends and
// clears mobs.event before the burn ignites the leftovers — failure-first
// ordering), leaving the arena ring too long (the horde disperses), or death
// (Combat.respawn clears the mob list; we just observe health.isDead).
// Retry is free (CHALLENGE.retry): re-arm at the core next dusk.
//
// Mid-siege state is deliberately NOT saved — mobs are never persisted, so a
// reload can't reconstruct a half-siege. A fresh SiegeEvent boots disarmed;
// only the latched siegeCleared flag rides the challenge save slot.
export class SiegeEvent {
  constructor(anchorPosition, cfg = CHALLENGE.siege) {
    this.anchor = anchorPosition
    this.cfg = cfg
    // Attached by main.js after construction (the mobs.daynight pattern).
    // With mobs/daynight missing (bare/test runs) arming refuses and the
    // update is a no-op — the rest of the challenge still works.
    this.mobs = null
    this.daynight = null
    this.health = null
    this.player = null
    // Optional hooks (main.js / Challenge wire them).
    this.onToast = null // callback(text)
    this.onFlare = null // callback(x, y, z) — one spawn-point telegraph column
    this.onHorn = null // callback() — the wave call
    this.onWin = null // callback() — final wave cleared while live
    this.onChange = null // callback() — armed/wave/remaining changed (quest log)

    this.armed = false // core clicked; waves start at the next dusk
    this.active = false // waves running
    this.phase = null // 'telegraph' | 'fight' | 'breather'
    this.waveIndex = 0
    this.pinned = [] // the live wave's mobs, by object reference
    this.pending = [] // {kind, x, z} spawn points waiting out the telegraph
    this.remaining = 0
    this.timer = 0
    this.leaveTimer = 0 // seconds the player has been outside the arena ring
  }

  // The compass strip's siege readout, or null when there is nothing to say
  // beyond the stage default.
  get hudLabel() {
    if (this.active) {
      const total = this.cfg.waves.length
      if (this.phase === 'breather') {
        return `Wave ${this.waveIndex + 2} of ${total} in ${Math.ceil(this.timer)}s · ${this.#dawnClock()}`
      }
      if (this.phase === 'telegraph') {
        return `Wave ${this.waveIndex + 1} of ${total} rising · ${this.#dawnClock()}`
      }
      return `Wave ${this.waveIndex + 1} · ${this.remaining} remain · ${this.#dawnClock()}`
    }
    if (this.armed) return 'Siege armed — the horde comes at dusk'
    return null
  }

  #dawnClock() {
    const left =
      Math.max(0, DAYNIGHT.night.end - this.daynight.time) * DAYNIGHT.dayLengthSeconds
    const m = Math.floor(left / 60)
    const s = String(Math.floor(left % 60)).padStart(2, '0')
    return `dawn in ~${m}:${s}`
  }

  // The core was clicked (stage-gated by Challenge). Always returns true —
  // the click is spent — except in bare runs with no mob system attached.
  arm() {
    if (!this.mobs || !this.daynight) return false
    if (this.active) {
      this.onToast?.('The siege is already underway — hold the ring!')
      return true
    }
    if (this.armed) {
      this.onToast?.('The siege is armed — the horde comes at dusk.')
      return true
    }
    this.armed = true
    this.onToast?.(
      this.daynight.isNight
        ? 'The core ignites — the horde answers!'
        : 'The horde answers at dusk. Hold the Trial Grounds.',
    )
    this.onChange?.()
    return true
  }

  // Ticked from Challenge.update while the siege stage is live.
  update(delta, playerPos) {
    if (!this.armed && !this.active) return
    // Death first: Combat.respawn clears the whole mob list, so the wave is
    // gone either way — the event only observes. Checked before the lock
    // gate because dying unlocks the pointer.
    if (this.health?.isDead) {
      if (this.active) this.#fail('You fell — the siege is broken. Re-arm the core to try again.', false)
      return
    }
    // Menus pause physics, combat, and the clock; the siege freezes with them.
    if (this.player && !this.player.isLocked) return

    if (!this.active) {
      if (this.daynight.isNight) this.#begin()
      return
    }

    // Failure-first dawn check: end the event (clearing mobs.event) so the
    // deferred dawn burn cleans up the leftover horde for free.
    if (!this.daynight.isNight) {
      this.#fail('Dawn breaks — the horde retreats. Re-arm the core at dusk.', false)
      return
    }

    // Arena leash: kiting the wave out of the ring long enough disperses it
    // (past the grace it would hit the despawn radius and silently "clear").
    const dx = playerPos.x - this.anchor.x
    const dz = playerPos.z - this.anchor.z
    if (dx * dx + dz * dz > this.cfg.arenaRadius ** 2) {
      this.leaveTimer += delta
      if (this.leaveTimer > this.cfg.leaveGraceSeconds) {
        this.#fail('You abandoned the ring — the horde disperses.', true)
        return
      }
    } else {
      this.leaveTimer = 0
    }

    this.timer -= delta
    if (this.phase === 'telegraph') {
      if (this.timer <= 0) this.#spawnWave()
    } else if (this.phase === 'fight') {
      const remaining = this.pinned.filter((m) => this.mobs.mobs.includes(m)).length
      if (remaining !== this.remaining) {
        this.remaining = remaining
        this.onChange?.()
      }
      if (remaining === 0) this.#waveCleared()
    } else if (this.phase === 'breather') {
      if (this.timer <= 0) {
        this.waveIndex++
        this.#telegraph()
      }
    }
  }

  #begin() {
    this.active = true
    this.mobs.event = true
    this.waveIndex = 0
    this.leaveTimer = 0
    this.#telegraph()
  }

  // Announce the wave: flare each spawn point and start the lead timer; the
  // mobs rise when it runs out. Points spread evenly around the ring from a
  // random rotation, so entrances surround the arena but aren't memorizable.
  #telegraph() {
    this.phase = 'telegraph'
    this.timer = this.cfg.flare.leadSeconds
    const kinds = []
    for (const [kind, count] of Object.entries(this.cfg.waves[this.waveIndex])) {
      for (let i = 0; i < count; i++) kinds.push(kind)
    }
    const start = Math.random() * Math.PI * 2
    this.pending = kinds.map((kind, i) => {
      const angle = start + (i / kinds.length) * Math.PI * 2
      return {
        kind,
        x: this.anchor.x + Math.sin(angle) * this.cfg.spawnRadius,
        z: this.anchor.z + Math.cos(angle) * this.cfg.spawnRadius,
      }
    })
    this.onHorn?.()
    for (const p of this.pending) {
      this.onFlare?.(p.x, this.mobs.world.surfaceY(p.x, p.z) + 1, p.z)
    }
    this.onToast?.(`Wave ${this.waveIndex + 1} of ${this.cfg.waves.length}`)
    this.onChange?.()
  }

  #spawnWave() {
    this.phase = 'fight'
    this.pinned = this.pending.map((p) => this.mobs.spawnAt(p.x, p.z, p.kind))
    this.pending = []
    this.remaining = this.pinned.length
    this.onChange?.()
  }

  #waveCleared() {
    if (this.waveIndex >= this.cfg.waves.length - 1) {
      this.#end()
      this.onWin?.() // Challenge latches siegeCleared and advances the stage
      return
    }
    this.phase = 'breather'
    this.timer = this.cfg.breatherSeconds
    this.onToast?.(`Wave ${this.waveIndex + 1} cleared — a breath before the next.`)
    this.onChange?.()
  }

  #end() {
    this.active = false
    this.armed = false
    this.phase = null
    this.pinned = []
    this.pending = []
    this.remaining = 0
    if (this.mobs) this.mobs.event = false
  }

  // `disperse` poofs the leftover wave now (the leash fail); dawn leaves its
  // leftovers for the burn, and death leaves them for Combat.respawn. Runs
  // from the main loop, never inside mobs.update — despawning here is safe.
  #fail(message, disperse) {
    if (disperse) for (const mob of this.pinned) this.mobs.despawn(mob)
    this.#end()
    this.onToast?.(message)
    this.onChange?.()
  }

  // Cancel without fanfare — stage jumps (skipToStage) route through this so
  // a test skipping past a live siege never leaves mobs.event set.
  cancel() {
    if (!this.armed && !this.active) return
    this.#end()
    this.onChange?.()
  }
}
