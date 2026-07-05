import * as THREE from 'three'
import * as config from './config.js'
import { BREATH, CHALLENGE, GRAPHICS, HUNGER, LAVA, PLAYER, WATER } from './config.js'
import { World } from './world/World.js'
import { NetherWorld } from './world/NetherWorld.js'
import { Dimensions } from './world/Dimensions.js'
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
import { bindGuidance } from './quest/guidance.js'
import { bindBossHud } from './ui/bossHud.js'
import { bindHelp } from './ui/help.js'
import { bindMuteButton } from './ui/muteButton.js'
import { SoundEngine } from './audio/SoundEngine.js'
import { createFootsteps } from './audio/Footsteps.js'
import { Particles } from './fx/Particles.js'
import { Viewmodel } from './fx/Viewmodel.js'
import { GroundItems } from './fx/GroundItems.js'
import { TorchLights } from './fx/TorchLights.js'
import { LavaLights } from './fx/LavaLights.js'
import { DayNight } from './sky/DayNight.js'
import { Clouds } from './sky/Clouds.js'
import { BLOCKS, BLOCK_AIR, BLOCK_BED, BLOCK_CHEST, BLOCK_FURNACE, BLOCK_KINGS_CACHE, BLOCK_LAVA, BLOCK_WATER, isLiquid, isSolid } from './world/blocks.js'
import { Hunger } from './survival/Hunger.js'
import { Breath } from './survival/Breath.js'
import { Burning } from './survival/Burning.js'
import { Sleep } from './survival/Sleep.js'
import { Furnaces } from './crafting/Furnaces.js'
import { FurnaceScreen } from './ui/furnaceScreen.js'
import { Chests } from './crafting/Chests.js'
import { EnderStore } from './crafting/EnderStore.js'
import { ChestScreen } from './ui/chestScreen.js'
import { bindSleepFx } from './ui/sleepFx.js'
import { bindHungerHud } from './ui/hungerHud.js'
import { bindBreathHud } from './ui/breathHud.js'
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
// The Nether (second dimension): a sibling World in the same scene, its root
// invisible until the dimension controller (constructed below, once every
// world-holding system exists) swaps it in.
const nether = new NetherWorld(scene)
const player = new PlayerControls(camera, renderer.domElement, world)
const inventory = new Inventory()

// Sky layer (Phase 10): the day/night clock drives lights, sky/fog color,
// and the sun/moon billboards; clouds drift as one merged mesh. The sky
// bodies and clouds are OVERWORLD furniture — parenting them under its root
// makes them vanish with it in the Nether.
const daynight = new DayNight(scene, world, camera)
const clouds = new Clouds(scene)
world.root.add(daynight.sunSprite, daynight.moonSprite, clouds.mesh)

// Torch lighting (Phase 11): a fixed point-light pool tracks the torches
// nearest the camera — see src/fx/TorchLights.js.
const torchLights = new TorchLights(scene, world)
// Lava glow (lava feature): its sibling pool tracks the nearest exposed
// pool surfaces — see src/fx/LavaLights.js.
const lavaLights = new LavaLights(scene, world)

// Feedback layer (Phase 9): synthesized sound, break particles, ground item
// drops, and the held-item viewmodel, bundled into the `fx` object the game
// systems hook into (every hook optional).
scene.add(camera) // the viewmodel is a camera child; children need the camera in-scene
const sounds = new SoundEngine()
const particles = new Particles(scene)
const drops = new GroundItems(scene, world, inventory, sounds)
drops.particles = particles // lava-destruction embers (lava feature)
const fx = { sounds, particles, drops, viewmodel: null, health: null, hunger: null }

const interaction = new BlockInteraction(camera, world, player, scene, inventory, fx)

const combat = new Combat(camera, world, player, inventory, interaction, scene, fx)
fx.health = combat.health
combat.mobs.daynight = daynight // hostile spawns are night-gated (Phase 10)
fx.viewmodel = new Viewmodel(camera, inventory, player)
// Quest systems are overworld-bound (dimension seam): their meshes parent
// under the overworld root so they vanish in the Nether, their world ref is
// never swapped, and their update() calls below gate on the active dimension.
const hunt = new TreasureHunt(world, world.root)

