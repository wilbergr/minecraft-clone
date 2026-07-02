import * as THREE from 'three'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { PLAYER } from '../config.js'

// First-person controls: pointer-lock mouse look + WASD movement with
// delta-time integration and velocity damping. Phase 1 has no gravity,
// jumping, or block collision — the camera glides at fixed eye height.
export class PlayerControls {
  constructor(camera, domElement, world) {
    this.camera = camera
    this.world = world
    this.controls = new PointerLockControls(camera, domElement)

    this.velocity = new THREE.Vector3()
    this.keys = { forward: false, back: false, left: false, right: false, sprint: false }

    camera.position.set(0, world.groundY + PLAYER.eyeHeight, 8)

    document.addEventListener('keydown', (e) => this.#onKey(e.code, true))
    document.addEventListener('keyup', (e) => this.#onKey(e.code, false))
  }

  get isLocked() {
    return this.controls.isLocked
  }

  lock() {
    this.controls.lock()
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

    // Keep the player inside the test world at fixed eye height.
    const bound = this.world.halfExtent
    const pos = this.camera.position
    pos.x = THREE.MathUtils.clamp(pos.x, -bound, bound)
    pos.z = THREE.MathUtils.clamp(pos.z, -bound, bound)
    pos.y = this.world.groundY + PLAYER.eyeHeight
  }
}
