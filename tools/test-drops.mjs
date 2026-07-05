// Headless regression test for ground-item drops (GroundItems.js).
//
// Covers the roofed-mining bug: mining a block with solid blocks directly
// above it must still drop an item that FALLS and lands in the mined cell —
// the pop arc used to carry the drop's center up into the solid roof cell,
// where #floorBelow (scanning down from the drop's own cell) answered the
// roof block's top and wedged the drop inside the roof forever.
//
// Also re-checks: plain open-air drop landing, magnet pickup, and despawn.
//
// Run:
//   npm run build
//   npm install --no-save puppeteer-core   (not a project dep)
//   node tools/test-drops.mjs
// Exits 0 on pass, 1 on failure. Uses the cached Chrome under
// ~/.cache/puppeteer with --enable-unsafe-swiftshader (software WebGL —
// game time runs ~0.3x real time, so everything waits on waitForFunction).

import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const PORT = 4731 // unique strict port for this suite

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome')
  const dir = readdirSync(root).find((d) => d.startsWith('linux-'))
  if (!dir) throw new Error('no cached Chrome under ~/.cache/puppeteer')
  return join(root, dir, 'chrome-linux64', 'chrome')
}

let failures = 0
function assert(cond, label) {
  if (cond) console.log(`  PASS ${label}`)
  else {
    console.error(`  FAIL ${label}`)
    failures++
  }
}

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
})
const browser = await (async () => {
  // Wait for the preview server to accept connections.
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://localhost:${PORT}/`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  return puppeteer.launch({
    executablePath: findChrome(),
    args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
  })
})()

