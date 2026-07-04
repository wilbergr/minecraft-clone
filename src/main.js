import * as THREE from 'three'
import { CHALLENGE, GRAPHICS, HUNGER } from './config.js'
import { World } from './world/World.js'
import { PlayerControls } from './player/PlayerControls.js'
import { BlockInteraction } from './player/BlockInteraction.js'
import { TouchControls } from './player/TouchControls.js'
import { Inventory } from './inventory/Inventory.js'
import { Combat } from './combat/Combat.js'
import { SaveManager } from './save/SaveManager.js'
import { TreasureHunt } from './treasure/TreasureHunt.js'
import { Challenge } from './quest/Challenge.js'
import { bindOverlay } from './ui/overlay.js'
import { bindHotbar } from './ui/hotbar.js'
import { bindHud } from './ui/hud.js'
import { bindResetButton } from './ui/resetButton.js'
import { InventoryScreen } from './ui/inventoryScreen.js'
import { SlotCursor } from './ui/slotCursor.js'
import { bindSlotTooltips } from './ui/slots.js'
import { bindQuestLog } from './ui/questLog.js'
import { bindDropKeys, bindBackdropDrop } from './ui/dropKeys.js'
import { bindTreasureHud } from './ui/treasureHud.js'
import { bindTreasureReveal } from './ui/treasureReveal.js'
import { bindChallengeReveal } from './ui/challengeReveal.js'
import { bindBossHud } from './ui/bossHud.js'
import { bindHelp } from './ui/help.js'
import { bindMuteButton } from './ui/muteButton.js'
import { SoundEngine } from './audio/SoundEngine.js'
import { createFootsteps } from './audio/Footsteps.js'
import { Particles } from './fx/Particles.js'
import { Viewmodel } from './fx/Viewmodel.js'
import { GroundItems } from './fx/GroundItems.js'
import { TorchLights } from './fx/TorchLights.js'
import { DayNight } from './sky/DayNight.js'
import { Clouds } from './sky/Clouds.js'
import { BLOCK_BED, BLOCK_CHEST, BLOCK_FURNACE, isLiquid } from './world/blocks.js'
import { Hunger } from './survival/Hunger.js'
import { Sleep } from './survival/Sleep.js'
import { Furnaces } from './crafting/Furnaces.js'
import { FurnaceScreen } from './ui/furnaceScreen.js'
import { Chests } from './crafting/Chests.js'
import { ChestScreen } from './ui/chestScreen.js'
import { bindSleepFx } from './ui/sleepFx.js'
import { bindHungerHud } from './ui/hungerHud.js'
import { bindArmorHud } from './ui/armorHud.js'

