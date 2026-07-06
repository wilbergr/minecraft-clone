import * as THREE from 'three'
import { END } from '../config.js'
import { Mob } from './Mob.js'

// The Ender Dragon (the End) — a Mob on the Boss template with one big
// simplification: KINEMATIC flight. The arena is open sky over a known
// island, so its movement vocabulary (orbit the pillar ring, dive through a
// marked point, land on the center perch) is paths, not navigation —
// update() drives group.position along state-owned trajectories directly.
// The Mob base's body still makes it hittable (melee raycasts key off
// part()'s userData.mob; arrows test body.half/height around
// group.position); it simply never calls locomote/step, so gravity never
// applies.
//
// Fight shape (phases are fight beats, not health bands like the Boss's):
//   1 — Crystals: while any end crystal lives the runner heals the dragon
//       (the healing beams ARE the teach); it never perches.
//   2 — Perch cycles (crystals dead): orbit → swoop/fireball → perch, the
//       melee window (damage taken ×perch.damageFactor).
//   3 — Enrage below `enrageAt` health: cooldowns ×enrageCooldownFactor,
//       swoop/return speeds ×enrageSpeedFactor.
// Transitions are announced by a 2s invulnerable roar (the Boss rule).
//
// Attacks touch only the player (via the in-loop-legal damagePlayer
// callback) and projectiles (skeleton/volley precedent) — nothing pends to
// MobManager. `startAttack(key, playerPos)` is public: the headless seam
// that forces any attack past cooldown/phase gates (the telegraph still
// runs). All knobs in END.dragon (src/config.js).

const GEOM = {
  body: new THREE.BoxGeometry(2.2, 1.2, 3.4),
  neck: new THREE.BoxGeometry(0.7, 0.7, 1.1),
  head: new THREE.BoxGeometry(0.95, 0.8, 1.2),
  jaw: new THREE.BoxGeometry(0.7, 0.25, 0.95),
  eye: new THREE.BoxGeometry(0.14, 0.1, 0.14),
  wingInner: new THREE.BoxGeometry(2.3, 0.12, 1.9),
  wingOuter: new THREE.BoxGeometry(2.0, 0.1, 1.5),
  tail1: new THREE.BoxGeometry(0.8, 0.6, 1.3),
  tail2: new THREE.BoxGeometry(0.6, 0.45, 1.2),
  tail3: new THREE.BoxGeometry(0.4, 0.3, 1.1),
}

const COLORS = { body: 0x161020, wing: 0x1e1628, belly: 0x241b31 }
const HEAD_HEIGHT = 1.5 // fireball origin + LOS eye level over the feet

export class EnderDragon extends Mob {
  #toPlayer = new THREE.Vector3()
  #aim = new THREE.Vector3()
  #swoopP0 = new THREE.Vector3()
  #swoopP1 = new THREE.Vector3()
  #swoopP2 = new THREE.Vector3()
  #dest = new THREE.Vector3()