// Survival loop (Phase 12): hunger gates health regen and starves down to a
// floor; furnaces smelt ore/meat over time and spill their contents when
// their block is broken.
const hunger = new Hunger()
fx.hunger = hunger
combat.health.regenGate = () => hunger.value >= HUNGER.regenThreshold
// MC's can't-sprint-when-starving rule (the spawnHook optional-gate
// pattern): the double-tap latch still sets, but sprint speed is refused
// until the bar climbs back over the threshold. Bare runs sprint freely.
player.canSprintHook = () => hunger.value > PLAYER.sprint.minHunger
hunger.onStarve = () => {
  if (combat.health.value > HUNGER.starve.minHealth) combat.health.damage(HUNGER.starve.damage)
}
// Breath & drowning (deep water): drains while the camera is submerged (the
// shared flag computed in updateUnderwater below), refills in air. Drowning
// damage goes through health.damage() DIRECTLY — armor must not reduce it,
// the deliberate fall/void/starve precedent — and is lethal, unlike
// starvation: the surface is always the escape. Not persisted (resets full
// on load); reset on respawn beside hunger below.
const breath = new Breath()
breath.onDrown = () => combat.health.damage(BREATH.drown.damage)
// Burning (lava feature): contact ticks while the body midsection is in
// lava, plus the after-burn that lingers after climbing out (extinguished by
// water). Damage rides health.damage() DIRECTLY — armor never reduces it,
// the same environmental precedent as drowning above. Embers at the camera
// give every tick a visible beat.
const burning = new Burning()
burning.onBurn = (damage) => {
  combat.health.damage(damage)
  const p = camera.position
  particles.burst(p.x, p.y - 0.4, p.z, LAVA.ember.color, LAVA.ember.count)
}
const furnaces = new Furnaces()
const chests = new Chests() // placed-chest contents (inventory overhaul); no tick — inert storage
const enderStore = new EnderStore() // the King's Cache global store; also inert

// Bed sleeping (bed feature): sleep at night to set the respawn point and
// skip to dawn; Combat.respawn → player.respawn consults it via spawnHook.
const sleep = new Sleep(world, daynight)
player.spawnHook = () => sleep.respawnPoint()
// Monsters-nearby sleep refusal (the mobs.daynight attachment pattern):
// null in bare runs, where the check silently passes.
sleep.mobs = combat.mobs

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
save.attachNether(nether) // the Nether's edit overlay, before its first chunk
save.attachCursor(cursor)
save.attachTreasure(hunt)
save.attachDayNight(daynight)
save.attachHunger(hunger)
save.attachFurnaces(furnaces)
save.attachChests(chests)
save.attachEnderStore(enderStore)
save.attachArmor(combat.armor)
save.attachSleep(sleep)

// The King's Trial (endgame): the four-stage challenge chain, unlocked by
// treasure-hunt completion. Constructed after attachTreasure so it sees the
// restored hunt state; its own progress rides the optional `challenge` slot.
// Overworld-bound like the hunt: its meshes live in the overworld root.
const challenge = new Challenge(world, world.root, hunt, inventory)
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
// Armor wear (fidelity pack): a piece ground down to zero durability snaps.
combat.armor.onBreak = () => sounds.play('toolBreak')

const screen = new InventoryScreen(inventory, player, combat.armor, cursor, drops, camera)
const furnaceScreen = new FurnaceScreen(furnaces, inventory, player, cursor, drops, camera)
const chestScreen = new ChestScreen(chests, inventory, player, world, cursor, drops, camera, sounds)

