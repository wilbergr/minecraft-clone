import * as THREE from 'three'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { PLAYER } from '../config.js'
import { isTouchDevice } from './TouchControls.js'

// First-person controls: pointer-lock mouse look + WASD movement with
// delta-time integration and velocity damping. The camera follows the
// terrain surface at eye height (smoothed, so steps read as steps rather
// than pops). Still no gravity/jumping or lateral block collision — those
// come with the physics pass in a later phase.
//
// Touch devices (Phase 7) have no pointer lock, so `isLocked` — the flag
// every game system gates on, meaning "the player is actively in control" —
// is also satisfied by `touchActive`, toggled by the same lock()/unlock()
// calls. TouchControls drives the camera directly for look and feeds
// `touchMove` (an analog stick vector) into update() for movement.
export class PlayerControls {
  constructor(camera, domElement, world) {
    this.camera = camera
    this.world = world
    this.controls = new PointerLockControls(camera, domElement)

    this.touchMode = isTouchDevice()
    this.touchActive = false // touch-mode stand-in for pointer lock
    this.touchMove = new THREE.Vector2() // joystick: x = strafe right, y = forward

    this.velocity = new THREE.Vector3()
    this.keys = { forward: false, back: false, left: false, right: false, sprint: false }

    this.respawn()

    document.addEventListener('keydown', (e) => this.#onKey(e.code, true))
    document.addEventListener('keyup', (e) => this.#onKey(e.code, false))
  }

  // Put the player at the spawn point (initial spawn and death respawn).
  respawn() {
    const { x, z } = PLAYER.spawnPoint
    this.velocity.set(0, 0, 0)
    this.camera.position.set(x, this.world.surfaceY(x, z) + PLAYER.eyeHeight, z)
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
    this.velocity.set(0, 0, 0)
    this.camera.position.set(x, y, z)
    this.camera.quaternion.setFromEuler(
      new THREE.Euler(data.pitch ?? 0, data.yaw ?? 0, 0, 'YXZ'),
    )
  }

  update(delta) {
    if (!this.isLocked) return

    // Exponential damping so movement stops smoothly when keys release.
    const damp = Math.exp(-PLAYER.damping * delta)
    this.velocity.multiplyScalar(damp)

    // Full joystick deflection sprints, mirroring Shift on the keyboard.
    const sprinting = this.keys.sprint || this.touchMove.length() >= 0.999
    const speed =
      PLAYER.moveSpeed * (sprinting ? PLAYER.sprintMultiplier : 1)
    const accel = speed * PLAYER.damping * delta

    if (this.keys.forward) this.velocity.z -= accel
    if (this.keys.back) this.velocity.z += accel
    if (this.keys.left) this.velocity.x -= accel
    if (this.keys.right) this.velocity.x += accel

    // Analog joystick input (touch mode; zero vector otherwise).
    this.velocity.x += this.touchMove.x * accel
    this.velocity.z -= this.touchMove.y * accel

    // PointerLockControls moves along the camera's local axes, projected
    // onto the ground plane.
    this.controls.moveRight(this.velocity.x * delta)
    this.controls.moveForward(-this.velocity.z * delta)

    // Follow the terrain surface at eye height, eased so single-block steps
    // feel like steps instead of teleports. The world is unbounded — chunks
    // stream in around the player — so there is no more edge clamp.
    const pos = this.camera.position
    const targetY = this.world.surfaceY(pos.x, pos.z) + PLAYER.eyeHeight
    pos.y = THREE.MathUtils.damp(pos.y, targetY, PLAYER.stepSmoothing, delta)
  }
}
