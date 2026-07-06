// Headless verification for Minecraft-style death drops + the persisted
// user toggle (mechanics report §6.5 / M5).
//
// Covers: toggle defaults ON and renders on the overlay button; dying with a
// known kit spills inventory + equipped armor + the held cursor stack at the
// death site (long despawn window, eviction-exempt, durability preserved);
// respawn leaves the inventory empty and walking back recovers everything;
// toggle OFF keeps the inventory through death (the original behavior); the
// setting persists across a reload; the trial-arena exemption (mobs.event —
// what the siege/boss set) and the Nether exemption both keep the kit; and
// the death-screen hint matches what actually happened.
//
// Run:
//   npm run build
//   npm install --no-save puppeteer-core   (not a project dep)
//   node tools/test-death-drops.mjs
// Exits 0 on pass, 1 on failure. Software WebGL runs game time at ~0.3x real
// time — everything waits on waitForFunction, never fixed sleeps.

import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const PORT = 4741 // unique strict port for this suite
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

// One flat stone stage above the terrain: deaths and drop scatter stay on it.
const STAGE = { x: 8, y: 70, z: 8, half: 5 }

async function boot(page) {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__mc?.world?.chunkReadyAt(0, 0))
  // Never persist anything this run writes (the diamond-PR sharp edge: the
  // interval autosave ignores save.enabled, so stub save() too). The
  // settings key is its OWN localStorage slot and deliberately survives.
  await page.evaluate(() => {
    __mc.save.enabled = false
    __mc.save.save = () => {}
    __mc.sounds.unlock()
    __mc.player.lock()
    __mc.daynight.setTime(0.25) // noon: bright surface, no ambient hostiles
  })
}

// Stand the player mid-stage with a known kit: 12 stone + a part-worn
// pickaxe in the inventory, an iron chestplate equipped, 3 coal on the
// cursor. Returns nothing; the kit constants live in the assertions.
async function armKit(page) {
  await page.evaluate((S) => {
    for (let x = S.x - S.half; x <= S.x + S.half; x++) {
      for (let z = S.z - S.half; z <= S.z + S.half; z++) {
        __mc.world.setBlock(x, S.y, z, 3)
        for (let y = S.y + 1; y <= S.y + 4; y++) __mc.world.setBlock(x, y, z, 0)
      }
    }
    __mc.player.teleport(S.x + 0.5, S.y + 1, S.z + 0.5)
    __mc.inventory.add('stone', 12)
    __mc.inventory.add('wooden_pickaxe', 1, 21)
    __mc.armor.setSlot('chest', { id: 'iron_chestplate', durability: 150 })
    __mc.cursor.set({ id: 'coal', count: 3 })
    __mc.inventory.select(2)
  }, STAGE)
}

