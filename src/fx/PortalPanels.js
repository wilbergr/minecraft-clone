import * as THREE from 'three'
import { NETHER } from '../config.js'

// Portal-field rendering (N3) — TorchLights' sibling: the portal block is
// never meshed, so this watches the ACTIVE world's portal registry and keeps
// one translucent plane per field cell, oriented to the frame (a cell with a
// portal neighbor along x spans the xz... no — spans x/y and faces z, and
// vice versa). Panels rebuild only when the registry's key set changes —
// travel swaps `world`, whose different key set triggers the rebuild for
// free. A slow particle shimmer (the pooled burst) sells the surface.
export class PortalPanels {
  constructor(scene, dims, particles) {
    this.dims = dims
    this.particles = particles
    this.group = new THREE.Group()
    scene.add(this.group)
    const { color, opacity } = NETHER.portal.panel
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.geometry = new THREE.PlaneGeometry(1, 1)
    this.key = ''
    this.shimmerTimer = 0
    this.shimmers = 0 // test observability
  }

  get count() {
    return this.group.children.length
  }

  update(delta, cameraPos) {
    const portals = this.dims.current.portals
    const key = portals.size === 0 ? '' : [...portals.keys()].join(';')
    if (key !== this.key) {
      this.key = key
      this.#rebuild()
    }
    if (portals.size === 0) return

    this.shimmerTimer -= delta
    if (this.shimmerTimer <= 0) {
      const s = NETHER.portal.shimmer
      this.shimmerTimer = s.intervalSeconds
      const cells = [...portals.values()]
      const c = cells[Math.floor(Math.random() * cells.length)]
      const d2 = (c.x + 0.5 - cameraPos.x) ** 2 + (c.z + 0.5 - cameraPos.z) ** 2
      if (d2 <= s.radius * s.radius) {
        this.particles?.burst(c.x + 0.5, c.y + 0.5, c.z + 0.5, s.color, s.count)
        this.shimmers++
      }
    }
  }

  #rebuild() {
    for (const mesh of [...this.group.children]) this.group.remove(mesh)
    const portals = this.dims.current.portals
    for (const c of portals.values()) {
      // Orientation: a portal neighbor along x means the field spans x —
      // the plane's default xy footprint already faces z; a neighbor along
      // z rotates it 90°. Isolated cells (mid-collapse) default to x-span.
      const spansX =
        portals.has(`${c.x + 1},${c.y},${c.z}`) ||
        portals.has(`${c.x - 1},${c.y},${c.z}`)
      const spansZ =
        portals.has(`${c.x},${c.y},${c.z + 1}`) ||
        portals.has(`${c.x},${c.y},${c.z - 1}`)
      const mesh = new THREE.Mesh(this.geometry, this.material)
      mesh.position.set(c.x + 0.5, c.y + 0.5, c.z + 0.5)
      if (!spansX && spansZ) mesh.rotation.y = Math.PI / 2
      this.group.add(mesh)
    }
  }
}
