// Headless verification for procedural mob skins (src/combat/mobSkins.js).
//
// Covers: the `typeof document` guard (node import returns null and the
// flat-color fallback still constructs mobs); every skinned mob type builds
// with a TEXTURED (mapped) material; per-type sharing (all zombies ride ONE
// material + one geometry set — material count stays constant as the horde
// grows); the creeper's per-mob clone still sharing the type texture; hurt
// flash isolation (a hit zombie swaps to the flash material without touching
// its neighbors, and swaps back); the magma cube's baked-eyes single mesh;
// combat + ambient spawning unaffected; and zero console errors. Writes
// screenshot artifacts mob-textures-overworld.png (zombie/skeleton/creeper/
// drowned + the passives) and mob-textures-nether.png (piglin + magma cube).
//
// Run:
//   npm run build
//   npm install --no-save puppeteer-core   (not a project dep)
//   node tools/test-mob-textures.mjs
// Exits 0 on pass, 1 on failure. Software WebGL runs game time at ~0.3x real
// time — assertions wait on waitForFunction, never fixed sleeps.

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const PORT = 4757 // unique strict port for this suite
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

console.log('node-side document guard')
{
  const { mobSkin } = await import('../src/combat/mobSkins.js')
  assert(mobSkin('zombie') === null, 'mobSkin() returns null without a DOM')
  const { World } = await import('../src/world/World.js')
  const { Zombie } = await import('../src/combat/Zombie.js')
  const z = new Zombie(new World({ add() {} }), 0.5, 0.5)
  assert(
    z.group.children.length === 6 && z.materials.skin && !z.materials.skin.map,
    'node fallback still builds the flat-color zombie',
  )
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
  page.setDefaultTimeout(90_000)
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
    __mc.mobs.event = true // suppress ambient spawns while tests direct-spawn
    __mc.daynight.setTime(0.25) // noon — no dawn-burn noise, lit screenshots
  })

  console.log('every mob type builds textured')
  {
    const r = await page.evaluate(() => {
      const report = {}
      const skinned = ['zombie', 'skeleton', 'drowned', 'zombified_piglin', 'magma_cube']
      window.__menagerie = {}
      skinned.forEach((kind, i) => {
        const m = __mc.mobs.spawnAt(30.5 + i * 4, 30.5, kind)
        window.__menagerie[kind] = m
        report[kind] = {
          parts: m.skinMeshes.length,
          allMapped: m.skinMeshes.every((mesh) => !!mesh.material.map),
          clones: Object.keys(m.materials).length, // 0 = fully on the shared set
        }
      })
      const creeper = __mc.mobs.spawnAt(50.5, 30.5, 'creeper')
      window.__menagerie.creeper = creeper
      report.creeper = {
        parts: creeper.group.children.length,
        mapped: !!creeper.materials.skin?.map,
        cloned: creeper.skinMeshes.length === 0,
      }
      for (const kind of ['pig', 'cow', 'sheep']) {
        const m = __mc.mobs.spawnPassiveAt(54.5, 30.5, kind)
        window.__menagerie[kind] = m
        report[kind] = {
          parts: m.skinMeshes.length,
          allMapped: m.skinMeshes.every((mesh) => !!mesh.material.map),
        }
      }
      return report
    })
    for (const kind of ['zombie', 'skeleton', 'drowned', 'zombified_piglin']) {
      assert(
        r[kind].parts === 6 && r[kind].allMapped && r[kind].clones === 0,
        `${kind}: 6 skinned parts, all on a mapped shared material`,
      )
    }
    assert(
      r.magma_cube.parts === 1 && r.magma_cube.allMapped,
      'magma cube: ONE mesh (eyes baked into the face tile), mapped',
    )
    assert(
      r.creeper.parts === 6 && r.creeper.mapped && r.creeper.cloned,
      'creeper: 6 parts on a per-mob CLONE with the shared texture (fuse pulse)',
    )
    for (const kind of ['pig', 'cow', 'sheep']) {
      assert(
        r[kind].parts === 6 && r[kind].allMapped,
        `${kind}: 6 skinned parts, all mapped`,
      )
    }
  }

  console.log('shared-per-type caching stays bounded')
  {
    const r = await page.evaluate(() => {
      const collect = (zs) => {
        const mats = new Set()
        const geos = new Set()
        zs.forEach((z) => z.skinMeshes.forEach((mesh) => (mats.add(mesh.material), geos.add(mesh.geometry))))
        return { mats: mats.size, geos: geos.size }
      }
      const zombies = [window.__menagerie.zombie]
      for (let i = 0; i < 3; i++) zombies.push(__mc.mobs.spawnAt(30.5 + i * 2, 40.5, 'zombie'))
      const at4 = collect(zombies)
      for (let i = 0; i < 4; i++) zombies.push(__mc.mobs.spawnAt(30.5 + i * 2, 44.5, 'zombie'))
      const at8 = collect(zombies)
      window.__zombies = zombies
      const creeper2 = __mc.mobs.spawnAt(52.5, 30.5, 'creeper')
      return {
        at4,
        at8,
        // 3 distinct part geometries (head/body/limb+arm... head, body, limb, arm = 4)
        crossType:
          window.__menagerie.zombie.skinMeshes[0].material !==
          window.__menagerie.skeleton.skinMeshes[0].material,
        variantSheets:
          window.__menagerie.zombie.skinMeshes[0].material.map !==
          window.__menagerie.drowned.skinMeshes[0].material.map,
        creeperTexShared:
          creeper2.materials.skin.map === window.__menagerie.creeper.materials.skin.map,
        creeperMatCloned:
          creeper2.materials.skin !== window.__menagerie.creeper.materials.skin,
      }
    })
    assert(
      r.at4.mats === 1 && r.at8.mats === 1,
      `zombie horde shares ONE material (4 mobs: ${r.at4.mats}, 8 mobs: ${r.at8.mats})`,
    )
    assert(
      r.at4.geos === 4 && r.at8.geos === 4,
      `zombie horde shares the 4 part geometries (4 mobs: ${r.at4.geos}, 8 mobs: ${r.at8.geos})`,
    )
    assert(r.crossType, 'zombie and skeleton materials are distinct (per-type sheets)')
    assert(r.variantSheets, 'drowned variant gets its own sheet, not the zombie one')
    assert(
      r.creeperTexShared && r.creeperMatCloned,
      'two creepers: cloned materials, ONE shared texture',
    )
  }

  console.log('hurt flash: material swap, isolated per mob')
  {
    const before = await page.evaluate(() => {
      const [a, b] = [window.__zombies[1], window.__zombies[2]]
      window.__flashA = a
      window.__flashB = b
      __mc.mobs.hit(a, 1, { x: 1, y: 0, z: 0 })
      return {
        aFlashing: a.skinMeshes.every((mesh) => mesh.material === a.skinDef.flashMaterial),
        bUntouched: b.skinMeshes.every((mesh) => mesh.material === b.skinDef.material),
        flashIsRed: a.skinMeshes[0].material.emissive.getHex() === 0x8a1a1a,
        flashSharesMap: a.skinDef.flashMaterial.map === a.skinDef.material.map,
      }
    })
    assert(before.aFlashing, 'hit zombie swaps to the shared flash material')
    assert(before.bUntouched, 'neighbor zombie stays on the normal material')
    assert(before.flashIsRed && before.flashSharesMap, 'flash material: red emissive, same texture')
    await page.waitForFunction(() =>
      window.__flashA.skinMeshes.every(
        (mesh) => mesh.material === window.__flashA.skinDef.material,
      ),
    )
    assert(true, 'flash expires back to the shared material')
  }

  console.log('behavior spot-check: melee still lands')
  {
    await page.evaluate(() => {
      __mc.mobs.clear()
      const y = __mc.world.surfaceY(0.5, 0.5)
      __mc.player.teleport(0.5, y, 0.5)
      window.__biter = __mc.mobs.spawnAt(2.5, 0.5, 'zombie')
    })
    await page.waitForFunction(() => __mc.health.value < 20)
    assert(true, 'textured zombie still chases and damages the player')
    await page.evaluate(() => {
      __mc.mobs.clear()
      __mc.health.heal(20)
    })
  }

  console.log('behavior spot-check: ambient night spawns are skinned')
  {
    await page.evaluate(() => {
      __mc.mobs.event = false
      __mc.daynight.setTime(0.7)
      __mc.config.COMBAT.mobs.spawnIntervalSeconds = 0.3
      __mc.mobs.spawnTimer = 0.1
    })
    await page.waitForFunction(() => __mc.mobs.count > 0)
    const r = await page.evaluate(() =>
      __mc.mobs.mobs.map(
        (m) => m.skinMeshes.every((mesh) => !!mesh.material.map) && (m.skinMeshes.length > 0 || !!m.materials.skin?.map),
      ),
    )
    assert(
      r.length > 0 && r.every(Boolean),
      `ambient spawner still works and its mobs are textured (${r.length} spawned)`,
    )
    await page.evaluate(() => {
      __mc.mobs.event = true
      __mc.mobs.clear()
      __mc.daynight.setTime(0.25)
      __mc.health.heal(20)
    })
  }

  console.log('screenshot: overworld lineup')
  {
    await page.evaluate(() => {
      // Freeze feet so the pose holds through the render frames (cfg objects
      // are live references).
      const c = __mc.config.COMBAT.mobs
      for (const k of ['zombie', 'skeleton', 'creeper', 'drowned']) {
        c[k].chaseSpeed = 0
        c[k].wanderSpeed = 0
      }
      c.skeleton.speed = 0
      __mc.config.PASSIVE_MOBS.wanderSpeed = 0
      __mc.inventory.select(8) // empty hand keeps the viewmodel out of frame
      __mc.camera.quaternion.set(0, 0, 0, 1) // face straight down -z
      const y = 70
      for (let x = -5; x <= 5; x++) {
        for (let z = -9; z <= 1; z++) {
          __mc.world.setBlock(x, y - 1, z, 1)
          for (let dy = 0; dy <= 3; dy++) __mc.world.setBlock(x, y + dy, z, 0)
        }
      }
      __mc.player.teleport(0.5, y, 0.5)
      const pose = [
        ['zombie', -3.2, -4.5],
        ['skeleton', -1.4, -5.5],
        ['creeper', 0.4, -6.5], // beyond fuseRange 3
        ['drowned', 2.2, -5],
      ]
      for (const [kind, x, z] of pose) {
        const m = __mc.mobs.spawnAt(x, z, kind)
        m.group.position.set(x, y, z)
        m.wanderTimer = 999
        m.wanderDir = null
        if ('shootTimer' in m) m.shootTimer = 999 // no arrows in the shot
      }
      for (const [kind, x, z] of [
        ['pig', -4.5, -7],
        ['cow', 4, -7.5],
        ['sheep', 3.8, -3.5],
      ]) {
        const m = __mc.mobs.spawnPassiveAt(x, z, kind)
        m.group.position.set(x, y, z)
        m.wanderTimer = 999
        m.wanderDir = null
      }
      __mc.scene.updateMatrixWorld(true)
    })
    await new Promise((r) => setTimeout(r, 2500)) // let a few frames render
    await page.screenshot({ path: join(HERE, 'mob-textures-overworld.png') })
    console.log('  wrote tools/mob-textures-overworld.png')
    await page.evaluate(() => __mc.mobs.clear())
  }

  console.log('screenshot: Nether pair (third-dimension check)')
  {
    await page.evaluate(() => {
      __mc.dims.travel('nether', { x: 0.5, y: 57, z: 0.5 })
    })
    await page.waitForFunction(() => __mc.world.chunkReadyAt(0.5, 0.5))
    const r = await page.evaluate(() => {
      __mc.mobs.event = true // travel reset nothing, but be explicit
      __mc.config.COMBAT.mobs.zombifiedPiglin.wanderSpeed = 0
      __mc.config.COMBAT.mobs.zombifiedPiglin.chaseSpeed = 0
      __mc.camera.quaternion.set(0, 0, 0, 1)
      for (let x = -3; x <= 3; x++) {
        for (let z = -8; z <= 0; z++) {
          __mc.world.setBlock(x, 56, z, 21)
          for (let y = 57; y <= 60; y++) __mc.world.setBlock(x, y, z, 0)
        }
      }
      __mc.world.setBlock(2, 57, -2, 23) // glowstone lamp so the shot reads
      __mc.player.teleport(0.5, 57, 0.5)
      const pig = __mc.mobs.spawnAt(-1.3, -4.2, 'zombified_piglin')
      pig.group.position.y = 57
      pig.wanderTimer = 999
      pig.wanderDir = null
      const cube = __mc.mobs.spawnAt(1.4, -3, 'magma_cube')
      cube.group.position.y = 57
      cube.hopTimer = 999
      __mc.scene.updateMatrixWorld(true)
      return {
        pigMapped: pig.skinMeshes.every((mesh) => !!mesh.material.map),
        cubeMapped: cube.skinMeshes.every((mesh) => !!mesh.material.map),
        cubeWarm: cube.skinDef.material.emissive.getHex() !== 0,
      }
    })
    assert(
      r.pigMapped && r.cubeMapped,
      'piglin + magma cube render textured in the Nether',
    )
    assert(r.cubeWarm, 'magma cube base material carries the warm crust emissive')
    await new Promise((r) => setTimeout(r, 2500))
    await page.screenshot({ path: join(HERE, 'mob-textures-nether.png') })
    console.log('  wrote tools/mob-textures-nether.png')
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
console.log('\nOK: all mob-texture assertions hold')