try {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__mc?.world && window.__mc?.drops, {
    timeout: 60000,
  })
  await page.evaluate(() => {
    window.__mc.save.enabled = false // keep runs hermetic
  })
  // Wait until the spawn chunk is generated so setBlock/terrain queries hold.
  await page.waitForFunction(
    () => {
      const { world, camera } = window.__mc
      return world.chunkReadyAt(camera.position.x, camera.position.z)
    },
    { timeout: 60000 },
  )

  // Find two flat 5x5 clearings near spawn (uniform topSolidY, 5 cells of
  // air above — the forced max-roll pop below drifts the drop up to ~1.5
  // blocks sideways, so the neighborhood must behave like the target column).
  const spots = await page.evaluate(() => {
    const { world, camera } = window.__mc
    const cx = Math.floor(camera.position.x)
    const cz = Math.floor(camera.position.z)
    const flat = []
    for (let dx = -20; dx <= 20; dx++) {
      for (let dz = -20; dz <= 20; dz++) {
        const d = Math.hypot(dx, dz)
        if (d < 5 || d > 20) continue
        const px = cx + dx
        const pz = cz + dz
        const top = world.topSolidY(px, pz)
        if (top <= 57) continue // never a water column (WATER.level)
        // Neighbors may sit lower (drop just lands lower) but never higher —
        // "air at top+1..top+5 across the 5x5" rules out higher terrain,
        // trees, and anything else in the pop's flight envelope.
        let ok = true
        for (let ox = -2; ox <= 2 && ok; ox++) {
          for (let oz = -2; oz <= 2 && ok; oz++) {
            if (world.topSolidY(px + ox, pz + oz) > top) ok = false
            for (let oy = 1; oy <= 5 && ok; oy++) {
              if (world.blockAt(px + ox, top + oy, pz + oz) !== 0) ok = false
            }
          }
        }
        if (ok) flat.push({ px, pz, top, d })
      }
    }
    flat.sort((a, b) => a.d - b.d)
    const a = flat[0]
    const b = flat.find(
      (s) => Math.hypot(s.px - a.px, s.pz - a.pz) >= 8,
    )
    return { a, b }
  })
  if (!spots.a || !spots.b) throw new Error('no flat clearings found near spawn')
  console.log('clearings:', JSON.stringify(spots))

  // Mine the dirt block at (px, top+1, pz) via the test seam; returns the
  // index of the freshly spawned drop entity. Math.random is pinned to the
  // MAX pop roll for the spawn: the roofed bug only reproduces when the pop
  // carries the drop's center into the cell above (vy0 ≈ 4.5 — under the
  // headless 0.1s delta clamp low rolls never cross the cell boundary).
  const mine = ({ px, pz, top }) =>
    page.evaluate(
      ({ px, pz, top }) => {
        const { world, interaction, drops } = window.__mc
        const yT = top + 1
        const idx = drops.count
        const realRandom = Math.random
        Math.random = () => 0.999
        try {
          for (let i = 0; i < 60; i++) {
            interaction.target = { x: px, y: yT, z: pz, normal: [0, 1, 0] }
            if (interaction.breakTargeted()) break
          }
        } finally {
          Math.random = realRandom
        }
        return { idx, broke: world.blockAt(px, yT, pz) === 0, count: drops.count }
      },
      { px, pz, top },
    )

  const landingOf = async (idx) => {
    await page.waitForFunction(
      (i) => window.__mc.drops.items[i]?.landed,
      { timeout: 90000 },
      idx,
    )
    return page.evaluate((i) => {
      const { drops, world } = window.__mc
      const e = drops.items[i]
      const p = e.mesh.position
      const bx = Math.floor(p.x)
      const bz = Math.floor(p.z)
      const by = Math.floor(e.restY)
      return {
        x: p.x,
        z: p.z,
        restY: e.restY,
        cellIsAir: world.blockAt(bx, by, bz) === 0,
        floorIsSolid: world.blockAt(bx, by - 1, bz) !== 0 && world.blockAt(bx, by - 1, bz) !== 9,
      }
    }, idx)
  }

  // ---- Scenario A: mine a block with a solid roof directly above ---------
  console.log('\n[A] roofed mining: drop must fall into the mined cell')
  await page.evaluate(({ px, pz, top }) => {
    const { world } = window.__mc
    const yT = top + 1
    world.setBlock(px, yT, pz, 2) // dirt target
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        world.setBlock(px + ox, yT + 1, pz + oz, 3) // stone roof, two deep,
        world.setBlock(px + ox, yT + 2, pz + oz, 3) // 5x5 to cover pop drift
      }
    }
  }, spots.a)
  const a = await mine(spots.a)
  assert(a.broke && a.count === a.idx + 1, 'mining under the roof spawned a drop')

  // Trace the drop's y for a moment — the descent (or the hang) is visible.
  const trace = []
  for (let t = 0; t < 12; t++) {
    trace.push(
      await page.evaluate((i) => {
        const e = window.__mc.drops.items[i]
        return e ? +e.mesh.position.y.toFixed(2) : null
      }, a.idx),
    )
    await page.evaluate(() => new Promise((r) => setTimeout(r, 150)))
  }
  console.log('  drop y trace:', trace.join(' → '), `(mined cell floor y=${spots.a.top + 1})`)

  const aRest = await landingOf(a.idx)
  console.log('  landed:', JSON.stringify(aRest))
  assert(
    aRest.restY < spots.a.top + 1.5,
    `roofed drop fell to the mined cell (restY ${aRest.restY.toFixed(2)} < ${spots.a.top + 1.5})`,
  )
  assert(aRest.cellIsAir && aRest.floorIsSolid, 'roofed drop rests in air on solid ground')

  // ---- Scenario B: plain open-air drop (no regression) -------------------
  console.log('\n[B] open-air mining still drops and lands')
  await page.evaluate(({ px, pz, top }) => {
    window.__mc.world.setBlock(px, top + 1, pz, 2)
  }, spots.b)
  const b = await mine(spots.b)
  assert(b.broke && b.count === b.idx + 1, 'open-air mining spawned a drop')
  const bRest = await landingOf(b.idx)
  console.log('  landed:', JSON.stringify(bRest))
  assert(
    bRest.restY < spots.b.top + 1.5,
    `open-air drop landed low (restY ${bRest.restY.toFixed(2)})`,
  )
  assert(bRest.cellIsAir && bRest.floorIsSolid, 'open-air drop rests in air on solid ground')

  // ---- Scenario C: pickup still fires -------------------------------------
  console.log('\n[C] magnet pickup')
  const dirtBefore = await page.evaluate(() =>
    window.__mc.inventory.slots.reduce(
      (n, s) => n + (s?.id === 'dirt' ? s.count : 0),
      0,
    ),
  )
  await page.evaluate(
    ({ x, z, restY }) => {
      const { player, sounds } = window.__mc
      sounds.unlock()
      player.lock() // camera resyncs from the body only while locked
      player.teleport(x, restY, z)
    },
    { x: bRest.x, z: bRest.z, restY: bRest.restY },
  )
  await page.waitForFunction(
    (want) =>
      window.__mc.inventory.slots.reduce(
        (n, s) => n + (s?.id === 'dirt' ? s.count : 0),
        0,
      ) > want,
    { timeout: 90000 },
    dirtBefore,
  )
  const pickups = await page.evaluate(() => window.__mc.sounds.stats.byName.pickup ?? 0)
  assert(true, 'drop vacuumed into the inventory')
  assert(pickups > 0, `pickup sound fired (${pickups})`)

  // ---- Scenario D: despawn timer still works ------------------------------
  console.log('\n[D] despawn (shrunk timer)')
  await page.evaluate(() => {
    window.__mc.config.FEEDBACK.drops.despawnSeconds = 2
  })
  await page.waitForFunction(() => window.__mc.drops.count === 0, { timeout: 90000 })
  assert(true, 'all drops despawned once past the timer')
  await page.evaluate(() => {
    window.__mc.config.FEEDBACK.drops.despawnSeconds = 120
  })

  const errs = consoleErrors.filter((e) => !e.includes('WebGL')) // swiftshader noise
  assert(errs.length === 0, `no console errors (${errs.length ? errs.join(' | ') : 'clean'})`)
} catch (err) {
  console.error('FATAL', err)
  failures++
} finally {
  await browser.close()
  preview.kill()
}

console.log(failures ? `\n${failures} failure(s)` : '\nall drop tests passed')
process.exit(failures ? 1 : 0)
