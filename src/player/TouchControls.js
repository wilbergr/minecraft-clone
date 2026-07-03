import * as THREE from 'three'
import { TOUCH } from '../config.js'

// True when the primary pointer is coarse (phone/tablet) — the switch for
// the whole touch scheme. Checked once at startup; a desktop with a
// touchscreen but a mouse attached stays on the pointer-lock path.
export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches
}

// Touch control scheme (Phase 7), active only when isTouchDevice():
//
//   - left thumb: virtual joystick → player.touchMove (analog; full
//     deflection sprints)
//   - right thumb: drag anywhere else on the screen to look (camera driven
//     through the same YXZ euler PointerLockControls uses)
//   - a quick tap on the look area = one attack-or-break, exactly like a
//     desktop left click
//   - action buttons: hold ⛏ to mine continuously (or tap to attack),
//     tap ▦ to place — both reuse BlockInteraction/Combat entry points
//   - top-right buttons: pause, inventory, quest log, help
//
// The whole UI lives in #touch-ui, shown only while the player is in
// control (player lock/unlock events), so menus and the start overlay are
// never covered. Everything here is input plumbing — no game rules.
export class TouchControls {
  constructor(player, interaction, camera, ui) {
    this.player = player
    this.interaction = interaction
    this.camera = camera
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ')

    document.body.classList.add('touch-mode')
    this.root = document.getElementById('touch-ui')
    this.#buildJoystick()
    this.#buildLookZone()
    this.#buildActionButtons()
    this.#buildMenuButtons(ui)

    // Visible only while playing; also drop stuck inputs when play stops.
    const sync = () => {
      const active = this.player.touchActive
      this.root.classList.toggle('hidden', !active)
      if (!active) this.#releaseAll()
    }
    player.addEventListener('lock', sync)
    player.addEventListener('unlock', sync)
    sync()
  }

  #releaseAll() {
    this.player.touchMove.set(0, 0)
    this.interaction.mining = false
    this.lookId = null
    this.stickId = null
    this.nub.style.transform = ''
  }

  // --- Virtual joystick (movement) ----------------------------------------

  #buildJoystick() {
    const base = document.createElement('div')
    base.id = 'touch-joystick'
    this.nub = document.createElement('div')
    this.nub.id = 'touch-joystick-nub'
    base.appendChild(this.nub)
    this.root.appendChild(base)
    this.stickId = null

    const { radius, deadZone, sprintAt } = TOUCH.joystick
    base.style.width = base.style.height = `${radius * 2}px`
    let cx = 0
    let cy = 0

    const apply = (e) => {
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const dist = Math.hypot(dx, dy)
      const shown = Math.min(dist, radius)
      this.nub.style.transform =
        dist > 0 ? `translate(${(dx / dist) * shown}px, ${(dy / dist) * shown}px)` : ''

      let mag = Math.min(dist / radius, 1)
      if (mag < deadZone) mag = 0
      else if (mag >= sprintAt) mag = 1 // full tilt = sprint (see PlayerControls)
      // Screen-space drag → move vector: up on screen is forward.
      this.player.touchMove.set(
        dist > 0 ? (dx / dist) * mag : 0,
        dist > 0 ? (-dy / dist) * mag : 0,
      )
    }

    base.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return
      this.stickId = e.pointerId
      const rect = base.getBoundingClientRect()
      cx = rect.left + rect.width / 2
      cy = rect.top + rect.height / 2
      base.setPointerCapture(e.pointerId)
      apply(e)
    })
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) apply(e)
    })
    const end = (e) => {
      if (e.pointerId !== this.stickId) return
      this.stickId = null
      this.player.touchMove.set(0, 0)
      this.nub.style.transform = ''
    }
    base.addEventListener('pointerup', end)
    base.addEventListener('pointercancel', end)
  }

  // --- Look-drag + tap-to-break (everywhere that isn't a control) ---------

  #buildLookZone() {
    const zone = document.createElement('div')
    zone.id = 'touch-look'
    this.root.appendChild(zone)
    this.lookId = null

    let lastX = 0
    let lastY = 0
    let startedAt = 0
    let drift = 0

    zone.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return
      this.lookId = e.pointerId
      lastX = e.clientX
      lastY = e.clientY
      startedAt = performance.now() / 1000
      drift = 0
      zone.setPointerCapture(e.pointerId)
    })
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      drift += Math.abs(dx) + Math.abs(dy)

      // Same rotation model as PointerLockControls: yaw/pitch through a YXZ
      // euler, pitch clamped to straight up/down.
      this.euler.setFromQuaternion(this.camera.quaternion)
      this.euler.y -= dx * TOUCH.lookSensitivity
      this.euler.x -= dy * TOUCH.lookSensitivity
      this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x))
      this.camera.quaternion.setFromEuler(this.euler)
    })
    const end = (e) => {
      if (e.pointerId !== this.lookId) return
      this.lookId = null
      // A short, still press is a tap: one attack-or-break, like left click.
      const held = performance.now() / 1000 - startedAt
      if (e.type === 'pointerup' && held <= TOUCH.tap.maxSeconds && drift <= TOUCH.tap.maxDrift) {
        this.#attackOrBreak()
      }
    }
    zone.addEventListener('pointerup', end)
    zone.addEventListener('pointercancel', end)
  }

  // --- Action + menu buttons ----------------------------------------------

  #attackOrBreak() {
    if (this.interaction.attackHook?.()) return // swung at a mob — tap is spent
    this.interaction.breakTargeted()
  }

  #buildActionButtons() {
    const cluster = document.createElement('div')
    cluster.id = 'touch-actions'

    // Hold to mine: mirrors holding the left mouse button (BlockInteraction
    // auto-repeats while `mining` is set); the initial press also attacks.
    const mine = this.#button('⛏', 'Mine (hold) / attack', 'touch-action-btn')
    mine.addEventListener('pointerdown', (e) => {
      mine.setPointerCapture(e.pointerId)
      if (this.interaction.attackHook?.()) return
      this.interaction.mining = true
      this.interaction.breakTargeted()
    })
    const stopMining = () => (this.interaction.mining = false)
    mine.addEventListener('pointerup', stopMining)
    mine.addEventListener('pointercancel', stopMining)

    const place = this.#button('▦', 'Place selected block', 'touch-action-btn')
    place.addEventListener('pointerdown', () => this.interaction.placeAtTargeted())

    cluster.append(place, mine)
    this.root.appendChild(cluster)
  }

  #buildMenuButtons(ui) {
    const cluster = document.createElement('div')
    cluster.id = 'touch-menu'
    const entries = [
      ['⏸', 'Pause', () => this.player.unlock()],
      ['🎒', 'Inventory', ui.toggleInventory],
      ['🗺', 'Quest log', ui.toggleQuestLog],
      ['?', 'Help', ui.toggleHelp],
    ]
    for (const [icon, label, onTap] of entries) {
      const btn = this.#button(icon, label, 'touch-menu-btn')
      // 'click', not pointerdown: these open panels over this spot, and the
      // browser's post-tap synthetic click must land on THIS button (spent),
      // not on whatever the panel just rendered under the finger.
      btn.addEventListener('click', onTap)
      cluster.appendChild(btn)
    }
    this.root.appendChild(cluster)
  }

  #button(icon, label, className) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = className
    btn.textContent = icon
    btn.setAttribute('aria-label', label)
    return btn
  }
}
