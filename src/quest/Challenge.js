import * as THREE from 'three'
import { CHALLENGE, PLAYER, WATER, WORLD } from '../config.js'
import { mulberry32 } from '../world/noise.js'
import { cardinal8 } from '../treasure/TreasureHunt.js'
import { RelicHunt } from './RelicHunt.js'

// The King's Trial (endgame): a four-stage machine — scavenger → build →
// siege → boss — mirroring TreasureHunt's shape so every established pattern
// transfers: onChange listeners for the UI/save layers, update(delta,
// playerPos) beside hunt.update in the main loop, serialize()/deserialize()
// for the optional `challenge` save slot, and window.__mc.challenge as the
// test seam. This PR ships the framework plus stage 0 (Relics of the Deep);
// stages 1–3 are declared in STAGES and the save shape but inert — their
// PRs land StructureCheck / SiegeEvent / Boss behind the same machine.
//
// The Trial unlocks when the treasure hunt completes (hunt.isComplete): the
// anchor marker and relic meshes appear only then, and until then the quest
// log shows the section sealed. Everything physical about the Trial Grounds
// is scene meshes — NOTHING is stamped into terrain generation (the purity
// rule): the site is marked, not generated.

export const STAGES = [
  { id: 'relics', name: 'Relics of the Deep' },
  { id: 'beacon', name: 'Raise the Beacon' },
  { id: 'siege', name: 'The Siege' },
  { id: 'boss', name: 'The Hollow King' },
]

export class Challenge {
  constructor(world, scene, hunt, inventory) {
    this.world = world
    this.scene = scene
    this.hunt = hunt
    this.inventory = inventory
    this.listeners = []
    this.onToast = null // callback(text) — HUD toast line
    this.onCollect = null // callback(relic) — collect fx (sound/particles)
    this.onDeliver = null // callback(anchorPosition) — delivery fx

    this.stage = 0 // index into STAGES; STAGES.length = trial complete
    // Latched stage flags (report §9): once true they stay true — a creeper
    // chewing the beacon later never regresses the quest.
    this.beaconBuilt = false
    this.siegeCleared = false
    this.bossDefeated = false
    this.celebrated = false // completion reveal shown (later PR's replay guard)

    // Trial Grounds anchor: seed-deterministic, ringed off the third treasure
    // token. anchor is the column; anchorPosition the block-centered vector
    // the compass and delivery test use.
    this.anchor = this.#placeAnchor()
    this.anchorPosition = new THREE.Vector3(
      this.anchor.x + 0.5,
      this.anchor.y,
      this.anchor.z + 0.5,
    )
    this.deliverClue = this.#deliverClueText()

    this.relics = new RelicHunt(world, scene)
    this.relics.onCollect = (relic) => this.#onRelicCollect(relic)

    this.activated = false // meshes built / trial live — flips on hunt completion
    this.marker = null // { ring, beam } scene meshes at the anchor
    // Activate silently when the hunt is already complete (construction
    // happens after the save restored it); the live transition — collecting
    // the last token mid-play — arrives via onChange and gets the herald.
    if (hunt.isComplete) this.#activate(false)
    hunt.onChange(() => {
      if (hunt.isComplete) this.#activate(true)
    })
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  get isComplete() {
    return this.stage >= STAGES.length
  }

  // What the compass HUD points at (null = nothing to show): the active
  // relic while scavenging, then the Trial Grounds for delivery and every
  // later stage.
  get compassTarget() {
    if (!this.activated || this.isComplete) return null
    if (this.stage === 0) {
      const relic = this.relics.activeRelic
      if (relic) return { position: relic.position, name: relic.name }
    }
    return { position: this.anchorPosition, name: 'Trial Grounds' }
  }

  // --- Trial Grounds placement (pure function of WORLD.seed) -----------------

  // Ring off the third treasure token (the player has already walked there),
  // re-rolling deterministically for a dry, tree-free, reasonably flat
  // column — the later build/siege stages want a fair arena floor. Nothing
  // is flattened or generated; the last candidate stands if no roll passes.
  #placeAnchor() {
    const rand = mulberry32((WORLD.seed ^ CHALLENGE.seedSalt) >>> 0)
    const from = this.hunt.tokens[this.hunt.tokens.length - 1].position
    const { minDist, maxDist, flatSpread } = CHALLENGE.site
    let x = Math.round(from.x)
    let z = Math.round(from.z)
    for (let tries = 0; tries < 64; tries++) {
      const angle = rand() * Math.PI * 2
      const dist = minDist + rand() * (maxDist - minDist)
      x = Math.round(from.x + Math.sin(angle) * dist)
      z = Math.round(from.z + Math.cos(angle) * dist)
      const h = this.world.terrainHeight(x, z)
      if (h - 1 <= WATER.level + 2) continue // dry land only
      if (this.world.treeAt(x, z)) continue
      if (this.#heightSpread(x, z) > flatSpread) continue
      break
    }
    return { x, z, y: this.world.terrainHeight(x, z) }
  }

  #heightSpread(x, z) {
    let min = Infinity
    let max = -Infinity
    for (const [dx, dz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) {
      const h = this.world.terrainHeight(x + dx, z + dz)
      min = Math.min(min, h)
      max = Math.max(max, h)
    }
    return max - min
  }

  #deliverClueText() {
    const dx = this.anchorPosition.x - PLAYER.spawnPoint.x
    const dz = this.anchorPosition.z - PLAYER.spawnPoint.z
    const dist = Math.round(Math.hypot(dx, dz) / 5) * 5
    return CHALLENGE.relics.deliverClue
      .replaceAll('{dist}', String(dist))
      .replaceAll('{dir}', cardinal8(dx, dz))
  }

