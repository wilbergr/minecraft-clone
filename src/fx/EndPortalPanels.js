import * as THREE from 'three'
import { END } from '../config.js'

// End-portal field rendering — PortalPanels' horizontal sibling: the field
// block is never meshed, so this watches the ACTIVE world's endPortals
// registry and keeps one near-black translucent plane per field cell, lying
// flat a little above the floor (the field is a pool you stand on, not a
// doorway). Panels rebuild only when the registry's key set changes — travel
// swaps `world`, whose different key set triggers the rebuild for free. A
// slow violet particle shimmer (the pooled burst) sells the surface.
export class EndPortalPanels {
  constructor(scene, dims, particles) {
    this.dims = dims
    this.particles = particles
    this.group = new THREE.Group()
    scene.add(this.group)
    const { color, opacity } = END.portal.panel
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
    const portals = this.dims.current.endPortals
    const key = portals.size === 0 ? '' : [...portals.keys()].join(';')
    if (key !== this.key) {
      this.key = key
      this.#rebuild()
    }
    if (portals.size === 0) return

    this.shimmerTimer -= delta
    if (this.shimmerTimer <= 0) {
      const s = END.portal.shimmer
      this.shimmerTimer = s.intervalSeconds
      const cells = [...portals.values()]
      const c = cells[Math.floor(Math.random() * cells.length)]
      const d2 = (c.x + 0.5 - cameraPos.x) ** 2 + (c.z + 0.5 - cameraPos.z) ** 2
      if (d2 <= s.radius * s.radius) {
        this.particles?.burst(c.x + 0.5, c.y + 0.4, c.z + 0.5, s.color, s.count)
        this.shimmers++
      }
    }
  }

  #rebuild() {
    for (const mesh of [...this.group.children]) this.group.remove(mesh)
    const portals = this.dims.current.endPortals
    for (const c of portals.values()) {
      const mesh = new THREE.Mesh(this.geometry, this.material)
      mesh.rotation.x = -Math.PI / 2 // flat — the field is a floor pool
      mesh.position.set(c.x + 0.5, c.y + END.portal.panel.drop, c.z + 0.5)
      this.group.add(mesh)
    }
  }
}
