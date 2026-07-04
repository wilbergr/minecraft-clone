import * as THREE from 'three'
import { WORLD } from '../config.js'

// Shared floating-token machinery (extracted from TreasureHunt for the
// King's Trial): the glowing octahedron + sky-beam meshes, the bob/spin
// animation, and the proximity-collect test. Owners (TreasureHunt, RelicHunt)
// keep the game state — a token here is any object with `position`
// (THREE.Vector3, block-centered), `found` (skip flag), and an optional
// `index` (staggers the bob phase); build() adds `mesh`/`beam` to it.
//
// `style` supplies the visual/gameplay knobs: { tokenColor, beam: { color,
// radius, opacity }, spinSpeed, bob: { amplitude, speed }, collectRadius } —
// TREASURE and CHALLENGE.relics are both valid styles, so both hunts stay
// pixel-identical in behavior.
export class TokenField {
  constructor(scene, style) {
    this.scene = scene
    this.style = style
    this.time = 0 // drives the bob animation
  }

  build(token) {
    // Unlit octahedron: MeshBasicMaterial ignores the scene lights, so it
    // reads as glowing against the Lambert-shaded terrain.
    token.mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.45),
      new THREE.MeshBasicMaterial({ color: this.style.tokenColor }),
    )
    token.mesh.position.copy(token.position)
    // Sky beam: a faint additive column over the token. Scene fog still
    // applies, so it emerges as a landmark on approach instead of giving the
    // spot away from across the world.
    const { radius, color, opacity } = this.style.beam
    token.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, WORLD.chunkHeight * 2, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    token.beam.position.set(token.position.x, WORLD.chunkHeight, token.position.z)
    this.scene.add(token.mesh, token.beam)
  }

  remove(token) {
    if (!token.mesh) return
    for (const mesh of [token.mesh, token.beam]) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    token.mesh = null
    token.beam = null
  }

  // Animate un-found tokens and fire onReach(token) when the player walks
  // into one. Horizontal proximity with a loose vertical band, so pillars
  // and pits under a token don't count as "reaching" it.
  update(delta, playerPos, tokens, onReach) {
    this.time += delta
    const { spinSpeed, bob, collectRadius } = this.style
    for (const token of tokens) {
      if (token.found || !token.mesh) continue
      token.mesh.rotation.y += spinSpeed * delta
      token.mesh.position.y =
        token.position.y +
        Math.sin(this.time * bob.speed + (token.index ?? 0)) * bob.amplitude
      const dx = playerPos.x - token.position.x
      const dz = playerPos.z - token.position.z
      if (
        dx * dx + dz * dz <= collectRadius * collectRadius &&
        Math.abs(playerPos.y - token.position.y) < 4
      ) {
        onReach(token)
      }
    }
  }
}
