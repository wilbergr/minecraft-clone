import * as THREE from 'three'
import { GUIDANCE } from '../config.js'

// The Herald of the Hollow King (guidance layer centerpiece): the ghost of
// the last champion who attempted the Trial. A translucent additive figure —
// deliberately NOT a Mob (no physics, health, or AI; and without
// mesh.userData.mob the combat raycast never finds it, so it is intangible
// for free). It stands at the Trial Grounds, bobs, faces the player, raises
// an arm toward the active objective, and "speaks" stage lines through the
// banner + the `herald` whisper-chord synth.
//
// Everything it says is derived: lineKeyFor() is a pure function of
// challenge/siege/boss state (the §2.2 seams), re-checked on every
// challenge.onChange — zero Challenge.js edits. Scripted beats (the unlock
// apparition, boss-phase calls, the retry scold, the farewell) arrive via
// onRevealDismissed()/onBossEvent()/farewell(), wired in bindGuidance.
//
// Tone arc (captain-locked): the config lines run empathetic → urgent →
// lightly scolding as the Trial advances; this module only picks keys.
export function lineKeyFor(challenge) {
  if (!challenge.activated) return null
  if (challenge.isComplete) return 'complete'
  if (challenge.stage === 0) return challenge.relics.allFound ? 'deliver' : 'relics'
  if (challenge.stage === 1) return 'beacon'
  if (challenge.stage === 2) {
    const siege = challenge.siege
    if (siege.active) return 'siegeActive'
    if (siege.armed) return 'siegeArmed'
    return 'siegeDisarmed'
  }
  const fight = challenge.bossFight
  if (fight.state === 'fighting') return 'bossFight'
  if (fight.state === 'rumbling') return 'bossRumble'
  return 'boss'
}

export class Herald {
  constructor({ challenge, world, scene, camera, banner, sounds, particles, health }) {
    this.challenge = challenge
    this.world = world
    this.scene = scene
    this.camera = camera
    this.banner = banner
    this.sounds = sounds
    this.particles = particles
    this.health = health
    this.cfg = GUIDANCE.herald

    this.group = null // the figure (built lazily on activation)
    this.material = null // ONE shared material — the flicker touches one uniform
    this.arm = null // pointing-arm pivot group (shoulder joint)
    this.state = 'hidden' // 'hidden' | 'apparition' | 'resident' | 'dissolving' | 'gone'
    this.lineKey = null // last spoken key (test seam)
    this.time = 0 // drives bob/flicker
    this.timer = 0 // apparition/dissolve countdown
    this.nearLatch = false // spoke on approach; resets when the player leaves
    this.pendingApparition = false // live unlock happened; wait out the reveal modal
    this.suppressRetryLine = false // a leash line already covered this reset
    this.onDissolved = null // farewell callback (bindGuidance → challengeReveal.show)
    this.#derivedKey = lineKeyFor(challenge)
    this.#prevSiege = { active: challenge.siege.active }
    this.#prevBossState = challenge.bossFight.state

    // Restored-already-active worlds get the resident figure silently; the
    // live unlock (activated flips during play) holds for the reveal modal.
    if (challenge.activated && !challenge.isComplete) this.#buildResident()
    if (challenge.isComplete) this.state = 'gone' // nothing left to say
    challenge.onChange(() => this.#onChange())
  }

  #derivedKey
  #prevSiege
  #prevBossState

  // The resident spot: offset from the anchor, feet on the pristine surface.
  #residentPosition() {
    const a = this.challenge.anchorPosition
    const x = a.x + this.cfg.offset.x
    const z = a.z + this.cfg.offset.z
    return new THREE.Vector3(x, this.world.terrainHeight(Math.floor(x), Math.floor(z)) + this.cfg.hover, z)
  }