const app = document.getElementById('app')

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS.maxPixelRatio))
renderer.setSize(window.innerWidth, window.innerHeight)
app.prepend(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(GRAPHICS.skyColor)
scene.fog = new THREE.Fog(GRAPHICS.skyColor, GRAPHICS.fogNear, GRAPHICS.fogFar)

const camera = new THREE.PerspectiveCamera(
  GRAPHICS.fov,
  window.innerWidth / window.innerHeight,
  0.1,
  200,
)

const world = new World(scene)
const player = new PlayerControls(camera, renderer.domElement, world)
const inventory = new Inventory()

// Sky layer (Phase 10): the day/night clock drives lights, sky/fog color,
// and the sun/moon billboards; clouds drift as one merged mesh.
const daynight = new DayNight(scene, world, camera)
const clouds = new Clouds(scene)

// Torch lighting (Phase 11): a fixed point-light pool tracks the torches
// nearest the camera — see src/fx/TorchLights.js.
const torchLights = new TorchLights(scene, world)

// Feedback layer (Phase 9): synthesized sound, break particles, ground item
// drops, and the held-item viewmodel, bundled into the `fx` object the game
// systems hook into (every hook optional).
scene.add(camera) // the viewmodel is a camera child; children need the camera in-scene
const sounds = new SoundEngine()
const particles = new Particles(scene)
const drops = new GroundItems(scene, world, inventory, sounds)
const fx = { sounds, particles, drops, viewmodel: null, health: null, hunger: null }

const interaction = new BlockInteraction(camera, world, player, scene, inventory, fx)

const combat = new Combat(camera, world, player, inventory, interaction, scene, fx)
fx.health = combat.health
combat.mobs.daynight = daynight // hostile spawns are night-gated (Phase 10)
fx.viewmodel = new Viewmodel(camera, inventory, player)
const hunt = new TreasureHunt(world, scene)

// Survival loop (Phase 12): hunger gates health regen and starves down to a
// floor; furnaces smelt ore/meat over time and spill their contents when
// their block is broken.
const hunger = new Hunger()
fx.hunger = hunger
combat.health.regenGate = () => hunger.value >= HUNGER.regenThreshold
hunger.onStarve = () => {
  if (combat.health.value > HUNGER.starve.minHealth) combat.health.damage(HUNGER.starve.damage)
}
const furnaces = new Furnaces()
const chests = new Chests() // placed-chest contents (inventory overhaul); no tick — inert storage

// Bed sleeping (bed feature): sleep at night to set the respawn point and
// skip to dawn; Combat.respawn → player.respawn consults it via spawnHook.
const sleep = new Sleep(world, daynight)
player.spawnHook = () => sleep.respawnPoint()

// Restore a saved game before anything renders: block edits must be in the
// overlay before the first chunks generate, and the UI binders below pick up
// the restored inventory/health through their initial renders.
// The shared cursor stack (inventory overhaul): every screen moves items by
// picking them up onto this cursor; its held stack rides the optional
// `cursor` save key so a refresh mid-move can't lose it.
const cursor = new SlotCursor()
bindSlotTooltips()

const save = new SaveManager({ world, player, inventory, health: combat.health })
save.load()
save.attachCursor(cursor)
save.attachTreasure(hunt)
save.attachDayNight(daynight)
save.attachHunger(hunger)
save.attachFurnaces(furnaces)
save.attachChests(chests)
save.attachArmor(combat.armor)
save.attachSleep(sleep)

// The King's Trial (endgame): the four-stage challenge chain, unlocked by
// treasure-hunt completion. Constructed after attachTreasure so it sees the
// restored hunt state; its own progress rides the optional `challenge` slot.
const challenge = new Challenge(world, scene, hunt, inventory)
save.attachChallenge(challenge)
challenge.onCollect = (relic) => {
  sounds.play('pickup')
  particles.burst(relic.position.x, relic.position.y, relic.position.z, 0x7fe7d0, 24)
}
challenge.onDeliver = (pos) => {
  sounds.play('pickup')
  particles.burst(pos.x, pos.y + 1, pos.z, 0xffb066, 60)
}
// Stage 2 beacon juice: a green pulse as each ghost cell satisfies, a big
// burst (the placement sound already covers audio per block) when the whole
// structure completes.
challenge.onBeaconPulse = (pos) => {
  particles.burst(pos.x, pos.y, pos.z, CHALLENGE.beacon.ghost.pulseColor, 10)
}
challenge.onBeaconDone = (pos) => {
  sounds.play('pickup')
  particles.burst(pos.x, pos.y + 2, pos.z, CHALLENGE.beacon.ghost.doneColor, 80)
}
// Stage 3 siege wiring: the wave runner's live deps (the mobs.daynight
// attachment pattern) and its telegraph/victory juice.
challenge.siege.mobs = combat.mobs
challenge.siege.daynight = daynight
challenge.siege.health = combat.health
challenge.siege.player = player
challenge.siege.onHorn = () => sounds.play('horn')
challenge.siege.onFlare = (x, y, z) => {
  const { color, particles: count } = CHALLENGE.siege.flare
  particles.burst(x, y, z, color, count)
}
challenge.onSiegeWon = (pos) => {
  sounds.play('pickup')
  particles.burst(pos.x, pos.y + 2, pos.z, CHALLENGE.siege.clearedBeamColor, 80)
}
// Stage 4 boss wiring: the fight runner's live deps (the mobs.daynight
// pattern) plus its fx. onBossEvent is deliberately generic — the future
// guidance layer (Herald) will observe these same events; here they only
// drive sound/particles.
challenge.bossFight.mobs = combat.mobs
challenge.bossFight.health = combat.health
challenge.bossFight.player = player
challenge.bossFight.onBossEvent = (type, data) => {
  if (type === 'rumble') {
    sounds.play('rumble')
    particles.burst(data.position.x, data.position.y + 1, data.position.z, 0xffd75e, 60)
  } else if (type === 'rise' || type === 'leash') {
    sounds.play('roar')
    if (data.position) {
      particles.burst(data.position.x, data.position.y + 1.5, data.position.z, 0x9aa4b8, 60)
    }
  } else if (type === 'phase') {
    sounds.play('roar')
    particles.burst(data.position.x, data.position.y + 2, data.position.z, 0xffffff, 80)
  } else if (type === 'slam') {
    sounds.play('explosion', { gain: 0.4 })
    particles.burst(data.position.x, data.position.y + 0.2, data.position.z, 0xbcc4d4, 40)
  } else if (type === 'stagger') {
    sounds.play('arrowHit')
    particles.burst(data.position.x, data.position.y + 2.2, data.position.z, 0xffd75e, 30)
  }
}
// Victory: crown-nova + roar; the reveal modal opens via challenge.onComplete.
challenge.onBossDefeated = (pos) => {
  sounds.play('roar')
  const nova = CHALLENGE.boss.defeatNova
  particles.burst(pos.x, pos.y + 1.5, pos.z, nova.color, nova.particles)
}

// Armor equipping (Phase 13): right-clicking an armor item wears it.
interaction.useItemHook = (item) => {
  if (!item.armor || !combat.armor.equipSelected()) return false
  sounds.play('equip')
  return true
}

const screen = new InventoryScreen(inventory, player, combat.armor, cursor, drops, camera)
const furnaceScreen = new FurnaceScreen(furnaces, inventory, player, cursor, drops, camera)
const chestScreen = new ChestScreen(chests, inventory, player, world, cursor, drops, camera, sounds)
// Use dispatcher for right clicks on blocks (touch ▦ too, sneak bypasses):
// handlers keyed by block id, each returning true when the click was spent.
// New interactive blocks register here — mark the block `interactive: true`
// in blocks.js and add a row. Contextual cases (the King's Trial gold core,
// which must NOT make cave gold veins interactive) are consulted first and
// gate themselves on position + stage.
const blockUseHandlers = {
  [BLOCK_FURNACE]: (x, y, z) => {
    furnaceScreen.openAt(x, y, z)
    return true
  },
  [BLOCK_BED]: (x, y, z) => sleep.tryAt(x, y, z),
  [BLOCK_CHEST]: (x, y, z) => {
    chestScreen.openAt(x, y, z)
    return true
  },
}
interaction.useBlockHook = (block, x, y, z) => {
  if (challenge.tryUseBlock(block, x, y, z)) return true
  return blockUseHandlers[block.id]?.(x, y, z) ?? false
}
// Break handlers, keyed by block id like blockUseHandlers: blocks with
// per-position contents spill them as ground drops. Fired for player mining
// (interaction.onBlockBroken) AND for explosion-carved cells (below) — the
// latter closes the old orphan bug where a creeper-blasted furnace kept its
// contents in the map forever and resurrected them into a newly placed one.
const spillAt = (x, y, z) => (stack) =>
  drops.spawn(x + 0.5, y + 0.7, z + 0.5, stack.id, stack.count, { durability: stack.durability })
const blockBreakHandlers = {
  [BLOCK_FURNACE]: (x, y, z) => furnaces.onBroken(x, y, z, spillAt(x, y, z)),
  [BLOCK_CHEST]: (x, y, z) => chests.onBroken(x, y, z, spillAt(x, y, z)),
}
interaction.onBlockBroken = (x, y, z, block) => blockBreakHandlers[block.id]?.(x, y, z)
combat.mobs.onBlocksExploded = (cells) => {
  for (const c of cells) blockBreakHandlers[c.id]?.(c.x, c.y, c.z)
}
const reveal = bindTreasureReveal(hunt, player)
const challengeReveal = bindChallengeReveal(challenge, player)
bindBossHud(challenge.bossFight)
const help = bindHelp(player)
// The death screen, reveals, furnace, and help panel count as open UI
// so "click to play" stays out of their way.
const anyUIOpen = () =>
  screen.isOpen ||
  combat.health.isDead ||
  reveal.isOpen ||
  challengeReveal.isOpen ||
  help.isOpen ||
  furnaceScreen.isOpen ||
  chestScreen.isOpen
const refreshOverlay = bindOverlay(player, anyUIOpen)
// Q / Shift+Q throw from the hotbar while playing; clicking a screen's
// backdrop throws the held cursor stack (left = all, right = one).
bindDropKeys(inventory, drops, camera, player, combat.health, sounds, anyUIOpen)
bindBackdropDrop(screen.root, cursor, drops, camera)
bindBackdropDrop(furnaceScreen.root, cursor, drops, camera)
bindBackdropDrop(chestScreen.root, cursor, drops, camera)
bindHotbar(inventory, player)
bindHud(combat.health, () => {
  combat.respawn()
  hunger.reset() // fresh spawn, fresh appetite
})
bindHungerHud(hunger)
bindArmorHud(combat.armor)
bindSleepFx(sleep, sounds)
bindResetButton(save)
const toggleQuestLog = bindQuestLog(hunt, challenge)
const updateTreasureHud = bindTreasureHud(hunt, challenge, camera)
// Closing the screen re-locks the pointer; give the lock a beat to land
// before re-evaluating, so "click to play" only appears if it failed.
screen.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
reveal.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
challengeReveal.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
help.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
furnaceScreen.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
chestScreen.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))

