import * as THREE from 'three'
import { END } from '../config.js'
import { BLOCK_AIR, BLOCK_DRAGON_EGG, BLOCK_END_STONE, isSolid } from '../world/blocks.js'

// The Ender Dragon fight runner (the End) — BossFight's sibling, owned by
// main.js (the End is its own arc, not the Challenge's). Arriving in the End
// with the dragon undefeated arms it: a short rumble, then the dragon rises
// from below the island center and six end crystals appear on the pillar
// tops, all PINNED BY REFERENCE (the documented pattern). Gone from
// mobs.mobs with health <= 0 is victory; gone any other way resets quietly
// to re-armable (a fresh arrival faces the full fight — leaving IS the
// reset, since travel clears every mob).
//
// Phase 1 is runner-driven: while any pinned crystal lives the dragon heals
// `healPerCrystalPerSecond × alive` (the HP bar visibly refills — the
// teach), and one thin additive beam per crystal tracks the dragon so the
// mechanic is legible. Crystal deaths pop proximity damage through
// combat.hurtPlayer (armor counts) and, at zero left, tell the dragon to
// enter phase 2.
//
// NO leash: the island is the arena and the void is the wall — hiding in a
// dug hole just lets phase-1 healing erase progress. Deliberately unsaved
// mid-fight (mobs never persist); only the EndProgress latches ride the
// save. Victory stamps the exit portal ring + dragon egg as ordinary edits
// (the frame ring self-activates through EndPortal's detector), grants the
// elytra THROUGH THE RUNNER (a mob-drop would die over the void), latches
// dragonDefeated, and fires onComplete → the END_MESSAGE reveal.
//
// Live deps (mobs/health/player/combat/inventory/drops/camera) are attached
// by main.js after construction (the BossFight pattern); bare runs stay
// inert. onBossEvent is the observability seam: rumble/rise/telegraph/
// swoop/fireball/perch/phase/crystalBreak/victory.
export class DragonFight {
  constructor(world, scene, cfg = END.dragon) {
    this.world = world // the End
    this.scene = scene // the End's root — beams vanish with the dimension
    this.cfg = cfg
    // Attached by main.js after construction.
    this.mobs = null
    this.health = null
    this.player = null
    this.combat = null
    this.inventory = null
    this.drops = null
    this.camera = null
    this.progress = null // EndProgress — the dragonDefeated/celebrated latches
    // Optional hooks.
    this.onToast = null // callback(text)
    this.onBossHealth = null // callback(hp, max) — the HP bar
    this.onBossGone = null // callback() — the bar hides
    this.onBossEvent = null // callback(type, data)
    this.onComplete = null // () — the endReveal modal owns it

    this.state = 'idle' // 'idle' | 'rumbling' | 'fighting'
    this.timer = 0
    this.dragon = null // pinned reference while fighting
    this.crystals = [] // pinned crystal refs
    this.beams = [] // { mesh, crystal } — one healing beam per live crystal
    this.beamMaterial = null
    this.beamGeometry = null
  }

  // Ticked from the main loop, gated on dims.current === the End (the
  // quest-gate idiom). Death first — dying unlocks the pointer.
  update(delta, playerPos) {
    if (!this.mobs || this.progress?.dragonDefeated) return
    if (this.health?.isDead) {
      this.#reset()
      return
    }
    if (this.player && !this.player.isLocked) return

    if (this.state === 'idle') {
      // Standing in the End with the dragon undefeated arms the fight.
      this.state = 'rumbling'
      this.timer = this.cfg.summonSeconds
      this.mobs.event = true // no ambient logic during the fight (belt-and-braces — the End spawns nothing anyway)
      this.#event('rumble', { position: { x: 0.5, y: 64, z: 0.5 } })
      this.onToast?.('The island trembles — something vast stirs below…')
      return
    }

    if (this.state === 'rumbling') {
      this.timer -= delta
      if (this.timer <= 0) this.#rise()
      return
    }

    // Fighting.
    const dragon = this.dragon
    if (!this.mobs.mobs.includes(dragon)) {
      if (dragon.health <= 0) this.#victory(dragon)
      else this.#reset() // void/despawn oddity — quietly re-armable
      return
    }

    this.#tickCrystals(playerPos)

    // Phase 1 healing: alive crystals visibly knit the dragon back.
    if (this.crystals.length > 0 && dragon.health < this.cfg.health) {
      dragon.health = Math.min(
        this.cfg.health,
        dragon.health + this.crystals.length * this.cfg.healPerCrystalPerSecond * delta,
      )
      this.onBossHealth?.(dragon.health, this.cfg.health)
    }

    this.#updateBeams(dragon)
  }

