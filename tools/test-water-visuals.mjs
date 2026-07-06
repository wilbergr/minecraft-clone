// Headless verification for the water-visuals polish (post-deep-water):
// the animated water surface (opacity shimmer — uniform-only, no remesh)
// and rising bubbles via the particle pool's per-burst gravityScale.
//
// Covers: waterMaterial.opacity oscillates around WATER.opacity across
// frames; a default burst still falls (gravityScale 1 untouched); bubble
// bursts rise (y increases frame over frame); the ambient underwater
// emitter fires; chunk geometry is NOT remeshed by the shimmer (attribute
// version stable); deep-water regressions (breath drain, submerged fog,
// water tint) still hold; zero console errors. Writes a screenshot next to
// this script (water-visuals.png; git-ignored artifact).
//
// Run:
//   npm run build
//   npm install --no-save puppeteer-core   (not a project dep)
//   node tools/test-water-visuals.mjs
// Exits 0 on pass, 1 on failure. Software WebGL runs game time at ~0.3x real
// time — everything waits on waitForFunction, never fixed sleeps.

import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const PORT = 4742 // unique strict port for this suite
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

  console.log('— animated water surface (opacity shimmer)')
  // Sample the material opacity across frames; the ~4s sine period runs on
  // REAL time, so a handful of spaced samples must show movement both above
  // and below rest. Uniform write only — no geometry involvement.
  const shimmer = await page.evaluate(async () => {
    const base = __mc.config.WATER.opacity
    const amp = __mc.config.WATER.shimmer.amplitude
    const samples = []
    for (let i = 0; i < 12; i++) {
      samples.push(__mc.world.waterMaterial.opacity)
      await new Promise((r) => setTimeout(r, 400))
    }
    return { base, amp, min: Math.min(...samples), max: Math.max(...samples) }
  })
  assert(shimmer.max - shimmer.min > shimmer.amp * 0.6, 'opacity oscillates over time')
  assert(
    shimmer.min >= shimmer.base - shimmer.amp - 1e-6 &&
      shimmer.max <= shimmer.base + shimmer.amp + 1e-6,
    'opacity stays within ±amplitude of WATER.opacity',
  )

  console.log('— no per-frame remesh (chunk geometry stable under the shimmer)')
  const remesh = await page.evaluate(async () => {
    const chunk = [...__mc.world.chunks.values()].find((c) => c.mesh)
    const attr = chunk.mesh.geometry.getAttribute('position')
    const before = attr.version
    const opacityBefore = __mc.world.waterMaterial.opacity
    await new Promise((r) => setTimeout(r, 1500))
    return {
      versionStable: attr.version === before,
      opacityMoved: __mc.world.waterMaterial.opacity !== opacityBefore,
    }
  })
  assert(remesh.versionStable, 'chunk position attribute version unchanged across frames')
  assert(remesh.opacityMoved, 'opacity kept animating while geometry stayed put')

  console.log('— per-slot gravity: default bursts still fall')
  const fall = await page.evaluate(async () => {
    const p = __mc.particles
    const slot = p.cursor
    p.burst(0, 120, 0, 0xffffff, 1) // classic debris call, no opts
    const scale = p.gravityScale[slot]
    const vy0 = p.velocities[slot * 3 + 1]
    // Two frames ≈ 1-2 particle updates headless; life (≥0.33s) survives it.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const vy = p.velocities[slot * 3 + 1]
    return { scale, vy0, vy, alive: p.life[slot] > 0 }
  })
  assert(fall.scale === 1, 'default burst gets gravityScale 1')
  assert(fall.alive && fall.vy < fall.vy0, 'default burst velocity pulled downward (gravity applied)')

  console.log('— per-slot gravity: bubble bursts rise')
  const rise = await page.evaluate(async () => {
    const p = __mc.particles
    const b = __mc.config.WATER.bubbles
    const slot = p.cursor
    p.burst(0, 120, 0, b.color, 1, {
      gravityScale: b.gravityScale,
      speed: 0, // isolate buoyancy from the random scatter
      lifetimeSeconds: 5,
    })
    const y0 = p.positions[slot * 3 + 1]
    const ys = [y0]
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      ys.push(p.positions[slot * 3 + 1])
    }
    return { scale: p.gravityScale[slot], ys }
  })
  assert(rise.scale < 0, 'bubble burst stores negative gravityScale')
  assert(
    rise.ys[rise.ys.length - 1] > rise.ys[0] &&
      rise.ys.every((y, i) => i === 0 || y >= rise.ys[i - 1]),
    `bubble y rises monotonically (${rise.ys.map((y) => y.toFixed(3)).join(' → ')})`,
  )

  console.log('— underwater: ambient bubbles + deep-water regressions')
  // Find real generated sea water near spawn (pure blockAt answers unloaded
  // chunks), then sink the camera into it.
  const spot = await page.evaluate(() => {
    const w = __mc.world
    for (let r = 8; r < 400; r += 4) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r)
        const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r)
        // Water down to y 53 ⇒ seabed ≤ 52, so a body dropped at 54 sinks
        // and the camera cell stays water all the way to the floor.
        if (w.blockAt(x, 56, z) === 9 && w.blockAt(x, 53, z) === 9) return { x, z }
      }
    }
    return null
  })
  assert(spot, `found a sea column at ${spot && `(${spot.x}, ${spot.z})`}`)
  const under = await page.evaluate(async ({ x, z }) => {
    const p = __mc.particles
    // Live buoyant slots from earlier tests must not count as underwater
    // emissions — snapshot them as an exclusion set (ring-buffer reuse
    // within this window is impossible at these emission rates).
    const negSlots = () => {
      const out = []
      for (let i = 0; i < p.gravityScale.length; i++) {
        if (p.life[i] > 0 && p.gravityScale[i] < 0) out.push(i)
      }
      return out
    }
    const excluded = new Set(negSlots())
    const freshNeg = () => negSlots().find((i) => !excluded.has(i)) ?? -1
    const nextFrame = () => new Promise((r) => requestAnimationFrame(r))

    __mc.player.teleport(x + 0.5, 54, z + 0.5) // camera ~55.6 → cell 55, water
    const breathBefore = __mc.breath.value
    // Wait for the submerged flag to take (tint visible + fog pulled in).
    let deadline = performance.now() + 60_000
    while (performance.now() < deadline) {
      const tintOn = !document.getElementById('water-tint').classList.contains('hidden')
      if (tintOn && __mc.scene.fog.near === __mc.config.WATER.fog.near) break
      await nextFrame()
    }
    // Phase A — the entry burst's rising bubbles (fired on the transition).
    deadline = performance.now() + 60_000
    let entrySlot = -1
    while (performance.now() < deadline && entrySlot < 0) {
      entrySlot = freshNeg()
      if (entrySlot < 0) await nextFrame()
    }
    let entryRose = false
    if (entrySlot >= 0) {
      const y0 = p.positions[entrySlot * 3 + 1]
      for (let i = 0; i < 6 && p.life[entrySlot] > 0; i++) await nextFrame()
      entryRose = p.positions[entrySlot * 3 + 1] > y0
    }
    // Phase B — the ambient emitter: exclude everything live now, then wait
    // for a brand-new buoyant slot (the throttled per-interval emission).
    negSlots().forEach((i) => excluded.add(i))
    deadline = performance.now() + 60_000
    let ambientSlot = -1
    while (performance.now() < deadline && ambientSlot < 0) {
      ambientSlot = freshNeg()
      if (ambientSlot < 0) await nextFrame()
    }
    return {
      tintOn: !document.getElementById('water-tint').classList.contains('hidden'),
      fogNear: __mc.scene.fog.near,
      fogWant: __mc.config.WATER.fog.near,
      breathBefore,
      breathAfter: __mc.breath.value,
      splashes: __mc.sounds.stats.byName.splash ?? 0,
      entryEmitted: entrySlot >= 0,
      entryRose,
      ambientEmitted: ambientSlot >= 0,
    }
  }, spot)
  assert(under.tintOn, 'water tint visible while submerged')
  assert(under.fogNear === under.fogWant, 'submerged fog near matches WATER.fog.near')
  assert(under.breathAfter < under.breathBefore, 'breath drains underwater')
  assert(under.splashes > 0, 'splash fired on entry')
  assert(under.entryEmitted && under.entryRose, 'entry bubbles emitted and rose')
  assert(under.ambientEmitted, 'ambient bubble emitter fired while submerged')

  await page.screenshot({ path: join(HERE, 'water-visuals.png') })
  console.log('  screenshot: tools/water-visuals.png')

  assert(consoleErrors.length === 0, `zero console errors (${consoleErrors.join(' | ')})`)
} finally {
  await browser.close()
  preview.kill()
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nall water-visuals checks passed')
