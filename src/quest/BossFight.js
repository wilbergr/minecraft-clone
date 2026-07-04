import * as THREE from 'three'
import { CHALLENGE } from '../config.js'

// King's Trial stage 4 — the Hollow King fight runner, SiegeEvent's sibling.
// Re-clicking the beacon's gold core after the siege (Challenge.tryUseBlock
// routes it) starts a rumble, then the King rises at the arena center. The
// boss object is PINNED BY REFERENCE (the documented pattern): gone from
// mobs.mobs with health <= 0 is victory through the normal kill plumbing
// (drops included); gone while still healthy (void fall, despawn radius) just
// resets to summonable.
//
// Anti-cheese leash, the fight's backbone: the player outside the siege's
// arenaRadius for > leash.playerSeconds, or line of sight broken for >
// leash.losSeconds (skeleton-style ray), and the King roars and despawns —
// re-summoning raises him at full health, so there is no plinking from a hill
// or burying him and going to lunch. Retry is free (CHALLENGE.retry): death
// clears the mobs via Combat.respawn and the core summons again; the trek
// back is the cost.
//
// While the fight runs, mobs.event suppresses ambient spawning and defers the
// dawn burn (the siege's flag — the boss population stays exactly the King
// plus his ≤2 minions). Mid-fight state is deliberately NOT saved: mobs never
// persist, so a reload lands disarmed on the boss stage.
//
// Live deps (mobs, health, player) are attached by main.js after construction
// (the mobs.daynight pattern); bare runs leave the fight inert. onBossEvent
// is the generic observability seam — rumble/rise/telegraph/attack/phase/
// stagger/leash all flow through it, so the future guidance layer (Herald)
// can react without new plumbing.
export class BossFight {
  constructor(anchorPosition, scene, world, cfg = CHALLENGE.boss) {
    this.anchor = anchorPosition
    this.scene = scene
    this.world = world
    this.cfg = cfg
    // Attached by main.js after construction.
    this.mobs = null
    this.health = null
    this.player = null
    // Optional hooks (Challenge / main.js wire them).
    this.onToast = null // callback(text)
    this.onChange = null // callback() — state changed (quest log)
    this.onWin = null // callback(position) — Challenge latches bossDefeated
    this.onBossHealth = null // callback(hp, max) — the boss HP bar shows/tracks
    this.onBossGone = null // callback() — the bar hides
    this.onBossEvent = null // callback(type, data) — generic observability seam

    this.state = 'idle' // 'idle' | 'rumbling' | 'fighting'
    this.timer = 0
    this.boss = null // pinned object reference while fighting
    this.leaveTimer = 0 // seconds the player has been outside the arena ring
    this.losTimer = 0 // seconds line of sight has been broken
    this.marker = null // { mesh, timer } — the quake ground marker
  }

  // The compass strip's boss readout, or null for the stage default.
  get hudLabel() {
    if (this.state === 'rumbling') return 'The ground trembles…'
    if (this.state === 'fighting' && this.boss) {
      const hp = Math.max(0, Math.ceil(this.boss.health))
      return `The Hollow King · phase ${this.boss.phase}/3 · ${hp}/${this.cfg.health}`
    }
    return null
  }

  // The core was clicked at the boss stage (gated by Challenge). Returns true
  // when the click is spent — always, except in bare runs with no mob system.
  trySummon() {
    if (!this.mobs) return false
    if (this.state !== 'idle') {
      this.onToast?.('The Hollow King already answers — stand your ground!')
      return true
    }
    this.state = 'rumbling'
    this.timer = this.cfg.summonSeconds
    this.mobs.event = true // ambient spawns rest; the dawn burn defers
    this.#event('rumble', { position: this.anchor })
    this.onToast?.('The core screams — the ground begins to shake…')
    this.onChange?.()
    return true
  }

