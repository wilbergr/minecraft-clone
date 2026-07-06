import * as THREE from 'three'
import { COMBAT, PHYSICS } from '../config.js'
import { BLOCKS } from '../world/blocks.js'
import { PhysicsBody } from '../physics/PhysicsBody.js'
import { mobSkin } from './mobSkins.js'

// Shared mob base (Phase 13, generalized from the Phase 4 Zombie): the
// box-part body pattern, per-mob cloned materials with the red hurt flash,
// decaying knockback, and the common locomotion contract — AI intent plus
// knockback become the horizontal velocity, gravity/collision are the
// PhysicsBody's, and a blocked grounded move hops a jump (which climbs
// 1-block steps and keeps straight-line chases working over terrain).
//
// Subclasses build their body out of `part()` calls, hand the group to
// `attachBody()`, and implement update(delta, playerPos, damagePlayer);
// `damagePlayer(amount, mob)` reports the attacker so Combat can shove the
// player away from it (player knockback, Phase 13).
export class Mob {
  constructor(world, health) {
    this.world = world
    this.health = health
    this.knock = new THREE.Vector3() // decaying knockback impulse
    this.flashTimer = 0
    this.materials = {}
    this.skinDef = null // shared per-type skin resources (mobSkins.js)
    this.skinMeshes = [] // meshes on the shared material — flash swaps them
    this.group = null
    this.body = null
  }

  // Clone a color table into per-mob Lambert materials (the hurt flash sets
  // emissive — shared materials would light up every mob of the kind).
  makeMaterials(colors) {
    for (const [name, color] of Object.entries(colors)) {
      this.materials[name] = new THREE.MeshLambertMaterial({ color })
    }
    return this.materials
  }

  // Textured-skin path (mob-textures PR): fetch the type's SHARED material +
  // UV-mapped geometries from the per-type cache. Falls back to the old
  // per-mob flat-color materials when no skin exists (node probes, unknown
  // types) — subclasses branch their body build on the return value.
  makeSkin(type, colors) {
    this.skinDef = mobSkin(type)
    if (!this.skinDef) this.makeMaterials(colors)
    return this.skinDef
  }

  // A body part on the type's shared skin material; registered so setFlash
  // can swap it to the shared flash material and back.
  skinnedPart(name, x, y, z) {
    const mesh = this.part(this.skinDef.geoms[name], this.skinDef.material, x, y, z)
    this.skinMeshes.push(mesh)
    return mesh
  }

  // One body part; userData.mob maps attack raycast intersections back here.
  part(geom, material, x, y, z) {
    const mesh = new THREE.Mesh(geom, material)
    mesh.position.set(x, y, z)
    mesh.userData.mob = this
    return mesh
  }

  // Place the finished body on the terrain surface and give it physics.
  // Group origin sits at the feet; the body drives the position directly.
  attachBody(group, x, z, aabb) {
    this.group = group
    group.position.set(x, this.world.surfaceY(x, z), z)
    this.body = new PhysicsBody(this.world, aabb, group.position)
  }

  // The shared per-frame movement tail: face + apply the move intent, decay
  // knockback, hop blocked grounded moves, step physics, tick the flash.
  // `hop: false` lets a move slam into walls instead of jumping them (the
  // boss's charge — hitWall is its stagger trigger, not a step to climb).
  locomote(delta, moveDir, speed, hop = true) {
    if (moveDir) this.group.rotation.y = Math.atan2(moveDir.x, moveDir.z)
    const body = this.body
    // Walked-on slow factor (N4, soul sand): the PlayerControls twin — one
    // feet-cell blockAt, only when actually moving. Mobs wade through soul
    // sand as slowly as the player does.
    if (moveDir && speed > 0) {
      const p = this.group.position
      speed *=
        BLOCKS[this.world.blockAt(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z))]
          ?.slow ?? 1
    }
    body.velocity.x = (moveDir ? moveDir.x * speed : 0) + this.knock.x
    body.velocity.z = (moveDir ? moveDir.z * speed : 0) + this.knock.z
    this.knock.multiplyScalar(Math.exp(-8 * delta))
    if (hop && moveDir && body.grounded && body.hitWall) {
      body.velocity.y = PHYSICS.jumpVelocity
    }
    body.step(delta)

    if (this.flashTimer > 0) {
      this.flashTimer -= delta
      if (this.flashTimer <= 0) this.setFlash(false)
    }
  }

  // Take a hit: lose health, flash red, get shoved along `knockDir` (unit
  // XZ). Returns true when the hit was fatal.
  hurt(amount, knockDir) {
    this.health -= amount
    this.knock.addScaledVector(knockDir, COMBAT.attack.knockback)
    this.flashTimer = 0.15
    this.setFlash(true)
    return this.health <= 0
  }

  setFlash(on) {
    for (const mat of Object.values(this.materials)) {
      mat.emissive.setHex(on ? 0x8a1a1a : 0x000000)
    }
    // Skinned meshes share ONE material per type, so the flash is a material
    // swap (never an emissive write — that would flash the whole kind).
    if (this.skinDef) {
      const mat = on ? this.skinDef.flashMaterial : this.skinDef.material
      for (const mesh of this.skinMeshes) mesh.material = mat
    }
  }

  dispose() {
    // Per-mob clones only — shared skin materials/textures are cached
    // forever (atlas semantics) and must never be disposed here.
    for (const mat of Object.values(this.materials)) mat.dispose()
  }
}
