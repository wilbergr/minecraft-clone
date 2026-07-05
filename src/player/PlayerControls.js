import * as THREE from 'three'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { GRAPHICS, PHYSICS, PLAYER, WATER } from '../config.js'
import { PhysicsBody } from '../physics/PhysicsBody.js'
import { isTouchDevice } from './TouchControls.js'

// First-person controls: pointer-lock mouse look + WASD movement with
// delta-time integration and velocity damping, driving a real physics body
// (Phase 8). The body owns the feet position; the camera rides at eye height
// above it. Gravity, jumping (Space, held = auto-hop), sneaking (C — slower,
// won't walk off edges), and AABB block collision all live in PhysicsBody;
// this class turns input into a desired horizontal velocity and hands it
// over each frame.
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
      sprint: false,
      sneak: false,
      jump: false,
    }
    this.jumpBuffer = 0 // seconds a tapped (touch) jump keeps waiting for ground
    this.eyeOffset = 0 // smoothed sneak crouch, subtracted from eye height
    this.isSprinting = false // sprint input while actually moving (hunger drain reads this)
    // Decaying hit-shove (Phase 13): control input overwrites the body's
    // horizontal velocity every frame, so knockback rides its own vector
    // that update() adds on top — the same trick mobs use.
    this.knock = new THREE.Vector3()
    // Optional custom respawn-point provider (bed spawn, wired in main.js):
    // returns feet {x, y, z} to respawn at, or null for the default spawn.
    this.spawnHook = null

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
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = down
        break
      case 'Space':
        this.keys.jump = down
        break
      // C, not Ctrl: pointer lock doesn't intercept Ctrl+W / Ctrl+S, so a
      // Ctrl sneak while moving would be closing tabs and saving pages.
      case 'KeyC':
        this.keys.sneak = down
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
      return
    }

    // Exponential damping so movement stops smoothly when keys release.
    const damp = Math.exp(-PLAYER.damping * delta)
    this.velocity.multiplyScalar(damp)

    // Full joystick deflection sprints, mirroring Shift on the keyboard.
    const sneaking = this.keys.sneak
    const sprinting =
      !sneaking && (this.keys.sprint || this.touchMove.length() >= 0.999)
    const speed =
      PLAYER.moveSpeed *
      (sprinting
        ? PLAYER.sprintMultiplier
        : sneaking
          ? PHYSICS.sneak.speedMultiplier
          : 1) *
      (this.body.inWater ? WATER.physics.moveMultiplier : 1) // swimming is slower
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
          ? PHYSICS.jumpVelocity * WATER.physics.breachBoost
          : WATER.physics.swimUpSpeed
        this.jumpBuffer = 0
      }
    }

    // Dive (deep water): C swims down. Sneak's land meaning (edge-stop,
    // slow) is meaningless mid-water, so the key overload is clean; the
    // passive drag-capped sink is too slow for a deliberate 10-block dive.
    // Space wins when both are held. Touch inherits it through the existing
    // ⬇ sneak button (TouchControls holds keys.sneak).
    if (this.keys.sneak && this.body.inWater && !this.keys.jump) {
      this.body.velocity.y = -WATER.physics.swimDownSpeed
    }

    // Sprint that actually covers ground (same "moving" test as the FOV cue).
    this.isSprinting = sprinting && this.velocity.lengthSq() > 1

    this.body.step(delta, { sneak: sneaking })
    this.#syncCamera(delta)
    this.#updateFov(delta, sprinting)
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

  // Sprint speed cue: widen the FOV a touch while actually moving fast.
  #updateFov(delta, sprinting) {
    const moving = this.velocity.lengthSq() > 1
    const target = GRAPHICS.fov + (sprinting && moving ? PHYSICS.sprintFov.boost : 0)
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