  // --- Activation (gated behind the treasure hunt) ---------------------------

  #activate(loud) {
    if (this.activated) return
    this.activated = true
    this.#buildMarker()
    if (!this.relics.delivered) this.relics.show()
    if (loud) {
      this.onToast?.('The Heart of the World stirs — five relics answer it.')
      this.#emit()
    }
  }

  // The Trial Grounds marker: a flat glowing ring on the terrain plus a sky
  // beam (scene meshes only — the purity rule keeps generation untouched).
  #buildMarker() {
    const { marker } = CHALLENGE.site
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(marker.ringRadius - marker.ringWidth, marker.ringRadius, 48),
      new THREE.MeshBasicMaterial({
        color: marker.color,
        transparent: true,
        opacity: marker.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.set(this.anchorPosition.x, this.anchor.y + 0.1, this.anchorPosition.z)
    const { radius, color, opacity } = marker.beam
    const beam = new THREE.Mesh(
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
    beam.position.set(this.anchorPosition.x, WORLD.chunkHeight, this.anchorPosition.z)
    this.scene.add(ring, beam)
    this.marker = { ring, beam }
  }

  // --- Gameplay tick (beside hunt.update in the main loop) -------------------

  update(delta, playerPos) {
    if (!this.activated || this.isComplete) return
    if (this.stage === 0) {
      this.relics.update(delta, playerPos)
      this.#checkDelivery(playerPos)
    }
    // Stages 1–3 (beacon / siege / boss) tick here when their PRs land.
  }

  // Delivery: all shards found and the player standing inside the marker
  // ring. The carried relic_shard items are consumed (defensively — flags
  // are the source of truth, so a shard lost to some future mechanic can
  // never soft-lock the trial).
  #checkDelivery(playerPos) {
    if (!this.relics.allFound || this.relics.delivered) return
    const dx = playerPos.x - this.anchorPosition.x
    const dz = playerPos.z - this.anchorPosition.z
    const r = CHALLENGE.site.deliverRadius
    if (dx * dx + dz * dz > r * r) return
    if (Math.abs(playerPos.y - this.anchor.y) > 6) return // on the site, not under it
    const carried = this.inventory.countOf('relic_shard')
    if (carried > 0) this.inventory.consume('relic_shard', Math.min(carried, this.relics.relics.length))
    this.relics.delivered = true
    this.#advance('The relics are delivered — the Trial Grounds awaken.')
    this.onDeliver?.(this.anchorPosition)
  }

  #onRelicCollect(relic) {
    this.inventory.add('relic_shard', 1)
    this.onCollect?.(relic)
    this.onToast?.(
      `◈ ${relic.name} recovered (${this.relics.foundCount}/${this.relics.relics.length})`,
    )
    this.#emit()
  }

  #advance(toast) {
    this.stage++
    if (toast) this.onToast?.(toast)
    this.#emit()
  }

  // --- Test seam (dev-only): jump the machine for headless runs --------------

  // Marks every stage before `n` complete and lands on stage n, so tests and
  // captain playtesting skip hours of progression. Does NOT force the unlock
  // gate — the trial still needs hunt.isComplete to activate.
  skipToStage(n) {
    const stage = Math.max(0, Math.min(n, STAGES.length))
    if (stage >= 1) {
      for (const relic of this.relics.relics) {
        if (!relic.found) {
          relic.found = true
          this.relics.field.remove(relic)
        }
      }
      this.relics.delivered = true
    }
    if (stage >= 2) this.beaconBuilt = true
    if (stage >= 3) this.siegeCleared = true
    if (stage >= 4) this.bossDefeated = true
    this.stage = stage
    this.#emit()
  }

  // --- Persistence (optional `challenge` save slot, report §9) ---------------

  serialize() {
    return {
      stage: this.stage,
      relics: this.relics.serialize(),
      beaconBuilt: this.beaconBuilt,
      siegeCleared: this.siegeCleared,
      bossDefeated: this.bossDefeated,
      celebrated: this.celebrated,
    }
  }

  // Defensive like the other deserializers: anything malformed leaves the
  // trial fresh. No emit — UI layers bind (and render) after restore.
  deserialize(data) {
    if (!data || typeof data !== 'object') return
    this.relics.deserialize(data.relics)
    const stage = Number.isInteger(data.stage) ? data.stage : 0
    this.stage = Math.max(0, Math.min(stage, STAGES.length))
    this.beaconBuilt = data.beaconBuilt === true
    this.siegeCleared = data.siegeCleared === true
    this.bossDefeated = data.bossDefeated === true
    this.celebrated = data.celebrated === true
  }
}
