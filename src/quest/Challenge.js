import * as THREE from 'three'
import { CHALLENGE, PLAYER, WATER, WORLD } from '../config.js'
import { mulberry32 } from '../world/noise.js'
import { cardinal8 } from '../treasure/TreasureHunt.js'
import { RelicHunt } from './RelicHunt.js'
import { StructureCheck } from './StructureCheck.js'
import { SiegeEvent } from './SiegeEvent.js'
import { BossFight } from './BossFight.js'

// The King's Trial (endgame): a four-stage machine — scavenger → build →
// siege → boss — mirroring TreasureHunt's shape so every established pattern
// transfers: onChange listeners for the UI/save layers, update(delta,
// playerPos) beside hunt.update in the main loop, serialize()/deserialize()
// for the optional `challenge` save slot, and window.__mc.challenge as the
// test seam. All four stages are live: stage 0 (Relics of the Deep), stage 1
// (Raise the Beacon — StructureCheck), stage 2 (The Siege — SiegeEvent), and
// stage 3 (The Hollow King — BossFight + src/combat/Boss.js). Felling the
// King latches bossDefeated, completes the trial, and fires onComplete — the
// CHALLENGE_MESSAGE reveal modal (src/ui/challengeReveal.js) owns that hook.
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
    this.onBeaconPulse = null // callback({x,y,z}) — a beacon cell satisfied
    this.onBeaconDone = null // callback(anchorPosition) — the beacon completed
    this.onSiegeWon = null // callback(anchorPosition) — the final wave cleared
    this.onBossDefeated = null // callback(bossPosition) — victory fx (nova, roar)
    this.onComplete = null // single-slot, owned by the reveal modal (hunt.onComplete pattern)

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

    // Stage 2 — the beacon spec/checker + ghost preview. Cells anchor at the
    // Trial Grounds column; the ghost builds only while the stage is active
    // (#syncBeacon). World edits near the site re-run the check (world.onEdit
    // is a listener list — SaveManager's dirty flag subscribes alongside us).
    this.structure = new StructureCheck(world, scene, this.anchor)
    this.structure.onCellSatisfied = (pos) => this.onBeaconPulse?.(pos)
    world.onEdit((wx, wy, wz) => this.#onWorldEdit(wx, wz))

    // Stage 3 — the siege wave runner. Its live deps (mobs, daynight, health,
    // player) and fx hooks are attached by main.js after construction (the
    // mobs.daynight pattern); bare runs leave them null and the siege inert.
    this.siege = new SiegeEvent(this.anchorPosition)
    this.siege.onToast = (text) => this.onToast?.(text)
    this.siege.onChange = () => this.#emit()
    this.siege.onWin = () => this.#onSiegeWin()

    // Stage 4 — the Hollow King fight runner. Same live-dep pattern as the
    // siege: main.js attaches mobs/health/player after construction.
    this.bossFight = new BossFight(this.anchorPosition, scene, world)
    this.bossFight.onToast = (text) => this.onToast?.(text)
    this.bossFight.onChange = () => this.#emit()
    this.bossFight.onWin = (position) => this.#onBossWin(position)

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
    if (this.stage === 1) {
      return {
        position: this.anchorPosition,
        name: `Beacon ${this.structure.satisfied}/${this.structure.total}`,
      }
    }
    if (this.stage === 2) {
      // During the event the compass strip becomes the wave readout
      // ("Wave 2 · 3 remain · dawn in ~2:40"); otherwise it points home.
      return {
        position: this.anchorPosition,
        name: this.siege.hudLabel ?? 'Arm the siege at the beacon core',
      }
    }
    if (this.stage === 3) {
      // Boss stage: phase/health readout while the King walks, else the call
      // back to the core.
      return {
        position: this.anchorPosition,
        name: this.bossFight.hudLabel ?? 'Summon the Hollow King at the beacon core',
      }
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
    this.#syncBeacon() // restores landing past stage 0 need the ghost/bright beam
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
    // Stage 1 (beacon) is edit-driven, not ticked — see #onWorldEdit.
    if (this.stage === 2) this.siege.update(delta, playerPos)
    if (this.stage === 3) this.bossFight.update(delta, playerPos)
  }

  // --- Stage 2: The Siege (SiegeEvent owns the waves) -------------------------

  // The use-verb dispatcher (main.js) consults this for EVERY targeted block:
  // right-clicking the beacon's gold core arms the siege (stage 2) or summons
  // the Hollow King (stage 3, siege cleared). Gate hard on the core cells at
  // the anchor AND the combat stages — gold ore is never globally
  // interactive, so cave veins stay plain mining targets.
  tryUseBlock(block, x, y, z) {
    if (!this.activated || (this.stage !== 2 && this.stage !== 3)) return false
    if (block.id !== this.structure.cfg.shape.coreId) return false
    const s = this.structure
    if (x !== s.anchorX || z !== s.anchorZ) return false
    const dy = y - s.baseY
    if (dy < 1 || dy > s.cfg.shape.coreHeight) return false
    if (this.stage === 2) return this.siege.arm()
    return this.bossFight.trySummon()
  }

  #onSiegeWin() {
    this.siegeCleared = true // latched, like beaconBuilt
    this.onSiegeWon?.(this.anchorPosition)
    this.#advance('The siege is broken! The beam burns blood-orange — the Hollow King stirs.')
  }

  // The King fell (through the normal kill plumbing — BossFight observed the
  // pinned reference vanish with zero health). Latch, advance to complete,
  // and fire onComplete for the reveal modal.
  #onBossWin(position) {
    this.bossDefeated = true // latched, like the others
    this.onBossDefeated?.(position)
    this.#advance('The Hollow King has fallen. The Trial is complete!')
    this.onComplete?.()
  }

  // The reveal modal was shown — never replay it on a reload (the treasure
  // hunt's celebrated guard, same shape).
  markCelebrated() {
    if (this.celebrated) return
    this.celebrated = true
    this.#emit()
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
    this.#syncBeacon()
    if (toast) this.onToast?.(toast)
    this.#emit()
  }

  // --- Stage 1: Raise the Beacon (StructureCheck owns the spec/ghost) --------

  // Every entry/exit path for the beacon stage funnels here: show the ghost
  // and take a first reading while the stage is live (natural or pre-placed
  // cells count immediately), tear the ghost down otherwise, and keep the
  // anchor beam bright once the beacon is built (restores included).
  #syncBeacon() {
    if (!this.activated) return
    if (this.stage === 1 && !this.beaconBuilt) {
      this.structure.show()
      this.#evaluateBeacon()
    } else {
      this.structure.hide()
    }
    if (this.beaconBuilt && this.marker) {
      const base = CHALLENGE.site.marker.beam.opacity
      this.marker.beam.material.opacity = Math.min(1, base * 2)
    }
    // Siege won (live or restored): the beam shifts blood-orange — the
    // "boss ready" signal the boss stage will answer.
    if (this.siegeCleared && this.marker) {
      this.marker.beam.material.color.setHex(CHALLENGE.siege.clearedBeamColor)
    }
  }

  // World-edit listener (all edits, any source): re-check only while the
  // beacon stage is live and the edit landed near the anchor. Once built the
  // stage is latched — later damage never regresses it, so no re-checks.
  #onWorldEdit(wx, wz) {
    if (!this.activated || this.stage !== 1 || this.beaconBuilt) return
    if (!this.structure.near(wx, wz)) return
    this.#evaluateBeacon()
  }

  #evaluateBeacon() {
    const before = this.structure.satisfied
    const done = this.structure.evaluate()
    if (done) {
      this.beaconBuilt = true // latched — the win survives any later damage
      this.onBeaconDone?.(this.anchorPosition)
      this.#advance('The beacon blazes! The Trial Grounds brace for a siege.')
    } else if (this.structure.satisfied !== before) {
      this.#emit() // quest-log progress line
    }
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
    this.siege.cancel() // never jump away leaving mobs.event set
    this.bossFight.cancel() // ditto — also despawns a live King
    this.#syncBeacon()
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
    // Restored mid-beacon: rebuild the ghost against the restored edit
    // overlay (load() applied it before we were constructed). Restored past
    // it: keep the beam bright.
    this.#syncBeacon()
  }
}
