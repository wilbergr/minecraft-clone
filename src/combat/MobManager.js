import { AUDIO, COMBAT, DAYNIGHT, PASSIVE_MOBS, PHYSICS, WATER, WORLD } from '../config.js'
import { BLOCK_AIR, isSolid } from '../world/blocks.js'
import { Zombie } from './Zombie.js'
import { Skeleton } from './Skeleton.js'
import { Creeper } from './Creeper.js'
import { Boss } from './Boss.js'
import { PassiveMob } from './PassiveMob.js'

// Owns the live mob population: periodically tops it up by spawning hostiles
// in dark cells on a ring around the player — the mix is weighted across
// zombie / skeleton / creeper (Phase 13, COMBAT.mobs.hostileWeights) —
// updates their AI each frame, and removes mobs that die or fall too far
// behind a travelling player. Spawning is light-gated (dark-places spawn):
// each attempt walks the candidate column top-to-bottom for spawnable air
// pockets (the surface AND every cave the column crosses) and spawns only
// where world.lightAt is at or below COMBAT.mobs.spawnLight.maxLight — so
// caves are dangerous at any hour, the surface only after dark, and torches
// carve real safe bubbles. Passive mobs (Phase 12) share the same list — one
// update/attack/despawn path — but spawn on their own timer against their
// own cap (mobs with `passive: true` never count toward the hostile
// population).
//
// Creeper detonation (Phase 13) happens HERE, not in the creeper: the mob
// sets `exploded` during its update and the manager carves the blast,
// applies proximity damage, and removes it — mob-list mutation stays out of
// the update callback (the Phase 4 rule).
//
// Mob state is intentionally not persisted (Phase 5 note): mobs are ambient
// spawns, so a reload simply starts with a fresh population.

const HOSTILES = {
  zombie: (world, x, z) => new Zombie(world, x, z),
  skeleton: (world, x, z, projectiles) => new Skeleton(world, x, z, projectiles),
  creeper: (world, x, z) => new Creeper(world, x, z),
  // The Hollow King (King's Trial stage 4). In the table so spawnAt works
  // (BossFight summons through it; tests too), but deliberately NOT in
  // hostileWeights — the boss can never ambient-spawn.
  boss: (world, x, z, projectiles) => new Boss(world, x, z, projectiles),
}

export class MobManager {
  constructor(scene, world, fx = {}) {
    this.scene = scene
    this.world = world
    this.fx = fx
    this.mobs = []
    // Full interval before the first spawn — no zombie the instant you click in.
    this.spawnTimer = COMBAT.mobs.spawnIntervalSeconds
    this.passiveSpawnTimer = PASSIVE_MOBS.spawnIntervalSeconds
    this.groanTimer = AUDIO.zombie.groanIntervalSeconds / 2
    this.onMobKilled = null // callback(mob) — Combat awards the drop
    // Day/night clock (Phase 10), attached by main.js. When present, hostile
    // spawns are night-only (with a raised cap) and daylight burns the
    // stragglers; when absent (bare/test runs) spawning behaves as before.
    this.daynight = null
    // Projectile system (Phase 13), attached by Combat — skeletons shoot
    // through it. Null in bare runs: skeletons then simply never fire.
    this.projectiles = null
    // Optional hook (inventory overhaul): receives World.explode's carved
    // cells [{ x, y, z, id }] after a detonation — main.js routes carved
    // interactive blocks (furnaces, chests) through the same break handlers
    // as player mining, so their contents spill instead of orphaning.
    this.onBlocksExploded = null
    this.burnTimer = 0
    // Event mode (King's Trial siege): while set, ambient hostile spawning is
    // suppressed (wave counts stay exact), the passive spawner rests
    // (draw-call headroom), and the dawn burn defers — failure-first
    // ordering: at dawn the event fails and CLEARS this flag first, then the
    // burn cleans up whatever the event left behind, for free.
    this.event = false
  }

  get count() {
    return this.mobs.length
  }

  // Every mob body part, for attack raycasts.
  get meshes() {
    return this.mobs.map((mob) => mob.group)
  }

