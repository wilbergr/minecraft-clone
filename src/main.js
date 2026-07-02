import * as THREE from 'three'
import { GRAPHICS } from './config.js'
import { World } from './world/World.js'
import { PlayerControls } from './player/PlayerControls.js'
import { bindOverlay } from './ui/overlay.js'

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

bindOverlay(player)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

const clock = new THREE.Clock()

renderer.setAnimationLoop(() => {
  // Clamp delta so a backgrounded tab doesn't produce a huge jump on resume.
  const delta = Math.min(clock.getDelta(), 0.1)
  player.update(delta)
  renderer.render(scene, camera)
})

// Debug/test hook (used by automated browser verification; harmless in prod).
window.__mc = { scene, camera, player, renderer }