try {
  const page = await browser.newPage()
  page.setDefaultTimeout(90_000)
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await boot(page)

  console.log('toggle defaults + overlay button')
  {
    const r = await page.evaluate(() => ({
      value: __mc.settings.get('deathDrops'),
      label: document.getElementById('death-drops-btn').textContent,
    }))
    assert(r.value === true, 'deathDrops defaults ON')
    assert(r.label === 'Death drops: on', `overlay button reads the setting ("${r.label}")`)
  }

  console.log('death with the toggle ON: the kit spills at the death site')
  {
    await armKit(page)
    const r = await page.evaluate(() => {
      const before = __mc.drops.count
      __mc.health.damage(999)
      const spill = __mc.drops.items.slice(before)
      const byId = {}
      for (const e of spill) byId[e.itemId] = (byId[e.itemId] ?? 0) + e.count
      return {
        byId,
        entities: spill.length,
        allLongDespawn: spill.every((e) => e.despawnSeconds === 300 && e.noEvict === true),
        pickDurability: spill.find((e) => e.itemId === 'wooden_pickaxe')?.durability,
        inventoryEmpty: __mc.inventory.slots.every((s) => s === null),
        armorEmpty: Object.values(__mc.armor.slots).every((s) => s === null),
        cursorEmpty: __mc.cursor.stack === null,
        selectedSlot: __mc.inventory.selectedSlot,
        deathShown: !document.getElementById('death-screen').classList.contains('hidden'),
        hint: document.getElementById('death-hint').textContent,
      }
    })
    assert(
      r.byId.stone === 12 &&
        r.byId.wooden_pickaxe === 1 &&
        r.byId.iron_chestplate === 1 &&
        r.byId.coal === 3 &&
        r.entities === 4,
      `whole kit spilled as ground items (${JSON.stringify(r.byId)})`,
    )
    assert(r.allLongDespawn, 'spill entities carry despawnSeconds 300 + eviction exemption')
    assert(r.pickDurability === 21, 'tool durability rides the spilled drop')
    assert(
      r.inventoryEmpty && r.armorEmpty && r.cursorEmpty,
      'inventory, armor slots, and cursor all emptied',
    )
    assert(r.selectedSlot === 2, 'hotbar selection persists through death')
    assert(r.deathShown && /dropped where you fell/.test(r.hint), `death hint says so ("${r.hint}")`)
  }

  console.log('respawn empty, walk back, recover everything')
  {
    await page.evaluate(() => document.getElementById('respawn-btn').click())
    await page.waitForFunction(() => !__mc.health.isDead && __mc.player.isLocked)
    assert(
      await page.evaluate(() => __mc.inventory.slots.every((s) => s === null)),
      'respawned with an empty inventory',
    )
    // Walk back: hop onto each remaining drop until the magnet has them all
    // (drops scatter a little, so re-target every poll; landed drops only).
    await page.waitForFunction(
      () => {
        const d = __mc.drops.items[0]
        if (!d) return true
        const p = d.mesh.position
        __mc.player.teleport(p.x, p.y + 0.1, p.z)
        return false
      },
      { polling: 500 },
    )
    const r = await page.evaluate(() => ({
      stone: __mc.inventory.countOf('stone'),
      coal: __mc.inventory.countOf('coal'),
      chest: __mc.inventory.countOf('iron_chestplate'),
      pick: __mc.inventory.slots.find((s) => s?.id === 'wooden_pickaxe'),
    }))
    assert(
      r.stone === 12 && r.coal === 3 && r.chest === 1 && r.pick?.durability === 21,
      `full kit recovered, durability intact (${JSON.stringify(r)})`,
    )
  }

  console.log('death spills survive the over-cap eviction')
  {
    const r = await page.evaluate(() => {
      __mc.inventory.setRange(0, new Array(__mc.inventory.size).fill(null))
      __mc.inventory.add('stone', 5)
      __mc.health.damage(999)
      const spillId = __mc.drops.items[__mc.drops.count - 1]
      // Flood the pool well past maxEntities with ordinary drops.
      const S = { x: 8, y: 71, z: 8 }
      for (let i = 0; i < __mc.config.FEEDBACK.drops.maxEntities + 8; i++) {
        __mc.drops.spawn(S.x, S.y + 1, S.z, 'dirt', 1)
      }
      return {
        capped: __mc.drops.count === __mc.config.FEEDBACK.drops.maxEntities,
        spillAlive: __mc.drops.items.includes(spillId),
      }
    })
    assert(r.capped, 'entity cap still holds under flood')
    assert(r.spillAlive, 'the death spill outlives the oldest-first eviction')
    await page.evaluate(() => {
      __mc.drops.clear()
      document.getElementById('respawn-btn').click()
    })
    await page.waitForFunction(() => !__mc.health.isDead && __mc.player.isLocked)
  }

  console.log('toggle OFF: keep-inventory (the original behavior)')
  {
    await page.evaluate(() => {
      document.getElementById('death-drops-btn').click() // flip via the real UI
    })
    await armKit(page)
    const r = await page.evaluate(() => {
      const before = __mc.drops.count
      __mc.health.damage(999)
      return {
        label: document.getElementById('death-drops-btn').textContent,
        newDrops: __mc.drops.count - before,
        stone: __mc.inventory.countOf('stone'),
        chest: __mc.armor.slots.chest?.id,
        cursor: __mc.cursor.stack?.id,
        hint: document.getElementById('death-hint').textContent,
      }
    })
    assert(r.label === 'Death drops: off', 'button flipped to off')
    assert(r.newDrops === 0, 'nothing drops with the toggle off')
    assert(
      r.stone === 12 && r.chest === 'iron_chestplate' && r.cursor === 'coal',
      'inventory, armor, and cursor all survive death',
    )
    assert(/items are safe/.test(r.hint), `death hint says items are safe ("${r.hint}")`)
    await page.evaluate(() => document.getElementById('respawn-btn').click())
    await page.waitForFunction(() => !__mc.health.isDead && __mc.player.isLocked)
    assert(
      await page.evaluate(() => __mc.inventory.countOf('stone') === 12),
      'kit still there after respawn',
    )
  }

  console.log('the OFF setting persists across a reload')
  {
    await boot(page) // fresh page load; settings key untouched by the save stubs
    const r = await page.evaluate(() => ({
      value: __mc.settings.get('deathDrops'),
      label: document.getElementById('death-drops-btn').textContent,
    }))
    assert(r.value === false, 'deathDrops still OFF after reload')
    assert(r.label === 'Death drops: off', 'button renders the persisted state')
    await page.evaluate(() => document.getElementById('death-drops-btn').click()) // back ON
    assert(
      await page.evaluate(() => __mc.settings.get('deathDrops') === true),
      'button flips it back ON',
    )
  }

  console.log('trial-arena guardrail: siege/boss deaths keep the kit')
  {
    await armKit(page)
    const r = await page.evaluate(() => {
      __mc.mobs.event = true // exactly what SiegeEvent/BossFight set while live
      const before = __mc.drops.count
      __mc.health.damage(999)
      return {
        newDrops: __mc.drops.count - before,
        stone: __mc.inventory.countOf('stone'),
        chest: __mc.armor.slots.chest?.id,
      }
    })
    assert(r.newDrops === 0, 'no spill while a trial event is live (toggle still ON)')
    assert(r.stone === 12 && r.chest === 'iron_chestplate', 'the kit survives an arena death')
    await page.evaluate(() => {
      __mc.mobs.event = false
      document.getElementById('respawn-btn').click()
    })
    await page.waitForFunction(() => !__mc.health.isDead && __mc.player.isLocked)
  }

  console.log('Nether guardrail: travel home would clear the drops, so keep the kit')
  {
    await page.evaluate(() => {
      // Shed the kit the arena death kept, so the counts below are exact.
      __mc.inventory.setRange(0, new Array(__mc.inventory.size).fill(null))
      __mc.armor.setSlot('chest', null)
      __mc.cursor.clear()
      __mc.dims.travel('nether', { x: 0.5, y: 57, z: 0.5 })
    })
    await page.waitForFunction(() => __mc.world.chunkReadyAt(0.5, 0.5))
    const r = await page.evaluate(() => {
      __mc.inventory.add('stone', 7)
      const before = __mc.drops.count
      __mc.health.damage(999)
      return { newDrops: __mc.drops.count - before, stone: __mc.inventory.countOf('stone') }
    })
    assert(r.newDrops === 0 && r.stone === 7, 'Nether death keeps the inventory')
    await page.evaluate(() => document.getElementById('respawn-btn').click())
    await page.waitForFunction(
      () => !__mc.health.isDead && __mc.dims.name === 'overworld',
    )
    assert(
      await page.evaluate(() => __mc.inventory.countOf('stone') === 7),
      'respawn travels home with the kit intact',
    )
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
console.log('\nOK: all death-drops assertions hold')
