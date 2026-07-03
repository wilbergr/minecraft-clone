import * as THREE from 'three'
import { COMBAT, FEEDBACK, PHYSICS, PLAYER, WORLD } from '../config.js'
import { BLOCKS, BLOCK_AIR, BLOCK_WATER } from '../world/blocks.js'
import { CrackOverlay } from '../fx/CrackOverlay.js'

// Aiming at, breaking, and placing blocks. Left click attacks a mob when the
// crosshair is on one (via attackHook, wired up by Combat); otherwise it
// mines: while the button is held on the same target, progress accumulates
// at delta / breakTime — breakTime being the block's hardness divided down
// by a matching held tool (see BLOCKS fields) — with crack stages rendered
// on the block until it breaks at 100%. Progress resets when the target
// changes or shortly after the button releases (a short grace window lets
// touch taps accumulate). Right click "uses" the held item: consumables are
// eaten, placeable blocks are placed against the targeted face.
//
// A wireframe box highlights the current target (flashing red when the held
// tool can't break it). Breaking a block spawns a ground item drop (fx.drops)
// that pops out and vacuums into the inventory — see fx/GroundItems.js.
//
// `fx` bundles the Phase 9 feedback systems (particles, drops, sounds,
// viewmodel, health) — every hook is optional so the class still works bare
// (as in unit-style test setups).
export class BlockInteraction {
  #lookDir = new THREE.Vector3()