  update(delta, playerPos, damagePlayer) {
    // Light-gated spawning (dark-places spawn): the old night-only gate is
    // gone — the per-cell light check inside #spawnNear IS the gate now, so
    // days allow cave spawns up to the day cap while nights still raise the
    // whole dark surface. Caps stay modest — each body part is a draw call.
    const night = this.daynight ? this.daynight.isNight : true
    this.spawnTimer -= delta
    if (this.spawnTimer <= 0) {
      this.spawnTimer = COMBAT.mobs.spawnIntervalSeconds
      const cap =
        night && this.daynight
          ? DAYNIGHT.hostiles.nightMaxCount
          : COMBAT.mobs.maxCount
      // Hostiles only — passive mobs must not eat into the hostile cap.
      const hostiles = this.mobs.filter((m) => !m.passive).length
      if (!this.event && hostiles < cap) this.#spawnNear(playerPos)
    }

    // Dawn burn (Phase 10): daylight ignites the night's hostiles one at a
    // time — an ember burst each (reusing the pooled particles), staggered so
    // sunrise reads as a wave of little pyres rather than a mass vanish.
    // Sky-exposed hostiles only (dark-places spawn): a mob under any roof or
    // underground survives sunrise, MC-style — without this, cave mobs would
    // ignite at dawn through 40 blocks of stone. Farm animals (Phase 12)
    // graze on through the day. Event mode defers the burn — the siege's
    // dawn check fails the event (clearing the flag) before any of its mobs
    // ignite.
    if (this.daynight && !night && !this.event) {
      this.burnTimer -= delta
      if (this.burnTimer <= 0) {
        const i = this.mobs.findLastIndex(
          (m) =>
            !m.passive &&
            this.world.topSolidY(
              Math.floor(m.group.position.x),
              Math.floor(m.group.position.z),
            ) <= m.group.position.y,
        )
        if (i !== -1) {
          this.burnTimer = DAYNIGHT.hostiles.burnStaggerSeconds
          const { burnColor, burnParticles } = DAYNIGHT.hostiles
          const p = this.mobs[i].group.position
          this.fx.particles?.burst(p.x, p.y + 1, p.z, burnColor, burnParticles)
          this.#remove(i)
        }
      }
    }

    // Passive population (Phase 12): its own timer and cap (day or night), so
    // pigs appearing never changes when or how many zombies spawn.
    this.passiveSpawnTimer -= delta
    if (this.passiveSpawnTimer <= 0) {
      this.passiveSpawnTimer = PASSIVE_MOBS.spawnIntervalSeconds
      const passives = this.mobs.filter((m) => m.passive).length
      if (!this.event && passives < PASSIVE_MOBS.maxCount) this.#spawnPassiveNear(playerPos)
    }

    // Ambient groans (Phase 9): every so often one random growling mob
    // groans, volume fading with distance, so the horde is audible offscreen.
    // Lives here (not in the mob) so mob AI stays sound-agnostic. Growlers
    // only — pigs and skeletons don't moan like zombies.
    this.groanTimer -= delta
    if (this.groanTimer <= 0) {
      const growlers = this.mobs.filter((m) => m.growls)
      if (growlers.length > 0) {
        this.groanTimer = AUDIO.zombie.groanIntervalSeconds * (0.6 + Math.random() * 0.8)
        const mob = growlers[Math.floor(Math.random() * growlers.length)]
        const gain = 1 - mob.group.position.distanceTo(playerPos) / AUDIO.zombie.hearRadius
        if (gain > 0) this.fx.sounds?.play('zombie', { gain })
      }
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i]
      mob.update(delta, playerPos, damagePlayer)
      // Creeper detonation (Phase 13): flagged during update, resolved here.
      if (mob.exploded) {
        this.#detonate(mob, playerPos, damagePlayer)
        this.#remove(i)
        continue
      }
      const dx = mob.group.position.x - playerPos.x
      const dz = mob.group.position.z - playerPos.z
      // Too far behind a travelling player, or fallen out of a mined-open
      // world floor (Phase 8: mobs fall for real) — either way, gone.
      if (
        dx * dx + dz * dz > COMBAT.mobs.despawnRadius ** 2 ||
        mob.group.position.y < PHYSICS.voidY
      ) {
        this.#remove(i)
      }
    }

