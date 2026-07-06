// Headless verification for the Drowned (aquatic hostile, deep-water sequel).
//
// Covers: spawn-profile wiring (land tables untouched, aquatic table
// overworld-only); 3D swim-chase toward the player + contact melee +
// rotten-flesh drop; the dawn-burn submersion exemption; ambient aquatic
// spawning at night in ocean columns (and land hostiles still never rising
// in water); noon spawns confined to dark deep cells (the per-block water
// light attenuation); and the overworld land-spawn regression (no drowned on
// dry land). Screenshots the drowned underwater (tools/drowned-underwater.png,
// a git-ignored artifact).
//
// Run:
//   npm run build
//   npm install --no-save puppeteer-core   (not a project dep)
//   node tools/test-drowned.mjs
// Exits 0 on pass, 1 on failure. Software WebGL runs game time at ~0.3x real
// time — everything waits on waitForFunction, never fixed sleeps.

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const PORT = 4761 // unique strict port for this suite
const HERE = dirname(fileURLToPath(import.meta.url))

// Deep-ocean test spot on seed 1337 (probed): every spawn-ring column around
// (186, 8) is water-covered and >= 3 blocks deep, ~half of them >= 12 deep.
const OCEAN_X = 186
const OCEAN_Z = 8

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
  page.setDefaultTimeout(120_000)
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__mc?.world?.chunkReadyAt(0, 0))

  await page.evaluate(() => {
    __mc.save.enabled = false
    __mc.save.save = () => {} // the interval autosave ignores save.enabled
    __mc.sounds.unlock()
    __mc.player.lock()
    __mc.mobs.event = true // no ambient spawns until the ambient tests ask
    // Record every spawnAt so ambient tests can assert kind + placement at
    // the moment of spawn (mobs move afterwards).
    window.__spawns = []
    const orig = __mc.mobs.spawnAt.bind(__mc.mobs)
    __mc.mobs.spawnAt = (x, z, kind, y) => {
      window.__spawns.push({ x, z, kind, y })
      return orig(x, z, kind, y)
    }
  })

  console.log('spawn-profile wiring')
  {
    const r = await page.evaluate(() => ({
      landWeights: __mc.dims.overworld.spawnProfile.weights,
      aquatic: __mc.dims.overworld.spawnProfile.aquaticWeights,
      netherWeights: __mc.dims.nether.spawnProfile.weights,
      netherAquatic: __mc.dims.nether.spawnProfile.aquaticWeights,
    }))
    assert(
      JSON.stringify(r.landWeights) ===
        JSON.stringify({ zombie: 0.5, skeleton: 0.3, creeper: 0.2 }),
      'overworld land spawn table untouched (no drowned in it)',
    )
    assert(
      JSON.stringify(r.aquatic) === JSON.stringify({ drowned: 1 }),
      'overworld aquatic table is { drowned: 1 }',
    )
    assert(
      JSON.stringify(r.netherWeights) ===
        JSON.stringify({ zombified_piglin: 0.7, magma_cube: 0.3 }) &&
        r.netherAquatic === undefined,
      'nether profile untouched and carries NO aquatic table (lava seas stay empty)',
    )
  }

  console.log('travel to the deep ocean')
  await page.evaluate(
    ({ x, z }) => {
      __mc.config.BREATH.drainPerSecond = 0 // the player observes from the water
      __mc.player.teleport(x + 0.5, 56, z + 0.5)
    },
    { x: OCEAN_X, z: OCEAN_Z },
  )
  await page.waitForFunction(
    ({ x, z }) => __mc.world.chunkReadyAt(x + 0.5, z + 0.5),
    {},
    { x: OCEAN_X, z: OCEAN_Z },
  )
  assert(
    await page.evaluate(
      ({ x, z }) => __mc.world.terrainHeight(x, z) <= __mc.world.fluid.level - 10,
      { x: OCEAN_X, z: OCEAN_Z },
    ),
    'test spot is a dive-worthy ocean column',
  )
  await page.keyboard.down('Space') // tread water at the surface

  console.log('swim-chase: closes in 3D, rises from the deep')
  {
    await page.evaluate(
      ({ x, z }) => {
        window.__d = __mc.mobs.spawnAt(x - 6.5, z + 0.5, 'drowned', 48)
        const p = window.__d.group.position
        const b = __mc.player.body.position
        window.__d0 = {
          y: p.y,
          dist: Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z),
        }
      },
      { x: OCEAN_X, z: OCEAN_Z },
    )
    assert(
      await page.evaluate(() => {
        const p = window.__d.group.position
        return (
          __mc.world.blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === 9 &&
          window.__d.kind === 'drowned'
        )
      }),
      'drowned spawns submerged (feet cell is water)',
    )
    await page.waitForFunction(() => {
      const p = window.__d.group.position
      const b = __mc.player.body.position
      const dist = Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z)
      return p.y > window.__d0.y + 3 && dist < window.__d0.dist - 4
    })
    assert(true, 'drowned swims UP and AT the player (3D distance closes by 4+, rises 3+)')
  }

  console.log('contact melee + drop')
  {
    await page.waitForFunction(() => __mc.health.value < __mc.health.max)
    assert(true, 'contact melee damages the player')
    const drop = await page.evaluate(() => {
      __mc.mobs.hit(window.__d, 9999, { x: 0.5, y: 0, z: 0 })
      return (
        __mc.drops.items.some((d) => d.itemId === 'rotten_flesh') ||
        __mc.inventory.countOf('rotten_flesh') > 0
      )
    })
    assert(drop, 'killed drowned drops rotten flesh')
    await page.keyboard.up('Space')
    await page.evaluate(
      ({ x, z }) => {
        __mc.mobs.clear()
        __mc.drops.clear()
        __mc.health.heal(20)
        // A one-block stone perch at the waterline: the player watches the
        // remaining tests dry and stationary.
        __mc.world.setBlock(x, 57, z, 3)
        __mc.player.teleport(x + 0.5, 58.1, z + 0.5)
      },
      { x: OCEAN_X, z: OCEAN_Z },
    )
  }

  console.log('dawn burn: submerged drowned survives, dry zombie ignites')
  {
    await page.evaluate(
      ({ x, z }) => {
        // The burn defers while mobs.event is set — run this one with ambient
        // spawning enabled but effectively idle.
        __mc.mobs.event = false
        __mc.config.COMBAT.mobs.spawnIntervalSeconds = 999
        __mc.mobs.spawnTimer = 999
        // Freeze both actors: the control zombie must not chase off its perch
        // into the water (a submerged zombie would be burn-exempt too —
        // correctly), and the drowned must stay put on its distant seabed
        // instead of rising to bob at the surface mid-assert.
        __mc.config.COMBAT.mobs.zombie.chaseSpeed = 0
        __mc.config.COMBAT.mobs.zombie.wanderSpeed = 0
        __mc.config.COMBAT.mobs.drowned.wanderSpeed = 0
        __mc.config.COMBAT.mobs.drowned.aggroRange = 0
        __mc.world.setBlock(x - 3, 57, z, 3) // dry perch for the control
        // y = null: feet on the seabed of its (always >= 3 deep) column —
        // fully submerged, stable.
        window.__wet = __mc.mobs.spawnAt(x + 16.5, z + 0.5, 'drowned')
        window.__dry = __mc.mobs.spawnAt(x - 2.5, z + 0.5, 'zombie', 58.1)
        __mc.daynight.setTime(0.2) // late morning — the burn is on
      },
      { x: OCEAN_X, z: OCEAN_Z },
    )
    await page.waitForFunction(() => !__mc.mobs.mobs.includes(window.__dry))
    assert(true, 'sky-exposed dry zombie burns at day')
    // Several more burn ticks' worth of game time, then the submerged
    // drowned must still be alive.
    await new Promise((r) => setTimeout(r, 4000))
    assert(
      await page.evaluate(
        () => __mc.mobs.mobs.includes(window.__wet) && window.__wet.body.inWater,
      ),
      'submerged drowned survives the dawn burn',
    )
    await page.evaluate(() => {
      __mc.mobs.clear()
      __mc.config.COMBAT.mobs.zombie.chaseSpeed = 2.8
      __mc.config.COMBAT.mobs.zombie.wanderSpeed = 1
      __mc.config.COMBAT.mobs.drowned.wanderSpeed = 0.8
      __mc.config.COMBAT.mobs.drowned.aggroRange = 14
    })
  }

  console.log('ambient aquatic spawns: night ocean')
  {
    await page.evaluate(() => {
      window.__spawns.length = 0
      __mc.daynight.setTime(0.7) // midnight-ish
      __mc.config.COMBAT.mobs.spawnIntervalSeconds = 0.3
      __mc.config.DAYNIGHT.hostiles.nightMaxCount = 10
      __mc.mobs.spawnTimer = 0.1
    })
    await page.waitForFunction(() => window.__spawns.length >= 3)
    const r = await page.evaluate(() => ({
      spawns: window.__spawns.map((s) => ({
        ...s,
        wet: __mc.world.terrainHeight(Math.floor(s.x), Math.floor(s.z)) <= 57,
        inWater:
          __mc.world.blockAt(Math.floor(s.x), Math.floor(s.y), Math.floor(s.z)) === 9 &&
          __mc.world.blockAt(Math.floor(s.x), Math.floor(s.y) + 1, Math.floor(s.z)) === 9,
      })),
    }))
    assert(
      r.spawns.every((s) => s.kind === 'drowned'),
      `all-ocean ring spawns only drowned at night (${r.spawns.map((s) => s.kind).join(', ')})`,
    )
    assert(
      r.spawns.every((s) => s.wet && s.inWater),
      'every ambient drowned spawned fully submerged in an ocean column (land hostiles never rise in water)',
    )
  }

  console.log('noon: spawns confined to dark deep cells')
  {
    await page.evaluate(() => {
      __mc.mobs.clear()
      window.__spawns.length = 0
      __mc.daynight.setTime(0.25) // noon — full sky brightness
      __mc.mobs.spawnTimer = 0.1
    })
    await page.waitForFunction(() => window.__spawns.length >= 2)
    const r = await page.evaluate(() => window.__spawns.map((s) => ({ kind: s.kind, y: s.y })))
    // lightPerDepth 0.08 × maxLight 0.25 ⇒ a noon spawn needs 9.4+ blocks of
    // water overhead: feet at y <= 47 under the 57 waterline.
    assert(
      r.every((s) => s.kind === 'drowned' && s.y <= 47.5),
      `noon ocean spawns exist but only under 9+ blocks of water (y: ${r.map((s) => s.y).join(', ')})`,
    )
    await page.evaluate(() => {
      __mc.mobs.clear()
      __mc.mobs.event = true
    })
  }

  console.log('overworld land regression: no drowned on dry land')
  {
    await page.evaluate(() => {
      window.__spawns.length = 0
      const y = __mc.world.surfaceY(0.5, 0.5)
      __mc.player.teleport(0.5, y, 0.5)
      __mc.daynight.setTime(0.7)
      __mc.mobs.event = false
      __mc.mobs.spawnTimer = 0.1
    })
    await page.waitForFunction(() => __mc.world.chunkReadyAt(0.5, 0.5))
    await page.waitForFunction(() => window.__spawns.length >= 3)
    const kinds = await page.evaluate(() => window.__spawns.map((s) => s.kind))
    assert(
      kinds.every((k) => ['zombie', 'skeleton', 'creeper'].includes(k)),
      `inland night spawns stay zombie/skeleton/creeper — never drowned (${kinds.join(', ')})`,
    )
    await page.evaluate(() => {
      __mc.mobs.event = true
      __mc.mobs.clear()
      __mc.health.heal(20)
    })
  }

  console.log('screenshot: the drowned underwater')
  {
    await page.evaluate(
      ({ x, z }) => {
        __mc.daynight.setTime(0.25) // noon light for a readable shot
        __mc.inventory.select(8) // empty hand — viewmodel out of frame
        // Freeze the model so it holds its pose in front of the camera.
        __mc.config.COMBAT.mobs.drowned.swimSpeed = 0
        __mc.config.COMBAT.mobs.drowned.verticalSwimSpeed = 0
        __mc.camera.quaternion.set(0, 0, 0, 1) // look straight down -z
        __mc.player.teleport(x + 0.5, 50, z + 0.5) // submerged in the basin
        const d = __mc.mobs.spawnAt(x + 0.5, z - 3.5, 'drowned', 49.5)
        d.group.rotation.y = Math.PI // face the camera
        __mc.scene.updateMatrixWorld(true)
      },
      { x: OCEAN_X, z: OCEAN_Z },
    )
    await new Promise((r) => setTimeout(r, 2500)) // let a few frames render
    await page.screenshot({ path: join(HERE, 'drowned-underwater.png') })
    console.log('  wrote tools/drowned-underwater.png')
  }

  console.log('console errors')
  assert(consoleErrors.length === 0, `zero console errors (${consoleErrors.join(' | ') || 'none'})`)
} finally {
  await browser.close()
  preview.kill()
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nOK: all Drowned assertions hold')
