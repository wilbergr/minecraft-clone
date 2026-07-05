import * as THREE from 'three'
import { DAYNIGHT } from '../config.js'

// Day/night cycle (Phase 10). Owns the game-time clock — `time` in [0, 1):
// 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight — and drives everything
// that expresses it: scene background + fog color, the directional light's
// direction/intensity/color (moonlight takes over at night), the ambient
// level, and sun/moon billboard sprites that ride the sky opposite each
// other. All visual values lerp through DAYNIGHT.keyframes.
//
// The clock advances only while the player is in control (main.js passes
// delta = 0 when unlocked), matching how physics/combat pause in menus, and
// persists in the save via SaveManager.attachDayNight. MobManager reads
// `isNight` to gate hostile spawns.
export class DayNight {
  #color = new THREE.Color()
  #colorB = new THREE.Color()
  #colorC = new THREE.Color()
  #dir = new THREE.Vector3()
  #maxSunIntensity = 1

  constructor(scene, world, camera) {
    this.scene = scene
    this.camera = camera
    this.sunLight = world.sun
    this.ambient = world.ambient
    this.time = DAYNIGHT.startTime
    // Normalized sky brightness [~0.1, 1] — the sampled sun intensity over
    // its keyframe max. Noon ≈ 1, night ≈ 0.1, dusk/dawn lerp between.
    // world.lightAt multiplies it into the depth-based sky light so mob
    // spawning can ask "how dark is this cell right now" (dark-places spawn).
    this.skyBrightness = 1
    this.#maxSunIntensity = Math.max(...DAYNIGHT.keyframes.map((k) => k[2]))
    this.sunSprite = this.#makeBillboard(DAYNIGHT.sun)
    this.moonSprite = this.#makeBillboard(DAYNIGHT.moon)
    scene.add(this.sunSprite, this.moonSprite)
    this.update(0) // apply the starting time before the first frame renders
  }

  get isNight() {
    const { start, end } = DAYNIGHT.night
    return this.time >= start && this.time < end
  }

  // Test/debug seam: jump the clock (fraction of a day) and apply instantly.
  setTime(t) {
    this.time = ((t % 1) + 1) % 1
    this.update(0)
  }

  update(delta) {
    this.time = (this.time + delta / DAYNIGHT.dayLengthSeconds) % 1

    // Sample the keyframe table around the current time.
    const [sky, sunIntensity, ambientIntensity, lightColor] = this.#sample()
    this.skyBrightness = sunIntensity / this.#maxSunIntensity
    this.scene.background.copy(sky)
    this.scene.fog.color.copy(sky)
    this.sunLight.intensity = sunIntensity
    this.sunLight.color.copy(lightColor)
    this.ambient.intensity = ambientIntensity

    // Sun path: rises in +x at t=0, peaks at noon, sets in -x; the moon is
    // exactly opposite. A slight z lean keeps face shading asymmetric.
    const angle = this.time * Math.PI * 2
    this.#dir.set(Math.cos(angle), Math.sin(angle), 0.3).normalize()
    const sunDir = this.#dir

    // Whichever body is up lights the world (intensity/color already faded
    // near the horizon by the keyframes, so the swap never pops).
    this.sunLight.position
      .copy(sunDir)
      .multiplyScalar(sunDir.y >= 0 ? 60 : -60)

    // Billboards track the camera so they read as celestial, not parallax.
    const cam = this.camera.position
    this.sunSprite.position
      .copy(sunDir)
      .multiplyScalar(DAYNIGHT.sun.distance)
      .add(cam)
    this.moonSprite.position
      .copy(sunDir)
      .multiplyScalar(-DAYNIGHT.moon.distance)
      .add(cam)
  }

  // --- Persistence (SaveManager.attachDayNight) ----------------------------

  serialize() {
    return { time: this.time }
  }

  deserialize(data) {
    if (Number.isFinite(data?.time)) this.setTime(data.time)
  }

  // Lerp [skyColor, sunIntensity, ambientIntensity, lightColor] between the
  // two keyframes bracketing `time`. The table starts at 0 and ends at 1
  // with matching values, so a bracket always exists.
  #sample() {
    const frames = DAYNIGHT.keyframes
    let i = 1
    while (i < frames.length - 1 && frames[i][0] < this.time) i++
    const [t0, skyA, sunA, ambA, lightA] = frames[i - 1]
    const [t1, skyB, sunB, ambB, lightB] = frames[i]
    const f = t1 > t0 ? (this.time - t0) / (t1 - t0) : 0
    return [
      this.#color.setHex(skyA).lerp(this.#colorC.setHex(skyB), f),
      sunA + (sunB - sunA) * f,
      ambA + (ambB - ambA) * f,
      this.#colorB.setHex(lightA).lerp(this.#colorC.setHex(lightB), f),
    ]
  }

  // A soft radial disc on a canvas — no texture assets, matching the
  // synthesized-everything approach. fog:false keeps the sky bodies crisp.
  #makeBillboard({ size, color }) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    const grad = ctx.createRadialGradient(32, 32, 6, 32, 32, 30)
    const c = new THREE.Color(color)
    const rgb = `${(c.r * 255) | 0}, ${(c.g * 255) | 0}, ${(c.b * 255) | 0}`
    grad.addColorStop(0, `rgba(${rgb}, 1)`)
    grad.addColorStop(0.6, `rgba(${rgb}, 0.9)`)
    grad.addColorStop(1, `rgba(${rgb}, 0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 64)
    const material = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      fog: false,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(size, size, 1)
    return sprite
  }
}