  #rise() {
    this.state = 'fighting'
    const dragon = this.mobs.spawnAt(0.5, 0.5, 'dragon')
    // Rise from below the island center — the dragon's 'rise' state carries
    // it up to orbit height kinematically.
    dragon.group.position.y = Math.max(
      2,
      this.world.surfaceY(0.5, 0.5) - this.cfg.rise.fromDepth,
    )
    dragon.onHealth = (hp, max) => this.onBossHealth?.(hp, max)
    dragon.onEvent = (type, data) => this.#event(type, data)
    this.dragon = dragon

    // Six crystals on the pillar tops (positions are pure functions of the
    // seed — world.pillars, no world queries).
    this.crystals = this.world.pillars.map((p) =>
      this.mobs.spawnAt(p.x + 0.5, p.z + 0.5, 'end_crystal', p.top + 1),
    )
    this.#buildBeams()

    this.onBossHealth?.(dragon.health, this.cfg.health)
    this.#event('rise', { position: dragon.group.position })
    this.onToast?.('The Ender Dragon rises. Its crystals mend every wound — shatter them first.')
  }

  // Detect newly-shattered crystals: fx + proximity pop + the phase-2 turn.
  #tickCrystals(playerPos) {
    for (let i = this.crystals.length - 1; i >= 0; i--) {
      const crystal = this.crystals[i]
      if (this.mobs.mobs.includes(crystal)) continue
      this.crystals.splice(i, 1)
      const pos = crystal.group.position
      // Face-tanking the pedestal hurts — through hurtPlayer, so armor counts.
      if (this.combat && playerPos) {
        const d = playerPos.distanceTo(pos)
        if (d < this.cfg.crystals.popRadius) {
          const dir = new THREE.Vector3().subVectors(playerPos, pos).setY(0)
          this.combat.hurtPlayer(
            this.cfg.crystals.popDamage,
            dir.lengthSq() > 0 ? dir.normalize() : null,
          )
        }
      }
      this.#event('crystalBreak', { position: { x: pos.x, y: pos.y, z: pos.z } })
      if (this.crystals.length === 0) {
        this.dragon?.crystalsGone()
        this.onToast?.('The last crystal shatters — the dragon can bleed. It will land. Be ready.')
      }
    }
    this.#pruneBeams()
  }

  // --- Healing beams (scene meshes, one per live crystal) --------------------

  #buildBeams() {
    const b = this.cfg.crystals.beam
    this.beamGeometry ??= new THREE.CylinderGeometry(b.radius, b.radius, 1, 6, 1, true)
    this.beamMaterial ??= new THREE.MeshBasicMaterial({
      color: b.color,
      transparent: true,
      opacity: b.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.beams = this.crystals.map((crystal) => {
      const mesh = new THREE.Mesh(this.beamGeometry, this.beamMaterial)
      this.scene.add(mesh)
      return { mesh, crystal }
    })
  }

  #pruneBeams() {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      if (this.crystals.includes(this.beams[i].crystal)) continue
      this.scene.remove(this.beams[i].mesh)
      this.beams.splice(i, 1)
    }
  }

  #updateBeams(dragon) {
    const target = dragon.group.position
    for (const { mesh, crystal } of this.beams) {
      const from = crystal.group.position
      const a = new THREE.Vector3(from.x, from.y + 0.6, from.z)
      const b = new THREE.Vector3(target.x, target.y + 1, target.z)
      const dir = new THREE.Vector3().subVectors(b, a)
      const len = dir.length()
      mesh.position.copy(a).addScaledVector(dir, 0.5)
      mesh.scale.set(1, Math.max(0.001, len), 1)
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        len > 0.001 ? dir.divideScalar(len) : new THREE.Vector3(0, 1, 0),
      )
    }
  }

  #clearBeams() {
    for (const { mesh } of this.beams) this.scene.remove(mesh)
    this.beams = []
  }

  // --- Victory ----------------------------------------------------------------

  #victory(dragon) {
    const position = dragon.group.position.clone()
    // Any crystals that survived an out-DPS-the-healing kill go with it.
    for (const crystal of this.crystals) this.mobs.despawn(crystal)
    this.#end()
    this.progress?.setDefeated()
    this.#stampExitPortal()
    this.#grantElytra()
    this.#event('victory', { position })
    this.onComplete?.()
  }

  // The exit portal + egg, as ordinary edits at the island center: a cleared
  // pedestal, then the 12-frame ring — EndPortal's detector self-activates
  // it (fill + bloom + sound) the moment the last frame lands.
  #stampExitPortal() {
    const w = this.world
    const cy = w.surfaceY(0.5, 0.5) // feet level at the center
    const ax = -1 // interior min corner: interior spans -1..1, ring bbox -2..2
    const az = -1
    // Pedestal + headroom across the ring's 5×5 footprint.
    for (let x = ax - 1; x <= ax + 3; x++) {
      for (let z = az - 1; z <= az + 3; z++) {
        if (!isSolid(w.blockAt(x, cy - 1, z))) w.setBlock(x, cy - 1, z, BLOCK_END_STONE)
        for (const y of [cy, cy + 1, cy + 2]) {
          if (w.blockAt(x, y, z) !== BLOCK_AIR) w.setBlock(x, y, z, BLOCK_AIR)
        }
      }
    }
    // The 12 frames — the final setBlock triggers self-activation.
    for (let i = 0; i < 3; i++) {
      for (const [x, z] of [
        [ax + i, az - 1],
        [ax + i, az + 3],
        [ax - 1, az + i],
        [ax + 3, az + i],
      ]) {
        w.setBlock(x, cy, z, END.portal.frameBlockId)
      }
    }
    // The trophy beside the ring, on its own pedestal cell.
    const ex = this.cfg.egg.dx
    const ez = this.cfg.egg.dz
    if (!isSolid(w.blockAt(ex, cy - 1, ez))) w.setBlock(ex, cy - 1, ez, BLOCK_END_STONE)
    w.setBlock(ex, cy, ez, BLOCK_DRAGON_EGG)
  }

  // The one elytra, granted runner-side (never the death-position drop — a
  // dragon dying mid-orbit would drop it over the void). dragonDefeated is
  // already latched, so reloads never re-grant.
  #grantElytra() {
    if (!this.inventory) return
    const leftover = this.inventory.add('elytra', 1)
    if (leftover > 0 && this.drops && this.camera) {
      this.drops.throwFrom(this.camera, 'elytra', leftover)
    }
    this.onToast?.('The elytra is yours — wings from the dragon. Equip them in your chest slot.')
  }

  #end() {
    this.state = 'idle'
    this.timer = 0
    this.dragon = null
    this.crystals = []
    this.#clearBeams()
    if (this.mobs) this.mobs.event = false
    this.onBossGone?.()
  }

  #reset() {
    if (this.state === 'idle') return
    // Despawn whatever is still pinned (a death reset — travel already
    // cleared everything on a dimension leave).
    if (this.dragon && this.mobs.mobs.includes(this.dragon)) this.mobs.despawn(this.dragon)
    for (const crystal of this.crystals) {
      if (this.mobs.mobs.includes(crystal)) this.mobs.despawn(crystal)
    }
    this.#end()
  }

  // Leaving the dimension mid-fight: travel cleared the mobs; this clears
  // the runner (and mobs.event) so nothing leaks into other worlds. Wired
  // to dims.onTravel by main.js.
  cancel() {
    this.#reset()
  }

  #event(type, data) {
    this.onBossEvent?.(type, data)
  }
}
