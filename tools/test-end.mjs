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
    // The dragon fight is E4's business — latch it defeated for now so the
    // dimension checks (esp. mobs.count === 0) see a quiet island.
    await page.evaluate(() => {
      __mc.endProgress.dragonDefeated = true
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

  console.log('E2: the End portal')
  {
    // Craft one frame through the real recipe row; the other 11 are given
    // directly (the recipe math is the thing under test, not clicking 12x).
    const crafted = await page.evaluate(() => {
      __mc.inventory.add('obsidian', 2)
      __mc.inventory.add('quartz_block', 2)
      __mc.inventory.add('diamond', 1)
      const row = __mc.screen.recipeEls.find((e) => e.recipe.id === 'end_portal_frame')
      row.button.click()
      return {
        frames: __mc.inventory.countOf('end_portal_frame'),
        leftovers:
          __mc.inventory.countOf('obsidian') +
          __mc.inventory.countOf('quartz_block') +
          __mc.inventory.countOf('diamond'),
      }
    })
    assert(crafted.frames === 1, 'frame crafts from 2 obsidian + 2 quartz block + 1 diamond')
    assert(crafted.leftovers === 0, 'crafting consumed the exact inputs')

    // Lay the ring floating at y 80 (guaranteed air): a 3×3 obsidian slab
    // under the interior for footing, 11 frames via setBlock, and the 12th
    // through the real placement path — the moment it lands, the ring must
    // self-activate.
    const ring = await page.evaluate(() => {
      const w = __mc.world // the overworld
      const p = __mc.player.body.position
      const ax = Math.floor(p.x) + 6
      const az = Math.floor(p.z) + 6
      const y = 80
      window.__ring = { ax, az, y }
      for (let u = 0; u < 3; u++) {
        for (let v = 0; v < 3; v++) w.setBlock(ax + u, y - 1, az + v, 20) // footing slab
      }
      const cells = []
      for (let i = 0; i < 3; i++) {
        cells.push([ax + i, az - 1], [ax + i, az + 3], [ax - 1, az + i], [ax + 3, az + i])
      }
      const last = cells.pop()
      for (const [x, z] of cells) w.setBlock(x, y, z, 30)
      const before = w.endPortals.size // must still be 0 — ring incomplete
      // Support under the final frame, then place it for real.
      w.setBlock(last[0], y - 1, last[1], 20)
      const slot = __mc.inventory.slots.findIndex((s) => s?.id === 'end_portal_frame')
      __mc.inventory.select(slot)
      __mc.interaction.target = { x: last[0], y: y - 1, z: last[1], normal: [0, 1, 0] }
      const placed = __mc.interaction.placeAtTargeted()
      return { before, placed, fields: w.endPortals.size }
    })
    assert(ring.before === 0, 'incomplete ring stays inert')
    assert(ring.placed, 'the 12th frame places through the normal path')
    assert(ring.fields === 9, 'completed ring self-activates (9 field cells)')
    const openSound = await page.evaluate(() => __mc.sounds.stats.byName.endPortalOpen ?? 0)
    assert(openSound >= 1, 'endPortalOpen voice fired')
    await page.waitForFunction(() => __mc.endPortalPanels.count === 9)
    assert(true, '9 horizontal field panels render')

    // Registry rebuild (load path): a serialize->deserialize round trip of
    // the edit overlay recovers the field cells with no save key.
    const rebuilt = await page.evaluate(() => {
      const w = __mc.world
      w.deserializeEdits(JSON.parse(JSON.stringify(w.serializeEdits())))
      return w.endPortals.size
    })
    assert(rebuilt === 9, 'field registry rebuilds from the edit overlay')

    // Stand on the field: the feet-cell charge loop travels to the End.
    await page.evaluate(() => {
      __mc.config.END.portal.chargeSeconds = 0.4
      const { ax, az, y } = window.__ring
      __mc.player.teleport(ax + 1.5, y, az + 1.5)
    })
    await page.waitForFunction(() => __mc.dims.name === 'end', { timeout: 60_000 })
    assert(true, 'standing on the field travels to the End')
    await page.waitForFunction(() => __mc.world.chunkReadyAt(0, 36))
    const arrival = await page.evaluate(() => {
      const a = __mc.config.END.arrival
      const end = __mc.dims.end
      const feet = __mc.player.body.position
      return {
        platform: end.blockAt(a.x, 61, a.z) === 20 && end.blockAt(a.x - 2, 61, a.z + 2) === 20,
        nearArrival: Math.hypot(feet.x - (a.x + 0.5), feet.z - (a.z + 0.5)) < 2,
        noReturnField: end.endPortals.size === 0,
        charges: __mc.endPortal.travelCount,
      }
    })
    assert(arrival.platform, '5×5 obsidian arrival platform stamped')
    assert(arrival.nearArrival, 'feet land on the arrival platform')
    assert(arrival.noReturnField, 'no End-side return field — one-way until victory')

    // Direction keying: an End-side ring (standing in for E4's exit portal)
    // routes HOME. Built via setBlock — the detector watches both worlds.
    await page.evaluate(() => {
      const end = __mc.dims.end
      const ax = 8
      const az = 30
      const y = 70
      for (let u = 0; u < 3; u++) {
        for (let v = 0; v < 3; v++) end.setBlock(ax + u, y - 1, az + v, 20)
      }
      for (let i = 0; i < 3; i++) {
        for (const [x, z] of [[ax + i, az - 1], [ax + i, az + 3], [ax - 1, az + i], [ax + 3, az + i]]) {
          end.setBlock(x, y, z, 30)
        }
      }
      window.__endRing = { ax, az, y }
    })
    const endField = await page.evaluate(() => __mc.dims.end.endPortals.size)
    assert(endField === 9, 'End-side ring activates too (the exit-portal path)')
    await page.evaluate(() => {
      const { ax, az, y } = window.__endRing
      __mc.player.teleport(ax + 1.5, y, az + 1.5)
    })
    await page.waitForFunction(() => __mc.dims.name === 'overworld', { timeout: 60_000 })
    const home = await page.evaluate(() => {
      const feet = __mc.player.body.position
      const { x, z } = __mc.config.PLAYER.spawnPoint
      return Math.hypot(feet.x - x, feet.z - z) < 2
    })
    assert(home, 'End-side field routes home to the world spawn')

    // Frame-break collapse: breaking one ring frame drops the whole field.
    const collapsed = await page.evaluate(() => {
      const w = __mc.world
      const { ax, az, y } = window.__ring
      w.setBlock(ax, y, az - 1, 0) // a non-corner ring frame
      return w.endPortals.size
    })
    assert(collapsed === 0, 'breaking a frame collapses the field')
    await page.evaluate(() => __mc.player.lock())
  }

  console.log('E3: shared flight seams')
  {
    // gravityScale 0: a mid-air body holds altitude; back at 1 it falls.
    await page.evaluate(() => {
      __mc.player.body.gravityScale = 0
      __mc.player.teleport(0.5, 90, 8.5)
    })
    await page.waitForFunction(() => {
      window.__e3frames = (window.__e3frames ?? 0) + 1
      return window.__e3frames > 12
    })
    const float = await page.evaluate(() => ({
      y: __mc.player.body.position.y,
      vy: __mc.player.body.velocity.y,
    }))
    assert(Math.abs(float.y - 90) < 0.01 && float.vy === 0, 'gravityScale 0 body floats (y stable)')
    await page.evaluate(() => {
      __mc.player.body.gravityScale = 1
    })
    await page.waitForFunction(() => __mc.player.body.position.y < 89)
    assert(true, 'gravityScale 1 restores normal gravity')
    // Park safely on the ground before the projectile phase — the free fall
    // from 90 would otherwise be lethal (teleport clears fall distance).
    await page.evaluate(() => {
      const w = __mc.world
      __mc.player.teleport(0.5, w.surfaceY(0.5, 8.5), 8.5)
    })
    await page.waitForFunction(() => __mc.player.body.grounded && !__mc.health.isDead)

    // Per-projectile gravity: a gravity-0 projectile flies flat while a
    // default one arcs down, from the same spawn.
    const arc = await page.evaluate(() => {
      const origin = __mc.camera.position.clone().set(0.5, 90, 8.5)
      const vel = __mc.camera.position.clone().set(6, 0, 0)
      const flat = __mc.projectiles.spawn(origin, vel, { gravity: 0 })
      const ballistic = __mc.projectiles.spawn(origin, vel)
      window.__e3arrows = { flat, ballistic, y0: 90 }
      return __mc.projectiles.count
    })
    assert(arc === 2, 'two test projectiles in flight')
    await page.waitForFunction(() => {
      const a = window.__e3arrows
      return a.ballistic.mesh.position.y < a.y0 - 1 || a.ballistic.stuck
    })
    const seams = await page.evaluate(() => {
      const a = window.__e3arrows
      return {
        flatVy: a.flat.velocity.y,
        flatY: a.flat.mesh.position.y,
        ballisticY: a.ballistic.mesh.position.y,
      }
    })
    assert(seams.flatVy === 0 && Math.abs(seams.flatY - 90) < 0.01, 'gravity-0 projectile flies flat')
    assert(seams.ballisticY < 89, 'default projectile still arcs (live cfg read)')
    await page.evaluate(() => __mc.projectiles.clear())
  }

  console.log('E4: the Ender Dragon fight')
  {
    // Shrink the slow beats, un-latch the E1 stub, and enter the End.
    await page.evaluate(() => {
      const d = __mc.config.END.dragon
      d.summonSeconds = 0.4
      d.rise.seconds = 0.6
      d.attacks.perch.seconds = 30 // hold the perch open for the kill window
      __mc.endProgress.dragonDefeated = false
      __mc.dims.travel('end', { x: 0.5, y: 66, z: 36.5 })
    })
    await page.waitForFunction(() => __mc.world.chunkReadyAt(0, 0))
    // Arm → rumble → rise: the dragon and six crystals appear pinned.
    await page.waitForFunction(
      () => __mc.mobs.mobs.some((m) => m.kind === 'dragon'),
      { timeout: 60_000 },
    )
    const armed = await page.evaluate(() => ({
      crystals: __mc.mobs.mobs.filter((m) => m.kind === 'end_crystal').length,
      pinned: __mc.dragonFight.dragon !== null && __mc.dragonFight.crystals.length === 6,
      beams: __mc.dragonFight.beams.length,
      event: __mc.mobs.event,
      barVisible: !document.getElementById('boss-bar').classList.contains('hidden'),
      barName: document.getElementById('boss-name').textContent,
    }))
    assert(armed.crystals === 6, 'six end crystals rise on the pillar tops')
    assert(armed.pinned, 'dragon + crystals pinned by reference')
    assert(armed.beams === 6, 'six healing beams render')
    assert(armed.event, 'mobs.event set for the fight')
    assert(armed.barVisible && armed.barName === 'The Ender Dragon', 'boss HP bar shows the dragon')

    // Wait for the dragon to reach its orbit (rise -> return -> orbit).
    await page.waitForFunction(() => __mc.dragonFight.dragon.state === 'orbit', {
      timeout: 60_000,
    })
    await page.evaluate(() => {
      __mc.camera.lookAt(__mc.dragonFight.dragon.group.position)
    })
    await page.screenshot({ path: join(HERE, 'end-dragon-fight.png') })

    // Phase 1 healing: damage the dragon, watch the crystals knit it back.
    const healed = await page.evaluate(() => {
      const dragon = __mc.dragonFight.dragon
      __mc.mobs.hit(dragon, 40, { x: 1, y: 0, z: 0 })
      window.__e4hp = dragon.health
      return dragon.health
    })
    assert(healed <= 160, 'the dragon takes damage in phase 1')
    await page.waitForFunction(() => __mc.dragonFight.dragon.health > window.__e4hp + 1)
    assert(true, 'live crystals visibly heal the dragon back')

    // Forced attacks (the startAttack seam): swoop telegraph -> dive; a
    // fireball spawns a gravity-0 projectile.
    await page.evaluate(() => {
      __mc.dragonFight.dragon.startAttack('swoop', __mc.camera.position)
    })
    const teleSwoop = await page.evaluate(() => ({
      state: __mc.dragonFight.dragon.state,
      attack: __mc.dragonFight.dragon.attack,
    }))
    assert(teleSwoop.state === 'telegraph' && teleSwoop.attack === 'swoop', 'swoop telegraphs first')
    await page.waitForFunction(() => __mc.dragonFight.dragon.state === 'swoop', {
      timeout: 30_000,
    })
    assert(true, 'telegraph resolves into the dive')
    await page.waitForFunction(() => __mc.dragonFight.dragon.state === 'orbit', {
      timeout: 60_000,
    })
    await page.evaluate(() => {
      __mc.dragonFight.dragon.startAttack('fireball', __mc.camera.position)
    })
    await page.waitForFunction(() => __mc.projectiles.count > 0, { timeout: 30_000 })
    const fireball = await page.evaluate(() =>
      __mc.projectiles.arrows.some((a) => a.gravity === 0 && !a.fromPlayer),
    )
    assert(fireball, 'the fireball is a gravity-0 hostile projectile')

    // Shatter all six crystals: fx counters + the phase-2 turn.
    await page.evaluate(() => {
      for (const c of [...__mc.dragonFight.crystals]) {
        __mc.mobs.hit(c, 9, { x: 0, y: 0, z: 1 })
      }
    })
    await page.waitForFunction(() => __mc.dragonFight.crystals.length === 0)
    const afterCrystals = await page.evaluate(() => ({
      beams: __mc.dragonFight.beams.length,
      breaks: __mc.sounds.stats.byName.crystalBreak ?? 0,
      phase: __mc.dragonFight.dragon.phase,
    }))
    assert(afterCrystals.beams === 0, 'healing beams removed with their crystals')
    assert(afterCrystals.breaks >= 6, 'crystalBreak voice fired per crystal')
    assert(afterCrystals.phase === 2, 'crystals gone -> phase 2')

    // No more healing: damage sticks now.
    const stays = await page.evaluate(() => {
      const dragon = __mc.dragonFight.dragon
      __mc.mobs.hit(dragon, 20, { x: 1, y: 0, z: 0 })
      window.__e4hp2 = dragon.health
      return dragon.health
    })
    await page.waitForFunction(() => {
      window.__e4ticks = (window.__e4ticks ?? 0) + 1
      return window.__e4ticks > 20
    })
    const later = await page.evaluate(() => __mc.dragonFight.dragon.health)
    assert(later <= stays + 0.01, 'no healing once the crystals are gone')

    // The perch: phase 2 opens the melee window at the island center.
    await page.evaluate(() => {
      __mc.dragonFight.dragon.cooldowns.perch = 0.01
    })
    await page.waitForFunction(() => __mc.dragonFight.dragon.state === 'perched', {
      timeout: 90_000,
    })
    const perch = await page.evaluate(() => {
      const p = __mc.dragonFight.dragon.group.position
      return { x: p.x, y: p.y, z: p.z }
    })
    assert(Math.hypot(perch.x - 0.5, perch.z - 0.5) < 2, 'the dragon perches at the island center')

    // The kill — victory latches, stamps, grants, reveals.
    await page.evaluate(() => {
      __mc.mobs.hit(__mc.dragonFight.dragon, 9999, { x: 1, y: 0, z: 0 })
    })
    await page.waitForFunction(() => __mc.endProgress.dragonDefeated, { timeout: 30_000 })
    const victory = await page.evaluate(() => {
      const end = __mc.dims.end
      const cy = end.surfaceY(0.5, 0.5)
      // E2 left its own test ring in this world, so count the exit portal's
      // nine interior cells (-1..1 around the center) rather than the map size.
      let exitField = 0
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          if (end.endPortals.has(`${x},${cy},${z}`)) exitField++
        }
      }
      return {
        exitField,
        egg: end.blockAt(__mc.config.END.dragon.egg.dx, cy, __mc.config.END.dragon.egg.dz),
        elytra: __mc.inventory.countOf('elytra'),
        reveal: __mc.endReveal.isOpen,
        state: __mc.dragonFight.state,
        event: __mc.mobs.event,
        barHidden: document.getElementById('boss-bar').classList.contains('hidden'),
        celebrated: __mc.endProgress.celebrated,
      }
    })
    assert(victory.exitField === 9, 'exit portal stamped + self-activated at the center')
    assert(victory.egg === 32, 'dragon egg stamped beside the ring')
    assert(victory.elytra === 1, 'elytra granted through the runner')
    assert(victory.reveal && victory.celebrated, 'END_MESSAGE reveal opened + celebrated latched')
    assert(victory.state === 'idle' && !victory.event, 'runner reset clean')
    assert(victory.barHidden, 'boss bar hides on victory')

    // Dismiss the reveal; the fight must never re-arm.
    await page.click('#end-continue-btn')
    await page.waitForFunction(() => !__mc.endReveal.isOpen)
    await page.evaluate(() => __mc.player.lock())
    await page.waitForFunction(() => {
      window.__e4idle = (window.__e4idle ?? 0) + 1
      return window.__e4idle > 20
    })
    const rearm = await page.evaluate(() => ({
      state: __mc.dragonFight.state,
      count: __mc.mobs.count,
    }))
    assert(rearm.state === 'idle' && rearm.count === 0, 'defeated dragon never re-arms')

    // Fly home through the exit portal (still shrunk to 0.4s charge).
    const cy = await page.evaluate(() => __mc.dims.end.surfaceY(0.5, 0.5))
    await page.evaluate((y) => __mc.player.teleport(0.5, y, 0.5), cy)
    await page.waitForFunction(() => __mc.dims.name === 'overworld', { timeout: 60_000 })
    assert(true, 'the exit portal carries the champion home')
    await page.evaluate(() => __mc.player.lock())
  }

  console.log('E5: elytra glide')
  {
    // Equip the granted elytra through the real right-click-equip path.
    const equipped = await page.evaluate(() => {
      const slot = __mc.inventory.slots.findIndex((s) => s?.id === 'elytra')
      __mc.inventory.select(slot)
      __mc.armor.equipSelected()
      return __mc.armor.slots.chest?.id
    })
    assert(equipped === 'elytra', 'elytra equips into the chest wear slot')

    // Return to the End for the glide (defeated = a quiet island) and fall
    // from high over the center.
    await page.evaluate(() => {
      __mc.dims.travel('end', { x: 0.5, y: 66, z: 36.5 })
    })
    await page.waitForFunction(() => __mc.world.chunkReadyAt(0, 0))
    await page.evaluate(() => {
      // Level the camera (the E4 lookAt left it pitched) and step off.
      __mc.camera.quaternion.set(0, 0, 0, 1)
      __mc.player.teleport(0.5, 95, 0.5)
    })
    await page.waitForFunction(() => __mc.player.body.velocity.y < -2)
    // A fresh Space press mid-fall deploys — synchronous keydown/keyup in
    // ONE evaluate (headless timers stretch).
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }))
    })
    await page.waitForFunction(() => __mc.player.gliding)
    const glide = await page.evaluate(() => ({
      gravityScale: __mc.player.body.gravityScale,
      expectedScale: __mc.config.PLAYER.glide.gravityScale,
      vy: __mc.player.body.velocity.y,
      horizontal: Math.hypot(__mc.player.body.velocity.x, __mc.player.body.velocity.z),
    }))
    assert(glide.gravityScale === glide.expectedScale, 'glide engages the gravityScale seam')
    assert(glide.vy > -6, `glide sink is gentle vs free fall (vy ${glide.vy.toFixed(1)})`)
    assert(glide.horizontal >= 5, `momentum carries forward (${glide.horizontal.toFixed(1)} blocks/s)`)

    // Pitch down: speed rises (assert the gap, not the knob) — set the dive
    // through the same YXZ euler the controls read. The screenshot lands
    // mid-dive, island filling the frame.
    await page.evaluate(() => {
      __mc.camera.rotation.set(-0.55, __mc.camera.rotation.y, 0, 'YXZ')
      window.__e5speed = __mc.player.glideSpeed
    })
    await page.waitForFunction(() => __mc.player.glideSpeed > window.__e5speed + 2)
    assert(true, 'diving gains speed (pitch-to-speed momentum)')
    await page.screenshot({ path: join(HERE, 'end-elytra-glide.png') })

    // The dive lands on the island: contact exits the glide, gravity restores.
    await page.waitForFunction(() => !__mc.player.gliding && __mc.player.body.grounded, {
      timeout: 60_000,
    })
    const landed = await page.evaluate(() => ({
      gravityScale: __mc.player.body.gravityScale,
      durability: __mc.armor.slots.chest?.durability ?? 0,
      wind: __mc.sounds.stats.byName.wind ?? 0,
      alive: !__mc.health.isDead,
    }))
    assert(landed.gravityScale === 1, 'landing restores normal gravity')
    assert(landed.durability > 0 && landed.durability < 432, 'glide time wore the wings')
    assert(landed.wind >= 1, 'wind voice plays while gliding')
    assert(landed.alive, 'the flare landing is survivable')
  }

  console.log(consoleErrors.length ? `console errors:\n${consoleErrors.join('\n')}` : 'no console errors')
  assert(consoleErrors.length === 0, 'zero console errors')
} finally {
  await browser.close()
  preview.kill()
}

process.exit(failures ? 1 : 0)