// Audio wiring: browsers require a user gesture before audio starts, so the
// context unlocks on the first pointer/key input (the click-to-play overlay
// counts). Hurt plays on any health drop; every UI button clicks.
const unlockAudio = () => sounds.unlock()
document.addEventListener('pointerdown', unlockAudio)
document.addEventListener('keydown', unlockAudio)
player.addEventListener('lock', unlockAudio)
bindMuteButton(sounds)
let lastHealth = combat.health.value
combat.health.onChange((h) => {
  if (h.value < lastHealth) sounds.play('hurt')
  lastHealth = h.value
})
document.addEventListener('click', (e) => {
  if (e.target.closest?.('button')) sounds.play('click')
})
const updateFootsteps = createFootsteps(sounds, player, camera, world)

// Coarse-pointer devices get the joystick/touch scheme instead of pointer
// lock; on desktop this is a no-op and the touch UI never exists.
const touch = player.touchMode
  ? new TouchControls(player, interaction, camera, {
      toggleInventory: () => screen.toggle(),
      toggleQuestLog,
      toggleHelp: () => help.toggle(),
    })
  : null

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

const clock = new THREE.Clock()

// Blue full-screen wash while the camera is underwater (Phase 10).
const waterTint = document.getElementById('water-tint')
const updateWaterTint = () => {
  const p = camera.position
  const submerged = isLiquid(
    world.blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
  )
  waterTint.classList.toggle('hidden', !submerged)
}

