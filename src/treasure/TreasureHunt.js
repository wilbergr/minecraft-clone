import * as THREE from 'three'
import { PLAYER, TREASURE, WORLD } from '../config.js'
import { mulberry32 } from '../world/noise.js'

// The treasure hunt (Phase 6): TREASURE.rings.length glowing tokens at
// seed-deterministic world positions, collected by walking up to them. Token
// 1 sits a ring-distance from spawn and each later token a ring-distance
// from the previous one, so the pre-generated clues (and the compass HUD)
// chain the player across the world. UI layers subscribe via onChange (same
// pattern as Inventory/Health); progress round-trips through the save's
// reserved `treasure` slot as { found: [bool per token], celebrated }.
//
// Positions are a pure function of WORLD.seed (mulberry32 stream + the
// deterministic terrain functions), so a given world always hides its tokens
// in the same spots and a saved `found` array stays valid across reloads.
// Token height comes from pristine terrainHeight — player edits never move a
// token, they just leave it hovering.

// 8-point compass name for the horizontal direction (dx, dz). North is -Z.
export function cardinal8(dx, dz) {
  const deg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]
}

export class TreasureHunt {
  constructor(world, scene) {
    this.world = world
    this.scene = scene
    this.listeners = []
    this.onCollect = null // callback(token) — HUD toast
    this.onComplete = null // callback() — opens the reveal overlay
    this.celebrated = false // reveal shown — set via markCelebrated(), persisted
    this.time = 0 // drives the bob animation
    this.tokens = this.#placeTokens()
    for (const token of this.tokens) this.#buildMeshes(token)
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  get foundCount() {
    return this.tokens.filter((t) => t.found).length
  }

  get isComplete() {
    return this.tokens.every((t) => t.found)
  }

  // The token the compass and active clue point at: first unfound, in hunt
  // order (finding a later token early just means less walking afterwards).
  get activeToken() {
    return this.tokens.find((t) => !t.found) ?? null
  }

  // --- Placement (pure function of WORLD.seed) ------------------------------

  #placeTokens() {
    const rand = mulberry32((WORLD.seed ^ TREASURE.seedSalt) >>> 0)
    let from = { x: PLAYER.spawnPoint.x, z: PLAYER.spawnPoint.z }
    return TREASURE.rings.map((ring, index) => {
      let x = 0
      let z = 0
      // Seed-chosen bearing + distance from the previous stop; re-roll (still
      // deterministic — same rand stream) rather than hover inside a trunk.
      for (let tries = 0; tries < 48; tries++) {
        const angle = rand() * Math.PI * 2
        const dist = ring.minDist + rand() * (ring.maxDist - ring.minDist)
        x = Math.round(from.x + Math.sin(angle) * dist)
        z = Math.round(from.z + Math.cos(angle) * dist)
        if (!this.world.treeAt(x, z)) break
      }
      const y = this.world.terrainHeight(x, z) + TREASURE.hoverHeight
      const position = new THREE.Vector3(x + 0.5, y, z + 0.5)
      const token = {
        index,
        name: TREASURE.names[index],
        position,
        found: false,
        clue: this.#clueText(index, from, position),
      }
      from = { x: position.x, z: position.z }
      return token
    })
  }

  // Fill the config clue template with the real bearing/distance from the
  // previous stop, so clue text always matches the generated world.
  #clueText(index, from, to) {
    const dx = to.x - from.x
    const dz = to.z - from.z
    const dist = Math.round(Math.hypot(dx, dz) / 5) * 5 // "~65", not "~63.4"
    return TREASURE.clues[index]
      .replaceAll('{dist}', String(dist))
      .replaceAll('{dir}', cardinal8(dx, dz))
      .replaceAll('{name}', TREASURE.names[index])
  }

  // --- Rendering -------------------------------------------------------------

  #buildMeshes(token) {
    // Unlit gold octahedron: MeshBasicMaterial ignores the scene lights, so
    // it reads as glowing against the Lambert-shaded terrain.
    token.mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.45),
      new THREE.MeshBasicMaterial({ color: TREASURE.tokenColor }),
    )
    token.mesh.position.copy(token.position)
    // Sky beam: a faint additive column over the token. Scene fog still
    // applies, so it emerges as a landmark on approach instead of giving the
    // spot away from across the world.
    const { radius, color, opacity } = TREASURE.beam
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

  #removeMeshes(token) {
    for (const mesh of [token.mesh, token.beam]) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }

  // --- Gameplay tick (driven by the main loop) -------------------------------

  update(delta, playerPos) {
    this.time += delta
    const { spinSpeed, bob, collectRadius } = TREASURE
    for (const token of this.tokens) {
      if (token.found) continue
      token.mesh.rotation.y += spinSpeed * delta
      token.mesh.position.y =
        token.position.y + Math.sin(this.time * bob.speed + token.index) * bob.amplitude
      // Horizontal proximity collect (with a loose vertical band, so pillars
      // and pits under the token don't count as "reaching" it).
      const dx = playerPos.x - token.position.x
      const dz = playerPos.z - token.position.z
      if (
        dx * dx + dz * dz <= collectRadius * collectRadius &&
        Math.abs(playerPos.y - token.position.y) < 4
      ) {
        this.#collect(token)
      }
    }
  }

  #collect(token) {
    token.found = true
    this.#removeMeshes(token)
    this.onCollect?.(token)
    this.#emit()
    if (this.isComplete) this.onComplete?.()
  }

  // The reveal overlay calls this when it shows, so a reload after completion
  // doesn't replay the celebration.
  markCelebrated() {
    if (this.celebrated) return
    this.celebrated = true
    this.#emit()
  }

  // --- Persistence seam (Phase 5's reserved `treasure` slot) -----------------

  serialize() {
    return {
      found: this.tokens.map((t) => t.found),
      celebrated: this.celebrated,
    }
  }

  // Defensive like the other deserializers: anything malformed leaves the
  // hunt fresh. No emit — UI layers bind (and render) after restore.
  deserialize(data) {
    const found = Array.isArray(data?.found) ? data.found : []
    for (const token of this.tokens) {
      if (found[token.index] === true && !token.found) {
        token.found = true
        this.#removeMeshes(token)
      }
    }
    this.celebrated = data?.celebrated === true
  }
}