  // Ticked from Challenge.update while the boss stage is live.
  update(delta, playerPos) {
    if (this.state === 'idle') return
    // Death first (before the lock gate — dying unlocks the pointer):
    // Combat.respawn clears the whole mob list; we only observe. Free retry.
    if (this.health?.isDead) {
      this.#reset('The Hollow King stands unbeaten. Return and summon him again.')
      return
    }
    // Menus pause physics, combat, and the clock; the fight freezes with them.
    if (this.player && !this.player.isLocked) return

    this.#tickMarker(delta)

    if (this.state === 'rumbling') {
      this.timer -= delta
      if (this.timer <= 0) this.#rise()
      return
    }

    const boss = this.boss
    if (!this.mobs.mobs.includes(boss)) {
      // Killed through the normal hit path → victory (drops already rolled by
      // Combat's kill plumbing). Gone any other way (void fall, despawn
      // radius) → quietly summonable again.
      if (boss.health <= 0) this.#victory(boss)
      else this.#reset('The Hollow King fades into the dark. Summon him again at the core.')
      return
    }

    // Arena leash: distance…
    const dx = playerPos.x - this.anchor.x
    const dz = playerPos.z - this.anchor.z
    if (dx * dx + dz * dz > CHALLENGE.siege.arenaRadius ** 2) {
      this.leaveTimer += delta
      if (this.leaveTimer > this.cfg.leash.playerSeconds) {
        this.#leash()
        return
      }
    } else {
      this.leaveTimer = 0
    }
    // …and line of sight (no burying him, no shooting through a slit).
    if (!this.#lineOfSight(boss, playerPos)) {
      this.losTimer += delta
      if (this.losTimer > this.cfg.leash.losSeconds) this.#leash()
    } else {
      this.losTimer = 0
    }
  }

  #rise() {
    this.state = 'fighting'
    const boss = this.mobs.spawnAt(this.anchor.x, this.anchor.z, 'boss')
    this.boss = boss
    boss.onHealth = (hp, max) => this.onBossHealth?.(hp, max)
    boss.onEvent = (type, data) => {
      if (type === 'quakeMark') this.#showMarker(data)
      this.#event(type, data)
    }
    this.leaveTimer = 0
    this.losTimer = 0
    this.onBossHealth?.(boss.health, this.cfg.health)
    this.#event('rise', { position: boss.group.position })
    this.onToast?.('The Hollow King rises. Every blow is announced — watch, then move.')
    this.onChange?.()
  }

  // Cheated of his duel: roar, despawn (re-summoning spawns him fresh at
  // full health), and wait at the core again.
  #leash() {
    this.#event('leash', { position: this.boss.group.position })
    this.#despawnAll()
    this.#reset('The Hollow King roars — cheated of his duel, he returns to the dark.')
  }

  #victory(boss) {
    const position = boss.group.position.clone()
    this.#despawnAll() // leftover minions don't outlive their King
    this.#end()
    this.onWin?.(position) // Challenge latches bossDefeated and advances
  }

  // Remove the boss and his minions without kill credit. Runs from the main
  // loop, never inside mobs.update — despawning here is safe.
  #despawnAll() {
    if (!this.boss) return
    for (const minion of this.boss.minions) this.mobs.despawn(minion)
    this.mobs.despawn(this.boss)
  }

  #end() {
    this.state = 'idle'
    this.timer = 0
    this.boss = null
    this.leaveTimer = 0
    this.losTimer = 0
    this.#removeMarker()
    if (this.mobs) this.mobs.event = false
    this.onBossGone?.()
  }

  #reset(message) {
    this.#end()
    if (message) this.onToast?.(message)
    this.onChange?.()
  }

  // Cancel without fanfare — stage jumps route through this so a test
  // skipping past a live fight never leaves mobs.event set.
  cancel() {
    if (this.state === 'idle') return
    this.#despawnAll()
    this.#end()
    this.onChange?.()
  }

  #event(type, data) {
    this.onBossEvent?.(type, data)
  }

  // Boss skull to player eyes, the skeleton-style ray.
  #lineOfSight(boss, playerPos) {
    const origin = new THREE.Vector3(
      boss.group.position.x,
      boss.group.position.y + 2.5,
      boss.group.position.z,
    )
    const dir = new THREE.Vector3().subVectors(playerPos, origin)
    const dist = dir.length()
    if (dist < 0.001) return true
    dir.divideScalar(dist)
    return this.world.raycast(origin, dir, dist) === null
  }

  // --- Quake ground marker (scene mesh, purity rule) --------------------------

  // The Quake telegraph marks the player's cell with a glowing disk for the
  // telegraph's duration — the "get off this spot" signal.
  #showMarker({ x, y, z, seconds }) {
    this.#removeMarker()
    const m = this.cfg.attacks.quake.marker
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(m.radius, 24),
      new THREE.MeshBasicMaterial({
        color: m.color,
        transparent: true,
        opacity: m.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, y + 0.06, z)
    this.scene.add(mesh)
    this.marker = { mesh, timer: seconds }
  }

  #tickMarker(delta) {
    if (!this.marker) return
    this.marker.timer -= delta
    if (this.marker.timer <= 0) this.#removeMarker()
  }

  #removeMarker() {
    if (!this.marker) return
    this.scene.remove(this.marker.mesh)
    this.marker.mesh.geometry.dispose()
    this.marker.mesh.material.dispose()
    this.marker = null
  }
}
