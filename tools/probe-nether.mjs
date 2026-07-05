// Nether generator probe (the ocean/lava-probe precedent): import the live
// NetherWorld with a scene stub and measure the generator directly, no
// browser needed. Run after touching NETHER.terrain or the wall/floor noise:
//
//   node tools/probe-nether.mjs
//
// Asserts (exit 1 on failure):
//   1. Open fraction of the interior slab in [30%, 45%] — cavernous but
//      structured (the design band, report §6.2).
//   2. Columns with a walkable dry floor >= 75% — traversal is the norm.
//   3. Columns with an exposed lava-sea surface in [5%, 15%] — a real,
//      visible hazard that doesn't dominate.
//   4. Quartz lands in [0.8%, 2.5%] of solid cells and only inside its band.
//   5. Bedrock seals the world: y < bedrock.floor and y >= bedrock.roof are
//      bedrock everywhere sampled; nothing else is bedrock.
//   6. A walkable arrival pocket exists within 32 blocks of nether (0, 0) —
//      spawn-area portals arrive safely on this seed.
//   7. Glowstone clusters, soul sand, and obsidian shells all generate, and
//      every sampled obsidian cell really touches generated lava.
//   8. Overworld regression: the overworld height field is byte-identical
//      to the pre-Nether generator (checksum + spawn column).

import { NETHER, WORLD } from '../src/config.js'
import { World } from '../src/world/World.js'
import { NetherWorld } from '../src/world/NetherWorld.js'
import {
  BLOCK_AIR,
  BLOCK_BEDROCK,
  BLOCK_GLOWSTONE,
  BLOCK_LAVA,
  BLOCK_OBSIDIAN,
  BLOCK_QUARTZ_ORE,
  BLOCK_SOUL_SAND,
  isSolid,
} from '../src/world/blocks.js'

const stub = { add() {} }
const nether = new NetherWorld(stub)
const t = NETHER.terrain

const RANGE = 320
const STEP = 4
const Y0 = t.shoulders.floor + 1 // the interior slab the metrics describe
const Y1 = t.shoulders.roof - 1

let columns = 0
let slabCells = 0
let openCells = 0
let lavaCells = 0
let solidCells = 0
let quartzCells = 0
let glowstoneCells = 0
let soulSandCells = 0
let obsidianCells = 0
let obsidianNotTouching = 0
let quartzOutOfBand = 0
let walkableColumns = 0
let lavaSurfaceColumns = 0
let fullySolidColumns = 0
let bedrockViolations = 0
const openByBand = new Map() // y >> 4 -> open count

for (let wx = -RANGE; wx <= RANGE; wx += STEP) {
  for (let wz = -RANGE; wz <= RANGE; wz += STEP) {
    columns++
    let columnOpen = 0
    let walkable = false
    let lavaSurface = false
    // Bedrock caps (assert 5): sample one cell in each shell.
    if (nether.terrainBlock(wx, 1, wz) !== BLOCK_BEDROCK) bedrockViolations++
    if (nether.terrainBlock(wx, WORLD.chunkHeight - 1, wz) !== BLOCK_BEDROCK) bedrockViolations++
    let below = nether.terrainBlock(wx, Y0 - 1, wz)
    let at = nether.terrainBlock(wx, Y0, wz)
    for (let wy = Y0; wy <= Y1; wy++) {
      const above = nether.terrainBlock(wx, wy + 1, wz)
      slabCells++
      if (at === BLOCK_BEDROCK) bedrockViolations++
      if (at === BLOCK_AIR || at === BLOCK_LAVA) {
        openCells++
        columnOpen++
        if (at === BLOCK_LAVA) {
          lavaCells++
          if (above === BLOCK_AIR) lavaSurface = true
        }
        const band = wy >> 4
        openByBand.set(band, (openByBand.get(band) ?? 0) + 1)
        // Walkable: standing here with solid footing and headroom, dry.
        if (at === BLOCK_AIR && above === BLOCK_AIR && isSolid(below)) walkable = true
      } else {
        solidCells++
        if (at === BLOCK_QUARTZ_ORE) {
          quartzCells++
          if (wy < t.quartz.minY || wy > t.quartz.maxY) quartzOutOfBand++
        }
        if (at === BLOCK_GLOWSTONE) glowstoneCells++
        if (at === BLOCK_SOUL_SAND) soulSandCells++
        if (at === BLOCK_OBSIDIAN) {
          obsidianCells++
          const touching =
            nether.lavaAt(wx, wy + 1, wz) ||
            nether.lavaAt(wx, wy - 1, wz) ||
            nether.lavaAt(wx + 1, wy, wz) ||
            nether.lavaAt(wx - 1, wy, wz) ||
            nether.lavaAt(wx, wy, wz + 1) ||
            nether.lavaAt(wx, wy, wz - 1)
          if (!touching) obsidianNotTouching++
        }
      }
      below = at
      at = above
    }
    if (walkable) walkableColumns++
    if (lavaSurface) lavaSurfaceColumns++
    if (columnOpen === 0) fullySolidColumns++
  }
}

