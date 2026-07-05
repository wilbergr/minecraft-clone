// Ocean generator probe (deep water) — the Phase 11 cave-tuning precedent:
// import the live World with a scene stub and measure the generator directly,
// no browser needed. Run after touching WORLD.terrain.ocean (or anything that
// feeds terrainHeight):
//
//   node tools/probe-ocean.mjs
//
// Asserts (exit 1 on failure):
//   1. Ocean coverage lands in a sane band (deep water exists, but the world
//      is still mostly land).
//   2. Enough dive-worthy columns exist for the Tide Shard's primary
//      placement pass (>= minDiveDepth blocks of water) within the sweep's
//      600-block ring cap.
//   3. The spawn column is dry and at its pre-ocean height.
//   4. Purity regression: every sampled column OUTSIDE the ocean mask is
//      byte-identical to the pre-ocean height formula — the shaping never
//      leaks into unmasked terrain.

import { WATER, WORLD, PLAYER, CHALLENGE } from '../src/config.js'
import { World } from '../src/world/World.js'

const world = new World({ add() {} }) // scene stub — lights land nowhere

const { ocean, baseHeight, amplitude, frequency, biomes } = WORLD.terrain

// The pre-ocean height formula, replicated from World.terrainHeight with the
// ocean shaping omitted — the purity baseline for unmasked columns.
function pristineHeight(wx, wz) {
  const n = world.fbm(wx * frequency, wz * frequency)
  const b = world.biomeNoise(wx * biomes.frequency, wz * biomes.frequency)
  const scale =
    biomes.amplitude.min + ((biomes.amplitude.max - biomes.amplitude.min) * (b + 1)) / 2
  const h = Math.round(baseHeight + n * amplitude * scale)
  return Math.max(2, Math.min(h, WORLD.chunkHeight - 8))
}

const RANGE = 600
const STEP = 4
const minDiveDepth = CHALLENGE.relics.minDiveDepth

let total = 0
let wet = 0
let unmaskedMismatches = 0
const depthHist = new Map() // water depth -> column count
let deepest = { depth: 0, x: 0, z: 0 }
let nearestDive = null // nearest column with depth >= minDiveDepth

for (let x = -RANGE; x <= RANGE; x += STEP) {
  for (let z = -RANGE; z <= RANGE; z += STEP) {
    total++
    const h = world.terrainHeight(x, z)
    const o = world.oceanNoise(x * ocean.frequency, z * ocean.frequency)
    if (o <= ocean.maskStart && h !== pristineHeight(x, z)) unmaskedMismatches++
    if (h > WATER.level) continue
    wet++
    const depth = WATER.level - h + 1
    depthHist.set(depth, (depthHist.get(depth) ?? 0) + 1)
    if (depth > deepest.depth) deepest = { depth, x, z }
    if (depth >= minDiveDepth) {
      const dist = Math.hypot(x - PLAYER.spawnPoint.x, z - PLAYER.spawnPoint.z)
      if (!nearestDive || dist < nearestDive.dist) nearestDive = { x, z, depth, dist }
    }
  }
}

const coverage = (wet / total) * 100
const atLeast = (d) =>
  [...depthHist].reduce((sum, [depth, n]) => (depth >= d ? sum + n : sum), 0)
const spawnH = world.terrainHeight(
  Math.round(PLAYER.spawnPoint.x),
  Math.round(PLAYER.spawnPoint.z),
)
const spawnPristine = pristineHeight(
  Math.round(PLAYER.spawnPoint.x),
  Math.round(PLAYER.spawnPoint.z),
)

console.log(`seed ${WORLD.seed} — ${total} columns sampled (±${RANGE}, step ${STEP})`)
console.log(`water-covered: ${wet} (${coverage.toFixed(2)}%)`)
console.log(
  'depth histogram:',
  Object.fromEntries([...depthHist].sort((a, b) => a[0] - b[0])),
)
console.log(`deepest: ${deepest.depth} blocks at (${deepest.x}, ${deepest.z})`)
console.log(`columns >= 8 deep: ${atLeast(8)}, >= ${minDiveDepth} deep: ${atLeast(minDiveDepth)}`)
console.log(
  nearestDive
    ? `nearest dive-worthy (>= ${minDiveDepth}) column: (${nearestDive.x}, ${nearestDive.z}), ${Math.round(nearestDive.dist)} blocks from spawn`
    : 'no dive-worthy column found!',
)
console.log(`spawn column height: ${spawnH} (pristine ${spawnPristine}, water level ${WATER.level})`)

const failures = []
if (coverage < 8 || coverage > 22) {
  failures.push(`ocean coverage ${coverage.toFixed(2)}% outside the sane 8–22% band`)
}
if (atLeast(minDiveDepth) < 100) {
  failures.push(`only ${atLeast(minDiveDepth)} columns >= ${minDiveDepth} deep — Tide Shard placement is starved`)
}
if (!nearestDive || nearestDive.dist > 600) {
  failures.push('no dive-worthy column within the 600-block shard sweep cap')
}
if (spawnH <= WATER.level) failures.push(`spawn column is underwater (h=${spawnH})`)
if (spawnH !== spawnPristine) {
  failures.push(`spawn column reshaped by the ocean mask (${spawnH} != ${spawnPristine})`)
}
if (unmaskedMismatches > 0) {
  failures.push(`${unmaskedMismatches} unmasked columns differ from the pre-ocean generator (purity regression)`)
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`)
  process.exit(1)
}
console.log('OK: all ocean generator assertions hold')
