// Headless regression test for fall damage (the 2-block-fall bug).
//
// Root cause pair this suite guards:
//  1. PhysicsBody swept X→Z→Y; horizontal-first moved the box at its
//     pre-drop height, so descending stairs/hillsides never registered a
//     touchdown and fallDistance accumulated across the whole slope — a
//     walk down 4 stairs landed as one 5-block "fall" (2 damage). The sweep
//     is Y-first now (Minecraft's order).
//  2. PlayerControls' damping integrator (accel = speed·k·Δ) overshot the
//     configured speed by kΔ/(1−e^(−kΔ)) — +72% at the clamped 0.1s delta —
//     which made even configured-walk-speed descents ballistic. accel is
//     speed·(1−damp) now, exact at any frame delta.
//
// Covers: straight drops (2/3 safe, 4 → 1, 5 → 2 — MC max(0, blocks−3)),
// jump-hops never register phantom damage, walking off a 2-ledge and down a
// staircase deals nothing, walk speed honors PLAYER.moveSpeed at the clamped
// delta, deep-water landings clear fall distance, the void still kills, and
// fall damage still bypasses armor.
//
// Run:
//   npm run build
//   npm install --no-save puppeteer-core   (not a project dep)
//   node tools/test-fall-damage.mjs
// Exits 0 on pass, 1 on failure.

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const PORT = 4769 // unique strict port for this suite
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
      // Foreign-server guard: parallel worktrees run their own previews.
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
  await page.waitForFunction(() => window.__mc?.world && window.__mc?.player, { timeout: 60000 })
  await page.evaluate(() => {
    const mc = window.__mc
    mc.save.enabled = false
    mc.save.save = () => {} // interval autosave ignores `enabled`
    mc.sounds.unlock()
    mc.player.lock()
    mc.mobs.event = true // no ambient spawns — mob hits must not confound
    mc.hunger.value = mc.hunger.max
    // Record every landing WITHOUT replacing Combat's damage hook.
    const body = mc.player.body
    const prev = body.onLand
    window.__landings = []
    body.onLand = (fell) => {
      window.__landings.push(fell)
      prev?.(fell)
    }
  })
  await page.waitForFunction(
    () => {
      const { world, camera } = window.__mc
      return world.chunkReadyAt(camera.position.x, camera.position.z)
    },
    { timeout: 60000 },
  )

  // Test rigs sit at y=88 (chunkHeight 96), 18+ blocks above the tallest
  // tree canopy near spawn, so natural terrain can never intersect them.
  const rig = await page.evaluate(() => {
    const { world, camera } = window.__mc
    const bx = Math.floor(camera.position.x) - 40
    const bz = Math.floor(camera.position.z) - 40
    const y = 88 // platform block layer; standing surface is y+1
    // pad for straight drops
    for (let x = bx; x < bx + 3; x++)
      for (let z = bz; z < bz + 3; z++) world.setBlock(x, y, z, 3)
    // ledge rig: upper 4x3, then a floor two blocks down
    for (let x = bx + 8; x < bx + 12; x++)
      for (let z = bz; z < bz + 3; z++) world.setBlock(x, y, z, 3)
    for (let x = bx + 12; x < bx + 18; x++)
      for (let z = bz; z < bz + 3; z++) world.setBlock(x, y - 2, z, 3)
    // staircase rig: launch pad, 4 one-block steps down, runout
    for (let x = bx + 24; x < bx + 28; x++)
      for (let z = bz; z < bz + 3; z++) world.setBlock(x, y, z, 3)
    for (let i = 0; i < 4; i++)
      for (let z = bz; z < bz + 3; z++) world.setBlock(bx + 28 + i, y - 1 - i, z, 3)
    for (let x = bx + 32; x < bx + 40; x++)
      for (let z = bz; z < bz + 3; z++) world.setBlock(x, y - 5, z, 3)
    // water pool rig: 3x3 basin, 4 deep (floor + walls hold the water)
    const wy = y - 6
    for (let x = bx + 44; x < bx + 49; x++)
      for (let z = bz - 1; z < bz + 4; z++) world.setBlock(x, wy, z, 3)
    for (let x = bx + 44; x < bx + 49; x++)
      for (let z = bz - 1; z < bz + 4; z++)
        for (let dy = 1; dy <= 4; dy++) {
          const inner = x > bx + 44 && x < bx + 48 && z > bz - 1 && z < bz + 3
          world.setBlock(x, wy + dy, z, inner ? 9 : 3)
        }
    return { bx, bz, y }
  })

  // Drop the body a true N-block fall: start from the standing height
  // (surface + the physics EPS) plus N, plus a hair (0.05) so the measured
  // fall sits safely past the integer boundary instead of ON it — floor()
  // at an exact integer would flip on 1e-12 float noise.
  const drop = (n) =>
    page.evaluate(
      ({ bx, bz, y }, n) => {
        const mc = window.__mc
        mc.health.value = mc.health.max
        window.__landings = []
        mc.player.teleport(bx + 1.5, y + 1.001 + n + 0.05, bz + 1.5)
        return new Promise((resolve) => {
          const t = setInterval(() => {
            if (mc.player.body.grounded) {
              clearInterval(t)
              resolve({
                landings: window.__landings.map((f) => +f.toFixed(3)),
                damage: mc.health.max - mc.health.value,
              })
            }
          }, 50)
        })
      },
      rig,
      n,
    )

  console.log('\n[A] straight drops: MC max(0, blocks - 3)')
  for (const [n, want] of [
    [2, 0],
    [3, 0],
    [4, 1],
    [5, 2],
    [10, 7],
  ]) {
    const r = await drop(n)
    assert(
      r.damage === want,
      `${n}-block fall deals ${want} (got ${r.damage}, landed ${JSON.stringify(r.landings)})`,
    )
  }

  console.log('\n[B] jump-hops on flat ground: no phantom fall damage')
  await page.evaluate(({ bx, bz, y }) => {
    const mc = window.__mc
    mc.health.value = mc.health.max
    mc.player.teleport(bx + 1.5, y + 1.001, bz + 1.5)
    window.__landings = []
  }, rig)
  await page.keyboard.down('Space')
  await page.waitForFunction(() => window.__landings.length >= 3, { timeout: 90000 })
  await page.keyboard.up('Space')
  const hops = await page.evaluate(() => ({
    landings: window.__landings.map((f) => +f.toFixed(2)),
    damage: window.__mc.health.max - window.__mc.health.value,
  }))
  assert(
    hops.damage === 0 && hops.landings.every((f) => f < 1.5),
    `3 hops, zero damage, apex-sized landings (${JSON.stringify(hops)})`,
  )

  // Real-input traversal: face +x (W walks toward +x) for both walk rigs.
  const faceX = () =>
    page.evaluate(() => {
      const cam = window.__mc.camera
      cam.rotation.order = 'YXZ'
      cam.rotation.set(0, -Math.PI / 2, 0)
    })

  console.log('\n[C] walk (W) off a 2-block ledge: one 2-block landing, no damage')
  await page.evaluate(({ bx, bz, y }) => {
    const mc = window.__mc
    mc.health.value = mc.health.max
    mc.player.teleport(bx + 9.5, y + 1.001, bz + 1.5)
    window.__landings = []
  }, rig)
  await faceX()
  await page.keyboard.down('KeyW')
  await page.waitForFunction(
    ({ bx, y }) => {
      const p = window.__mc.player.body
      return p.position.x > bx + 13 && p.position.y < y - 0.5 && p.grounded
    },
    { timeout: 90000 },
    rig,
  )
  await page.keyboard.up('KeyW')
  const ledge = await page.evaluate(() => ({
    landings: window.__landings.map((f) => +f.toFixed(2)),
    damage: window.__mc.health.max - window.__mc.health.value,
  }))
  assert(
    ledge.damage === 0 && ledge.landings.length === 1 && Math.abs(ledge.landings[0] - 2) < 0.1,
    `walk-off lands once at ~2 blocks, zero damage (${JSON.stringify(ledge)})`,
  )

  console.log('\n[D] walk (W) down a 4-step staircase: touches down, no accumulation')
  await page.evaluate(({ bx, bz, y }) => {
    const mc = window.__mc
    mc.health.value = mc.health.max
    mc.player.teleport(bx + 24.5, y + 1.001, bz + 1.5)
    window.__landings = []
  }, rig)
  await faceX()
  await page.keyboard.down('KeyW')
  await page.waitForFunction(
    ({ bx }) => {
      const p = window.__mc.player.body
      return p.position.x > bx + 34 && p.grounded
    },
    { timeout: 90000 },
    rig,
  )
  await page.keyboard.up('KeyW')
  const stairs = await page.evaluate(() => ({
    landings: window.__landings.map((f) => +f.toFixed(2)),
    damage: window.__mc.health.max - window.__mc.health.value,
    speed: window.__mc.player.body.velocity
      ? Math.hypot(window.__mc.player.body.velocity.x, window.__mc.player.body.velocity.z)
      : 0,
  }))
  assert(
    stairs.damage === 0,
    `staircase descent deals zero damage (landings ${JSON.stringify(stairs.landings)})`,
  )
  assert(
    stairs.landings.every((f) => f <= 3.05),
    `every touchdown within the 3-block grace (${JSON.stringify(stairs.landings)})`,
  )

  console.log('\n[E] walk speed honors PLAYER.moveSpeed at the clamped delta')
  // The old integrator ran configured walk 5 at ~8.6 under the headless
  // 0.1s delta clamp — the speed that made descents ballistic.
  await page.evaluate(({ bx, bz, y }) => {
    window.__mc.player.teleport(bx + 24.5, y + 1.001, bz + 1.5)
  }, rig)
  await faceX()
  await page.keyboard.down('KeyW')
  const speed = await page.evaluate(async () => {
    const body = window.__mc.player.body
    // sample cruise speed over a few frames once ramped up
    await new Promise((r) => setTimeout(r, 800))
    let peak = 0
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      peak = Math.max(peak, Math.hypot(body.velocity.x, body.velocity.z))
    }
    return peak
  })
  await page.keyboard.up('KeyW')
  assert(
    speed > 3.5 && speed < 5.3,
    `cruise walk speed ~= configured 5 at clamped delta (got ${speed.toFixed(2)})`,
  )

  console.log('\n[F] deep-water landing clears fall distance: no damage')
  const splash = await page.evaluate(({ bx, bz, y }) => {
    const mc = window.__mc
    mc.health.value = mc.health.max
    window.__landings = []
    // 10 blocks above the pool surface — lethal on land (7 damage)
    mc.player.teleport(bx + 46.5, y - 1 + 10, bz + 1.5)
    return new Promise((resolve) => {
      const t = setInterval(() => {
        if (mc.player.body.inWater) {
          clearInterval(t)
          resolve({
            damage: mc.health.max - mc.health.value,
            fallDistance: mc.player.body.fallDistance,
          })
        }
      }, 50)
    })
  }, rig)
  assert(
    splash.damage === 0 && splash.fallDistance === 0,
    `10-block plunge into 3-deep water: zero damage, fallDistance cleared (${JSON.stringify(splash)})`,
  )

  console.log('\n[G] armor bypass: fall damage ignores equipped armor')
  const armored = await page.evaluate(
    ({ bx, bz, y }) =>
      new Promise((resolve) => {
        const mc = window.__mc
        mc.health.value = mc.health.max
        mc.armor.setSlot('chest', { id: 'iron_chestplate', durability: 192 })
        mc.armor.setSlot('head', { id: 'iron_helmet', durability: 192 })
        mc.player.teleport(bx + 1.5, y + 1.001 + 5 + 0.05, bz + 1.5)
        const t = setInterval(() => {
          if (mc.player.body.grounded) {
            clearInterval(t)
            const out = {
              damage: mc.health.max - mc.health.value,
              chestDurability: mc.armor.slots.chest?.durability,
            }
            mc.armor.setSlot('chest', null)
            mc.armor.setSlot('head', null)
            resolve(out)
          }
        }, 50)
      }),
    rig,
  )
  assert(
    armored.damage === 2,
    `5-block fall in iron armor still deals the full 2 (got ${armored.damage})`,
  )
  assert(
    armored.chestDurability === 192,
    `armor took no wear from the fall (durability ${armored.chestDurability})`,
  )

  console.log('\n[H] the void is still lethal')
  const voided = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const mc = window.__mc
        mc.health.value = mc.health.max
        mc.player.teleport(0.5, -20, 0.5) // below PHYSICS.voidY
        const t = setInterval(() => {
          if (mc.health.isDead) {
            clearInterval(t)
            resolve(true)
          }
        }, 50)
        setTimeout(() => {
          clearInterval(t)
          resolve(false)
        }, 30000)
      }),
  )
  assert(voided, 'teleport below voidY kills the player')

  const errs = consoleErrors.filter((e) => !e.includes('WebGL')) // swiftshader noise
  assert(errs.length === 0, `no console errors (${errs.length ? errs.join(' | ') : 'clean'})`)
} catch (err) {
  console.error('FATAL', err)
  failures++
} finally {
  await browser.close()
  preview.kill()
}

console.log(failures ? `\n${failures} failure(s)` : '\nall fall-damage tests passed')
process.exit(failures ? 1 : 0)
