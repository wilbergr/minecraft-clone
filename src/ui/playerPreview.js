import * as THREE from 'three'
import { ITEMS } from '../inventory/items.js'
import { ARMOR_SLOTS } from '../combat/Armor.js'

// The inventory screen's live player figure (MC's paper-doll pane): a tiny
// second THREE.Scene rendering the player as a box-part body — the same
// pattern the mobs and the Herald use — with one overlay layer per armor
// slot that shows/tints as pieces are equipped. Purely cosmetic and purely
// armor-driven: refresh() reads Armor.slots and colors each layer from the
// equipped item's `tint`, so new armor tiers (diamond, whatever comes next)
// render with zero changes here.
//
// The renderer is its own small canvas (the main renderer owns the fullscreen
// game canvas behind the overlay, so it can't composite into the panel). It
// only draws while the screen is open: start()/stop() gate a private rAF loop
// that slowly turns the figure. Construction is failure-tolerant — if a
// second WebGL context can't be created, the pane just stays empty and the
// screen works without it.

const SKIN = 0xc8987a
const HAIR = 0x5a4632
const SHIRT = 0x2e8a8a
const PANTS = 0x35357a

export class PlayerPreview {
  #running = false

  constructor(width = 150, height = 210) {
    this.canvas = document.createElement('canvas')
    this.canvas.id = 'player-preview'
    this.renderer = null
    this.frames = 0 // headless-test seam: proves the loop actually drew
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: false,
      })
      this.renderer.setSize(width, height, false)
      this.renderer.setClearColor(0x000000, 0)
    } catch {
      return // no second GL context — pane stays empty, screen still works
    }

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 20)
    this.camera.position.set(0, 1.05, 3.9)
    this.camera.lookAt(0, 0.95, 0)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const sun = new THREE.DirectionalLight(0xffffff, 0.9)
    sun.position.set(1.5, 3, 2.5)
    this.scene.add(sun)

    this.figure = this.#buildFigure()
    this.scene.add(this.figure)
  }

  // The bare player body: Zombie proportions with arms hanging at the sides.
  #buildFigure() {
    const group = new THREE.Group()
    const part = (w, h, d, color, x, y, z) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color }),
      )
      mesh.position.set(x, y, z)
      group.add(mesh)
      return mesh
    }
    part(0.5, 0.5, 0.5, SKIN, 0, 1.75, 0) // head
    part(0.52, 0.14, 0.52, HAIR, 0, 1.94, 0) // hair cap
    part(0.5, 0.75, 0.25, SHIRT, 0, 1.125, 0) // torso
    part(0.18, 0.75, 0.2, SHIRT, -0.34, 1.125, 0) // arms
    part(0.18, 0.75, 0.2, SHIRT, 0.34, 1.125, 0)
    part(0.2, 0.75, 0.24, PANTS, -0.14, 0.375, 0) // legs
    part(0.2, 0.75, 0.24, PANTS, 0.14, 0.375, 0)

    // Armor overlays: one hidden group per wear slot, boxes padded a little
    // past the body part they cover so the layer reads as worn gear. Each
    // slot shares ONE material — refresh() tints it from the equipped item.
    this.armorParts = {}
    this.armorMaterials = {}
    for (const slot of ARMOR_SLOTS) {
      const layer = new THREE.Group()
      layer.visible = false
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff })
      const box = (w, h, d, x, y, z) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
        mesh.position.set(x, y, z)
        layer.add(mesh)
      }
      if (slot === 'head') {
        box(0.6, 0.6, 0.6, 0, 1.77, 0)
      } else if (slot === 'chest') {
        box(0.6, 0.82, 0.34, 0, 1.125, 0) // breastplate
        box(0.26, 0.34, 0.28, -0.34, 1.36, 0) // shoulder pads
        box(0.26, 0.34, 0.28, 0.34, 1.36, 0)
      } else if (slot === 'legs') {
        box(0.27, 0.52, 0.31, -0.14, 0.52, 0)
        box(0.27, 0.52, 0.31, 0.14, 0.52, 0)
      } else if (slot === 'feet') {
        box(0.28, 0.28, 0.34, -0.14, 0.14, 0.02)
        box(0.28, 0.28, 0.34, 0.14, 0.14, 0.02)
      }
      this.armorParts[slot] = layer
      this.armorMaterials[slot] = mat
      group.add(layer)
    }
    return group
  }

  // Mirror the Armor state onto the figure: layer visible iff a piece is
  // worn, tinted with the item's own color — generic across tiers.
  refresh(armor) {
    if (!this.renderer || !armor) return
    for (const slot of ARMOR_SLOTS) {
      const piece = armor.slots[slot]
      this.armorParts[slot].visible = !!piece
      if (piece) {
        this.armorMaterials[slot].color.set(ITEMS[piece.id]?.tint ?? '#ffffff')
      }
    }
    if (!this.#running) this.#draw() // keep a closed-screen refresh visible
  }

  #draw() {
    this.figure.rotation.y += 0.012
    this.renderer.render(this.scene, this.camera)
    this.frames += 1
  }

  // rAF loop gated on the screen being open — no cost while playing.
  start() {
    if (!this.renderer || this.#running) return
    this.#running = true
    const tick = () => {
      if (!this.#running) return
      this.#draw()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  stop() {
    this.#running = false
  }
}