  constructor(camera, world, player, scene, inventory, fx = {}) {
    this.camera = camera
    this.world = world
    this.player = player
    this.inventory = inventory
    this.fx = fx
    this.target = null
    this.attackHook = null // set by Combat: () => true if a mob took the click
    this.mining = false // left button held — accumulate break progress
    this.progress = 0 // 0..1 toward breaking the current mining target
    this.miningKey = null // target block + hotbar slot the progress belongs to
    this.lastAdvanceAt = 0
    this.gatedFlashUntil = 0

    // Slightly oversized so the outline doesn't z-fight the block faces.
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002)
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x111111 }),
    )
    box.dispose()
    this.highlight.visible = false
    scene.add(this.highlight)
    this.crack = new CrackOverlay(scene)

    // Touch mode has its own tap/button input (TouchControls) — ignore the
    // compatibility mouse events browsers synthesize after taps, or every
    // tap would fire twice.
    document.addEventListener('mousedown', (e) => {
      if (this.player.touchMode || !this.player.isLocked) return
      if (e.button === 0) {
        this.fx.viewmodel?.swing()
        if (this.attackHook?.()) return // swung at a mob — click is spent
        this.mining = true
      } else if (e.button === 2) {
        this.useSelected()
      }
    })
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mining = false
    })
    document.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  // Block id the selected hotbar item places, or null (empty hand / tool).
  get selectedBlockId() {
    return this.inventory.selectedItem?.blockId ?? null
  }

  // Re-raycast from the camera, move the highlight, advance held-button
  // mining. Called every frame with the frame delta.
  update(delta = 0) {
    this.camera.getWorldDirection(this.#lookDir)
    this.target = this.world.raycast(
      this.camera.position,
      this.#lookDir,
      PLAYER.reach,
    )
    if (this.target) {
      this.highlight.position.set(
        this.target.x + 0.5,
        this.target.y + 0.5,
        this.target.z + 0.5,
      )
      this.highlight.visible = true
    } else {
      this.highlight.visible = false
    }

    const now = performance.now() / 1000

    // Red flash on "your tool can't break this" fades back to the outline.
    this.highlight.material.color.setHex(
      now < this.gatedFlashUntil ? 0xc0392b : 0x111111,
    )

    if (this.mining && this.player.isLocked && this.target) {
      this.#advanceMining(delta)
    } else {
      this.fx.sounds?.stopDig()
      // Keep tap progress through the grace window so taps accumulate.
      if (this.progress > 0 && now - this.lastAdvanceAt > FEEDBACK.mining.tapGraceSeconds) {
        this.#resetMining()
      }
    }
  }

  // Legacy single-swing seam (touch taps, test hooks): one tap advances
  // mining by FEEDBACK.mining.tapSeconds of held-button time, so soft blocks
  // still break in a tap or two and hard ones take several. Returns true if
  // this swing broke the block.
  breakTargeted() {
    if (!this.target) return false
    this.fx.viewmodel?.swing()
    return this.#advanceMining(FEEDBACK.mining.tapSeconds)
  }

  // Accumulate `seconds` of mining on the current target; break at 100%.
  // Gated blocks (wrong/missing tool) flash the highlight red instead.
  #advanceMining(seconds) {
    const { x, y, z } = this.target
    const block = BLOCKS[this.world.blockAt(x, y, z)]
    if (!block.solid) return false // stale target (block already edited away)
    const now = performance.now() / 1000
    const tool = this.inventory.selectedItem?.tool ?? null
    const toolMatches = tool && tool.kind === block.tool?.kind

    if (block.tool?.minTier > 0 && (!toolMatches || tool.tier < block.tool.minTier)) {
      this.gatedFlashUntil = now + COMBAT.mining.gatedFlashSeconds
      this.#resetMining()
      return false
    }

    let breakTime = block.hardness ?? 0.3
    if (toolMatches) breakTime /= 1 + tool.tier * COMBAT.mining.speedPerTier

    // Progress belongs to one (block, held slot) pair — looking away or
    // switching items starts over.
    const key = `${x},${y},${z}:${this.inventory.selectedSlot}`
    if (key !== this.miningKey) {
      this.miningKey = key
      this.progress = 0
    }
    this.progress += seconds / breakTime
    this.lastAdvanceAt = now
    this.fx.viewmodel?.swing()
    this.fx.sounds?.startDig(block.material)

    if (this.progress >= 1) return this.#finishBreak(x, y, z, block, tool)
    this.crack.show(x, y, z, this.progress)
    return false
  }

  #finishBreak(x, y, z, block, tool) {
    this.#resetMining()
    this.fx.sounds?.stopDig()
    if (!this.world.setBlock(x, y, z, BLOCK_AIR)) return false
    if (block.drop) {
      // Ground item drop; straight to the inventory only when running bare.
      if (this.fx.drops) this.fx.drops.spawn(x + 0.5, y + 0.7, z + 0.5, block.drop)
      else this.inventory.add(block.drop, 1)
    }
    this.fx.particles?.burstBlock(x, y, z, block)
    this.fx.sounds?.play('break', { material: block.material })
    if (tool) this.inventory.damageSelected()
    return true
  }

  #resetMining() {
    this.progress = 0
    this.miningKey = null
    this.crack.hide()
  }

  // The "use" verb for the held item (right click / touch ▦): consumables
  // are eaten, placeable blocks are placed, tools do nothing on use.
  useSelected() {
    const item = this.inventory.selectedItem
    if (item?.consumable) return this.#consumeSelected()
    const placed = this.placeAtTargeted()
    if (placed) this.fx.viewmodel?.use()
    return placed
  }

  // Eat the held consumable. Hunger doesn't exist yet, so the effect is a
  // token FEEDBACK.consume.healAmount — the point is that "use" is a real,
  // animated verb; the payoff grows when hunger lands.
  #consumeSelected() {
    this.fx.viewmodel?.use()
    this.fx.sounds?.play('eat')
    this.fx.health?.heal(FEEDBACK.consume.healAmount)
    this.inventory.consumeSelected()
    return true
  }

  // Place the selected block against the targeted face, consuming one item
  // from the active hotbar stack.
  placeAtTargeted() {
    if (!this.target) return false
    const blockId = this.selectedBlockId
    if (blockId === null) return false
    const [nx, ny, nz] = this.target.normal
    const x = this.target.x + nx
    const y = this.target.y + ny
    const z = this.target.z + nz
    if (y < 0 || y >= WORLD.chunkHeight) return false
    // Air and water are both placeable-into (water just gets displaced —
    // that's how you pillar up out of the sea).
    const existing = this.world.blockAt(x, y, z)
    if (existing !== BLOCK_AIR && existing !== BLOCK_WATER) return false
    if (this.#overlapsPlayer(x, y, z)) return false
    if (!this.world.setBlock(x, y, z, blockId)) return false
    this.fx.sounds?.play('place', { material: BLOCKS[blockId].material })
    this.inventory.consumeSelected()
    return true
  }

  // Don't place a block into the player's collision box (Phase 8: the exact
  // AABB — a block that overlapped it would wedge the physics sweeps). Jump
  // first to pillar up: at the apex the feet clear the target cell.
  #overlapsPlayer(x, y, z) {
    const { position } = this.player.body
    const half = PHYSICS.playerAABB.width / 2
    return (
      x + 1 > position.x - half &&
      x < position.x + half &&
      z + 1 > position.z - half &&
      z < position.z + half &&
      y + 1 > position.y &&
      y < position.y + PHYSICS.playerAABB.height
    )
  }
}
