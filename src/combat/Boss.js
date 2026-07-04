import * as THREE from 'three'
import { CHALLENGE, COMBAT, PLAYER } from '../config.js'
import { Mob } from './Mob.js'

// The Hollow King (King's Trial stage 4): a ~2.8-tall armored revenant on the
// shared Mob base — a floating gold crown (unlit, so it glows) over a skull
// head, broad plated torso with an exposed pulsing core, long arms. Twelve
// parts, the only event mob plus ≤2 minions, so the draw-call budget holds.
//
// The fight is a telegraph-and-dodge kit, not a bullet sponge: every attack
// ramps emissive + poses parts for at least its telegraphSeconds (the
// creeper-fuse precedent) before firing, no attack one-shots through iron
// armor, and phase transitions are announced by a 2s invulnerable roar — the
// crown spinning fast IS the invulnerability tell.
//
// Mid-update mutation rule: Summon and Quake mutate mob/world state, so the
// boss only SETS `pendingSummon` / `pendingQuake` here — MobManager resolves
// both after the mob loop, exactly like the creeper's `exploded` flag. The
// `minions` array is pruned against the live list by MobManager too.
//
// Registered in the HOSTILES table as 'boss' (mobs.spawnAt(x, z, 'boss') is
// the test hook) but NEVER in hostileWeights — the King cannot ambient-spawn;
// only BossFight summons him. State (`phase`, `state`, `attack`, `cooldowns`)
// is plain readable fields, and startAttack() doubles as the headless seam.

const GEOM = {
  head: new THREE.BoxGeometry(0.55, 0.5, 0.55),
  jaw: new THREE.BoxGeometry(0.42, 0.18, 0.4),
  torso: new THREE.BoxGeometry(1.0, 0.95, 0.55),
  pelvis: new THREE.BoxGeometry(0.75, 0.35, 0.45),
  shoulder: new THREE.BoxGeometry(0.45, 0.3, 0.62),
  arm: new THREE.BoxGeometry(0.24, 1.15, 0.24),
  leg: new THREE.BoxGeometry(0.3, 1.0, 0.3),
  crown: new THREE.BoxGeometry(0.5, 0.22, 0.5),
  core: new THREE.BoxGeometry(0.32, 0.32, 0.14),
}

const COLORS = { plate: 0x4a505c, dark: 0x2f333c, bone: 0xcfd0c6 }
const HEAD_HEIGHT = 2.5 // volley origin + line-of-sight eye level

export class Boss extends Mob {
  #toPlayer = new THREE.Vector3()
  #aim = new THREE.Vector3()

