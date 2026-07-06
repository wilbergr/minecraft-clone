// Headless verification for Nether phases N5 (mobs) + N4 (survival polish).
//
// Covers: zombified piglin neutrality → anger → spread → gold drop; magma
// cube periodic hops + lavaProof; the Nether ambient spawn profile (and the
// overworld table staying untouched); soul-sand slowdown vs netherrack;
// netherrack as furnace fuel; quartz block craft + place; the Nether bed
// refusal; compass HUD dimension gating; and a portal round-trip + overworld
// night-spawn regression. Takes screenshots of the two mobs in the Nether
// (written next to this script as nether-mobs-*.png; git-ignored artifacts).
//
// Run:
//   npm run build
//   npm install --no-save puppeteer-core   (not a project dep)
//   node tools/test-nether-mobs.mjs
// Exits 0 on pass, 1 on failure. Software WebGL runs game time at ~0.3x real
// time — everything waits on waitForFunction, never fixed sleeps.

import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const PORT = 4738 // unique strict port for this suite
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
  page.setDefaultTimeout(90_000)
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

  console.log('overworld baseline')
  {
    const profile = await page.evaluate(() => __mc.dims.overworld.spawnProfile.weights)
    assert(
      JSON.stringify(profile) === JSON.stringify({ zombie: 0.5, skeleton: 0.3, creeper: 0.2 }),
      'overworld spawn table untouched (zombie/skeleton/creeper only)',
    )
    const netherWeights = await page.evaluate(() => __mc.dims.nether.spawnProfile.weights)
    assert(
      netherWeights.zombified_piglin > 0 && netherWeights.magma_cube > 0,
      'nether spawn table lists zombified_piglin + magma_cube',
    )
    // The compass strip shows in the overworld (fresh save: hunt token 0 is
    // the active target) — a frame must pass for the HUD update to run.
    await page.waitForFunction(
      () => !document.getElementById('compass').classList.contains('hidden'),
    )
    assert(true, 'compass visible in the overworld')
  }

  console.log('travel to the Nether')
  await page.evaluate(() => {
    __mc.dims.travel('nether', { x: 0.5, y: 57, z: 0.5 })
    __mc.mobs.event = true // suppress ambient spawns while tests direct-spawn
  })
  await page.waitForFunction(() => __mc.world.chunkReadyAt(0.5, 0.5))
  await page.waitForFunction(
    () => document.getElementById('compass').classList.contains('hidden'),
  )
  assert(true, 'compass hidden in the Nether')

  console.log('bed refusal')
  {
    const r = await page.evaluate(() => {
      const p = __mc.player.body.position
      const x = Math.floor(p.x) + 2
      const z = Math.floor(p.z)
      const y = __mc.world.surfaceY(x + 0.5, z + 0.5)
      __mc.world.setBlock(x, y - 1, z, 21) // a netherrack floor to sit on
      __mc.world.setBlock(x, y, z, 0)
      __mc.world.setBlock(x, y + 1, z, 0)
      __mc.inventory.add('bed', 1)
      __mc.inventory.select(0)
      const slot = __mc.inventory.slots.findIndex((s) => s?.id === 'bed')
      __mc.inventory.select(slot < 9 ? slot : 0)
      __mc.interaction.target = { x, y: y - 1, z, normal: [0, 1, 0] }
      const placed = __mc.interaction.placeAtTargeted()
      const timeBefore = __mc.daynight.time
      __mc.interaction.target = { x, y, z, normal: [0, 1, 0] }
      const used = __mc.interaction.useSelected()
      return {
        placed,
        used,
        bedThere: __mc.world.blockAt(x, y, z) === 15,
        toast: document.getElementById('sleep-toast').textContent,
        spawn: __mc.sleep.spawn,
        timeJump: Math.abs(__mc.daynight.time - timeBefore),
      }
    })
    assert(r.placed && r.bedThere, 'bed places in the Nether (as a block)')
    assert(r.used && /refuses/.test(r.toast), `bed click refused with toast ("${r.toast}")`)
    assert(r.spawn === null && r.timeJump < 0.05, 'no spawn point set, no time skip')
  }

  console.log('soul sand slowdown')
  {
    // Two identical walks from the same start over each surface; compare
    // steady top speeds. Camera faces -z (identity quaternion); platforms are
    // rebuilt in place between runs.
    const buildPlatform = (id) =>
      page.evaluate((blockId) => {
        for (let x = -2; x <= 2; x++) {
          for (let z = -9; z <= 2; z++) {
            __mc.world.setBlock(x, 56, z, blockId)
            for (let y = 57; y <= 59; y++) __mc.world.setBlock(x, y, z, 0)
          }
        }
        __mc.camera.quaternion.set(0, 0, 0, 1) // look straight down -z
        __mc.player.teleport(0.5, 57, 0.5)
      }, id)
    const measure = async () => {
      await page.evaluate(() => {
        window.__speedMax = 0
        window.__sampler = setInterval(() => {
          const v = __mc.player.body.velocity
          const s = Math.hypot(v.x, v.z)
          if (s > window.__speedMax) window.__speedMax = s
        }, 30)
      })
      await page.keyboard.down('KeyW')
      await new Promise((r) => setTimeout(r, 5000)) // ~1.5s of game time
      await page.keyboard.up('KeyW')
      return page.evaluate(() => {
        clearInterval(window.__sampler)
        return window.__speedMax
      })
    }
    await buildPlatform(21) // netherrack control run
    const fast = await measure()
    await buildPlatform(22) // soul sand
    const slow = await measure()
    const ratio = slow / fast
    assert(
      fast > 2 && ratio > 0.25 && ratio < 0.55,
      `soul sand slows the walk (netherrack ${fast.toFixed(2)} b/s vs soul sand ${slow.toFixed(2)} b/s, ratio ${ratio.toFixed(2)} ≈ 0.4)`,
    )
  }

  console.log('zombified piglin: neutral → angered → spread → gold')
  {
    await page.evaluate(() => {
      __mc.config.COMBAT.mobs.zombifiedPiglin.wanderSpeed = 0 // stand still unprovoked
      window.__p1 = __mc.mobs.spawnAt(10.5, 0.5, 'zombified_piglin')
      window.__p2 = __mc.mobs.spawnAt(14.5, 0.5, 'zombified_piglin') // 4 from p1: inside angerRadius
      window.__p1start = { x: window.__p1.group.position.x, z: window.__p1.group.position.z }
    })
    await new Promise((r) => setTimeout(r, 6000)) // ~2s game time to prove neutrality
    const neutral = await page.evaluate(() => {
      const p = window.__p1.group.position
      return {
        angered: window.__p1.angered,
        drift: Math.hypot(p.x - window.__p1start.x, p.z - window.__p1start.z),
        distToPlayer: Math.hypot(
          p.x - __mc.player.body.position.x,
          p.z - __mc.player.body.position.z,
        ),
      }
    })
    assert(
      neutral.angered === false && neutral.drift < 1,
      `unprovoked piglin stays put (drift ${neutral.drift.toFixed(2)}, dist ${neutral.distToPlayer.toFixed(1)})`,
    )
    const afterHit = await page.evaluate(() => {
      window.__hitDist = Math.hypot(
        window.__p1.group.position.x - __mc.player.body.position.x,
        window.__p1.group.position.z - __mc.player.body.position.z,
      )
      __mc.mobs.hit(window.__p1, 1, { x: 0.5, y: 0, z: 0 })
      return { p1: window.__p1.angered, p2: window.__p2.angered }
    })
    assert(afterHit.p1 === true, 'hit piglin angers')
    assert(afterHit.p2 === true, 'second piglin inside angerRadius angers too')
    await page.waitForFunction(() => {
      const p = window.__p1.group.position
      const d = Math.hypot(
        p.x - __mc.player.body.position.x,
        p.z - __mc.player.body.position.z,
      )
      return window.__hitDist - d > 2
    })
    assert(true, 'angered piglin closes distance (chases)')
    const drop = await page.evaluate(() => {
      __mc.mobs.hit(window.__p1, 9999, { x: 0.5, y: 0, z: 0 })
      __mc.mobs.hit(window.__p2, 9999, { x: 0.5, y: 0, z: 0 })
      // The drop is a ground entity — unless the magnet already vacuumed it.
      return (
        __mc.drops.items.some((d) => d.itemId === 'gold_ore') ||
        __mc.inventory.countOf('gold_ore') > 0
      )
    })
    assert(drop, 'killed piglin drops gold ore')
    await page.evaluate(() => {
      __mc.mobs.clear()
      __mc.drops.clear()
      __mc.health.heal(20)
    })
  }

  console.log('magma cube: periodic hops')
  {
    await page.evaluate(() => {
      window.__cube = __mc.mobs.spawnAt(8.5, 0.5, 'magma_cube')
    })
    await page.waitForFunction(() => window.__cube.body.velocity.y > 2)
    await page.waitForFunction(() => window.__cube.body.velocity.y < 0)
    await page.waitForFunction(() => window.__cube.body.velocity.y > 2)
    assert(true, 'magma cube launches repeatedly (two upward velocity spikes)')
    assert(
      await page.evaluate(() => window.__cube.lavaProof === true),
      'magma cube is lavaProof-flagged',
    )
  }

  console.log('screenshots: the two mobs in the Nether')
  {
    await page.evaluate(() => {
      __mc.mobs.clear()
      __mc.inventory.select(8) // an empty hand keeps the viewmodel out of frame
      __mc.camera.quaternion.set(0, 0, 0, 1)
      __mc.player.teleport(0.5, 57, 0.5)
      // Pose fresh mobs on the netherrack test platform in front of the camera.
      for (let x = -3; x <= 3; x++) {
        for (let z = -8; z <= 0; z++) {
          __mc.world.setBlock(x, 56, z, 21)
          for (let y = 57; y <= 60; y++) __mc.world.setBlock(x, y, z, 0)
        }
      }
      __mc.world.setBlock(2, 57, -2, 23) // a glowstone lamp so the shot reads
      const pig = __mc.mobs.spawnAt(-1.1, -4.2, 'zombified_piglin')
      pig.group.position.y = 57
      const cube = __mc.mobs.spawnAt(1.4, -2.8, 'magma_cube')
      cube.group.position.y = 57
      __mc.scene.updateMatrixWorld(true)
    })
    await new Promise((r) => setTimeout(r, 2500)) // let a few frames render
    await page.screenshot({ path: join(HERE, 'nether-mobs-pair.png') })
    console.log('  wrote tools/nether-mobs-pair.png')
    await page.evaluate(() => __mc.mobs.clear())
  }

  console.log('magma cube: lava immunity (piglin control burns)')
  {
    await page.evaluate(() => {
      // A deterministic 1×1 lava well 15 blocks out: solid shaft walls, two
      // stacked lava cells — mob midsections sit squarely in lava.
      const x = 15
      const z = 0
      for (let y = 55; y <= 58; y++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            __mc.world.setBlock(x + dx, y, z + dz, dx === 0 && dz === 0 ? 0 : 21)
          }
        }
      }
      __mc.world.setBlock(x, 54, z, 21) // well floor
      __mc.world.setBlock(x, 55, z, 19) // lava
      __mc.world.setBlock(x, 56, z, 19) // lava
      window.__cube = __mc.mobs.spawnAt(x + 0.5, z + 0.5, 'magma_cube', 55)
      window.__pig = __mc.mobs.spawnAt(x + 0.5, z + 0.5, 'zombified_piglin', 55)
      window.__pigHealth = window.__pig.health
    })
    // The piglin control proves the well actually burns: first tick is
    // immediate on entry, so its health drops within a couple of game seconds.
    await page.waitForFunction(
      () => !__mc.mobs.mobs.includes(window.__pig) || window.__pig.health < window.__pigHealth,
    )
    assert(true, 'control piglin burns in the lava well')
    const cube = await page.evaluate(() => ({
      alive: __mc.mobs.mobs.includes(window.__cube),
      health: window.__cube.health,
      max: __mc.config.COMBAT.mobs.magmaCube.health,
    }))
    assert(cube.alive && cube.health === cube.max, 'magma cube sits in lava at full health')
    await page.evaluate(() => __mc.mobs.clear())
  }

  console.log('nether ambient spawn profile')
  {
    await page.evaluate(() => {
      __mc.mobs.event = false
      __mc.config.COMBAT.mobs.spawnIntervalSeconds = 0.3
      __mc.mobs.spawnTimer = 0.1
    })
    await page.waitForFunction(() => __mc.mobs.count > 0)
    const kinds = await page.evaluate(() =>
      __mc.mobs.mobs.map((m) =>
        m.cfg === __mc.config.COMBAT.mobs.zombifiedPiglin
          ? 'zombified_piglin'
          : m.cfg === __mc.config.COMBAT.mobs.magmaCube
            ? 'magma_cube'
            : 'other',
      ),
    )
    assert(
      kinds.length > 0 && kinds.every((k) => k !== 'other'),
      `nether ambient spawns are piglins/cubes only (${kinds.join(', ')})`,
    )
    await page.evaluate(() => {
      __mc.mobs.event = true
      __mc.mobs.clear()
    })
  }

  console.log('quartz block: craft + place')
  {
    const r = await page.evaluate(() => {
      __mc.inventory.add('quartz', 4)
      const row = __mc.screen.recipeEls.find((e) => e.recipe.id === 'quartz_block')
      row.button.click()
      const crafted = __mc.inventory.countOf('quartz_block') === 1
      const slot = __mc.inventory.slots.findIndex((s) => s?.id === 'quartz_block')
      __mc.inventory.select(slot)
      const p = __mc.player.body.position
      const x = Math.floor(p.x) + 2
      const z = Math.floor(p.z) + 2
      const y = 56
      __mc.world.setBlock(x, y, z, 21)
      __mc.world.setBlock(x, y + 1, z, 0)
      __mc.interaction.target = { x, y, z, normal: [0, 1, 0] }
      const placed = __mc.interaction.placeAtTargeted()
      return { crafted, placed, id: __mc.world.blockAt(x, y + 1, z) }
    })
    assert(r.crafted, '4 quartz craft one quartz block')
    assert(r.placed && r.id === 27, 'quartz block places in the world')
  }

  console.log('netherrack furnace fuel')
  {
    const r = await page.evaluate(() => {
      const state = __mc.furnaces.at(30, 57, 30)
      state.input = { id: 'iron_ore', count: 1 }
      state.fuel = { id: 'netherrack', count: 1 }
      __mc.furnaces.update(1)
      return { lit: state.fuelRemaining > 0, progress: state.progress, fuel: state.fuel }
    })
    assert(
      r.lit && r.progress > 0 && r.fuel === null,
      'netherrack lights the furnace (one consumed, smelt progressing)',
    )
  }

  console.log('overworld regression: night ambient spawns')
  {
    await page.evaluate(() => {
      const y = __mc.dims.overworld.surfaceY(0.5, 0.5)
      __mc.dims.travel('overworld', { x: 0.5, y, z: 0.5 })
      __mc.mobs.event = false
      __mc.daynight.setTime(0.7) // midnight-ish
      __mc.mobs.spawnTimer = 0.1
    })
    await page.waitForFunction(() => __mc.world.chunkReadyAt(0.5, 0.5))
    await page.waitForFunction(() => __mc.mobs.count > 0)
    const kinds = await page.evaluate(() =>
      __mc.mobs.mobs.map((m) =>
        m.cfg === __mc.config.COMBAT.mobs.zombie
          ? 'zombie'
          : m.cfg === __mc.config.COMBAT.mobs.skeleton
            ? 'skeleton'
            : m.cfg === __mc.config.COMBAT.mobs.creeper
              ? 'creeper'
              : 'other',
      ),
    )
    assert(
      kinds.length > 0 && kinds.every((k) => k !== 'other'),
      `overworld night spawns stay zombie/skeleton/creeper (${kinds.join(', ')})`,
    )
    await page.evaluate(() => {
      __mc.mobs.event = true
      __mc.mobs.clear()
      __mc.daynight.setTime(0.25) // back to noon — no dawn-burn noise below
      __mc.health.heal(20)
    })
  }

  console.log('portal round-trip regression')
  {
    await page.evaluate(() => {
      __mc.config.NETHER.portal.chargeSeconds = 0.3
      const zc = 0
      const x0 = 20
      const y0 = __mc.world.surfaceY(21.5, 0.5)
      window.__frame = { x0, y0, zc }
      // 4×5 obsidian ring in the x-plane, interior cleared.
      for (let x = x0; x <= x0 + 3; x++) {
        for (let y = y0; y <= y0 + 4; y++) {
          const interior = x > x0 && x < x0 + 3 && y > y0 && y < y0 + 4
          __mc.world.setBlock(x, y, zc, interior ? 0 : 20)
        }
      }
      window.__lit = __mc.portals.tryIgnite(__mc.world, {
        x: x0 + 1,
        y: y0,
        z: zc,
        normal: [0, 1, 0],
      })
    })
    assert(
      await page.evaluate(() => window.__lit && __mc.dims.overworld.portals.size === 6),
      'flint-strike ignites the frame (6 portal field cells)',
    )
    await page.evaluate(() => {
      const f = window.__frame
      __mc.player.teleport(f.x0 + 1.5, f.y0 + 1, f.zc + 0.5)
    })
    await page.waitForFunction(() => __mc.dims.name === 'nether')
    assert(true, 'standing in the field travels to the Nether')
    const returnPortal = await page.evaluate(() => __mc.dims.nether.portals.size >= 6)
    assert(returnPortal, 'a linked return portal exists on the Nether side')
    // Step out (clearing the justArrived latch), then back into the field.
    await page.evaluate(() => {
      const cell = [...__mc.dims.nether.portals.values()][0]
      const p = __mc.player.body.position
      window.__field = cell
      __mc.player.teleport(p.x + 5, __mc.world.surfaceY(p.x + 5, p.z), p.z)
    })
    await new Promise((r) => setTimeout(r, 1500))
    await page.evaluate(() => {
      const c = window.__field
      __mc.player.teleport(c.x + 0.5, c.y, c.z + 0.5)
    })
    await page.waitForFunction(() => __mc.dims.name === 'overworld')
    const back = await page.evaluate(() => {
      const p = __mc.player.body.position
      return Math.hypot(p.x - 21.5, p.z - 0.5)
    })
    assert(back < 24, `round trip returns beside the origin portal (${back.toFixed(1)} blocks)`)
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
console.log('\nOK: all Nether N5+N4 assertions hold')
