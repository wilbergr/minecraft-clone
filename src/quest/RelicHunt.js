import * as THREE from 'three'
import { CHALLENGE, PLAYER, WATER, WORLD } from '../config.js'
import { mulberry32 } from '../world/noise.js'
import { cardinal8 } from '../treasure/TreasureHunt.js'
import { TokenField } from './TokenField.js'

// King's Trial stage 1 — Relics of the Deep: five relic shards hidden across
// the world's systems (desert / forest / snow biome treks, a cave pocket
// below CHALLENGE.relics maxY, a seabed), collected by walking into them like
// treasure tokens but carried as `relic_shard` items and delivered at the
// Trial Grounds (delivery itself is Challenge's job — it owns the anchor).
//
// Placement is a pure function of WORLD.seed via a dedicated mulberry32
// stream and ONLY the pristine terrain generators (terrainHeight / biomeAt /
// caveAt / treeAt — never blockAt, which consults the player's edit overlay
// and would make shard spots drift between saves). The save's `found` array
// is index-matched to CHALLENGE.relics.shards, same contract as treasure.
export class RelicHunt {
  constructor(world, scene) {
    this.world = world
    this.field = new TokenField(scene, CHALLENGE.relics)
    this.onCollect = null // callback(relic) — toast/fx, wired by Challenge
    this.visible = false // meshes exist only once the Trial activates
    this.delivered = false // latched by Challenge at the anchor
    this.relics = this.#placeRelics()
  }

  get foundCount() {
    return this.relics.filter((r) => r.found).length
  }

  get allFound() {
    return this.relics.every((r) => r.found)
  }

  // The shard the compass and active clue point at: first unfound, in order.
  get activeRelic() {
    return this.relics.find((r) => !r.found) ?? null
  }

  // --- Placement (pure function of WORLD.seed) ------------------------------

