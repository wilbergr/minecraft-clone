import * as THREE from 'three'
import { FEEDBACK } from '../config.js'
import { BLOCKS } from '../world/blocks.js'

// Held-item viewmodel (Phase 9): a small camera-space rig anchored bottom
// right showing what the active hotbar slot holds — a block cube, a
// box-built tool, a tinted item chunk, or the bare fist — with a swing
// animation for mine/attack and a use animation for place/eat.
//
// The rig is a child of the camera (main.js adds the camera to the scene so
// children render). Every material draws with depthTest off and a high
// renderOrder, so the held item never clips into nearby world geometry;
// parts layer by insertion order, which the builders below rely on.
//
// swing() only retriggers once the previous arc finishes, so calling it
// every frame while mining yields a continuous chopping loop for free.

const RENDER_ORDER = 100
const SKIN = 0xd9a066
const HANDLE = 0x8a6a3e

export class Viewmodel {
  constructor(camera, inventory, player) {
    this.inventory = inventory
    this.player = player
    this.root = new THREE.Group()
    const [x, y, z] = FEEDBACK.viewmodel.position
    this.root.position.set(x, y, z)
    camera.add(this.root)
    this.holder = new THREE.Group() // animated; root keeps the anchor still
    this.root.add(this.holder)

    this.time = 0
    this.swingT = Infinity // seconds since the swing started; Infinity = idle
    this.useT = Infinity
    this.currentItemId = undefined
    this.#rebuild()
    inventory.onChange(() => this.#rebuild())
  }

  // Mine/attack arc. No-op while one is already playing (see header).
  swing() {
    if (this.swingT >= FEEDBACK.viewmodel.swingSeconds) this.swingT = 0
  }

  // Place/eat motion: pull the item in toward the face and back.
  use() {
    this.useT = 0
  }

  get isSwinging() {
    return this.swingT < FEEDBACK.viewmodel.swingSeconds
  }

  update(delta) {
    const vm = FEEDBACK.viewmodel
    this.time += delta
    this.swingT += delta
    this.useT += delta
    this.root.visible = this.player.isLocked

    // Each animation is a half-sine pulse over its duration; both offsets
    // stack on the idle bob so overlapping triggers blend instead of popping.
    const s = Math.sin(Math.min(this.swingT / vm.swingSeconds, 1) * Math.PI)
    const u = Math.sin(Math.min(this.useT / vm.useSeconds, 1) * Math.PI)
    this.holder.position.set(
      -s * 0.12 - u * 0.16,
      Math.sin(this.time * vm.bob.speed) * vm.bob.amount + s * 0.05 + u * 0.06,
      -s * 0.22 - u * 0.12,
    )
    this.holder.rotation.set(-s * 1.0 + u * 0.5, s * 0.35, u * 0.3)
  }

  // Swap the mesh when the held item type changes (not on every count tick).
  #rebuild() {
    const item = this.inventory.selectedItem
    const id = item?.id ?? null
    if (id === this.currentItemId) return
    this.currentItemId = id
    for (const child of [...this.holder.children]) {
      this.holder.remove(child)
      child.traverse((o) => {
        o.geometry?.dispose()
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
        else o.material?.dispose()
      })
    }
    this.holder.add(buildItemMesh(item))
  }
}

function overlayMaterial(color) {
  return new THREE.MeshLambertMaterial({ color, depthTest: false })
}

function box(w, h, d, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), overlayMaterial(color))
  mesh.renderOrder = RENDER_ORDER
  return mesh
}

function buildItemMesh(item) {
  if (!item) return buildFist()
  if (item.blockId !== undefined) return buildBlock(item.blockId)
  if (item.tool) return buildTool(item.tool.kind, item.tint)
  return buildChunk(item.tint)
}

// Bare hand: a skin-colored fist that still swings.
function buildFist() {
  const fist = box(0.14, 0.14, 0.32, SKIN)
  fist.rotation.set(0.3, -0.4, 0.15)
  return fist
}

// Placeable item: a mini cube wearing the block's real face colors
// (BoxGeometry material order: +x, -x, +y, -y, +z, -z).
function buildBlock(blockId) {
  const { top, side, bottom } = BLOCKS[blockId].color
  const mats = [side, side, top, bottom, side, side].map(overlayMaterial)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mats)
  mesh.renderOrder = RENDER_ORDER
  mesh.rotation.set(0.35, -0.6, 0)
  return mesh
}

// Tools: a wooden handle plus a head shaped per kind, tinted per tier (the
// same tint the hotbar glyph uses, so tiers read consistently).
function buildTool(kind, tint) {
  const group = new THREE.Group()
  const head = new THREE.Color(tint)
  if (kind === 'sword') {
    const handle = box(0.05, 0.16, 0.05, HANDLE)
    const guard = box(0.14, 0.035, 0.06, head)
    guard.position.y = 0.1
    const blade = box(0.055, 0.46, 0.025, head)
    blade.position.y = 0.33
    group.add(handle, guard, blade)
  } else {
    const handle = box(0.055, 0.52, 0.055, HANDLE)
    if (kind === 'pickaxe') {
      const bar = box(0.4, 0.07, 0.07, head)
      bar.position.y = 0.24
      group.add(handle, bar)
    } else {
      // axe: a blade hanging off one side of the top
      const blade = box(0.17, 0.18, 0.06, head)
      blade.position.set(0.1, 0.2, 0)
      group.add(handle, blade)
    }
  }
  group.rotation.set(0.5, -0.35, -0.5)
  group.position.y = -0.05
  return group
}

// Everything else (sticks, flesh, ingots): a small tinted chunk in hand.
function buildChunk(tint) {
  const mesh = box(0.2, 0.2, 0.08, new THREE.Color(tint ?? '#bbbbbb'))
  mesh.rotation.set(0.4, -0.5, 0.2)
  return mesh
}
