// Diamond ore band probe — the cave/ocean-tuning precedent: import the live
// World with a scene stub and measure the generator directly, no browser
// needed. Run after touching the WORLD.terrain.ores diamond band:
//
//   node tools/probe-diamond.mjs
//
// Asserts (exit 1 on failure):
//   1. Diamonds generate at all in the sampled volume.
//   2. Every diamond sits inside its configured [minY, maxY] band.
//   3. Diamond is rarer than gold (it is the deeper, scarcer prize).

import { WORLD } from '../src/config.js'
import { World } from '../src/world/World.js'

const world = new World({ add() {} }) // scene stub — lights land nowhere

const counts = { stone: 0, diamond: 0, gold: 0, iron: 0, coal: 0 }
const diamondYs = []
let cells = 0

for (let wx = -200; wx <= 200; wx += 4) {
  for (let wz = -200; wz <= 200; wz += 4) {
    const h = world.terrainHeight(wx, wz)
    const biome = world.biomeAt(wx, wz)
    for (let wy = 1; wy <= Math.min(h - 1, 74); wy++) {
      const id = world.terrainBlock(wx, wy, wz, h, biome)
      cells++
      if (id === 3) counts.stone++
      else if (id === 18) {
        counts.diamond++
        diamondYs.push(wy)
      } else if (id === 12) counts.gold++
      else if (id === 8) counts.iron++
      else if (id === 11) counts.coal++
    }
  }
}

console.log('cells sampled:', cells)
console.log(counts)
if (diamondYs.length) {
  console.log('diamond y range:', Math.min(...diamondYs), '-', Math.max(...diamondYs))
}
const band = WORLD.terrain.ores.find((o) => o.blockId === 18)
console.log('configured band:', band)

let fail = false
if (counts.diamond === 0) {
  console.error('FAIL: no diamonds generated')
  fail = true
}
if (diamondYs.some((y) => y < band.minY || y > band.maxY)) {
  console.error('FAIL: diamond outside its band')
  fail = true
}
if (counts.diamond >= counts.gold) {
  console.error('FAIL: diamond not rarer than gold')
  fail = true
}
console.log(fail ? 'PROBE FAILED' : 'probe OK')
process.exit(fail ? 1 : 0)