  constructor(world, x, z, projectiles) {
    super(world, CHALLENGE.boss.health)
    this.cfg = CHALLENGE.boss
    this.projectiles = projectiles // null in bare runs — the volley never fires
    this.phase = 1 // 1 Sentinel, 2 Summoner, 3 Breaker
    this.state = 'chase' // 'chase' | 'telegraph' | 'charge' | 'stagger' | 'roar'
    this.attack = null // attack key while telegraphing
    this.lastAttack = null // last attack fired (test observability)
    this.timer = 0
    this.telegraphTotal = 1
    this.age = 0
    this.quakeTarget = null // player cell captured at telegraph start
    this.pendingSummon = 0 // MobManager raises the minions after the mob loop
    this.pendingQuake = null // MobManager carves + damages after the mob loop
    this.minions = [] // live minion refs, pruned against mobs.mobs by MobManager
    // Staggered starting cooldowns so the opener isn't every attack at once.
    this.cooldowns = { slam: 1.5, charge: 3, volley: 4, summon: 5, quake: 4 }
    this.chargeDir = new THREE.Vector3()
    this.onHealth = null // callback(hp, max) — the boss HP bar (BossFight wires it)
    this.onEvent = null // callback(type, data) — telegraph/attack/phase observability
    this.makeMaterials(COLORS)
    // Crown + core are unlit (MeshBasicMaterial) so they read as glowing —
    // kept out of `materials` so the hurt flash / telegraph emissive never
    // touches them. Disposed in the dispose() override.
    this.crownMaterial = new THREE.MeshBasicMaterial({ color: this.cfg.crown.color })
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: this.cfg.core.color })
    this.attachBody(this.#buildBody(), x, z, this.cfg.aabb)
  }

  get invulnerable() {
    return this.state === 'roar'
  }

  // Feet-origin body. Arms hang from pivot groups at the shoulders so raise
  // poses rotate around the joint, not the box center.
  #buildBody() {
    const m = this.materials
    const group = new THREE.Group()
    const armPivot = (side) => {
      const pivot = new THREE.Group()
      pivot.position.set(side * 0.68, 2.2, 0)
      pivot.add(this.part(GEOM.arm, m.plate, 0, -0.6, 0))
      return pivot
    }
    const torso = this.part(GEOM.torso, m.plate, 0, 1.82, 0)
    const head = this.part(GEOM.head, m.bone, 0, 2.6, 0)
    const crown = this.part(GEOM.crown, this.crownMaterial, 0, this.cfg.crown.hover, 0)
    const core = this.part(GEOM.core, this.coreMaterial, 0, 1.9, 0.3)
    const armL = armPivot(-1)
    const armR = armPivot(1)
    group.add(
      this.part(GEOM.leg, m.dark, -0.22, 0.5, 0),
      this.part(GEOM.leg, m.dark, 0.22, 0.5, 0),
      this.part(GEOM.pelvis, m.dark, 0, 1.18, 0),
      torso,
      this.part(GEOM.shoulder, m.dark, -0.65, 2.28, 0),
      this.part(GEOM.shoulder, m.dark, 0.65, 2.28, 0),
      armL,
      armR,
      head,
      this.part(GEOM.jaw, m.bone, 0, 2.32, 0.12),
      crown,
      core,
    )
    this.parts = { torso, head, crown, core, armL, armR }
    return group
  }

  update(delta, playerPos, damagePlayer) {
    const pos = this.group.position
    this.age += delta
    this.#toPlayer.set(playerPos.x - pos.x, 0, playerPos.z - pos.z)
    const dist = this.#toPlayer.length()

    // Phase transitions (health thresholds): a 2s invulnerable roar, timers
    // reset — every phase change is announced before it bites.
    const frac = Math.max(0, this.health) / this.cfg.health
    let want = 1
    if (frac <= this.cfg.phases[0]) want = 2
    if (frac <= this.cfg.phases[1]) want = 3
    if (want > this.phase && this.state !== 'roar') this.#enterRoar(want)

    for (const key of Object.keys(this.cooldowns)) this.cooldowns[key] -= delta

    let moveDir = null
    let speed = 0
    let hop = true

    if (this.state === 'roar' || this.state === 'stagger') {
      this.timer -= delta
      if (this.timer <= 0) this.state = 'chase'
    } else if (this.state === 'telegraph') {
      this.group.rotation.y = Math.atan2(this.#toPlayer.x, this.#toPlayer.z)
      this.timer -= delta
      if (this.timer <= 0) this.#fire(playerPos, damagePlayer, dist)
    } else if (this.state === 'charge') {
      this.timer -= delta
      moveDir = this.chargeDir
      speed = this.cfg.attacks.charge.speed
      hop = false // walls are the stagger trigger, not a step to climb
      const near = Math.abs(playerPos.y - PLAYER.eyeHeight - pos.y) < 2.5
      if (dist <= this.cfg.attacks.charge.hitRange && near) {
        damagePlayer(this.cfg.attacks.charge.damage, this)
        this.state = 'chase'
        moveDir = null
        speed = 0
      } else if (this.timer <= 0) {
        this.state = 'chase'
      }
    } else {
      // Chase: the King always knows where you are — it's his arena.
      this.group.rotation.y = Math.atan2(this.#toPlayer.x, this.#toPlayer.z)
      if (dist > 1.6) {
        moveDir = this.#toPlayer.normalize()
        speed = this.cfg.phaseSpeeds[this.phase - 1]
      }
      this.#chooseAttack(dist, playerPos)
      if (this.state !== 'chase') {
        moveDir = null
        speed = 0
      }
    }

    this.locomote(delta, moveDir, speed, hop)

    // A charge that slams a wall staggers the King — crown drops, ×1.5 damage
    // window. The stage-2 beacon pillars are the intended bait.
    if (this.state === 'charge' && this.body.hitWall) {
      this.state = 'stagger'
      this.timer = this.cfg.attacks.charge.staggerSeconds
      this.onEvent?.('stagger', { position: pos })
    }

    this.#animate(delta)
  }

  // Boss damage rules: invulnerable during the phase roar (the fast-spinning
  // crown announces it), ×staggerDamageFactor while staggered (the
  // charge-bait reward), heavy knockback resistance, and the HP-bar hook.
  hurt(amount, knockDir) {
    if (this.state === 'roar') return false
    const dmg =
      this.state === 'stagger'
        ? amount * this.cfg.attacks.charge.staggerDamageFactor
        : amount
    this.health -= dmg
    this.knock.addScaledVector(knockDir, COMBAT.attack.knockback * this.cfg.knockbackFactor)
    this.flashTimer = 0.15
    this.setFlash(true)
    this.onHealth?.(Math.max(0, this.health), this.cfg.health)
    return this.health <= 0
  }

  dispose() {
    super.dispose()
    this.crownMaterial.dispose()
    this.coreMaterial.dispose()
  }

  // Pick among the attacks that are off cooldown, unlocked by the current
  // phase, and in range — randomly, so the rhythm isn't memorizable.
  #chooseAttack(dist, playerPos) {
    const a = this.cfg.attacks
    const ready = (key) => this.cooldowns[key] <= 0
    const candidates = []
    if (ready('slam') && dist <= a.slam.triggerRange) candidates.push('slam')
    if (
      ready('charge') &&
      dist >= a.charge.minRange &&
      dist <= a.charge.maxRange &&
      this.#lineOfSight(playerPos)
    ) {
      candidates.push('charge')
    }
    if (
      this.phase >= 2 &&
      ready('volley') &&
      dist >= a.volley.minRange &&
      dist <= a.volley.maxRange &&
      this.#lineOfSight(playerPos)
    ) {
      candidates.push('volley')
    }
    if (this.phase >= 2 && ready('summon') && this.minions.length < a.summon.maxMinions) {
      candidates.push('summon')
    }
    if (this.phase >= 3 && ready('quake') && dist >= a.quake.minRange && dist <= a.quake.maxRange) {
      candidates.push('quake')
    }
    if (candidates.length === 0) return
    this.startAttack(candidates[Math.floor(Math.random() * candidates.length)], playerPos)
  }

  // Begin an attack's telegraph. Public on purpose: it is also the headless
  // test seam — force any attack regardless of phase/range/cooldown; the
  // telegraph still runs, so timing asserts stay honest.
  startAttack(key, playerPos) {
    const a = this.cfg.attacks[key]
    this.state = 'telegraph'
    this.attack = key
    this.timer = a.telegraphSeconds
    this.telegraphTotal = a.telegraphSeconds
    const factor = this.phase >= 3 ? this.cfg.phase3CooldownFactor : 1
    this.cooldowns[key] = a.cooldownSeconds * factor + a.telegraphSeconds
    if (key === 'quake' && playerPos) {
      // Mark the player's CURRENT cell — the blast lands there, so walking
      // away during the telegraph dodges it. That's the fight's signature.
      const feetY = playerPos.y - PLAYER.eyeHeight
      this.quakeTarget = { x: playerPos.x, y: feetY - 0.5, z: playerPos.z }
      this.onEvent?.('quakeMark', {
        x: playerPos.x,
        y: feetY,
        z: playerPos.z,
        seconds: a.telegraphSeconds,
      })
    }
    this.onEvent?.('telegraph', { attack: key })
  }

  // The telegraph ran out — the attack lands (or begins, for the charge).
  #fire(playerPos, damagePlayer, dist) {
    const a = this.cfg.attacks
    const key = this.attack
    this.attack = null
    this.lastAttack = key
    this.state = 'chase'
    if (key === 'slam') {
      this.onEvent?.('slam', { position: this.group.position })
      const feetDiff = Math.abs(playerPos.y - PLAYER.eyeHeight - this.group.position.y)
      if (dist <= a.slam.radius && feetDiff < 3) damagePlayer(a.slam.damage, this)
    } else if (key === 'charge') {
      this.state = 'charge'
      this.timer = a.charge.maxSeconds
      this.chargeDir
        .set(playerPos.x - this.group.position.x, 0, playerPos.z - this.group.position.z)
        .normalize()
      this.onEvent?.('charge', {})
    } else if (key === 'volley') {
      this.#volley(playerPos)
    } else if (key === 'summon') {
      const room = a.summon.maxMinions - this.minions.length
      this.pendingSummon = Math.max(0, Math.min(a.summon.count, room))
      this.onEvent?.('summon', { count: this.pendingSummon })
    } else if (key === 'quake') {
      this.pendingQuake = {
        ...this.quakeTarget,
        radius: a.quake.radius,
        damage: a.quake.damage,
        damageRadius: a.quake.damageRadius,
      }
      this.onEvent?.('quake', this.pendingQuake)
    }
  }

  #enterRoar(phase) {
    this.phase = phase
    this.state = 'roar'
    this.attack = null
    this.timer = this.cfg.roarSeconds
    // Timers reset: the new phase opens with a breath, not a barrage.
    for (const key of Object.keys(this.cooldowns)) this.cooldowns[key] = 1 + Math.random() * 1.5
    this.onEvent?.('phase', { phase, position: this.group.position })
  }

  // Three arrows in a fan with the skeleton's ballistic lead — it leads
  // elevated targets too, so pillar-camping gets shot.
  #volley(playerPos) {
    if (!this.projectiles) return
    const a = this.cfg.attacks.volley
    const origin = new THREE.Vector3(
      this.group.position.x,
      this.group.position.y + HEAD_HEIGHT,
      this.group.position.z,
    )
    const base = new THREE.Vector3().subVectors(playerPos, origin)
    base.y -= PLAYER.eyeHeight * 0.4 // aim at the chest, like the skeleton
    const dist = base.length()
    base.normalize().multiplyScalar(a.arrowSpeed)
    base.y += 0.5 * COMBAT.projectiles.gravity * (dist / a.arrowSpeed)
    const up = new THREE.Vector3(0, 1, 0)
    const fan = (a.fanDegrees * Math.PI) / 180
    for (let i = 0; i < a.arrows; i++) {
      const angle = (i - (a.arrows - 1) / 2) * (fan / Math.max(1, a.arrows - 1))
      this.projectiles.spawn(origin, base.clone().applyAxisAngle(up, angle), {
        fromPlayer: false,
        damage: a.arrowDamage,
      })
    }
    this.projectiles.onShoot?.()
    this.onEvent?.('volley', {})
  }

  // Skull-to-eyes ray, the skeleton's LOS test.
  #lineOfSight(playerPos) {
    const origin = this.#aim.set(
      this.group.position.x,
      this.group.position.y + HEAD_HEIGHT,
      this.group.position.z,
    )
    const dir = new THREE.Vector3().subVectors(playerPos, origin)
    const dist = dir.length()
    if (dist < 0.001) return true
    dir.divideScalar(dist)
    return this.world.raycast(origin, dir, dist) === null
  }

  // Poses + the emissive telegraph channel. Parts lerp toward per-state
  // targets so transitions read as motion; the crown hovers/spins (fast spin
  // = invulnerable) and the core pulses.
  #animate(delta) {
    const p = this.parts
    const c = this.cfg.crown
    const t = this.state === 'telegraph' ? 1 - this.timer / this.telegraphTotal : 0
    let armL = -0.25
    let armR = -0.25
    let torso = 0
    let crownY = c.hover
    let spin = c.spinSpeed
    if (this.state === 'telegraph') {
      if (this.attack === 'slam' || this.attack === 'quake') {
        armL = armR = -2.9 // arms overhead — the AoE radius reads from the pose
      } else if (this.attack === 'charge') {
        torso = 0.5 // crouch + lean at the player
        armL = armR = 0.7
      } else if (this.attack === 'volley') {
        armR = -1.7 // raised hand
      } else if (this.attack === 'summon') {
        torso = 0.55 // kneel
        armL = armR = -0.9
      }
    } else if (this.state === 'charge') {
      torso = 0.5
      armL = armR = 0.7
    } else if (this.state === 'stagger') {
      torso = -0.45
      armL = armR = 0.2
      crownY = c.staggerDrop // the crown drops to chest height — hit it NOW
      spin = 0.3
    } else if (this.state === 'roar') {
      armL = armR = -2.4
      torso = -0.2
      spin = c.roarSpinSpeed // fast spin = invulnerable
    }

    const k = Math.min(1, delta * 10)
    p.armL.rotation.x += (armL - p.armL.rotation.x) * k
    p.armR.rotation.x += (armR - p.armR.rotation.x) * k
    p.torso.rotation.x += (torso - p.torso.rotation.x) * k
    p.crown.rotation.y += spin * delta
    p.crown.position.y += (crownY + Math.sin(this.age * 2) * 0.08 - p.crown.position.y) * k
    p.core.scale.setScalar(1 + 0.2 * Math.sin(this.age * this.cfg.core.pulseSpeed))
    // Quake telegraph: the whole body swells white-hot, readable at range.
    this.group.scale.setScalar(
      this.state === 'telegraph' && this.attack === 'quake' ? 1 + t * 0.08 : 1,
    )

    // Emissive telegraph (shared channel with the hurt flash — red wins
    // while it lasts, the creeper rule).
    if (this.flashTimer <= 0) {
      let r = 0
      let g = 0
      let b = 0
      if (this.state === 'telegraph') {
        let e = t
        if (this.attack === 'charge') e = Math.max(0, Math.sin(t * Math.PI * 6)) * 0.9
        if (this.attack === 'summon') {
          g = e
          r = e * 0.3
          b = e * 0.35
        } else {
          r = g = b = e
        }
      } else if (this.state === 'roar') {
        r = g = b = 0.65 + 0.35 * Math.sin(this.age * 24)
      }
      for (const mat of Object.values(this.materials)) mat.emissive.setRGB(r, g, b)
    }
  }
}
