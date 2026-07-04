import * as THREE from 'three'
import { PLAYER, TREASURE, WORLD } from '../config.js'
import { mulberry32 } from '../world/noise.js'
import { TokenField } from '../quest/TokenField.js'

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
    // Visuals + proximity live in the shared TokenField (also used by the
    // King's Trial relic hunt), styled from the same TREASURE knobs as ever.
    this.field = new TokenField(scene, TREASURE)
    this.tokens = this.#placeTokens()
    for (const token of this.tokens) this.field.build(token)
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

  // --- Gameplay tick (driven by the main loop) -------------------------------

  update(delta, playerPos) {
    this.field.update(delta, playerPos, this.tokens, (token) => this.#collect(token))
  }

  #collect(token) {
    token.found = true
    this.field.remove(token)
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
        this.field.remove(token)
      }
    }
    this.celebrated = data?.celebrated === true
  }
}
