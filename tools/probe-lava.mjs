// Lava generator probe (lava feature) — the ocean/diamond-probe precedent:
// import the live World with a scene stub and measure the generator
// directly, no browser needed. Run after touching WORLD.terrain.lava,
// WORLD.terrain.caves, or anything that feeds terrainHeight:
//
//   node tools/probe-lava.mjs
//
// Asserts (exit 1 on failure):
//   1. Lava generates, and EVERY lava cell sits in [caves.minY, lava.level]
//      (band containment, the diamond-probe assert).
//   2. Lava's share of carved cave volume lands in a sane band (~15–25% at
//      level 10) — the coverage assert, the ocean-probe pattern.
//   3. NO lava-water adjacency anywhere sampled: generated water exists only
//      at y <= WATER.level in open columns and seabedKeep seals sea columns,
//      so contact is unreachable — this assert fires if anyone ever weakens
//      seabedKeep (the game has no water/lava reaction; a future bucket
//      feature owes that question an answer).
//   4. The Deep Shard's position is not inside lava (computed with the real
//      RelicHunt placement stream — the scan-floor clamp under test).
//   5. Exposed-surface supply: enough open pool tops exist near mining
//      depths for LavaLights / lightAt spawn suppression / ambience to have
//      anything to work with.
//   6. Obsidian crusts generate, and every sampled obsidian cell really
//      touches generated lava.

import { CHALLENGE, WATER, WORLD } from '../src/config.js'
import { World } from '../src/world/World.js'
import { RelicHunt } from '../src/quest/RelicHunt.js'
import { BLOCK_AIR, BLOCK_LAVA, BLOCK_OBSIDIAN } from '../src/world/blocks.js'

const world = new World({ add() {} }) // scene stub — lights land nowhere

const { lava, caves } = WORLD.terrain
const RANGE = 300
const STEP = 3
const CAVE_CEIL = 42 // count cave volume below this (the mining depths)

let carved = 0 // carved cave cells sampled below CAVE_CEIL
let lavaCells = 0
let exposed = 0 // lava cells with generated air directly above
let obsidianCells = 0
let obsidianNotTouching = 0
let diamondCells = 0
let diamondLavaAdjacent = 0
const lavaYs = []
let waterAdjacent = 0
const columnsWithLava = new Set()

// Is the generated cell water? Water fills y in [h, WATER.level] (both
// Chunk.generate and the blockAt fallback) — exact, without full blockAt.
const isWater = (wy, h) => wy >= h && wy <= WATER.level

for (let wx = -RANGE; wx <= RANGE; wx += STEP) {
  for (let wz = -RANGE; wz <= RANGE; wz += STEP) {
    const h = world.terrainHeight(wx, wz)
    const biome = world.biomeAt(wx, wz)
    for (let wy = 1; wy <= Math.min(h - 1, CAVE_CEIL); wy++) {
      const id = world.terrainBlock(wx, wy, wz, h, biome)
      if (id === BLOCK_AIR || id === BLOCK_LAVA) carved++
      if (id === BLOCK_LAVA) {
        lavaCells++
        lavaYs.push(wy)
        columnsWithLava.add(`${wx},${wz}`)
        // Exposure: generated air directly above (not lava, not solid, and
        // not the sea's water fill).
        const above = world.terrainBlock(wx, wy + 1, wz, h, biome)
        if (above === BLOCK_AIR && !isWater(wy + 1, h)) exposed++
        // Water adjacency (assert 3): vertical neighbors share the column
        // height; horizontal ones get their own.
        if (isWater(wy + 1, h) || isWater(wy - 1, h)) waterAdjacent++
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (isWater(wy, world.terrainHeight(wx + dx, wz + dz))) waterAdjacent++
        }
      } else if (id === BLOCK_OBSIDIAN) {
        obsidianCells++
        const touching =
          world.lavaAt(wx, wy + 1, wz, h) ||
          world.lavaAt(wx, wy - 1, wz, h) ||
          world.lavaAt(wx + 1, wy, wz) ||
          world.lavaAt(wx - 1, wy, wz) ||
          world.lavaAt(wx, wy, wz + 1) ||
          world.lavaAt(wx, wy, wz - 1)
        if (!touching) obsidianNotTouching++
      } else if (id === 18) {
        diamondCells++
        if (
          world.lavaAt(wx, wy + 1, wz, h) ||
          world.lavaAt(wx, wy - 1, wz, h) ||
          world.lavaAt(wx + 1, wy, wz) ||
          world.lavaAt(wx - 1, wy, wz) ||
          world.lavaAt(wx, wy, wz + 1) ||
          world.lavaAt(wx, wy, wz - 1)
        ) {
          diamondLavaAdjacent++
        }
      }
    }
  }
}

// The Deep Shard, placed by the real RelicHunt stream (scene stub — token
// meshes build lazily, so no THREE scene is needed).
const hunt = new RelicHunt(world, { add() {}, remove() {} })
const deep = hunt.relics.find((r) => r.kind === 'cave')
const shardCell = world.blockAt(
  Math.floor(deep.position.x),
  Math.floor(deep.position.y),
  Math.floor(deep.position.z),
)

const share = carved > 0 ? (lavaCells / carved) * 100 : 0
console.log(`seed ${WORLD.seed} — ±${RANGE} blocks, step ${STEP}, lava.level ${lava.level}`)
console.log(`carved cave cells (y <= ${CAVE_CEIL}): ${carved}`)
console.log(`lava cells: ${lavaCells} (${share.toFixed(1)}% of cave volume)`)
if (lavaYs.length) {
  console.log(`lava y range: ${Math.min(...lavaYs)} - ${Math.max(...lavaYs)}`)
}
console.log(`columns with lava: ${columnsWithLava.size}`)
console.log(`exposed surface cells: ${exposed}`)
console.log(`obsidian cells: ${obsidianCells} (${obsidianNotTouching} not touching lava)`)
console.log(
  `diamond cells: ${diamondCells}, lava-adjacent: ${diamondLavaAdjacent}` +
    (diamondCells ? ` (${((diamondLavaAdjacent / diamondCells) * 100).toFixed(1)}%)` : ''),
)
console.log(`lava-water adjacencies: ${waterAdjacent}`)
console.log(
  `Deep Shard: (${deep.position.x}, ${deep.position.y}, ${deep.position.z}), cell block id ${shardCell}`,
)

const failures = []
if (lavaCells === 0) failures.push('no lava generated')
if (lavaYs.some((y) => y < caves.minY || y > lava.level)) {
  failures.push(`lava outside its band [${caves.minY}, ${lava.level}]`)
}
if (share < 12 || share > 28) {
  failures.push(`lava share ${share.toFixed(1)}% of cave volume outside the sane 12-28% band`)
}
if (waterAdjacent > 0) {
  failures.push(`${waterAdjacent} lava-water adjacencies — the no-contact invariant broke`)
}
if (shardCell === BLOCK_LAVA || deep.position.y <= lava.level + 1) {
  failures.push(
    `Deep Shard at y=${deep.position.y} sits in/at the lava fill (cell id ${shardCell})`,
  )
}
if (exposed < 500) {
  failures.push(`only ${exposed} exposed surface cells — glow/ambience systems are starved`)
}
if (obsidianCells === 0) failures.push('no obsidian crust generated')
if (obsidianNotTouching > 0) {
  failures.push(`${obsidianNotTouching} obsidian cells do not touch lava`)
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`)
  console.log('PROBE FAILED')
  process.exit(1)
}
console.log('OK: all lava generator assertions hold')