// Arrival pocket near (0, 0) (assert 6): the portal-arrival column walk —
// solid floor + two air cells above the lava level, searched outward.
let pocket = null
outer: for (let r = 0; r <= 32 && !pocket; r++) {
  for (let dx = -r; dx <= r && !pocket; dx++) {
    for (const dz of dx === -r || dx === r ? Array.from({ length: 2 * r + 1 }, (_, i) => i - r) : [-r, r]) {
      const x = dx
      const z = dz
      for (let y = t.lava.level + 1; y < t.shoulders.roof; y++) {
        if (
          isSolid(nether.blockAt(x, y - 1, z)) &&
          nether.blockAt(x, y, z) === BLOCK_AIR &&
          nether.blockAt(x, y + 1, z) === BLOCK_AIR
        ) {
          pocket = { x, y, z, dist: Math.max(Math.abs(x), Math.abs(z)) }
          break outer
        }
      }
    }
  }
}

// Overworld regression (assert 8): heights byte-identical to the pre-Nether
// generator. The checksum was recorded against main at the branch point.
const overworld = new World(stub)
let checksum = 0
for (let x = -RANGE; x <= RANGE; x += 16) {
  for (let z = -RANGE; z <= RANGE; z += 16) {
    checksum = (checksum * 31 + overworld.terrainHeight(x, z)) >>> 0
  }
}
const EXPECTED_CHECKSUM = 2198261973
const spawnH = overworld.terrainHeight(0, 8)

const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0)
const openShare = pct(openCells, slabCells)
const walkShare = pct(walkableColumns, columns)
const lavaColShare = pct(lavaSurfaceColumns, columns)
const solidColShare = pct(fullySolidColumns, columns)
const quartzShare = pct(quartzCells, solidCells)

console.log(`seed ${WORLD.seed} — ±${RANGE} blocks, step ${STEP}, ${columns} columns`)
console.log(`open fraction of interior slab: ${openShare.toFixed(1)}%`)
console.log(`columns with walkable dry floor: ${walkShare.toFixed(1)}%`)
console.log(`columns with exposed lava-sea surface: ${lavaColShare.toFixed(1)}%`)
console.log(`fully solid columns: ${solidColShare.toFixed(1)}%`)
console.log(`quartz: ${quartzCells} cells (${quartzShare.toFixed(2)}% of solid), out-of-band ${quartzOutOfBand}`)
console.log(`glowstone cells: ${glowstoneCells}, soul sand: ${soulSandCells}`)
console.log(`obsidian cells: ${obsidianCells} (${obsidianNotTouching} not touching lava)`)
const peak = [...openByBand.entries()].sort((a, b) => b[1] - a[1])[0]
console.log(`open cells peak in y band ${peak[0] * 16}-${peak[0] * 16 + 15}`)
console.log(pocket ? `arrival pocket: (${pocket.x}, ${pocket.y}, ${pocket.z}), ${pocket.dist} from origin` : 'NO arrival pocket within 32')
console.log(`overworld checksum ${checksum} (expected ${EXPECTED_CHECKSUM}), spawn h ${spawnH}`)

const failures = []
if (openShare < 30 || openShare > 45) failures.push(`open fraction ${openShare.toFixed(1)}% outside [30, 45]`)
if (walkShare < 75) failures.push(`walkable columns ${walkShare.toFixed(1)}% < 75%`)
if (lavaColShare < 5 || lavaColShare > 15) failures.push(`lava-surface columns ${lavaColShare.toFixed(1)}% outside [5, 15]`)
if (quartzShare < 0.8 || quartzShare > 2.5) failures.push(`quartz ${quartzShare.toFixed(2)}% of solid outside [0.8, 2.5]`)
if (quartzOutOfBand > 0) failures.push(`${quartzOutOfBand} quartz cells outside [${t.quartz.minY}, ${t.quartz.maxY}]`)
if (bedrockViolations > 0) failures.push(`${bedrockViolations} bedrock violations (missing cap or interior bedrock)`)
if (!pocket) failures.push('no walkable arrival pocket within 32 of (0, 0)')
if (glowstoneCells === 0) failures.push('no glowstone generated')
if (soulSandCells === 0) failures.push('no soul sand generated')
if (obsidianCells === 0) failures.push('no obsidian shell generated')
if (obsidianNotTouching > 0) failures.push(`${obsidianNotTouching} obsidian cells do not touch lava`)
if (checksum !== EXPECTED_CHECKSUM || spawnH !== 63) {
  failures.push(`overworld heights changed (checksum ${checksum}, spawn h ${spawnH}) — the Nether must not touch them`)
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`)
  console.log('PROBE FAILED')
  process.exit(1)
}
console.log('OK: all Nether generator assertions hold')
