import * as THREE from 'three'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { PLAYER } from '../config.js'

// First-person controls: pointer-lock mouse look + WASD movement with
// delta-time integration and velocity damping. The camera follows the
// terrain surface at eye height (smoothed, so steps read as steps rather
// than pops). Still no gravity/jumping or lateral block collision — those
// come with the physics pass in a later phase.
export class PlayerControls {
  constructor(camera, domElement, world) {
    this.camera = camera
    this.world = world
    this.controls = new PointerLockControls(camera, domElement)

    this.velocity = new THREE.Vector3()
    this.keys = { forward: false, back: false, left: false, right: false, sprint: false }

    camera.position.set(0.5, world.surfaceY(0.5, 8.5) + PLAYER.eyeHeight, 8.5)

    document.addEventListener('keydown', (e) => this.#onKey(e.code, true))
    document.addEventListener('keyup', (e) => this.#onKey(e.code, false))
  }

  get isLocked() {
    return this.controls.isLocked
  }

  lock() {
    this.controls.lock()
  }

  unlock() {
    this.controls.unlock()
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

  update(delta) {
    if (!this.controls.isLocked) return

    // Exponential damping so movement stops smoothly when keys release.
    const damp = Math.exp(-PLAYER.damping * delta)
    this.velocity.multiplyScalar(damp)

    const speed =
      PLAYER.moveSpeed * (this.keys.sprint ? PLAYER.sprintMultiplier : 1)
    const accel = speed * PLAYER.damping * delta

    if (this.keys.forward) this.velocity.z -= accel
    if (this.keys.back) this.velocity.z += accel
    if (this.keys.left) this.velocity.x -= accel
    if (this.keys.right) this.velocity.x += accel

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
