import * as THREE from 'three'
import { END } from '../config.js'
import { Mob } from './Mob.js'

// End crystal (the End) — a minimal Mob-shaped fight entity, not a block and
// not generation: DragonFight spawns one atop each obsidian pillar and pins
// it by reference; while any lives the dragon heals (the beams are drawn by
// the runner). Living in mobs.mobs buys arrow hits, melee hits, and the
// mobs.hit kill plumbing for free. Health 1 — any hit (an arrow at range or
// a risky pillar climb) shatters it; the runner adds the proximity pop.
//
// Kinematic like its dragon: the body is never stepped — the crystal spins
// and bobs where it was placed. Mobs never persist, so every fight attempt
// faces all six fresh (the retry design).
export class EndCrystal extends Mob {
  constructor(world, x, z) {
    super(world, END.dragon.crystals.health)
    const c = END.dragon.crystals
    this.cfg = c
    this.kind = 'end_crystal'
    this.passive = false
    this.growls = false
    this.persistent = true // never distance-despawns mid-fight
    this.baseY = null // captured on the first update (spawnAt sets y after us)
    this.age = Math.random() * Math.PI * 2 // desynced bobbing across the six
    // Unlit gem: a tilted shell around a bright core (the TokenField feel).
    // Kept OUT of `materials` — nothing here should hurt-flash.
    this.shellMaterial = new THREE.MeshBasicMaterial({
      color: c.color,
      transparent: true,
      opacity: 0.75,
    })
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: c.coreColor })
    const group = new THREE.Group()
    const shell = this.part(new THREE.BoxGeometry(0.62, 0.62, 0.62), this.shellMaterial, 0, 0.55, 0)
    shell.rotation.set(Math.PI / 4, 0, Math.PI / 4)
    const core = this.part(new THREE.BoxGeometry(0.3, 0.3, 0.3), this.coreMaterial, 0, 0.55, 0)
    group.add(shell, core)
    this.attachBody(group, x, z, c.aabb)
  }

  update(delta) {
    const pos = this.group.position
    if (this.baseY === null) this.baseY = pos.y
    this.age += delta
    this.group.rotation.y += this.cfg.spinSpeed * delta
    pos.y = this.baseY + Math.sin(this.age * this.cfg.bob.speed) * this.cfg.bob.amplitude
  }

  dispose() {
    super.dispose()
    this.shellMaterial.dispose()
    this.coreMaterial.dispose()
  }
}
