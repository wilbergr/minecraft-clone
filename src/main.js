import * as THREE from 'three'
import { GRAPHICS } from './config.js'
import { World } from './world/World.js'
import { PlayerControls } from './player/PlayerControls.js'
import { BlockInteraction } from './player/BlockInteraction.js'
import { Inventory } from './inventory/Inventory.js'
import { Combat } from './combat/Combat.js'
import { bindOverlay } from './ui/overlay.js'
import { bindHotbar } from './ui/hotbar.js'
import { bindHud } from './ui/hud.js'
import { InventoryScreen } from './ui/inventoryScreen.js'

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
const interaction = new BlockInteraction(camera, world, player, scene, inventory)

const combat = new Combat(camera, world, player, inventory, interaction, scene)

const screen = new InventoryScreen(inventory, player)
// The death screen counts as open UI so "click to play" stays out of its way.
const refreshOverlay = bindOverlay(player, () => screen.isOpen || combat.health.isDead)
bindHotbar(inventory, player)
bindHud(combat.health, () => combat.respawn())
// Closing the screen re-locks the pointer; give the lock a beat to land
// before re-evaluating, so "click to play" only appears if it failed.
screen.onToggle = (open) => (open ? refreshOverlay() : setTimeout(refreshOverlay, 150))

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
  interaction.update()
  combat.update(delta)
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
}
