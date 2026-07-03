import * as THREE from 'three'
import { FEEDBACK } from '../config.js'

// Mining crack overlay (Phase 9): a translucent box hugging the block being
// mined, textured with procedurally drawn crack stages (canvas at startup —
// no image assets). Stages nest: each stage redraws the previous stage's
// cracks from the same seed and adds more, so progress reads as the same
// cracks spreading. Owned by BlockInteraction alongside the wire highlight.
export class CrackOverlay {
  constructor(scene) {
    this.textures = buildCrackTextures(FEEDBACK.mining.crackStages)
    this.material = new THREE.MeshBasicMaterial({
      map: this.textures[0],
      transparent: true,
      depthWrite: false,
      // Push toward the camera so the overlay never z-fights block faces.
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1.001, 1.001, 1.001), this.material)
    this.mesh.visible = false
    this.stage = -1
    scene.add(this.mesh)
  }

  // Show cracks on block (x, y, z) at mining progress 0..1.
  show(x, y, z, progress) {
    this.mesh.position.set(x + 0.5, y + 0.5, z + 0.5)
    const stage = Math.min(
      this.textures.length - 1,
      Math.floor(progress * this.textures.length),
    )
    if (stage !== this.stage) {
      this.stage = stage
      this.material.map = this.textures[stage]
    }
    this.mesh.visible = true
  }

  hide() {
    this.mesh.visible = false
    this.stage = -1
  }
}

// One transparent 64px texture per stage: seeded random-walk crack polylines
// radiating from the center, count growing with the stage. The fixed seed
// keeps earlier cracks in place as later stages add to them.
function buildCrackTextures(stages) {
  const textures = []
  for (let stage = 0; stage < stages; stage++) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const g = canvas.getContext('2d')
    let seed = 0xc4ac
    const rand = () => {
      // mulberry32 — deterministic, so every stage draws the same cracks.
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    g.strokeStyle = 'rgba(18, 14, 10, 0.85)'
    g.lineWidth = 2.5
    const cracks = (stage + 1) * 3
    for (let c = 0; c < cracks; c++) {
      let x = 20 + rand() * 24
      let y = 20 + rand() * 24
      let angle = rand() * Math.PI * 2
      // Later cracks (drawn only at higher stages) run longer — shattering.
      const segments = 3 + Math.floor(rand() * 3) + Math.floor(c / 3)
      g.beginPath()
      g.moveTo(x, y)
      for (let s = 0; s < segments; s++) {
        angle += (rand() - 0.5) * 1.6
        x += Math.cos(angle) * (4 + rand() * 6)
        y += Math.sin(angle) * (4 + rand() * 6)
        g.lineTo(x, y)
      }
      g.stroke()
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter // blocky, like everything else
    textures.push(texture)
  }
  return textures
}