  #buildResident() {
    this.#buildFigure(this.#residentPosition())
    this.state = 'resident'
    this.lineKey = this.#derivedKey
  }

  // ~7 box parts sharing one additive translucent material: hooded head,
  // torso, robe skirt (no legs — it hovers), a hanging arm, and the pointing
  // arm on a shoulder pivot so poses rotate the joint, not the box center.
  #buildFigure(position) {
    if (this.group) return
    this.material = new THREE.MeshBasicMaterial({
      color: this.cfg.color,
      transparent: true,
      opacity: this.cfg.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const g = new THREE.Group()
    const part = (w, h, d, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.material)
      mesh.position.set(x, y, z)
      g.add(mesh)
      return mesh
    }
    part(0.66, 1.05, 0.44, 0, 0.55, 0) // robe skirt
    part(0.56, 0.55, 0.36, 0, 1.3, 0) // torso
    part(0.44, 0.44, 0.44, 0, 1.82, 0) // hooded head
    part(0.14, 0.6, 0.14, -0.36, 1.28, 0) // hanging arm
    // Pointing arm: pivot at the right shoulder; the arm box hangs below it
    // so rotating the pivot swings the whole limb.
    this.arm = new THREE.Group()
    this.arm.position.set(0.36, 1.55, 0)
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.14), this.material)
    armMesh.position.set(0, -0.32, 0)
    this.arm.add(armMesh)
    g.add(this.arm)
    g.position.copy(position)
    this.scene.add(g)
    this.group = g
    this.baseY = position.y
  }

  #disposeFigure() {
    if (!this.group) return
    this.group.traverse((o) => o.geometry?.dispose())
    this.material.dispose()
    this.scene.remove(this.group)
    this.group = null
    this.arm = null
  }

  // --- Speaking ---------------------------------------------------------------

  // Speak a config line: banner always (the trial speaks through the bond),
  // whisper only within earshot of the figure (the distance-gain convention).
  say(key) {
    const line = this.cfg.lines[key]
    if (!line) return
    this.lineKey = key
    this.banner.say(line)
    const from = this.group?.position ?? this.challenge.anchorPosition
    const dist = this.camera.position.distanceTo(from)
    const gain = 1 - dist / this.cfg.hearRadius
    if (gain > 0.03) this.sounds.play('herald', { gain })
  }

  // --- Transition observation (challenge.onChange) -----------------------------

  #onChange() {
    const c = this.challenge
    // Live unlock: hold the apparition until the treasure reveal is dismissed
    // (onRevealDismissed) so the two moments never fight for attention.
    if (c.activated && this.state === 'hidden') this.pendingApparition = true

    // Failure lines first — and they win the change event: a fail flips the
    // derived key too (siegeActive → siegeDisarmed, bossFight → boss), and
    // re-speaking that generic line here would bury the retry guidance.
    let spoke = false

    // Siege fail: was active, no longer, and the stage didn't move on. Gate
    // on the STAGE, not the latched siegeCleared flag — a win advances the
    // stage inside the same emit, while skipToStage jumps can leave stale
    // latches behind (siegeCleared stays true after a skip past-and-back).
    if (this.#prevSiege.active && !c.siege.active && c.stage === 2) {
      this.say('siegeFailed')
      spoke = true
    }
    this.#prevSiege.active = c.siege.active

    // Boss retry scold: the fight ended (fighting → idle) without a win —
    // stage-gated like the siege (a victory lands on stage 4 in this same
    // emit). A leash reset already spoke through onBossEvent; consume that
    // flag so the player isn't scolded twice for one reset.
    const bossState = c.bossFight.state
    if (this.#prevBossState === 'fighting' && bossState === 'idle' && c.stage === 3) {
      if (this.suppressRetryLine) this.suppressRetryLine = false
      else this.say('bossRetry')
      spoke = true
    }
    this.#prevBossState = bossState

    // Stage-derived line: speak whenever the derived key changes (stage
    // latches, siege arm/begin, boss summon/rise, delivery readiness) —
    // except 'complete', which the farewell ceremony owns.
    const key = lineKeyFor(c)
    if (key !== this.#derivedKey) {
      this.#derivedKey = key
      if (key && key !== 'complete' && this.state !== 'hidden' && !spoke) this.say(key)
    }
  }

  // The boss observability seam (wired in bindGuidance over the fx handler).
  onBossEvent(type, data) {
    if (type === 'phase') this.say(data.phase >= 3 ? 'bossPhase3' : 'bossPhase2')
    if (type === 'leash') {
      this.suppressRetryLine = true
      this.say('bossLeash')
    }
  }

  // --- The unlock apparition ----------------------------------------------------

  // The treasure reveal was dismissed after a live unlock: materialize a few
  // blocks ahead of the player, speak, point home, then flow away as motes.
  onRevealDismissed() {
    if (!this.pendingApparition || this.state !== 'hidden') return
    this.pendingApparition = false
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    const x = this.camera.position.x + dir.x * this.cfg.apparitionDistance
    const z = this.camera.position.z + dir.z * this.cfg.apparitionDistance
    const y = this.world.terrainHeight(Math.floor(x), Math.floor(z)) + this.cfg.hover
    this.#buildFigure(new THREE.Vector3(x, y, z))
    this.state = 'apparition'
    this.timer = this.cfg.apparitionSeconds
    this.say('unlock')
  }

  // Dissolve into a stream of motes flowing toward the Trial Grounds — the
  // wisp trail's debut — then take up residence at the anchor.
  #finishApparition() {
    this.#moteStream(this.group.position, this.challenge.anchorPosition)
    this.group.position.copy(this.#residentPosition())
    this.baseY = this.group.position.y
    this.state = 'resident'
  }

  #moteStream(from, to) {
    const n = this.cfg.moteBursts
    for (let i = 0; i <= n; i++) {
      const t = i / n
      this.particles.burst(
        from.x + (to.x - from.x) * t,
        from.y + 1.2 + t * 2,
        from.z + (to.z - from.z) * t,
        this.cfg.color,
        6,
      )
    }
  }

  // --- Completion farewell --------------------------------------------------------

  // The Trial is complete: speak the farewell, dissolve for good, then hand
  // the moment to the reveal modal via onDissolved.
  farewell(onDissolved) {
    if (!this.group) {
      onDissolved?.()
      this.state = 'gone'
      return
    }
    this.onDissolved = onDissolved
    this.state = 'dissolving'
    this.timer = this.cfg.dissolveSeconds
    this.say('complete')
    this.#moteStream(this.group.position, this.challenge.anchorPosition)
  }

  // --- Per-frame ----------------------------------------------------------------

  update(delta, playerPos) {
    if (!this.group) return
    this.time += delta
    // Spectral flicker + bob, shared by every state that renders.
    const { flicker, bob } = this.cfg
    let opacity = this.cfg.opacity + Math.sin(this.time * flicker.speed) * flicker.amount
    if (this.state === 'dissolving') opacity *= Math.max(0, this.timer / this.cfg.dissolveSeconds)
    this.material.opacity = opacity
    this.group.position.y = this.baseY + Math.sin(this.time * bob.speed) * bob.amplitude

    const dx = playerPos.x - this.group.position.x
    const dz = playerPos.z - this.group.position.z
    const dist = Math.hypot(dx, dz)
    if (dist < this.cfg.faceRadius) this.group.rotation.y = Math.atan2(dx, dz)

    if (this.state === 'apparition') {
      this.#pointAt(this.challenge.anchorPosition)
      this.timer -= delta
      if (this.timer <= 0) this.#finishApparition()
      return
    }
    if (this.state === 'dissolving') {
      this.timer -= delta
      if (this.timer <= 0) {
        this.#disposeFigure()
        this.state = 'gone'
        this.onDissolved?.()
        this.onDissolved = null
      }
      return
    }

    // Resident: point at the active objective and re-speak the stage line
    // when the player walks up (once per approach).
    this.#pointAt(this.#objectivePosition())
    if (dist < this.cfg.speakRadius) {
      if (!this.nearLatch) {
        this.nearLatch = true
        this.say(this.#reminderKey())
      }
    } else {
      this.nearLatch = false
    }
  }

  // What an approach repeats: normally the stage's derived line — but a
  // spoken failure/scold line stays the better guidance until the stage
  // state actually moves on, so it wins while its stage-idle key holds.
  #reminderKey() {
    const overrides = { siegeFailed: 'siegeDisarmed', bossRetry: 'boss', bossLeash: 'boss' }
    return overrides[this.lineKey] === this.#derivedKey ? this.lineKey : this.#derivedKey
  }

  // Where the raised arm aims: the "where do I go / what do I touch" answer.
  #objectivePosition() {
    const c = this.challenge
    if (c.stage === 0) {
      const relic = c.relics.activeRelic
      return relic && !c.relics.allFound ? relic.position : c.anchorPosition
    }
    if (c.stage === 2 || c.stage === 3) {
      // The gold core when it waits to be clicked; the enemy when it walks.
      if (c.stage === 3 && c.bossFight.boss) return c.bossFight.boss.group.position
      if (c.stage === 2 && c.siege.active) {
        const mob = c.siege.pinned.find((m) => c.siege.mobs?.mobs.includes(m))
        if (mob) return mob.group.position
      }
      const s = c.structure
      return new THREE.Vector3(s.anchorX + 0.5, s.baseY + 1.5, s.anchorZ + 0.5)
    }
    return c.anchorPosition
  }

  // Aim the shoulder pivot so the arm (default hanging along -Y) points at
  // the target. The group only yaws, so the local direction is the world
  // direction rotated back by -yaw.
  #pointAt(target) {
    if (!this.arm || !target) return
    const shoulder = new THREE.Vector3(0.36, 1.55, 0)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y)
      .add(this.group.position)
    const dir = new THREE.Vector3().subVectors(target, shoulder).normalize()
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.group.rotation.y)
    this.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
  }
}