  #placeRelics() {
    const rand = mulberry32((WORLD.seed ^ CHALLENGE.relics.seedSalt) >>> 0)
    const spawn = { x: PLAYER.spawnPoint.x, z: PLAYER.spawnPoint.z }
    return CHALLENGE.relics.shards.map((def, index) => {
      let spot
      if (def.kind === 'biome') spot = this.#findBiomeSpot(rand, spawn, def)
      else if (def.kind === 'cave') spot = this.#findCaveSpot(rand, spawn, def)
      else spot = this.#findSeaSpot(rand, spawn, def)
      const position = new THREE.Vector3(spot.x + 0.5, spot.y, spot.z + 0.5)
      return {
        index,
        name: def.name,
        kind: def.kind,
        position,
        found: false,
        clue: this.#clueText(def, spawn, position),
      }
    })
  }

  // Seed-chosen bearing/distance re-rolls (same defensive spirit as the
  // treasure token loop): distances stretch as tries mount, so even a seed
  // whose target biome sits past maxDist resolves. The first dry candidate
  // is kept as a fallback so a pathological seed can't hang placement.
  #findBiomeSpot(rand, from, def) {
    let fallback = null
    for (let tries = 0; tries < 240; tries++) {
      const stretch = 1 + tries / 120 // up to 2x maxDist by the last tries
      const angle = rand() * Math.PI * 2
      const dist = (def.minDist + rand() * (def.maxDist - def.minDist)) * stretch
      const x = Math.round(from.x + Math.sin(angle) * dist)
      const z = Math.round(from.z + Math.cos(angle) * dist)
      const h = this.world.terrainHeight(x, z)
      if (h - 1 <= WORLD.terrain.sandLevel) continue // beach/sea — sand in every biome
      if (!fallback) fallback = { x, z, h }
      if (this.world.biomeAt(x, z).name !== def.biome) continue
      if (this.world.treeAt(x, z)) continue
      return { x, z, y: h + CHALLENGE.relics.hoverHeight }
    }
    fallback ??= this.#spawnColumn(from)
    return { x: fallback.x, z: fallback.z, y: fallback.h + CHALLENGE.relics.hoverHeight }
  }

  // Last-ditch fallback column (the stream never found a candidate at all —
  // effectively impossible, but placement must never throw).
  #spawnColumn(from) {
    const x = Math.round(from.x)
    const z = Math.round(from.z)
    return { x, z, h: this.world.terrainHeight(x, z) }
  }

  // Cave shard: a seed-chosen dry column, then a downward scan of the pure
  // cave field for the first air pocket (carved cell over a solid floor) at
  // or below def.maxY. Collected by REACHING the pocket — the ±4 vertical
  // proximity band means standing on the surface 40 blocks up never counts.
  // The scan floor is clamped above the lava fill (lava feature): carved
  // cells at or below WORLD.terrain.lava.level are lava now, and an opaque,
  // damaging pool with the shard invisible inside it is a broken quest beat.
  #findCaveSpot(rand, from, def) {
    const floor = Math.max(WORLD.terrain.caves.minY, WORLD.terrain.lava.level + 1)
    let last = null
    for (let tries = 0; tries < 240; tries++) {
      const angle = rand() * Math.PI * 2
      const dist = def.minDist + rand() * (def.maxDist - def.minDist)
      const x = Math.round(from.x + Math.sin(angle) * dist)
      const z = Math.round(from.z + Math.cos(angle) * dist)
      const h = this.world.terrainHeight(x, z)
      if (h - 1 <= WATER.level + 1) continue // sea/beach columns keep the seabed sealed
      last = { x, z }
      for (let y = Math.min(def.maxY, h - 8); y > floor; y--) {
        if (this.world.caveAt(x, y, z, h) && !this.world.caveAt(x, y - 1, z, h)) {
          return { x, z, y: y + 0.5 }
        }
      }
    }
    // No pocket found (pathological seed): sit the shard in the stone at the
    // depth cap — still reachable, the player just mines the last stretch.
    last ??= this.#spawnColumn(from)
    return { x: last.x, z: last.z, y: def.maxY - 2 }
  }

  // Tide shard: sweep outward rings deterministically (seed-chosen start
  // bearing) and take the first column deep enough. The primary pass wants a
  // genuinely dive-worthy ocean column (deep water: >= minDiveDepth blocks
  // under the waterline, so the ±4 vertical collect band can't be reached by
  // treading the surface — retrieving the shard takes a real breath-managed
  // dive); the relaxation ladder keeps the module's never-fail contract on
  // pathological seeds with only shallow seas. terrainHeight answers the
  // seabed for sea columns, so the shard hovers just above the sea floor.
  #findSeaSpot(rand, from, def) {
    const offset = rand() * Math.PI * 2
    let last = null
    const ladder = [
      WATER.level - CHALLENGE.relics.minDiveDepth,
      WATER.level - 3,
      WATER.level - 2,
    ]
    for (const maxHeight of ladder) {
      for (let r = def.minDist; r <= 600; r += 6) {
        const steps = Math.max(16, Math.floor((Math.PI * 2 * r) / 24))
        for (let a = 0; a < steps; a++) {
          const angle = offset + (a / steps) * Math.PI * 2
          const x = Math.round(from.x + Math.sin(angle) * r)
          const z = Math.round(from.z + Math.cos(angle) * r)
          const h = this.world.terrainHeight(x, z)
          last = { x, z, h }
          if (h <= maxHeight) return { x, z, y: h + 1 }
        }
      }
    }
    return { x: last.x, z: last.z, y: last.h + 1 } // no sea at all — wherever the sweep ended
  }

  #clueText(def, from, to) {
    const dx = to.x - from.x
    const dz = to.z - from.z
    const dist = Math.round(Math.hypot(dx, dz) / 5) * 5
    return def.clue
      .replaceAll('{dist}', String(dist))
      .replaceAll('{dir}', cardinal8(dx, dz))
      .replaceAll('{name}', def.name)
  }

  // --- Visibility (the Trial builds meshes only once it activates) -----------

  show() {
    if (this.visible) return
    this.visible = true
    for (const relic of this.relics) {
      if (!relic.found) this.field.build(relic)
    }
  }

  // --- Gameplay tick (driven by Challenge while stage 1 is active) -----------

  update(delta, playerPos) {
    if (!this.visible) return
    this.field.update(delta, playerPos, this.relics, (relic) => this.#collect(relic))
  }

  #collect(relic) {
    relic.found = true
    this.field.remove(relic)
    this.onCollect?.(relic)
  }

  // --- Persistence (embedded in Challenge's save slot) -----------------------

  serialize() {
    return { found: this.relics.map((r) => r.found), delivered: this.delivered }
  }

  deserialize(data) {
    const found = Array.isArray(data?.found) ? data.found : []
    for (const relic of this.relics) {
      if (found[relic.index] === true && !relic.found) {
        relic.found = true
        this.field.remove(relic)
      }
    }
    this.delivered = data?.delivered === true
  }
}