renderer.setAnimationLoop(() => {
  // Clamp delta so a backgrounded tab doesn't produce a huge jump on resume.
  const delta = Math.min(clock.getDelta(), 0.1)
  world.update(camera.position)
  player.update(delta)
  interaction.update(delta)
  combat.update(delta)
  // Hunger drains only while actually playing; furnaces also run while their
  // UI is open (so you can watch the smelt), pausing in every other menu.
  if (player.isLocked && !combat.health.isDead) {
    hunger.update(delta, {
      sprinting: player.isSprinting,
      mining: interaction.mining && !!interaction.target,
    })
  }
  if (player.isLocked || furnaceScreen.isOpen) furnaces.update(delta)
  hunt.update(delta, camera.position)
  challenge.update(delta, camera.position)
  particles.update(delta)
  drops.update(delta, camera.position)
  fx.viewmodel.update(delta)
  // The sky keeps rendering behind menus, but game time only passes while
  // the player is in control — matching the physics/combat pause.
  daynight.update(player.isLocked ? delta : 0)
  clouds.update(delta, camera.position)
  torchLights.update(camera.position)
  updateWaterTint()
  updateFootsteps()
  updateTreasureHud()
  save.update(delta)
  renderer.render(scene, camera)
})

// Debug/test hook (used by automated browser verification; harmless in prod).
window.__mc = {
  scene,
  camera,
  player,
  world,
  interaction,
  renderer,
  inventory,
  screen,
  combat,
  health: combat.health,
  mobs: combat.mobs,
  save,
  hunt,
  challenge,
  bossFight: challenge.bossFight,
  challengeReveal,
  touch,
  help,
  sounds,
  particles,
  drops,
  viewmodel: fx.viewmodel,
  daynight,
  clouds,
  hunger,
  furnaces,
  furnaceScreen,
  chests,
  chestScreen,
  torchLights,
  armor: combat.armor,
  projectiles: combat.projectiles,
  sleep,
  cursor,
}