  constructor(world, x, z, projectiles) {
    super(world, END.dragon.health)
    this.cfg = END.dragon
    this.projectiles = projectiles // null in bare runs — fireballs never fire
    this.kind = 'dragon'
    this.persistent = true // never distance-despawns — the island IS the arena
    this.growls = false
    this.phase = 1 // 1 crystals / 2 perch cycles / 3 enrage
    this.state = 'rise' // rise|orbit|telegraph|swoop|return|descend|perched|roar
    this.attack = null // attack key while telegraphing
    this.lastAttack = null // test observability
    this.timer = 0
    this.telegraphTotal = 1
    this.age = 0
    this.angle = Math.random() * Math.PI * 2 // orbit parameter
    this.center = { x: 0.5, z: 0.5 } // the island center — perch + orbit axis
    this.swoopT = 0
    this.swoopSeconds = 1
    this.swoopHit = false
    this.riseSpeed = null // fixed on the rise's first frame
    this.cooldowns = { swoop: 4, fireball: 2.5, perch: 8 }
    this.onHealth = null // callback(hp, max) — DragonFight wires the HP bar
    this.onEvent = null // callback(type, data) — observability seam
    this.makeMaterials(COLORS)
    // Violet eyes: unlit (MeshBasic), kept OUT of `materials` so the hurt
    // flash / telegraph emissive never touch them (the crown/core rule).
    this.eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xd05ce8 })
    this.attachBody(this.#buildBody(), x, z, this.cfg.aabb)
  }

  get invulnerable() {
    return this.state === 'roar' || this.state === 'rise'
  }

  // Forward is +z (the Mob facing convention). Wings hang from pivot groups
  // at the shoulders so the flap rotates the joint, not the box center.
  #buildBody() {
    const m = this.materials
    const group = new THREE.Group()
    const wingPivot = (side) => {
      const pivot = new THREE.Group()
      pivot.position.set(side * 1.1, 1.5, 0.3)
      pivot.add(this.part(GEOM.wingInner, m.wing, side * 1.2, 0, 0))
      pivot.add(this.part(GEOM.wingOuter, m.wing, side * 2.9, 0, -0.1))
      return pivot
    }
    const head = this.part(GEOM.head, m.body, 0, 1.5, 2.9)
    const jaw = this.part(GEOM.jaw, m.belly, 0, 1.1, 3.05)
    const wingL = wingPivot(-1)
    const wingR = wingPivot(1)
    const tail = [
      this.part(GEOM.tail1, m.body, 0, 1.0, -2.3),
      this.part(GEOM.tail2, m.body, 0, 1.0, -3.5),
      this.part(GEOM.tail3, m.wing, 0, 1.0, -4.6),
    ]
    group.add(
      this.part(GEOM.body, m.body, 0, 1.0, 0),
      this.part(GEOM.neck, m.body, 0, 1.35, 2.0),
      head,
      jaw,
      this.part(GEOM.eye, this.eyeMaterial, -0.28, 1.7, 3.45),
      this.part(GEOM.eye, this.eyeMaterial, 0.28, 1.7, 3.45),
      wingL,
      wingR,
      ...tail,
    )
    this.parts = { head, jaw, wingL, wingR, tail }
    return group
  }

  // The runner announces the last crystal's death: phase 2 opens with a roar.
  crystalsGone() {
    if (this.phase === 1) this.#enterRoar(2)
  }

  update(delta, playerPos, damagePlayer) {
    const pos = this.group.position
    this.age += delta
    const a = this.cfg.attacks
    const speedScale = this.phase >= 3 ? this.cfg.enrageSpeedFactor : 1

    if (this.state === 'orbit') {
      for (const key of Object.keys(this.cooldowns)) this.cooldowns[key] -= delta
    }

    if (this.state === 'rise') {
      // The runner placed the feet below the island center; climb straight
      // up to orbit height (rate fixed on the first frame).
      const o = this.cfg.orbit
      this.riseSpeed ??= Math.max(2, (o.height - pos.y) / this.cfg.rise.seconds)
      pos.y += this.riseSpeed * delta
      this.group.rotation.y += delta * 1.5
      if (pos.y >= o.height - 0.5) this.#enterReturn()
    } else if (this.state === 'orbit') {
      const o = this.cfg.orbit
      this.angle += (o.speed / o.radius) * delta
      pos.x = this.center.x + Math.sin(this.angle) * o.radius
      pos.z = this.center.z + Math.cos(this.angle) * o.radius
      pos.y = o.height + Math.sin(this.age * o.bobSpeed) * o.bobAmplitude
      // Face along the flight tangent.
      this.group.rotation.y = Math.atan2(Math.cos(this.angle), -Math.sin(this.angle))
      this.#chooseAttack(playerPos)
    } else if (this.state === 'telegraph') {
      // Hover where the orbit left us, facing the player — the rear-up pose
      // + emissive ramp are the tell.
      this.#facePlayer(playerPos)
      this.timer -= delta
      if (this.timer <= 0) this.#fire(playerPos)
    } else if (this.state === 'swoop') {
      this.swoopT += delta / this.swoopSeconds
      const t = Math.min(1, this.swoopT)
      // Quadratic bezier through the marked point (P1 was solved so B(0.5)
      // IS the mark) — dive in, pull out on the far side.
      const q = 1 - t
      pos.set(
        q * q * this.#swoopP0.x + 2 * q * t * this.#swoopP1.x + t * t * this.#swoopP2.x,
        q * q * this.#swoopP0.y + 2 * q * t * this.#swoopP1.y + t * t * this.#swoopP2.y,
        q * q * this.#swoopP0.z + 2 * q * t * this.#swoopP1.z + t * t * this.#swoopP2.z,
      )
      // Face the direction of travel (bezier derivative).
      const dx = 2 * q * (this.#swoopP1.x - this.#swoopP0.x) + 2 * t * (this.#swoopP2.x - this.#swoopP1.x)
      const dz = 2 * q * (this.#swoopP1.z - this.#swoopP0.z) + 2 * t * (this.#swoopP2.z - this.#swoopP1.z)
      this.group.rotation.y = Math.atan2(dx, dz)
      // Contact: one hit per dive — the shove near the rim is the threat.
      if (!this.swoopHit && playerPos.distanceTo(pos) < a.swoop.contactRadius + 1) {
        this.swoopHit = true
        damagePlayer(a.swoop.damage, this)
      }
      if (t >= 1) this.#enterReturn()
    } else if (this.state === 'return') {
      // Fly back to the orbit circle at the nearest angle, then resume.
      if (this.#approach(this.#dest, a.swoop.speed * 0.6 * speedScale, delta)) {
        this.state = 'orbit'
      }
    } else if (this.state === 'descend') {
      if (this.#approach(this.#dest, a.perch.descendSpeed, delta)) {
        this.state = 'perched'
        this.timer = a.perch.seconds
        this.onEvent?.('perch', { position: pos })
      }
      this.#facePlayer(playerPos)
    } else if (this.state === 'perched') {
      this.#facePlayer(playerPos)
      this.timer -= delta
      if (this.timer <= 0) this.#enterReturn()
    } else if (this.state === 'roar') {
      this.timer -= delta
      if (this.timer <= 0) this.#enterReturn()
    }

    // Enrage: announced like every phase change (only out of a roar).
    if (
      this.phase === 2 &&
      this.state !== 'roar' &&
      this.health <= this.cfg.health * this.cfg.enrageAt
    ) {
      this.#enterRoar(3)
    }

    this.#animate(delta)
    if (this.flashTimer > 0) {
      this.flashTimer -= delta
      if (this.flashTimer <= 0) this.setFlash(false)
    }
  }

  // Dragon damage rules: invulnerable during roars and the rise, the perch
  // is the punish window, no knockback, and the HP-bar hook.
  hurt(amount, knockDir) {
    if (this.invulnerable) return false
    const dmg =
      this.state === 'perched' ? amount * this.cfg.attacks.perch.damageFactor : amount
    this.health -= dmg
    this.knock.addScaledVector(knockDir, this.cfg.knockbackFactor) // 0 by default
    this.flashTimer = 0.15
    this.setFlash(true)
    this.onHealth?.(Math.max(0, this.health), this.cfg.health)
    return this.health <= 0
  }

  dispose() {
    super.dispose()
    this.eyeMaterial.dispose()
  }

  // Pick off cooldowns while orbiting. Perch (phase 2+) takes priority —
  // the fight's rhythm is "survive orbits, punish perches".
  #chooseAttack(playerPos) {
    const a = this.cfg.attacks
    if (this.phase >= 2 && this.cooldowns.perch <= 0) {
      this.startAttack('perch', playerPos)
    } else if (this.cooldowns.swoop <= 0) {
      this.startAttack('swoop', playerPos)
    } else if (this.cooldowns.fireball <= 0 && this.#lineOfSight(playerPos)) {
      this.startAttack('fireball', playerPos)
    }
  }

  // Begin an attack's telegraph (perch skips straight to the descent — the
  // long glide down IS its tell). Public: the headless seam that forces any
  // attack regardless of phase/cooldown; the telegraph still runs.
  startAttack(key, playerPos) {
    const a = this.cfg.attacks[key]
    const factor = this.phase >= 3 ? this.cfg.enrageCooldownFactor : 1
    this.cooldowns[key] = a.cooldownSeconds * factor + (a.telegraphSeconds ?? 0)
    if (key === 'perch') {
      this.state = 'descend'
      this.attack = null
      this.lastAttack = 'perch'
      this.#dest.set(
        this.center.x,
        this.world.surfaceY(this.center.x, this.center.z),
        this.center.z,
      )
      this.onEvent?.('telegraph', { attack: 'perch' })
      return
    }
    this.state = 'telegraph'
    this.attack = key
    this.timer = a.telegraphSeconds
    this.telegraphTotal = a.telegraphSeconds
    this.onEvent?.('telegraph', { attack: key })
  }

  // The telegraph ran out — dive or shoot.
  #fire(playerPos) {
    const key = this.attack
    this.attack = null
    this.lastAttack = key
    const a = this.cfg.attacks
    if (key === 'swoop') {
      const speedScale = this.phase >= 3 ? this.cfg.enrageSpeedFactor : 1
      const pos = this.group.position
      this.#swoopP0.copy(pos)
      // The mark is the player's position as the dive begins — locked, so
      // moving during the dive dodges it (the quake-mark signature).
      const mark = this.#aim.set(playerPos.x, playerPos.y - 0.6, playerPos.z)
      const dir = this.#toPlayer.set(mark.x - pos.x, 0, mark.z - pos.z)
      const len = dir.length() || 1
      dir.divideScalar(len)
      this.#swoopP2.set(
        mark.x + dir.x * this.cfg.orbit.radius,
        this.cfg.orbit.height,
        mark.z + dir.z * this.cfg.orbit.radius,
      )
      // Solve the control point so the curve passes THROUGH the mark at
      // t = 0.5: P1 = 2M − (P0 + P2)/2.
      this.#swoopP1.set(
        2 * mark.x - (this.#swoopP0.x + this.#swoopP2.x) / 2,
        2 * mark.y - (this.#swoopP0.y + this.#swoopP2.y) / 2,
        2 * mark.z - (this.#swoopP0.z + this.#swoopP2.z) / 2,
      )
      const approxLen = this.#swoopP0.distanceTo(mark) + mark.distanceTo(this.#swoopP2)
      this.swoopSeconds = approxLen / (a.swoop.speed * speedScale)
      this.swoopT = 0
      this.swoopHit = false
      this.state = 'swoop'
      this.onEvent?.('swoop', { position: this.group.position })
    } else if (key === 'fireball') {
      this.#shootFireball(playerPos)
      this.state = 'orbit' // position never moved during the hover
    }
  }

  // A straight (gravity-0, the E3 seam) bolt from the head at the player.
  #shootFireball(playerPos) {
    if (!this.projectiles) return
    const a = this.cfg.attacks.fireball
    const origin = new THREE.Vector3(
      this.group.position.x,
      this.group.position.y + HEAD_HEIGHT,
      this.group.position.z,
    )
    const vel = new THREE.Vector3().subVectors(playerPos, origin)
    if (vel.lengthSq() < 0.001) return
    vel.normalize().multiplyScalar(a.speed)
    this.projectiles.spawn(origin, vel, { fromPlayer: false, damage: a.damage, gravity: 0 })
    this.onEvent?.('fireball', { position: origin })
  }

  #enterRoar(phase) {
    this.phase = phase
    this.state = 'roar'
    this.attack = null
    this.timer = this.cfg.roarSeconds
    // The new phase opens with a breath, not a barrage.
    this.cooldowns.swoop = 2 + Math.random() * 2
    this.cooldowns.fireball = 1.5 + Math.random()
    this.cooldowns.perch = this.phase === 2 ? 3 : 6
    this.onEvent?.('phase', { phase, position: this.group.position })
  }

  // Route back to the orbit circle from wherever a state ended (kinematic
  // re-entry: never snap, always fly there).
  #enterReturn() {
    const o = this.cfg.orbit
    const pos = this.group.position
    this.angle = Math.atan2(pos.x - this.center.x, pos.z - this.center.z)
    this.#dest.set(
      this.center.x + Math.sin(this.angle) * o.radius,
      o.height,
      this.center.z + Math.cos(this.angle) * o.radius,
    )
    this.state = 'return'
  }

  // Move toward `dest` at `speed`; true once within arrival range.
  #approach(dest, speed, delta) {
    const pos = this.group.position
    const d = this.#toPlayer.subVectors(dest, pos)
    const dist = d.length()
    if (dist < Math.max(1, speed * delta * 1.5)) {
      pos.copy(dest)
      return true
    }
    d.divideScalar(dist)
    pos.addScaledVector(d, speed * delta)
    this.group.rotation.y = Math.atan2(d.x, d.z)
    return false
  }

  #facePlayer(playerPos) {
    const pos = this.group.position
    this.group.rotation.y = Math.atan2(playerPos.x - pos.x, playerPos.z - pos.z)
  }

  // Skull-to-eyes ray (the skeleton LOS test) — pillars can shield.
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

  // Wing beats + poses + the emissive telegraph channel.
  #animate(delta) {
    const p = this.parts
    let flap = Math.sin(this.age * 5) * 0.55 // cruising beat
    let headPitch = 0
    if (this.state === 'perched') {
      flap = 1.05 + Math.sin(this.age * 1.2) * 0.05 // folded, breathing
      headPitch = 0.25 // head low — the melee window reads submissive
    } else if (this.state === 'swoop') {
      flap = -0.35 // tucked dive
      headPitch = 0.4
    } else if (this.state === 'telegraph') {
      flap = -0.7 + Math.sin(this.age * 14) * 0.1 // rear up, trembling
      headPitch = -0.5
    } else if (this.state === 'roar') {
      flap = -0.85
      headPitch = -0.65
    }
    const k = Math.min(1, delta * 8)
    p.wingL.rotation.z += (-flap - p.wingL.rotation.z) * k
    p.wingR.rotation.z += (flap - p.wingR.rotation.z) * k
    p.head.rotation.x += (headPitch - p.head.rotation.x) * k
    p.jaw.rotation.x += ((this.state === 'roar' ? 0.5 : 0) - p.jaw.rotation.x) * k
    for (let i = 0; i < p.tail.length; i++) {
      p.tail[i].rotation.y = Math.sin(this.age * 2 + i * 0.9) * 0.14
    }

    // Emissive telegraph (shared channel with the hurt flash — red wins
    // while it lasts, the creeper rule).
    if (this.flashTimer <= 0) {
      let e = 0
      if (this.state === 'telegraph') e = 1 - this.timer / this.telegraphTotal
      else if (this.state === 'roar') e = 0.5 + 0.5 * Math.sin(this.age * 20)
      for (const mat of Object.values(this.materials)) {
        mat.emissive.setRGB(e * 0.45, e * 0.15, e * 0.6) // violet ramp
      }
    }
  }
}
