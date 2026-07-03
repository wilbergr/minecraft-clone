import * as THREE from 'three'
import { COMBAT, PHYSICS, PLAYER, WORLD } from '../config.js'
import { BLOCKS, BLOCK_AIR } from '../world/blocks.js'

// Aiming at, breaking, and placing blocks. Left click attacks a mob when the
// crosshair is on one (via attackHook, wired up by Combat), otherwise mines
// the targeted block — held down, mining auto-repeats at a rate set by the
// block's hardness and the held tool (see BLOCKS fields). Right click places
// the selected block against the targeted face, and a wireframe box
// highlights the current target (flashing red when the tool is too weak).
//
// What gets placed comes from the inventory's selected hotbar stack; breaking
// a block adds its drop to the inventory instantly (ground item entities are
// a later phase).
export class BlockInteraction {
  #lookDir = new THREE.Vector3()

  constructor(camera, world, player, scene, inventory) {
    this.camera = camera
    this.world = world
    this.player = player
    this.inventory = inventory
    this.target = null
    this.attackHook = null // set by Combat: () => true if a mob took the click
    this.mining = false // left button held — keep breaking as cooldowns allow
    this.nextBreakAt = 0
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

    // Touch mode has its own tap/button input (TouchControls) — ignore the
    // compatibility mouse events browsers synthesize after taps, or every
    // tap would fire twice.
    document.addEventListener('mousedown', (e) => {
      if (this.player.touchMode || !this.player.isLocked) return
      if (e.button === 0) {
        if (this.attackHook?.()) return // swung at a mob — click is spent
        this.mining = true
        this.breakTargeted()
      } else if (e.button === 2) {
        this.placeAtTargeted()
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

  // Re-raycast from the camera and move the highlight. Called every frame.
  update() {
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

    // Red flash on "your tool can't break this" fades back to the outline.
    this.highlight.material.color.setHex(
      performance.now() / 1000 < this.gatedFlashUntil ? 0xc0392b : 0x111111,
    )

    // Held-button mining: keep chewing through blocks as the cooldown allows.
    if (this.mining && this.player.isLocked) this.breakTargeted()
  }

  // Break the currently targeted block and pocket its drop, if the held tool
  // is up to it. Break rate: the block's hardness in seconds, divided down
  // when the held tool kind matches (higher tier = faster); blocks with a
  // minTier requirement don't break at all without that tool (red flash).
  // Breaking anything while holding a tool costs 1 durability.
  breakTargeted() {
    if (!this.target) return false
    const now = performance.now() / 1000
    if (now < this.nextBreakAt) return false
    const { x, y, z } = this.target
    const block = BLOCKS[this.world.blockAt(x, y, z)]
    const tool = this.inventory.selectedItem?.tool ?? null
    const toolMatches = tool && tool.kind === block.tool?.kind

    if (block.tool?.minTier > 0 && (!toolMatches || tool.tier < block.tool.minTier)) {
      this.gatedFlashUntil = now + COMBAT.mining.gatedFlashSeconds
      return false
    }

    if (!this.world.setBlock(x, y, z, BLOCK_AIR)) return false
    if (block.drop) this.inventory.add(block.drop, 1)

    let time = block.hardness ?? 0.3
    if (toolMatches) time /= 1 + tool.tier * COMBAT.mining.speedPerTier
    this.nextBreakAt = now + time
    if (tool) this.inventory.damageSelected()
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
    if (this.world.blockAt(x, y, z) !== BLOCK_AIR) return false
    if (this.#overlapsPlayer(x, y, z)) return false
    if (!this.world.setBlock(x, y, z, blockId)) return false
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
