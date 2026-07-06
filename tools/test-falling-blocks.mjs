// Headless regression test for falling gravity blocks (FallingBlocks.js).
//
// Covers: mining the bottom of a grounded sand column (the stack above falls
// and re-settles), a floating column collapse cascading in order (sand stays
// under gravel), gravel falling, landing on a torch (breaks it to a drop),
// landing in the player's cell (physics eject lifts them on top — no wedge),
// sand sinking into water (replaces the liquid cell), mid-air placement
// falling immediately, the explosion-sweep trigger, and the invariant that
// freshly generated beach sand never spontaneously collapses.
//
// Run:
//   npm run build
//   npm install --no-save puppeteer-core   (not a project dep)
//   node tools/test-falling-blocks.mjs
// Exits 0 on pass, 1 on failure. Uses the cached Chrome under
// ~/.cache/puppeteer with --enable-unsafe-swiftshader (software WebGL —
// game time runs ~0.3x real time, so everything waits on waitForFunction).

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const PORT = 4747 // unique strict port for this suite
const HERE = dirname(fileURLToPath(import.meta.url))

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
  for (let i = 0; i < 50; i++) {
    try {
      const html = await (await fetch(`http://localhost:${PORT}/`)).text()
      // Guard against a FOREIGN server already squatting the port (parallel
      // worktrees run their own previews): the served bundle must be the one
      // this worktree just built, or every assert would run against stale code.
      const built = readFileSync(join(HERE, '..', 'dist', 'index.html'), 'utf8')
      const bundle = (s) => s.match(/assets\/index-[^"]+\.js/)?.[0]
      if (bundle(html) !== bundle(built)) {
        preview.kill()
        throw new Error(
          `port ${PORT} serves ${bundle(html)} but dist has ${bundle(built)} — another server owns the port?`,
        )
      }
      break
    } catch (e) {
      if (String(e).includes('another server')) throw e
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
  await page.waitForFunction(() => window.__mc?.world && window.__mc?.falling, {
    timeout: 60000,
  })
  await page.evaluate(() => {
    window.__mc.save.enabled = false // keep runs hermetic
    window.__mc.save.save = () => {} // interval autosave ignores `enabled`
  })
  await page.waitForFunction(
    () => {
      const { world, camera } = window.__mc
      return world.chunkReadyAt(camera.position.x, camera.position.z)
    },
    { timeout: 60000 },
  )

  // Boot invariant: chunk generation fired no falls (generated terrain —
  // beaches, deserts, ocean floors — must never spontaneously collapse).
  const bootCount = await page.evaluate(() => window.__mc.falling.count)
  assert(bootCount === 0, `no falls triggered by generation at boot (${bootCount})`)

  // Find flat clearings near spawn: uniform-or-lower 5x5 neighborhood with
  // 10 cells of clear air above (tall enough for the floating-column rigs).
  const spots = await page.evaluate(() => {
    const { world, camera } = window.__mc
    const cx = Math.floor(camera.position.x)
    const cz = Math.floor(camera.position.z)
    const flat = []
    for (let dx = -24; dx <= 24; dx++) {
      for (let dz = -24; dz <= 24; dz++) {
        const d = Math.hypot(dx, dz)
        if (d < 5 || d > 24) continue
        const px = cx + dx
        const pz = cz + dz
        const top = world.topSolidY(px, pz)
        if (top <= 57) continue // never a water column (WATER.level)
        let ok = true
        for (let ox = -2; ox <= 2 && ok; ox++) {
          for (let oz = -2; oz <= 2 && ok; oz++) {
            if (world.topSolidY(px + ox, pz + oz) > top) ok = false
            for (let oy = 1; oy <= 10 && ok; oy++) {
              if (world.blockAt(px + ox, top + oy, pz + oz) !== 0) ok = false
            }
          }
        }
        if (ok) flat.push({ px, pz, top, d })
      }
    }
    flat.sort((a, b) => a.d - b.d)
    const picked = []
    for (const s of flat) {
      if (picked.every((p) => Math.hypot(s.px - p.px, s.pz - p.pz) >= 7)) picked.push(s)
      if (picked.length === 7) break
    }
    return picked
  })
  if (spots.length < 7) throw new Error(`only ${spots.length} flat clearings found near spawn`)
  console.log('clearings:', JSON.stringify(spots.map((s) => [s.px, s.top, s.pz])))

  const blockAt = (x, y, z) => page.evaluate(([x, y, z]) => window.__mc.world.blockAt(x, y, z), [x, y, z])
  const settled = () =>
    page.waitForFunction(() => window.__mc.falling.count === 0, { timeout: 90000 })

  // ---- A: mine the bottom of a grounded sand column ----------------------
  console.log('\n[A] grounded 3-sand column, bottom mined: stack falls one cell')
  const A = spots[0]
  await page.evaluate(({ px, pz, top }) => {
    const { world } = window.__mc
    for (let i = 1; i <= 3; i++) world.setBlock(px, top + i, pz, 4)
  }, A)
  const mined = await page.evaluate(({ px, pz, top }) => {
    const { world, interaction, falling } = window.__mc
    for (let i = 0; i < 60; i++) {
      interaction.target = { x: px, y: top + 1, z: pz, normal: [0, 1, 0] }
      if (interaction.breakTargeted()) break
    }
    return { broke: world.blockAt(px, top + 1, pz) !== 4, launched: falling.count }
  }, A)
  assert(mined.broke, 'bottom sand mined via breakTargeted')
  assert(mined.launched === 2, `both blocks above converted to falling entities (${mined.launched})`)
  await settled()
  assert((await blockAt(A.px, A.top + 1, A.pz)) === 4, 'sand re-settled at top+1')
  assert((await blockAt(A.px, A.top + 2, A.pz)) === 4, 'sand re-settled at top+2')
  assert((await blockAt(A.px, A.top + 3, A.pz)) === 0, 'top+3 left empty')

  // ---- B: floating mixed column collapses in order ------------------------
  console.log('\n[B] floating sand+gravel column: cascade preserves order')
  const B = spots[1]
  await page.evaluate(({ px, pz, top }) => {
    const { world } = window.__mc
    world.setBlock(px, top + 6, pz, 3) // stone support
    world.setBlock(px, top + 7, pz, 4) // sand
    world.setBlock(px, top + 8, pz, 28) // gravel above it
    world.setBlock(px, top + 6, pz, 0) // knock the support out
  }, B)
  await settled()
  assert((await blockAt(B.px, B.top + 1, B.pz)) === 4, 'sand landed first (bottom cell)')
  assert((await blockAt(B.px, B.top + 2, B.pz)) === 28, 'gravel stacked on top — order preserved')
  assert((await blockAt(B.px, B.top + 7, B.pz)) === 0, 'origin cells emptied')

  // ---- C: landing on a torch breaks it to a drop ---------------------------
  console.log('\n[C] falling sand onto a torch: torch pops, sand takes the cell')
  const C = spots[2]
  const cRes = await page.evaluate(({ px, pz, top }) => {
    const { world, drops } = window.__mc
    world.setBlock(px, top + 1, pz, 13) // torch on the ground
    const dropsBefore = drops.count
    world.setBlock(px, top + 5, pz, 3) // support high above
    world.setBlock(px, top + 6, pz, 4) // sand on it
    world.setBlock(px, top + 5, pz, 0)
    return { dropsBefore, torchRegistered: world.torches.has(`${px},${top + 1},${pz}`) }
  }, C)
  assert(cRes.torchRegistered, 'torch registered before the fall')
  await settled()
  const cAfter = await page.evaluate(({ px, pz, top }) => {
    const { world, drops } = window.__mc
    return {
      cell: world.blockAt(px, top + 1, pz),
      torchGone: !world.torches.has(`${px},${top + 1},${pz}`),
      torchDrop: drops.items.some((e) => e.itemId === 'torch'),
    }
  }, C)
  assert(cAfter.cell === 4, 'sand occupies the torch cell')
  assert(cAfter.torchGone, 'torch left the light registry')
  assert(cAfter.torchDrop, 'torch spilled as a ground drop')

  // ---- D: landing in the player's cell ejects them on top ------------------
  console.log('\n[D] sand lands on the player: eject lifts them, no wedge/death')
  const D = spots[3]
  await page.evaluate(({ px, pz, top }) => {
    const { player, sounds, world } = window.__mc
    sounds.unlock()
    player.lock() // physics (and the eject self-heal) run only while locked
    player.teleport(px + 0.5, top + 1, pz + 0.5)
    world.setBlock(px, top + 7, pz, 3)
    world.setBlock(px, top + 8, pz, 4)
    world.setBlock(px, top + 7, pz, 0)
  }, D)
  await settled()
  assert((await blockAt(D.px, D.top + 1, D.pz)) === 4, 'sand settled in the player cell')
  await page.waitForFunction(
    ({ px, pz, top }) => {
      const { player } = window.__mc
      const p = player.body.position
      return (
        Math.floor(p.x) === px && Math.floor(p.z) === pz && p.y >= top + 2 - 0.01
      )
    },
    { timeout: 90000 },
    D,
  )
  const dAlive = await page.evaluate(() => !window.__mc.health.isDead)
  assert(true, 'player ejected on top of the settled sand')
  assert(dAlive, 'player survived the landing')

  // ---- E: sand sinks through water and displaces the liquid cell -----------
  console.log('\n[E] sand falling into water: settles on the floor, replaces water')
  const E = spots[4]
  await page.evaluate(({ px, pz, top }) => {
    const { world } = window.__mc
    world.setBlock(px, top + 1, pz, 9) // a standing water cell
    world.setBlock(px, top + 5, pz, 3)
    world.setBlock(px, top + 6, pz, 4)
    world.setBlock(px, top + 5, pz, 0)
  }, E)
  await settled()
  assert((await blockAt(E.px, E.top + 1, E.pz)) === 4, 'sand displaced the water cell')

  // ---- F: placing sand in mid-air drops it immediately ---------------------
  console.log('\n[F] mid-air placement: the block falls as soon as it is placed')
  const F = spots[5]
  await page.evaluate(({ px, pz, top }) => {
    window.__mc.world.setBlock(px, top + 5, pz, 4) // no support at all
  }, F)
  await settled()
  assert((await blockAt(F.px, F.top + 1, F.pz)) === 4, 'placed sand landed on the ground')
  assert((await blockAt(F.px, F.top + 5, F.pz)) === 0, 'placement cell emptied')

  // ---- G: explosion carving the support triggers the fall -------------------
  console.log('\n[G] explosion sweep: carving a support drops the sand above')
  const G = spots[6]
  await page.evaluate(({ px, pz, top }) => {
    const { world, mobs } = window.__mc
    world.setBlock(px, top + 5, pz, 3)
    world.setBlock(px, top + 6, pz, 4)
    // Radius 0.9 carves exactly the support cell; the sweep below is
    // verbatim what MobManager does after a creeper/quake detonation.
    const carved = world.explode(px + 0.5, top + 5.5, pz + 0.5, 0.9)
    mobs.onBlocksExploded(carved)
    return carved.length
  }, G)
  await settled()
  assert((await blockAt(G.px, G.top + 1, G.pz)) === 4, 'exploded-out sand fell to the ground')
  assert((await blockAt(G.px, G.top + 6, G.pz)) === 0, 'origin cell emptied')

  // ---- H: a generated beach stays put ---------------------------------------
  console.log('\n[H] generated beach: no spontaneous collapse')
  const beach = await page.evaluate(() => {
    const { world, camera } = window.__mc
    const cx = Math.floor(camera.position.x)
    const cz = Math.floor(camera.position.z)
    for (let r = 4; r <= 120; r++) {
      for (let dx = -r; dx <= r; dx += 2) {
        for (const dz of [-r, r]) {
          for (const [px, pz] of [
            [cx + dx, cz + dz],
            [cx + dz, cz + dx],
          ]) {
            const top = world.topSolidY(px, pz)
            if (world.blockAt(px, top, pz) === 4) return { px, pz, top }
          }
        }
      }
    }
    return null
  })
  assert(beach !== null, `found generated beach sand at ${JSON.stringify(beach)}`)
  if (beach) {
    // Stream its chunk in (falls only trigger on edits, but prove it with the
    // chunk genuinely loaded), then confirm nothing ever launched.
    await page.evaluate(({ px, pz }) => {
      window.__mc.player.teleport(px + 0.5, window.__mc.world.topSolidY(px, pz) + 1, pz + 0.5)
    }, beach)
    await page.waitForFunction(
      ({ px, pz }) => window.__mc.world.chunkReadyAt(px, pz),
      { timeout: 60000 },
      beach,
    )
    const h = await page.evaluate(({ px, pz, top }) => {
      const { world, falling } = window.__mc
      return { count: falling.count, stillSand: world.blockAt(px, top, pz) === 4 }
    }, beach)
    assert(h.count === 0, `no falling entities near the beach (${h.count})`)
    assert(h.stillSand, 'beach sand block unchanged')
  }

  const errs = consoleErrors.filter((e) => !e.includes('WebGL')) // swiftshader noise
  assert(errs.length === 0, `no console errors (${errs.length ? errs.join(' | ') : 'clean'})`)

  await page.screenshot({ path: 'tools/falling-blocks.png' })
} catch (err) {
  console.error('FATAL', err)
  failures++
} finally {
  await browser.close()
  preview.kill()
}

console.log(failures ? `\n${failures} failure(s)` : '\nall falling-block tests passed')
process.exit(failures ? 1 : 0)
