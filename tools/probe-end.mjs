// End generator probe (the ocean/lava/nether-probe precedent): import the
// live EndWorld with a scene stub and measure the island directly, no
// browser needed. Run after touching END.island / END.pillars:
//
//   node tools/probe-end.mjs
//
// Asserts (exit 1 on failure):
//   1. Island columns within [5000, 7500] of the ±70 sample (~88 across) —
//      fits the loaded radius, big enough to fight on.
//   2. Surface y stays within [58, 66] — a fair, near-flat arena.
//   3. Underside minimum y >= 24 — the island visibly floats with real void
//      (~40 blocks) above PHYSICS.voidY.
//   4. Interior columns (all 4 neighbors solid) >= 90% — the rim is ragged,
//      the walkable surface isn't hole-punched.
//   5. All six pillars stand on the island with flat obsidian tops (the
//      crystal pedestals) and clear air above.
//   6. The arrival column (END.arrival) is end stone, pillar-free, and
//      within 2 blocks of the design surface (y 62).
//   7. Overworld regression: the height field is byte-identical to the
//      pre-End generator (the probe-nether checksum + spawn column).
//   8. Nether regression: a block-sample checksum of the Nether generator is
//      unchanged — a third dimension must never move a block in the first two.

import { END, WORLD } from '../src/config.js'
import { World } from '../src/world/World.js'
import { NetherWorld } from '../src/world/NetherWorld.js'
import { EndWorld } from '../src/world/EndWorld.js'
import { BLOCK_AIR, BLOCK_END_STONE, BLOCK_OBSIDIAN } from '../src/world/blocks.js'

const stub = { add() {} }
const end = new EndWorld(stub)

const RANGE = 70
const Y_TOP = 90 // nothing generates above pillar tops (~84)

// Column scan: top/bottom of the solid band (island or pillar), or null.
function columnBand(wx, wz) {
  let top = null
  let bottom = null
  for (let y = Y_TOP; y >= 0; y--) {
    const id = end.terrainBlock(wx, y, wz)
    if (id !== BLOCK_AIR) {
      if (top === null) top = y
      bottom = y
    }
  }
  return top === null ? null : { top, bottom }
}

let islandColumns = 0
let surfaceMin = Infinity
let surfaceMax = -Infinity
let bottomMin = Infinity
let thinnest = Infinity
const solid = new Set() // "x,z" of island columns, for the interior test

for (let wx = -RANGE; wx <= RANGE; wx++) {
  for (let wz = -RANGE; wz <= RANGE; wz++) {
    const band = columnBand(wx, wz)
    if (!band) continue
    islandColumns++
    solid.add(`${wx},${wz}`)
    surfaceMin = Math.min(surfaceMin, band.top)
    surfaceMax = Math.max(surfaceMax, band.top)
    bottomMin = Math.min(bottomMin, band.bottom)
    thinnest = Math.min(thinnest, band.top - band.bottom + 1)
  }
}

// Interior fraction: island columns whose 4 neighbors are island too. Pillar
// columns count as island (they rise from it — probe assert 5 covers them).
let interior = 0
for (const key of solid) {
  const [x, z] = key.split(',').map(Number)
  if (Math.max(Math.abs(x), Math.abs(z)) >= RANGE) continue // sample edge, not island edge
  if (
    solid.has(`${x + 1},${z}`) &&
    solid.has(`${x - 1},${z}`) &&
    solid.has(`${x},${z + 1}`) &&
    solid.has(`${x},${z - 1}`)
  ) {
    interior++
  }
}
const interiorShare = (interior / islandColumns) * 100

// Pillars (assert 5): on-island, flat obsidian top, air above. Surface-y
// range excludes pillar columns by construction only if pillars sit inside
// the [58, 66] check — they don't, so re-derive the ISLAND surface range by
// skipping pillar-covered columns above.
let pillarFailures = 0
for (const p of end.pillars) {
  const onIsland = end.terrainBlock(p.x, END.island.surfaceY - 1, p.z) !== BLOCK_AIR
  const cap = end.terrainBlock(p.x, p.top, p.z) === BLOCK_OBSIDIAN
  const clear = end.terrainBlock(p.x, p.top + 1, p.z) === BLOCK_AIR
  if (!onIsland || !cap || !clear) {
    pillarFailures++
    console.error(`pillar (${p.x}, ${p.z}) top ${p.top}: onIsland=${onIsland} cap=${cap} clear=${clear}`)
  }
}

