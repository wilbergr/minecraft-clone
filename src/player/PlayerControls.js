import * as THREE from 'three'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { GRAPHICS, LAVA, PHYSICS, PLAYER, WATER } from '../config.js'
import { BLOCKS } from '../world/blocks.js'
import { PhysicsBody } from '../physics/PhysicsBody.js'
import { isTouchDevice } from './TouchControls.js'

// First-person controls: pointer-lock mouse look + WASD movement with
// delta-time integration and velocity damping, driving a real physics body
// (Phase 8). The body owns the feet position; the camera rides at eye height
// above it. Gravity, jumping (Space, held = auto-hop), sneaking (Shift, or C
// as an alias — slower, won't walk off edges), and AABB block collision all
// live in PhysicsBody; this class turns input into a desired horizontal
// velocity and hands it over each frame. Sprinting is Minecraft's
// double-tap-forward: a second forward press within
// PLAYER.sprint.doubleTapSeconds latches sprint until forward releases (so
// it is forward-only by construction), sneak engages, or control unlocks —
// and the optional canSprintHook (main.js wires the hunger gate) can refuse
// it.
//
// Touch devices (Phase 7) have no pointer lock, so `isLocked` — the flag
// every game system gates on, meaning "the player is actively in control" —
// is also satisfied by `touchActive`, toggled by the same lock()/unlock()
// calls. TouchControls drives the camera directly for look and feeds
// `touchMove` (an analog stick vector) into update() for movement; its jump
// button holds keys.jump and buffers a tap via queueJump().
export class PlayerControls {
  #euler = new THREE.Euler(0, 0, 0, 'YXZ')

