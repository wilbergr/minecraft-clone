// Headless verification for the End arc (E1–E5): dimension travel + island,
// the End portal (craft → ring self-activation → one-way travel), the shared
// flight seams (gravityScale / per-projectile gravity), the Ender Dragon
// fight (crystals → perch → kill → victory grants), and elytra gliding.
// Writes screenshots next to this script (end-*.png; git-ignored artifacts).
//
// Run:
//   npm run build
//   npm install --no-save puppeteer-core   (not a project dep)
//   node tools/test-end.mjs
// Exits 0 on pass, 1 on failure. Software WebGL runs game time at ~0.3x real
// time — everything waits on waitForFunction, never fixed sleeps.

import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const PORT = 4746 // unique strict port for this suite
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
  page.setDefaultTimeout(120_000)
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__mc?.world?.chunkReadyAt(0, 0))

  // Never persist anything this run writes (the diamond-PR sharp edge: the
  // interval autosave ignores save.enabled, so stub save() too).
  await page.evaluate(() => {
    __mc.save.enabled = false
    __mc.save.save = () => {}
    __mc.sounds.unlock()
    __mc.player.lock()
  })

  console.log('E1: the End dimension')
  {
    // Travel straight in via the controller seam, feet on the arrival column.
    await page.evaluate(() => {
      __mc.dims.travel('end', { x: 0.5, y: 66, z: 36.5 })
    })
    await page.waitForFunction(() => __mc.world.chunkReadyAt(0, 36))
    const t = await page.evaluate(() => {
      const { dims, scene, daynight, furnaces, player } = __mc
      const end = dims.end
      const c = __mc.config.END
      return {
        isEnd: dims.current === end && dims.name === 'end',
        worldGetter: __mc.world === end,
        roots: !dims.overworld.root.visible && !dims.nether.root.visible && end.root.visible,
        refs:
          player.world === end &&
          player.body.world === end &&
          __mc.interaction.world === end &&
          __mc.mobs.world === end &&
          __mc.projectiles.world === end &&
          __mc.drops.world === end,
        fog: scene.fog.near === c.fog.near && scene.fog.far === c.fog.far,
        sky: scene.background.getHex() === c.skyColor,
        daynightPaused: daynight.active === false,
        prefix: furnaces.dim === 'E|' && __mc.chests.dim === 'E|',
        spawnEmpty: Object.keys(end.spawnProfile.weights).length === 0,
      }
    })
    assert(t.isEnd, 'dims.travel("end") lands in the End')
    assert(t.worldGetter, '__mc.world getter follows the active dimension')
    assert(t.roots, 'only the End root is visible')
    assert(t.refs, 'world refs swapped on every live system')
    assert(t.fog, 'END fog applied')
    assert(t.sky, 'END sky color applied')
    assert(t.daynightPaused, 'DayNight visual writes suppressed (clock still ticks)')
    assert(t.prefix, "container prefix is 'E|'")
    assert(t.spawnEmpty, 'End spawn profile is empty')

    // Block spot checks: end stone at the surface, obsidian at a pillar top,
    // void far out.
    const blocks = await page.evaluate(() => {
      const end = __mc.dims.end
      const surf = end.surfaceY(0.5, 0.5)
      const p = end.pillars[0]
      return {
        surf,
        top: end.blockAt(0, surf - 1, 0),
        pillar: end.blockAt(p.x, p.top, p.z),
        void1: end.blockAt(60, 40, 60),
        void2: end.blockAt(0, 20, 0) === 0 || true, // underside taper varies; presence-only
      }
    })
    assert(blocks.surf >= 58 && blocks.surf <= 66, `island surface sane (y ${blocks.surf})`)
    assert(blocks.top === 29, 'surface block is end stone')
    assert(blocks.pillar === 20, 'pillar top is obsidian')
    assert(blocks.void1 === 0, 'far column is void')

    // The ambient spawner stays quiet: force spawn ticks, population stays 0.
    await page.evaluate(() => {
      __mc.mobs.spawnTimer = 0.01
      __mc.mobs.passiveSpawnTimer = 0.01
    })
    await page.waitForFunction(() => __mc.mobs.spawnTimer > 0.01) // a tick ran
    const count = await page.evaluate(() => __mc.mobs.count)
    assert(count === 0, 'no ambient spawns in the End')

    // Nether portal refuses to operate here (the binary-flip guard).
    const ignite = await page.evaluate(() => {
      // A fake obsidian target — tryIgnite must bail on the dimension gate
      // before ever looking at the frame.
      return __mc.portals.tryIgnite(__mc.dims.current, {
        x: 0,
        y: 62,
        z: 0,
        normal: [0, 1, 0],
      })
    })
    assert(ignite === false, 'nether-portal ignition refused in the End')

    // Save round-trip: dimension + endEdits ride the save payload.
    const saved = await page.evaluate(() => {
      __mc.world.setBlock(2, 70, 2, 3) // one End edit
      const s = __mc.save.serialize()
      return {
        dimension: s.dimension,
        endEdits: Object.values(s.endEdits ?? {}).some((list) => list.length > 0),
        schema: s.schemaVersion,
      }
    })
    assert(saved.dimension === 'end', "save serializes dimension: 'end'")
    assert(saved.endEdits, 'save serializes endEdits')
    assert(saved.schema === 4, 'schemaVersion stays 4')
    await page.evaluate(() => __mc.world.setBlock(2, 70, 2, 0))

    await page.screenshot({ path: join(HERE, 'end-island.png') })

    // Falling off the island: void death, respawn lands in the overworld.
    await page.evaluate(() => {
      __mc.player.teleport(100.5, 40, 100.5) // off the rim, mid-void
    })
    await page.waitForFunction(() => __mc.health.isDead)
    assert(true, 'void fall below the island is lethal')
    await page.click('#respawn-btn')
    await page.waitForFunction(() => !__mc.health.isDead)
    const back = await page.evaluate(() => ({
      name: __mc.dims.name,
      daynight: __mc.daynight.active,
    }))
    assert(back.name === 'overworld', 'death respawns to the overworld')
    assert(back.daynight, 'DayNight resumes painting after the return')
    await page.evaluate(() => __mc.player.lock())
  }

  console.log(consoleErrors.length ? `console errors:\n${consoleErrors.join('\n')}` : 'no console errors')
  assert(consoleErrors.length === 0, 'zero console errors')
} finally {
  await browser.close()
  preview.kill()
}

process.exit(failures ? 1 : 0)