// Island-only surface range: the [58, 66] arena check must not trip on the
// pillars (tops ~75-84), so recompute skipping obsidian tops.
let islandSurfaceMin = Infinity
let islandSurfaceMax = -Infinity
for (let wx = -RANGE; wx <= RANGE; wx += 1) {
  for (let wz = -RANGE; wz <= RANGE; wz += 1) {
    const key = `${wx},${wz}`
    if (!solid.has(key)) continue
    const band = columnBand(wx, wz)
    if (end.terrainBlock(wx, band.top, wz) !== BLOCK_END_STONE) continue // pillar column
    islandSurfaceMin = Math.min(islandSurfaceMin, band.top)
    islandSurfaceMax = Math.max(islandSurfaceMax, band.top)
  }
}

// Arrival column (assert 6).
const a = END.arrival
const arrivalBand = columnBand(a.x, a.z)
const arrivalStone = arrivalBand && end.terrainBlock(a.x, arrivalBand.top, a.z) === BLOCK_END_STONE
const arrivalOk =
  arrivalStone && Math.abs(arrivalBand.top - (END.island.surfaceY - 1)) <= 2

// Overworld regression (assert 7): the probe-nether checksum verbatim.
const overworld = new World(stub)
let owChecksum = 0
for (let x = -320; x <= 320; x += 16) {
  for (let z = -320; z <= 320; z += 16) {
    owChecksum = (owChecksum * 31 + overworld.terrainHeight(x, z)) >>> 0
  }
}
const OW_EXPECTED = 2198261973
const spawnH = overworld.terrainHeight(0, 8)

// Nether regression (assert 8): a block-sample checksum over a fixed grid.
const nether = new NetherWorld(stub)
let nChecksum = 0
for (let x = -160; x <= 160; x += 8) {
  for (let z = -160; z <= 160; z += 8) {
    for (const y of [5, 20, 30, 40, 50, 60, 70, 80, 90]) {
      nChecksum = (nChecksum * 31 + nether.terrainBlock(x, y, z)) >>> 0
    }
  }
}
const NETHER_EXPECTED = 1220976004

console.log(`seed ${WORLD.seed} — ±${RANGE} blocks at step 1, ${(2 * RANGE + 1) ** 2} columns`)
console.log(`island columns: ${islandColumns} (~${Math.round(Math.sqrt(islandColumns) * 1.128)} across)`)
console.log(`island surface y: ${islandSurfaceMin}–${islandSurfaceMax} (with pillars: ${surfaceMin}–${surfaceMax})`)
console.log(`underside min y: ${bottomMin}, thinnest column: ${thinnest}`)
console.log(`interior columns: ${interiorShare.toFixed(1)}%`)
console.log(`pillars: ${end.pillars.map((p) => `(${p.x},${p.z})@${p.top}`).join(' ')}`)
console.log(arrivalBand ? `arrival (${a.x}, ${a.z}): surface y ${arrivalBand.top}, end stone ${arrivalStone}` : 'arrival column is VOID')
console.log(`overworld checksum ${owChecksum} (expected ${OW_EXPECTED}), spawn h ${spawnH}`)
console.log(`nether checksum ${nChecksum} (expected ${NETHER_EXPECTED})`)

const failures = []
if (islandColumns < 5000 || islandColumns > 7500) {
  failures.push(`island columns ${islandColumns} outside [5000, 7500]`)
}
if (islandSurfaceMin < 58 || islandSurfaceMax > 66) {
  failures.push(`island surface ${islandSurfaceMin}–${islandSurfaceMax} outside [58, 66]`)
}
if (bottomMin < 24) failures.push(`underside min ${bottomMin} < 24`)
if (interiorShare < 90) failures.push(`interior columns ${interiorShare.toFixed(1)}% < 90%`)
if (pillarFailures > 0) failures.push(`${pillarFailures} pillar(s) failed the pedestal checks`)
if (!arrivalOk) failures.push(`arrival column (${a.x}, ${a.z}) is not clean end stone near y ${END.island.surfaceY}`)
if (owChecksum !== OW_EXPECTED || spawnH !== 63) {
  failures.push(`overworld heights changed (checksum ${owChecksum}, spawn h ${spawnH}) — the End must not touch them`)
}
if (nChecksum !== NETHER_EXPECTED) {
  failures.push(`nether blocks changed (checksum ${nChecksum}) — the End must not touch them`)
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`)
  console.log('PROBE FAILED')
  process.exit(1)
}
console.log('OK: all End generator assertions hold')