  constructor(camera, domElement, world) {
    this.camera = camera
    this.world = world
    this.controls = new PointerLockControls(camera, domElement)

    this.touchMode = isTouchDevice()
    this.touchActive = false // touch-mode stand-in for pointer lock
    this.touchMove = new THREE.Vector2() // joystick: x = strafe right, y = forward

    // Camera-local control velocity (x = strafe, z = back); the body gets
    // the world-space rotation of it every frame.
    this.velocity = new THREE.Vector3()
    this.body = new PhysicsBody(world, PHYSICS.playerAABB)
    this.keys = {
      forward: false,
      back: false,
      left: false,
      right: false,
      sneak: false,
      jump: false,
    }
    this.jumpBuffer = 0 // seconds a tapped (touch) jump keeps waiting for ground
    this.eyeOffset = 0 // smoothed sneak crouch, subtracted from eye height
    this.isSprinting = false // sprint input while actually moving (hunger drain reads this)
    // Double-tap-forward sprint (MC scheme): the latch holds while forward
    // stays down; cleared on release, sneak, or unlock.
    this.sprintLatch = false
    this.lastForwardDownAt = -Infinity
    // Optional gate consulted before sprinting (main.js wires the MC hunger
    // rule: no sprint at or under PLAYER.sprint.minHunger); bare runs sprint
    // freely.
    this.canSprintHook = null
    // Decaying hit-shove (Phase 13): control input overwrites the body's
    // horizontal velocity every frame, so knockback rides its own vector
    // that update() adds on top — the same trick mobs use.
    this.knock = new THREE.Vector3()
    // Optional custom respawn-point provider (bed spawn, wired in main.js):
    // returns feet {x, y, z} to respawn at, or null for the default spawn.
    this.spawnHook = null
    // Elytra glide (the End): `armor` is attached by main.js (combat owns
    // it) — bare runs never deploy. Deployment wants a FRESH jump press
    // (jumpTapped, an #onKey edge) so the held-Space auto-hop never
    // auto-deploys; touch taps arrive through the existing jumpBuffer.
    this.armor = null
    this.gliding = false
    this.glideSpeed = 0
    this.jumpTapped = false
    this.glideWear = 0

    this.respawn()

    document.addEventListener('keydown', (e) => {
      // Space scrolls / re-activates focused buttons; it's ours while playing.
      if (e.code === 'Space' && this.isLocked) e.preventDefault()
      this.#onKey(e.code, true)
    })
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.isLocked) e.preventDefault()
      this.#onKey(e.code, false)
    })
  }

  // Put the player at the spawn point (initial spawn and death respawn).
  // spawnHook (the bed spawn) wins when it offers a point; otherwise the
  // origin PLAYER.spawnPoint column, at its current surface.
  respawn() {
    const custom = this.spawnHook?.()
    if (custom) {
      this.teleport(custom.x, custom.y, custom.z)
      return
    }
    const { x, z } = PLAYER.spawnPoint
    this.teleport(x, this.world.surfaceY(x, z), z)
  }

  // Move the player's feet to (x, y, z), clearing motion so no stale fall
  // distance lands after the warp. The one sanctioned way to relocate the
  // player — writing camera.position directly gets overwritten by the body.
  teleport(x, y, z) {
    this.velocity.set(0, 0, 0)
    this.body.velocity.set(0, 0, 0)
    this.knock.set(0, 0, 0)
    this.body.fallDistance = 0
    this.body.grounded = false // until physics proves otherwise at the new spot
    this.body.position.set(x, y, z)
    this.#syncCamera(0)
  }

  get isLocked() {
    return this.controls.isLocked || this.touchActive
  }

  // In touch mode lock()/unlock() flip touchActive and dispatch the same
  // lock/unlock events pointer lock would, so overlay/menu wiring is shared.
  // Unlike real pointer lock, the flag is updated BEFORE the event fires, so
  // handlers may read it directly (see src/ui/overlay.js).
  lock() {
    if (this.touchMode) {
      if (this.touchActive) return
      this.touchActive = true
      this.controls.dispatchEvent({ type: 'lock' })
    } else {
      this.controls.lock()
    }
  }

  unlock() {
    if (this.touchMode) {
      if (!this.touchActive) return
      this.touchActive = false
      this.controls.dispatchEvent({ type: 'unlock' })
    } else {
      this.controls.unlock()
    }
  }

  addEventListener(type, listener) {
    this.controls.addEventListener(type, listener)
  }

  // Touch jump button: remember the tap briefly so pressing a hair before
  // landing still jumps (touch taps are too short to rely on being grounded
  // the exact frame they arrive).
  queueJump() {
    this.jumpBuffer = PHYSICS.touchJumpBufferSeconds
  }

  // Shove the player (Phase 13: mob hits, arrows, explosions): a horizontal
  // impulse along `dir` (unit XZ) that decays over the next moments, plus an
  // upward pop applied as a velocity floor so back-to-back hits don't stack
  // into a launch.
  applyKnockback(dir, horizontal = PHYSICS.jumpVelocity, vertical = 0) {
    this.knock.x += dir.x * horizontal
    this.knock.z += dir.z * horizontal
    this.body.velocity.y = Math.max(this.body.velocity.y, vertical)
  }

  #onKey(code, down) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        // A second forward press within the double-tap window latches
        // sprint (key repeat never fires here — the transition check guards
        // it); releasing forward drops the latch, so sprint is forward-only.
        if (down && !this.keys.forward) {
          const now = performance.now() / 1000
          if (now - this.lastForwardDownAt < PLAYER.sprint.doubleTapSeconds) {
            this.sprintLatch = true
          }
          this.lastForwardDownAt = now
        }
        if (!down) this.sprintLatch = false
        this.keys.forward = down
        break
      case 'KeyS':
      case 'ArrowDown':
        this.keys.back = down
        break
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = down
        break
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = down
        break
      case 'Space':
        if (down && !this.keys.jump) this.jumpTapped = true // fresh-press edge (glide deploy)
        this.keys.jump = down
        break
      // Shift sneaks (MC scheme); C stays as an alias for pre-remap muscle
      // memory. No dedicated sprint key: MC's default is Ctrl, and pointer
      // lock doesn't intercept Ctrl+W / Ctrl+S — a Ctrl sprint while moving
      // would be closing tabs and saving pages. Double-tap forward instead.
      case 'ShiftLeft':
      case 'ShiftRight':
      case 'KeyC':
        this.keys.sneak = down
        if (down) this.sprintLatch = false // sneak cancels a held sprint
        break
    }
  }

  // --- Persistence seam (Phase 5) -------------------------------------------
  // PointerLockControls drives the camera through a YXZ euler, so pitch/yaw
  // round-trip through the quaternion the same way its mouse handler does.

  serialize() {
    const e = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.camera.quaternion)
    const p = this.camera.position
    return { position: [p.x, p.y, p.z], pitch: e.x, yaw: e.y }
  }

  // Defensive: anything malformed leaves the player at the spawn point.
  deserialize(data) {
    const [x, y, z] = Array.isArray(data?.position) ? data.position : []
    if (![x, y, z].every(Number.isFinite)) return
    this.teleport(x, y - PLAYER.eyeHeight, z)
    this.camera.quaternion.setFromEuler(
      new THREE.Euler(data.pitch ?? 0, data.yaw ?? 0, 0, 'YXZ'),
    )
  }

  update(delta) {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - delta)
    if (!this.isLocked) {
      this.isSprinting = false
      this.sprintLatch = false // unlock drops a held sprint, like MC
      this.jumpTapped = false
      return
    }

    // Elytra glide (the End): while deployed the glide model owns the
    // body's whole velocity — the WASD/jump/dive scheme below is bypassed.
    if (this.#updateGlide(delta)) {
      this.isSprinting = false
      this.body.step(delta)
      this.#syncCamera(delta)
      this.#updateFov(delta, true) // flight reads fast — the sprint FOV cue
      return
    }

    // Exponential damping so movement stops smoothly when keys release.
    const damp = Math.exp(-PLAYER.damping * delta)
    this.velocity.multiplyScalar(damp)

    // Sprint: the double-tap-forward latch on keyboard, full joystick
    // deflection on touch — both refused while sneaking or when the
    // canSprintHook (the hunger gate) says no.
    const sneaking = this.keys.sneak
    const sprinting =
      !sneaking &&
      (this.canSprintHook?.() ?? true) &&
      ((this.sprintLatch && this.keys.forward) || this.touchMove.length() >= 0.999)
    // Liquid feel: lava is viscous (lava feature) — same swim scheme as
    // water, roughly half the speeds. One table pick covers all four reads.
    const liquid = this.body.inLava ? LAVA.physics : WATER.physics
    // Walked-on slow factor (N4, soul sand): one blockAt at the feet cell —
    // the block the player is standing IN the top face of. Owner-side (the
    // Mob.locomote twin); PhysicsBody stays speed-agnostic. Airborne feet
    // sit in an air cell, so jumps escape the slow automatically.
    const feet = this.body.position
    const slow =
      BLOCKS[
        this.world.blockAt(Math.floor(feet.x), Math.floor(feet.y - 0.05), Math.floor(feet.z))
      ]?.slow ?? 1
    const speed =
      PLAYER.moveSpeed *
      slow *
      (sprinting
        ? PLAYER.sprintMultiplier
        : sneaking
          ? PHYSICS.sneak.speedMultiplier
          : 1) *
      (this.body.inWater ? liquid.moveMultiplier : 1) // swimming is slower
    const accel = speed * PLAYER.damping * delta

    if (this.keys.forward) this.velocity.z -= accel
    if (this.keys.back) this.velocity.z += accel
    if (this.keys.left) this.velocity.x -= accel
    if (this.keys.right) this.velocity.x += accel

    // Analog joystick input (touch mode; zero vector otherwise).
    this.velocity.x += this.touchMove.x * accel
    this.velocity.z -= this.touchMove.y * accel

    // Rotate the camera-local control velocity by the camera yaw into the
    // body's world-space horizontal velocity (vertical stays the body's —
    // that's gravity and jumps).
    const yaw = this.#euler.setFromQuaternion(this.camera.quaternion).y
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    this.body.velocity.x = this.velocity.x * cos + this.velocity.z * sin
    this.body.velocity.z = -this.velocity.x * sin + this.velocity.z * cos

    // Hit-shove (Phase 13) rides on top of control velocity, then decays —
    // the player steers through the knockback rather than losing input.
    this.body.velocity.x += this.knock.x
    this.body.velocity.z += this.knock.z
    this.knock.multiplyScalar(Math.exp(-8 * delta))

    // Jump when grounded: held Space keeps hopping (handy when every full
    // block takes a jump); a buffered touch tap is spent once. In water
    // (Phase 10) Space swims up instead — with a stronger boost against a
    // wall, so the shore's 1-block lip can be climbed straight out of the sea.
    if (this.keys.jump || this.jumpBuffer > 0) {
      if (this.body.grounded && !this.body.inWater) {
        this.body.velocity.y = PHYSICS.jumpVelocity
        this.jumpBuffer = 0
      } else if (this.body.inWater) {
        this.body.velocity.y = this.body.hitWall
          ? PHYSICS.jumpVelocity * liquid.breachBoost
          : liquid.swimUpSpeed
        this.jumpBuffer = 0
      }
    }

    // Dive (deep water): sneak (Shift, or the C alias) swims down — exactly
    // MC's Shift-to-descend. Sneak's land meaning (edge-stop, slow) is
    // meaningless mid-water, so the key overload is clean; the passive
    // drag-capped sink is too slow for a deliberate 10-block dive. Space
    // wins when both are held. Touch inherits it through the ⬇ sneak toggle
    // button (TouchControls drives keys.sneak).
    if (this.keys.sneak && this.body.inWater && !this.keys.jump) {
      this.body.velocity.y = -liquid.swimDownSpeed
    }

    // Sprint that actually covers ground (same "moving" test as the FOV cue).
    this.isSprinting = sprinting && this.velocity.lengthSq() > 1
    this.jumpTapped = false // a press that didn't deploy is spent

    this.body.step(delta, { sneak: sneaking })
    this.#syncCamera(delta)
    this.#updateFov(delta, sprinting && this.velocity.lengthSq() > 1)
  }

  // The glide model (~PLAYER.glide): deploy on a fresh jump press while
  // airborne, descending, wings equipped; pitch-to-speed with momentum —
  // s += (gain·sin(−pitch) − drag·s)·dt, velocity = look·s with a constant
  // sink term, residual gravity through the gravityScale seam. Returns true
  // while the glide owns the frame.
  #updateGlide(delta) {
    const g = PLAYER.glide
    const body = this.body
    const hasWings = this.armor?.slots.chest?.id === 'elytra'

    if (!this.gliding) {
      const tapped = this.jumpTapped || this.jumpBuffer > 0
      this.jumpTapped = false
      if (
        !hasWings ||
        !tapped ||
        body.grounded ||
        body.inWater ||
        body.velocity.y >= 0
      ) {
        return false
      }
      this.gliding = true
      this.jumpBuffer = 0
      this.glideSpeed = Math.max(g.minSpeed, Math.hypot(body.velocity.x, body.velocity.z))
      body.gravityScale = g.gravityScale
    }

    // Exit on any contact — the flare landing, a wave, a clipped pillar —
    // or the wings breaking mid-air (wear below).
    if (body.grounded || body.inWater || body.hitWall || !hasWings) {
      this.gliding = false
      this.glideSpeed = 0
      body.gravityScale = 1
      return false
    }

    const e = this.#euler.setFromQuaternion(this.camera.quaternion)
    const pitch = e.x // negative = looking down
    this.glideSpeed += (g.gain * Math.sin(-pitch) - g.drag * this.glideSpeed) * delta
    this.glideSpeed = Math.max(g.minSpeed, Math.min(g.maxSpeed, this.glideSpeed))
    const horizontal = this.glideSpeed * Math.cos(pitch)
    const sin = Math.sin(e.y)
    const cos = Math.cos(e.y)
    // Steering is by look; A/D add a gentle bank drift.
    const bank = ((this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0)) * g.bankSpeed
    body.velocity.x = -sin * horizontal + cos * bank
    body.velocity.z = -cos * horizontal - sin * bank
    body.velocity.y = this.glideSpeed * Math.sin(pitch) - g.sink
    // Knockback still lands mid-air (a dragon swoop mid-glide shoves).
    body.velocity.x += this.knock.x
    body.velocity.z += this.knock.z
    this.knock.multiplyScalar(Math.exp(-8 * delta))
    body.fallDistance = 0 // gliding IS the fall-damage escape (the water rule)

    // Wear: glide time grinds the wings; at zero armor.onBreak plays the
    // snap and the missing piece exits the glide next frame.
    this.glideWear += delta
    while (this.glideWear >= g.wearSeconds) {
      this.glideWear -= g.wearSeconds
      this.armor.wearSlot('chest')
    }
    return true
  }

  // Camera rides at eye height over the feet, dipping while sneaking.
  #syncCamera(delta) {
    this.eyeOffset = THREE.MathUtils.damp(
      this.eyeOffset,
      this.keys.sneak ? PHYSICS.sneak.eyeDrop : 0,
      20,
      delta,
    )
    const p = this.body.position
    this.camera.position.set(p.x, p.y + PLAYER.eyeHeight - this.eyeOffset, p.z)
  }

  // Speed cue: widen the FOV a touch while moving fast (sprint or glide).
  #updateFov(delta, boosted) {
    const target = GRAPHICS.fov + (boosted ? PHYSICS.sprintFov.boost : 0)
    if (Math.abs(this.camera.fov - target) < 0.01) return
    this.camera.fov = THREE.MathUtils.damp(
      this.camera.fov,
      target,
      PHYSICS.sprintFov.lerp,
      delta,
    )
    this.camera.updateProjectionMatrix()
  }
}
