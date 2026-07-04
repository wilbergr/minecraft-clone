import * as THREE from 'three'
import { TREASURE } from '../config.js'
import { cardinal8 } from '../treasure/TreasureHunt.js'

// Quest HUD (DOM, like the hotbar): a compass strip at the top of the screen
// whose arrow points at the current objective relative to where the camera
// faces, with a "~62 blocks NE · Sunstone" readout — plus the short-lived
// toast line. The compass target is the active treasure token first, then
// the King's Trial takes over (active relic shard, then the Trial Grounds
// anchor); it hides only when neither quest has an objective. Returns an
// update() for the main loop: the arrow needs the camera every frame, but
// text only touches the DOM when it changes.
export function bindTreasureHud(hunt, challenge, camera) {
  const compass = document.getElementById('compass')
  compass.innerHTML =
    '<span id="compass-arrow" aria-hidden="true">▲</span><span id="compass-text"></span>'
  const arrow = compass.querySelector('#compass-arrow')
  const text = compass.querySelector('#compass-text')
  const toast = document.getElementById('treasure-toast')

  let toastTimeout
  const showToast = (message) => {
    toast.textContent = message
    toast.classList.add('show')
    clearTimeout(toastTimeout)
    toastTimeout = setTimeout(
      () => toast.classList.remove('show'),
      TREASURE.toastSeconds * 1000,
    )
  }
  // Treasure-hunt messages only: the King's Trial routes ALL its messages
  // through the queued Herald banner (bindGuidance owns challenge.onToast) —
  // this single-slot 4s toast used to eat the trial's back-to-back beats.
  hunt.onCollect = (token) =>
    showToast(`✦ You found the ${token.name}! (${hunt.foundCount}/${hunt.tokens.length})`)

  let lastText = ''
  const forward = new THREE.Vector3()
  return function update() {
    const target = hunt.activeToken ?? challenge.compassTarget
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