// The dimension controller (the Nether): owns { overworld, nether, current }
// and the travel swap — every world-holding system above is on its list.
// Constructed here because it needs them all; the saved dimension is applied
// right away (before the first frame), so a save made in the Nether loads
// straight back into it — position was already restored by save.load().
const dims = new Dimensions({
  overworld: world,
  nether,
  scene,
  player,
  interaction,
  combat,
  drops,
  torchLights,
  lavaLights,
  furnaces,
  chests,
  chestScreen,
  daynight,
})
save.attachDimensions(dims)
if (save.dimensionData === 'nether') dims.travel('nether')
// Load guard (lava feature): a save written before lava existed can restore
// the player inside a newly-flooded cave bottom — burning from frame one is
// a bad beat. blockAt answers from the generator + edit overlay even before
// chunks exist, so the check is correct here; teleport up to the walkable
// surface of whichever dimension the player restored into.
{
  const p = player.body.position
  const w = dims.current
  if (w.blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === BLOCK_LAVA) {
    player.teleport(p.x, w.surfaceY(p.x, p.z), p.z)
  }
}
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
  // Beds are overworld furniture: sleeping (and spawn-setting) is refused in
  // the Nether — the respawn point is overworld logic through and through.
  [BLOCK_BED]: (x, y, z) => {
    if (dims.current !== world) {
      sleep.onMessage?.('The bed refuses this place — sleep under an open sky')
      return true
    }
    return sleep.tryAt(x, y, z)
  },
  [BLOCK_CHEST]: (x, y, z) => {
    chestScreen.openAt(x, y, z)
    return true
  },
  // The King's Cache: every placed cache opens the SAME global store, so
  // there's no break handler row — breaking the block drops it while the
  // contents persist in enderStore (the whole point of an ender-style chest).
  [BLOCK_KINGS_CACHE]: () => {
    chestScreen.openStore(enderStore)
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
// Attachment pops (fidelity pack): torches and beds — the non-solid
// `targetable` blocks — need the block under them. When an edit leaves the
// cell no longer solid, the attachment above breaks into its drop (which
// unregisters a torch from the light registry via setBlock). One level
// only; a stack of attachments cascades naturally through the recursive
// onEdit. Explosions report once at the blast center, so the carved cells
// are swept below via onBlocksExploded — interior cells no-op (the cell
// above them was carved too), leaving exactly the sphere's top shell.
const popAttachmentIn = (w) => (x, y, z) => {
  if (isSolid(w.blockAt(x, y, z))) return
  const above = BLOCKS[w.blockAt(x, y + 1, z)]
  if (!above || above.solid || above.targetable !== true) return
  w.setBlock(x, y + 1, z, BLOCK_AIR)
  if (above.drop) drops.spawn(x + 0.5, y + 1.7, z + 0.5, above.drop)
  sounds.play('break', { material: above.material })
}
// Each world pops its own attachments (edits only ever happen in the world
// they belong to, so the handlers never cross).
world.onEdit(popAttachmentIn(world))
nether.onEdit(popAttachmentIn(nether))
combat.mobs.onBlocksExploded = (cells) => {
  for (const c of cells) {
    blockBreakHandlers[c.id]?.(c.x, c.y, c.z)
    popAttachmentIn(dims.current)(c.x, c.y, c.z)
  }
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
  dims.travel('overworld') // death in the Nether respawns under the sky
  combat.respawn()
  hunger.reset() // fresh spawn, fresh appetite
  breath.reset() // and fresh lungs — a drowning death can't respawn gasping
  burning.reset() // and no lingering fire — a lava death can't respawn burning
})
bindHungerHud(hunger)
bindBreathHud(breath)
bindArmorHud(combat.armor)
bindSleepFx(sleep, sounds)
bindResetButton(save)
const toggleQuestLog = bindQuestLog(hunt, challenge)
const updateTreasureHud = bindTreasureHud(hunt, challenge, camera, () => dims.current === world)
// Closing the screen re-locks the pointer; give the lock a beat to land
// before re-evaluating, so "click to play" only appears if it failed.
screen.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
reveal.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
challengeReveal.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
help.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
furnaceScreen.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
chestScreen.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))

// The King's Trial guidance layer (Herald / wisps / stele / banner): one
// contiguous block, bound AFTER the reveals and their onToggle assignments —
// it wraps reveal.onToggle (unlock apparition), bossFight.onBossEvent
// (boss-stage lines), and challenge.onComplete (farewell ceremony before the
// challengeReveal modal). It also takes over challenge.onToast: every trial
// message rides the queued Herald banner, not the single-slot toast.
const guidance = bindGuidance({
  scene: world.root, // overworld-bound — Herald/stele vanish in the Nether
  world,
  camera,
  player,
  challenge,
  hunt,
  reveal,
  challengeReveal,
  health: combat.health,
  sounds,
  particles,
})