    // Boss deferred actions (King's Trial stage 4): Summon and Quake mutate
    // mob/world state, so the boss only flags them during its update — they
    // resolve HERE, after the loop, exactly like the creeper's `exploded`
    // flag. Minion refs are pruned against the live list at the same time so
    // the boss's hard cap counts only survivors.
    for (const mob of [...this.mobs]) {
      if (mob.minions) mob.minions = mob.minions.filter((m) => this.mobs.includes(m))
      if (mob.pendingQuake) {
        const q = mob.pendingQuake
        mob.pendingQuake = null
        this.#quake(q, playerPos, damagePlayer, mob)
      }
      if (mob.pendingSummon > 0) {
        const n = mob.pendingSummon
        mob.pendingSummon = 0
        this.#summonMinions(mob, n)
      }
    }
  }

  // The Hollow King's Quake: carve the marked cell (batched remesh, same as
  // a creeper blast — craters accumulate and the arena erodes) and hurt the
  // player if they ignored the ground marker.
  #quake(q, playerPos, damagePlayer, mob) {
    const carved = this.world.explode(q.x, q.y, q.z, q.radius)
    this.onBlocksExploded?.(carved)
    const dist = Math.sqrt(
      (playerPos.x - q.x) ** 2 +
        (playerPos.y - PHYSICS.playerAABB.height / 2 - q.y) ** 2 +
        (playerPos.z - q.z) ** 2,
    )
    if (dist < q.damageRadius) damagePlayer(q.damage, mob)
    this.fx.particles?.burst(q.x, q.y + 0.5, q.z, 0x9a9a9a, 60)
    this.fx.sounds?.play('explosion')
  }

  // The Hollow King's Summon: raise zombie minions on a small ring around
  // the boss, respecting its hard alive-cap (minions were pruned above).
  #summonMinions(boss, count) {
    const s = boss.cfg.attacks.summon
    const room = s.maxMinions - boss.minions.length
    const start = Math.random() * Math.PI * 2
    for (let i = 0; i < Math.min(count, room); i++) {
      const angle = start + (i / Math.max(1, count)) * Math.PI * 2
      const minion = this.spawnAt(
        boss.group.position.x + Math.sin(angle) * s.ringRadius,
        boss.group.position.z + Math.cos(angle) * s.ringRadius,
        'zombie',
      )
      boss.minions.push(minion)
      const p = minion.group.position
      this.fx.particles?.burst(p.x, p.y + 1, p.z, 0x66cc66, 24)
    }
    this.fx.sounds?.play('zombie')
  }

  // A creeper's fuse ran out: carve the blast sphere (batched remesh —
  // World.explode), hurt the player by proximity, and let the fx layer boom.
  #detonate(mob, playerPos, damagePlayer) {
    const e = COMBAT.mobs.creeper.explosion
    const p = mob.group.position
    const bx = p.x
    const by = p.y + 0.8 // blast centered on the body, not the feet
    const bz = p.z
    const carved = this.world.explode(bx, by, bz, e.radius)
    this.onBlocksExploded?.(carved)
    const dist = Math.sqrt(
      (playerPos.x - bx) ** 2 +
        (playerPos.y - PHYSICS.playerAABB.height / 2 - by) ** 2 +
        (playerPos.z - bz) ** 2,
    )
    if (dist < e.damageRadius) {
      const damage = Math.round(e.maxDamage * (1 - dist / e.damageRadius))
      if (damage > 0) damagePlayer(damage, mob)
    }
    this.fx.particles?.burst(bx, by, bz, e.color, e.particles)
    this.fx.sounds?.play('explosion')
  }

  // Try a few ring spots around the player and spawn one hostile in the
  // first dark-enough cell (dark-places spawn). Each attempt walks its
  // column top-to-bottom collecting spawnable cells — solid floor, two air
  // cells — so cave pockets under the ring are candidates alongside the
  // surface; the pick must then be genuinely far from the player in 3D (the
  // old check was horizontal-only — a cave cell 4 blocks under your feet is
  // not "18 blocks away") and at or under spawnLight.maxLight.
  #spawnNear(playerPos) {
    const { spawnRadiusMin, spawnRadiusMax, hostileWeights, spawnLight } = COMBAT.mobs
    // Bare runs (daynight null) contribute no sky term — light is the torch
    // term only, matching the old ungated fallback for tests.
    const skyBrightness = this.daynight ? this.daynight.skyBrightness : 0
    for (let attempt = 0; attempt < spawnLight.attempts; attempt++) {
      const angle = Math.random() * Math.PI * 2
      const dist = spawnRadiusMin + Math.random() * (spawnRadiusMax - spawnRadiusMin)
      const x = Math.floor(playerPos.x + Math.sin(angle) * dist)
      const z = Math.floor(playerPos.z + Math.cos(angle) * dist)
      // Water-covered column (deep water): the SURFACE here is the seabed —
      // a horde rising on the sea floor (zombies pathing underwater,
      // skeletons shooting through water) reads as broken. Skip the whole
      // column; ocean nights are quiet on purpose, and ocean caves are
      // sealed under the seabed anyway (caves.seabedKeep).
      if (this.world.terrainHeight(x, z) <= WATER.level) continue
      const cells = []
      const topY = this.world.topSolidY(x, z)
      let below = this.world.blockAt(x, WORLD.terrain.caves.minY - 1, z)
      let above = null
      // One bottom-up pass over the column: feet cell y is spawnable when
      // the block below is solid and y / y+1 are both air.
      for (let y = WORLD.terrain.caves.minY; y <= topY + 1; y++) {
        const at = above ?? this.world.blockAt(x, y, z)
        above = this.world.blockAt(x, y + 1, z)
        if (isSolid(below) && at === BLOCK_AIR && above === BLOCK_AIR) {
          cells.push(y)
        }
        below = at
      }
      if (cells.length === 0) continue
      const y = cells[Math.floor(Math.random() * cells.length)]
      const d2 =
        (x + 0.5 - playerPos.x) ** 2 + (y - playerPos.y) ** 2 + (z + 0.5 - playerPos.z) ** 2
      if (d2 < spawnRadiusMin ** 2) continue
      if (this.world.lightAt(x, y, z, skyBrightness) > spawnLight.maxLight) continue
      let roll = Math.random() * Object.values(hostileWeights).reduce((a, b) => a + b, 0)
      let kind = 'zombie'
      for (const [name, weight] of Object.entries(hostileWeights)) {
        roll -= weight
        if (roll <= 0) {
          kind = name
          break
        }
      }
      this.spawnAt(x + 0.5, z + 0.5, kind, y)
      return
    }
  }

  // Direct hostile spawn (also the browser-verification hook:
  // __mc.mobs.spawnAt — kind defaults to zombie so old tests still work).
  // `y` places the feet at that height instead of the column surface
  // (dark-places spawn puts mobs in cave pockets); null keeps every
  // pre-existing caller byte-identical.
  spawnAt(x, z, kind = 'zombie', y = null) {
    const mob = HOSTILES[kind](this.world, x, z, this.projectiles)
    if (y !== null) mob.group.position.y = y
    // Fuse-start hiss (creepers): wired here so mob AI stays sound-agnostic.
    if ('onHiss' in mob) mob.onHiss = () => this.fx.sounds?.play('fuse')
    this.mobs.push(mob)
    this.scene.add(mob.group)
    return mob
  }

  // Passive spawn attempt (Phase 12): try a few ring spots and take the first
  // grass column — farm animals belong on grass, not beaches or tree canopies.
  #spawnPassiveNear(playerPos) {
    const { spawnRadiusMin, spawnRadiusMax } = COMBAT.mobs
    const kinds = Object.keys(PASSIVE_MOBS.kinds)
    for (let i = 0; i < PASSIVE_MOBS.spawnAttempts; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = spawnRadiusMin + Math.random() * (spawnRadiusMax - spawnRadiusMin)
      const x = playerPos.x + Math.sin(angle) * dist
      const z = playerPos.z + Math.cos(angle) * dist
      const y = this.world.surfaceY(x, z)
      if (this.world.blockAt(Math.floor(x), y - 1, Math.floor(z)) !== 1) continue // grass only
      const kind = kinds[Math.floor(Math.random() * kinds.length)]
      this.spawnPassiveAt(x, z, kind)
      return
    }
  }

  // Direct passive spawn (also the test hook: __mc.mobs.spawnPassiveAt).
  spawnPassiveAt(x, z, kind = 'pig') {
    const mob = new PassiveMob(this.world, x, z, kind)
    this.mobs.push(mob)
    this.scene.add(mob.group)
    return mob
  }

  // Apply a player hit; on a kill, remove the mob and report it.
  hit(mob, damage, knockDir) {
    if (!mob.hurt(damage, knockDir)) return
    const i = this.mobs.indexOf(mob)
    if (i === -1) return
    this.#remove(i)
    this.onMobKilled?.(mob)
  }

  // Remove a mob without kill credit (no onMobKilled, no drops) — the siege
  // disperses its leftover wave when it fails. Safe from the main loop; never
  // call it from inside an update() callback (the Phase 4 rule).
  despawn(mob) {
    const i = this.mobs.indexOf(mob)
    if (i !== -1) this.#remove(i)
  }

  clear() {
    while (this.mobs.length) this.#remove(this.mobs.length - 1)
  }

  #remove(i) {
    const mob = this.mobs[i]
    this.scene.remove(mob.group)
    mob.dispose()
    this.mobs.splice(i, 1)
  }
}
