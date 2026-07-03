import * as THREE from 'three'
import { GRAPHICS } from './config.js'
import { World } from './world/World.js'
import { PlayerControls } from './player/PlayerControls.js'
import { BlockInteraction } from './player/BlockInteraction.js'
import { TouchControls } from './player/TouchControls.js'
import { Inventory } from './inventory/Inventory.js'
import { Combat } from './combat/Combat.js'
import { SaveManager } from './save/SaveManager.js'
import { TreasureHunt } from './treasure/TreasureHunt.js'
import { bindOverlay } from './ui/overlay.js'
import { bindHotbar } from './ui/hotbar.js'
import { bindHud } from './ui/hud.js'
import { bindResetButton } from './ui/resetButton.js'
import { InventoryScreen } from './ui/inventoryScreen.js'
import { bindQuestLog } from './ui/questLog.js'
import { bindTreasureHud } from './ui/treasureHud.js'
import { bindTreasureReveal } from './ui/treasureReveal.js'
import { bindHelp } from './ui/help.js'
import { bindMuteButton } from './ui/muteButton.js'
import { SoundEngine } from './audio/SoundEngine.js'
import { createFootsteps } from './audio/Footsteps.js'
import { Particles } from './fx/Particles.js'
import { Viewmodel } from './fx/Viewmodel.js'
import { GroundItems } from './fx/GroundItems.js'

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

// Feedback layer (Phase 9): synthesized sound, break particles, ground item
// drops, and the held-item viewmodel, bundled into the `fx` object the game
// systems hook into (every hook optional).
scene.add(camera) // the viewmodel is a camera child; children need the camera in-scene
const sounds = new SoundEngine()
const particles = new Particles(scene)
const drops = new GroundItems(scene, world, inventory, sounds)
const fx = { sounds, particles, drops, viewmodel: null, health: null }

const interaction = new BlockInteraction(camera, world, player, scene, inventory, fx)

const combat = new Combat(camera, world, player, inventory, interaction, scene, fx)
fx.health = combat.health
fx.viewmodel = new Viewmodel(camera, inventory, player)
const hunt = new TreasureHunt(world, scene)

// Restore a saved game before anything renders: block edits must be in the
// overlay before the first chunks generate, and the UI binders below pick up
// the restored inventory/health through their initial renders.
const save = new SaveManager({ world, player, inventory, health: combat.health })
save.load()
save.attachTreasure(hunt)

const screen = new InventoryScreen(inventory, player)
const reveal = bindTreasureReveal(hunt, player)
const help = bindHelp(player)
// The death screen, treasure reveal, and help panel count as open UI so
// "click to play" stays out of their way.
const refreshOverlay = bindOverlay(
  player,
  () => screen.isOpen || combat.health.isDead || reveal.isOpen || help.isOpen,
)
bindHotbar(inventory, player)
bindHud(combat.health, () => combat.respawn())
bindResetButton(save)
const toggleQuestLog = bindQuestLog(hunt)
const updateTreasureHud = bindTreasureHud(hunt, camera)
// Closing the screen re-locks the pointer; give the lock a beat to land
// before re-evaluating, so "click to play" only appears if it failed.
screen.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
reveal.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))
help.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))

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

renderer.setAnimationLoop(() => {
  // Clamp delta so a backgrounded tab doesn't produce a huge jump on resume.
  const delta = Math.min(clock.getDelta(), 0.1)
  world.update(camera.position)
  player.update(delta)
  interaction.update(delta)
  combat.update(delta)
  hunt.update(delta, camera.position)
  particles.update(delta)
  drops.update(delta, camera.position)
  fx.viewmodel.update(delta)
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
  touch,
  help,
  sounds,
  particles,
  drops,
  viewmodel: fx.viewmodel,
}