// The King's Cache grant: completing the Trial hands the player ONE cache
// block (grant-item rather than a gated recipe — the crafting panel has no
// conditional-recipe machinery, and the block is blast-resistant so the one
// copy can't be destroyed; only mined and re-placed). The latch rides the
// enderChest save key, so reloads never re-grant — and a save that finished
// the Trial before this reward existed grants once on load via the boot
// call. Wired after bindGuidance: challenge.onToast is the Herald banner now.
const grantKingsCache = () => {
  if (!challenge.isComplete || enderStore.granted) return
  enderStore.markGranted()
  const leftover = inventory.add('kings_cache', 1)
  if (leftover > 0) drops.throwFrom(camera, 'kings_cache', leftover)
  challenge.onToast?.("The King's Cache is yours — one vault, wherever you place it.")
}
challenge.onChange(grantKingsCache)
grantKingsCache()

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
const updateFootsteps = createFootsteps(sounds, player, camera, () => dims.current)

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

// Submerged state (Phase 10 tint + deep water fog/audio/breath, generalized
// for lava): ONE camera-cell test decides which liquid the head is in —
// `liquid` holds the cell's liquid block id (0 = air) — so the washes, the
// breath drain, the fog swaps, and the audio muffle can never disagree.
// Breath deliberately drains only in WATER: in lava you are not holding
// breath, you are on fire — the damage channels stay legible. Runs after
// daynight.update in the loop, so the submerged fog near/far and color
// overwrite what DayNight just wrote; surfaced frames restore
// GRAPHICS.fogNear/fogFar and leave the color to DayNight.
const waterTint = document.getElementById('water-tint')
const lavaTint = document.getElementById('lava-tint')
const waterFogColor = new THREE.Color(WATER.fog.color)
const lavaFogColor = new THREE.Color(LAVA.fog.color)
let liquid = 0 // camera-cell liquid block id, 0 while surfaced
const updateUnderwater = () => {
  const p = camera.position
  const id = dims.current.blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
  const now = isLiquid(id) ? id : 0
  if (now !== liquid) {
    // Surface-crossing feedback (louder going in): splash + spray for
    // water, sizzle + embers for lava, and the master-bus low-pass muffle —
    // both liquids muffle through the one filter.
    if (now === BLOCK_LAVA || liquid === BLOCK_LAVA) {
      sounds.play('sizzle', { gain: now ? 1 : 0.55 })
      if (now) particles.burst(p.x, p.y - 0.3, p.z, LAVA.ember.color, 18)
    } else {
      sounds.play('splash', { gain: now ? 1 : 0.55 })
      if (now) particles.burst(p.x, p.y - 0.3, p.z, 0xdfefff, 18)
    }
    liquid = now
    sounds.setUnderwater(now !== 0)
  }
  waterTint.classList.toggle('hidden', liquid !== BLOCK_WATER)
  // The lava wash doubles as the after-burn cue: full-strength while the
  // camera is in lava, a faint edge glow while the after-burn ticks.
  const afterburning = liquid !== BLOCK_LAVA && burning.isBurning
  lavaTint.classList.toggle('hidden', liquid !== BLOCK_LAVA && !afterburning)
  lavaTint.classList.toggle('afterburn', afterburning)
  if (liquid === BLOCK_WATER) {
    scene.fog.near = WATER.fog.near
    scene.fog.far = WATER.fog.far
    scene.fog.color.lerp(waterFogColor, WATER.fog.colorBlend)
  } else if (liquid === BLOCK_LAVA) {
    scene.fog.near = LAVA.fog.near
    scene.fog.far = LAVA.fog.far
    scene.fog.color.lerp(lavaFogColor, LAVA.fog.colorBlend)
  } else {
    // Surfaced: restore the current dimension's baseline. The overworld
    // leaves the color to DayNight (base.color null); the Nether's static
    // red is re-asserted here since nothing else repaints it.
    const base = dims.baseFog()
    scene.fog.near = base.near
    scene.fog.far = base.far
    if (base.color !== null) scene.fog.color.setHex(base.color)
  }
}

