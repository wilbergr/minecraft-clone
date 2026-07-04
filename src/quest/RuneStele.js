import * as THREE from 'three'
import { GUIDANCE, WORLD } from '../config.js'
import { mulberry32 } from '../world/noise.js'

// The Prophecy Stele (guidance layer): a rune-carved monolith beside the
// Trial Grounds anchor whose four glyph lines — one per stage — ignite as
// stages latch, plus a capstone sigil that blazes at completion. The
// persistent, glanceable "where am I in the arc" board, readable from the
// world instead of a menu. Deliberately glyphs-only, never English: the
// Herald (standing a few blocks away) is the translator.
//
// Scene meshes only (the purity rule — nothing stamped into terrain), built
// lazily on activation like the anchor marker. The rune face is ONE seeded
// canvas texture (the atlas.js technique: deterministic strokes from
// mulberry32, guarded behind `typeof document` so node probes keep working),
// redrawn at most 5 times per playthrough. Lit state is pure:
// line i lit ⇔ challenge.stage > i — restores are correct for free.
export class RuneStele {
  constructor({ challenge, world, scene, sounds, particles }) {
    this.challenge = challenge
    this.world = world
    this.scene = scene
    this.sounds = sounds
    this.particles = particles
    this.cfg = GUIDANCE.stele
    this.group = null
    this.canvas = null
    this.texture = null
    this.glow = null // additive plane pulsing over the active line
    this.time = 0
    this.litCount = 0 // completed stage lines burning (test seam)
    this.redraws = 0 // canvas redraw counter (test seam)

    if (challenge.activated) this.#sync(false)
    challenge.onChange(() => this.#sync(true))
  }

  #targetLit() {
    return Math.min(this.challenge.stage, 4)
  }

  // Build on first activation; on later changes, newly-lit lines get the
  // ignition rite (redraw + chime + burst). `loud` is false only for the
  // initial catch-up so restores never replay fanfare.
  #sync(loud) {
    if (!this.challenge.activated) return
    if (!this.group) {
      this.#build()
      this.litCount = this.#targetLit()
      this.#draw()
      return
    }
    const target = this.#targetLit()
    if (target === this.litCount) return
    const newlyLit = []
    for (let i = this.litCount; i < target; i++) newlyLit.push(i)
    this.litCount = target
    this.#draw()
    if (!loud) return
    this.sounds.play('runeIgnite')
    for (const i of newlyLit) {
      const p = this.#lineWorldPosition(i)
      this.particles.burst(p.x, p.y, p.z, 0xffb066, this.cfg.igniteParticles)
    }
  }

  #build() {
    if (typeof document === 'undefined') return // node generator probes
    const { width, height, depth, stoneColor } = this.cfg
    const a = this.challenge.anchorPosition
    const x = a.x + this.cfg.offset.x
    const z = a.z + this.cfg.offset.z
    const baseY = this.world.terrainHeight(Math.floor(x), Math.floor(z))

    this.canvas = document.createElement('canvas')
    this.canvas.width = 160
    this.canvas.height = 480
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.magFilter = THREE.NearestFilter // keep the carving crisp

    const group = new THREE.Group()
    const stone = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshLambertMaterial({ color: stoneColor }),
    )
    stone.position.y = height / 2
    group.add(stone)
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.88, height * 0.92),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
    )
    face.position.set(0, height / 2, depth / 2 + 0.01)
    group.add(face)
    // Active-line glow: one additive plane whose opacity pulses in update().
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.8, height * 0.16),
      new THREE.MeshBasicMaterial({
        color: 0xffb066,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.glow.position.set(0, 0, depth / 2 + 0.02)
    group.add(this.glow)

    group.position.set(x, baseY, z)
    // Face the anchor so the carving reads from the arena center.
    group.rotation.y = Math.atan2(a.x - x, a.z - z) + Math.PI
    this.scene.add(group)
    this.group = group
  }

  // The four stage lines stack top→bottom under a capstone sigil; local y of
  // line i (0-based), in world space for ignition bursts.
  #lineLocalY(i) {
    return this.cfg.height * (0.72 - i * 0.16)
  }

  #lineWorldPosition(i) {
    const p = new THREE.Vector3(0, this.#lineLocalY(i), 0)
    return p.add(this.group.position)
  }

  // Redraw the whole face: capstone + four rune lines, colored by state.
  // Glyph strokes are seeded (WORLD.seed ^ line index) — the same monument
  // every visit, every reload.
  #draw() {
    if (!this.canvas) return
    this.redraws++
    const ctx = this.canvas.getContext('2d')
    const W = this.canvas.width
    const H = this.canvas.height
    ctx.fillStyle = this.cfg.faceColor
    ctx.fillRect(0, 0, W, H)

    const complete = this.challenge.isComplete
    // Capstone sigil: a diamond that blazes only at completion.
    ctx.strokeStyle = complete ? this.cfg.litColor : this.cfg.dimColor
    ctx.lineWidth = 4
    ctx.shadowColor = this.cfg.litColor
    ctx.shadowBlur = complete ? 14 : 0
    ctx.beginPath()
    ctx.moveTo(W / 2, 18)
    ctx.lineTo(W / 2 + 22, 52)
    ctx.lineTo(W / 2, 86)
    ctx.lineTo(W / 2 - 22, 52)
    ctx.closePath()
    ctx.stroke()

    for (let line = 0; line < 4; line++) {
      const lit = line < this.litCount
      const active = !complete && line === this.litCount
      ctx.strokeStyle = lit ? this.cfg.litColor : active ? this.cfg.activeColor : this.cfg.dimColor
      ctx.shadowBlur = lit ? 10 : 0
      ctx.lineWidth = 3
      const rand = mulberry32((WORLD.seed ^ (0x57e1e + line * 97)) >>> 0)
      const y0 = 110 + line * 76
      const glyphW = (W - 24) / this.cfg.glyphsPerLine
      for (let gl = 0; gl < this.cfg.glyphsPerLine; gl++) {
        const gx = 12 + gl * glyphW
        const strokes = 3 + Math.floor(rand() * 3)
        ctx.beginPath()
        for (let s = 0; s < strokes; s++) {
          ctx.moveTo(gx + rand() * (glyphW - 6), y0 + rand() * 44)
          ctx.lineTo(gx + rand() * (glyphW - 6), y0 + rand() * 44)
        }
        ctx.stroke()
      }
    }
    ctx.shadowBlur = 0
    this.texture.needsUpdate = true
  }

  // Canvas pixel row → local plane y, for the pulsing active-line glow.
  update(delta) {
    if (!this.group || !this.glow) return
    this.time += delta
    const complete = this.challenge.isComplete
    if (complete || this.litCount >= 4) {
      this.glow.material.opacity = 0
      return
    }
    const { pulse, height } = this.cfg
    const canvasY = 110 + this.litCount * 76 + 22 // active line's row center
    const localY = height / 2 + (0.5 - canvasY / this.canvas.height) * height * 0.92
    this.glow.position.y = localY
    this.glow.material.opacity =
      pulse.min + (pulse.max - pulse.min) * (0.5 + 0.5 * Math.sin(this.time * pulse.speed))
  }
}
