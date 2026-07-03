import * as THREE from 'three'
import { TREASURE } from '../config.js'
import { cardinal8 } from '../treasure/TreasureHunt.js'

// Treasure HUD (DOM, like the hotbar): a compass strip at the top of the
// screen whose arrow points at the active token relative to where the camera
// faces, with a "~62 blocks NE · Sunstone" readout — plus the short-lived
// "found it" toast. Returns an update() for the main loop: the arrow needs
// the camera every frame, but text only touches the DOM when it changes.
export function bindTreasureHud(hunt, camera) {
  const compass = document.getElementById('compass')
  compass.innerHTML =
    '<span id="compass-arrow" aria-hidden="true">▲</span><span id="compass-text"></span>'
  const arrow = compass.querySelector('#compass-arrow')
  const text = compass.querySelector('#compass-text')
  const toast = document.getElementById('treasure-toast')

  let toastTimeout
  hunt.onCollect = (token) => {
    toast.textContent = `✦ You found the ${token.name}! (${hunt.foundCount}/${hunt.tokens.length})`
    toast.classList.add('show')
    clearTimeout(toastTimeout)
    toastTimeout = setTimeout(
      () => toast.classList.remove('show'),
      TREASURE.toastSeconds * 1000,
    )
  }

  let lastText = ''
  const forward = new THREE.Vector3()
  return function update() {
    const target = hunt.activeToken
    compass.classList.toggle('hidden', !target)
    if (!target) return

    const dx = target.position.x - camera.position.x
    const dz = target.position.z - camera.position.z
    // Screen-relative bearing: angle from the camera's flat (XZ-projected)
    // forward to the target (0 = dead ahead, +90° = to the right), fed
    // straight into a CSS rotation on the up-pointing arrow.
    camera.getWorldDirection(forward)
    const angle = Math.atan2(
      forward.x * dz - forward.z * dx,
      forward.x * dx + forward.z * dz,
    )
    arrow.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`

    const label = `~${Math.round(Math.hypot(dx, dz))} blocks ${cardinal8(dx, dz)} · ${target.name}`
    if (label !== lastText) {
      lastText = label
      text.textContent = label
    }
  }
}