// Lava ambience (lava feature): while an exposed pool surface is nearby
// (LavaLights already tracks the nearest), it pops and spits embers every
// few seconds — gain fading with distance, the zombie hearRadius pattern.
let lavaPopTimer = LAVA.pops.maxSeconds
const updateLavaAmbience = (delta) => {
  if (!player.isLocked) return
  lavaPopTimer -= delta
  if (lavaPopTimer > 0) return
  lavaPopTimer =
    LAVA.pops.minSeconds + Math.random() * (LAVA.pops.maxSeconds - LAVA.pops.minSeconds)
  const near = lavaLights.nearest
  if (!near || near.d2 > LAVA.pops.radius ** 2) return
  const gain = 1 - Math.sqrt(near.d2) / LAVA.pops.radius
  sounds.play('lavaPop', { gain })
  const c = near.cell
  particles.burst(c.x + 0.5, c.y + 1, c.z + 0.5, LAVA.ember.color, LAVA.pops.embers)
}

// Nether ambience (N2): a sparse low swell while the Nether is current —
// the lava-pops timer pattern, gated on being in control like every ambience.
let netherAmbienceTimer = 0 // first swell greets the first arrival
const updateNetherAmbience = (delta) => {
  if (!player.isLocked || dims.current !== nether) return
  netherAmbienceTimer -= delta
  if (netherAmbienceTimer > 0) return
  const { minSeconds, maxSeconds } = config.NETHER.ambience
  netherAmbienceTimer = minSeconds + Math.random() * (maxSeconds - minSeconds)
  sounds.play('netherAmbience')
}

renderer.setAnimationLoop(() => {
  // Clamp delta so a backgrounded tab doesn't produce a huge jump on resume.
  const delta = Math.min(clock.getDelta(), 0.1)
  dims.current.update(camera.position) // stream chunks for the active dimension
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
    // Breath shares hunger's gate (menus/death freeze it) and the camera
    // liquid updateUnderwater maintains each frame — water only, on purpose.
    breath.update(delta, { submerged: liquid === BLOCK_WATER })
    // Burning shares the same gate; body-midsection flags (you burn wading
    // chest-deep, not only when your eyes go under). The body's inWater
    // means "any liquid", so real water is inWater && !inLava.
    burning.update(delta, {
      inLava: player.body.inLava,
      inWater: player.body.inWater && !player.body.inLava,
    })
  }
  if (player.isLocked || furnaceScreen.isOpen) furnaces.update(delta)
  // Quest systems are overworld-bound: their targets, meshes, and proximity
  // checks are overworld coordinates, so they idle while the Nether is
  // current (the compass HUD hides through its own isActive gate).
  if (dims.current === world) {
    hunt.update(delta, camera.position)
    challenge.update(delta, camera.position)
    guidance.update(delta, camera.position)
  }
  particles.update(delta)
  drops.update(delta, camera.position)
  fx.viewmodel.update(delta)
  // The sky keeps rendering behind menus, but game time only passes while
  // the player is in control — matching the physics/combat pause.
  daynight.update(player.isLocked ? delta : 0)
  clouds.update(delta, camera.position)
  torchLights.update(camera.position)
  lavaLights.update(camera.position)
  updateUnderwater()
  updateLavaAmbience(delta)
  updateNetherAmbience(delta)
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
  // "The world I'm standing in" — tests already treat it that way, so it
  // follows the active dimension; __mc.dims exposes both worlds + travel.
  get world() {
    return dims.current
  },
  dims,
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
  herald: guidance.herald,
  wisps: guidance.wisps,
  stele: guidance.stele,
  heraldBanner: guidance.banner,
  touch,
  help,
  sounds,
  particles,
  drops,
  viewmodel: fx.viewmodel,
  daynight,
  clouds,
  hunger,
  breath,
  furnaces,
  furnaceScreen,
  chests,
  chestScreen,
  enderStore,
  torchLights,
  lavaLights,
  burning,
  armor: combat.armor,
  projectiles: combat.projectiles,
  sleep,
  cursor,
  // The live config module (headless-test seam): most tunables are read at
  // call time, so tests can shrink timings/radii — e.g.
  // config.COMBAT.mobs.spawnRadiusMax — without rebuilding.
  config,
}
