import { NETHER, WATER } from '../config.js'
import { BLOCK_AIR, BLOCK_PORTAL, isSolid } from './blocks.js'

// The Nether portal (N3): frame detection + ignition, the stand-in-the-field
// charge loop, 8:1 travel with linked-portal search, return-portal
// construction as ordinary edits, and frame-break collapse. Owns no meshes —
// PortalPanels (src/fx) renders the registry; main.js wires the vignette and
// sounds through the onChargeStart/onCharge/onTravel/onIgnite hooks.
//
// Everything works through world.blockAt/setBlock, so detection, linking,
// and construction are correct even when the target world has ZERO chunks
// loaded — edits land in the overlay and materialize when chunks generate.
export class Portals {
  // True while ignition/construction/collapse writes portal cells — the
  // onEdit collapse validator must not re-enter on its own edits or judge a
  // half-filled cluster.
  #filling = false

  constructor(dims, player, camera) {
    this.dims = dims
    this.player = player
    this.camera = camera
    this.charge = 0
    // Re-trigger latch: set on arrival (the return portal would instantly
    // charge again), cleared the first frame the camera leaves the field.
    // Starts true so a save restored standing inside a portal doesn't
    // auto-travel — step out first, like arriving.
    this.justArrived = true
    this.onChargeStart = null // () — the rising tone starts
    this.onCharge = null // (fraction 0..1) — drives the vignette
    this.onTravel = null // (dimensionName) — travel feedback
    this.onIgnite = null // (ok, x, y, z) — strike feedback / fizzle
    this.travelCount = 0 // test observability
    // Frame-break collapse: any edit beside a portal cell re-validates its
    // cluster (the popAttachmentAbove pattern — each world watches itself).
    dims.overworld.onEdit((x, y, z) => this.#checkCollapse(dims.overworld, x, y, z))
    dims.nether.onEdit((x, y, z) => this.#checkCollapse(dims.nether, x, y, z))
  }

  // --- Ignition --------------------------------------------------------------

  // Light the frame the player clicked (flint & steel use verb): the
  // candidate interior cell is target + normal — the placement cell — and
  // the fixed 2×3 interior is searched at every offset that would contain
  // it, in both orientations. Returns true when a portal ignited.
  tryIgnite(world, target) {
    if (!target) return false
    const [nx, ny, nz] = target.normal
    const cx = target.x + nx
    const cy = target.y + ny
    const cz = target.z + nz
    const { width, height } = NETHER.portal.interior
    for (const axis of ['x', 'z']) {
      for (let du = -(width - 1); du <= 0; du++) {
        for (let dy = -(height - 1); dy <= 0; dy++) {
          const ax = cx + (axis === 'x' ? du : 0)
          const az = cz + (axis === 'z' ? du : 0)
          const ay = cy + dy
          if (!this.#frameAt(world, ax, ay, az, axis)) continue
          this.#filling = true
          for (let u = 0; u < width; u++) {
            for (let y = 0; y < height; y++) {
              world.setBlock(
                ax + (axis === 'x' ? u : 0),
                ay + y,
                az + (axis === 'z' ? u : 0),
                BLOCK_PORTAL,
              )
            }
          }
          this.#filling = false
          this.onIgnite?.(true, ax, ay, az)
          return true
        }
      }
    }
    this.onIgnite?.(false, cx, cy, cz)
    return false
  }

  // Is there a complete frame whose interior anchor (min corner) sits at
  // (ax, ay, az) along `axis`? Interior must be all air; the surrounding
  // ring all obsidian, corners optional (MC-style).
  #frameAt(world, ax, ay, az, axis) {
    const { width, height } = NETHER.portal.interior
    const frameId = NETHER.portal.frameBlockId
    const cell = (u, y) => ({
      x: ax + (axis === 'x' ? u : 0),
      y: ay + y,
      z: az + (axis === 'z' ? u : 0),
    })
    for (let u = -1; u <= width; u++) {
      for (let y = -1; y <= height; y++) {
        const interior = u >= 0 && u < width && y >= 0 && y < height
        const corner = (u === -1 || u === width) && (y === -1 || y === height)
        const { x, y: wy, z } = cell(u, y)
        const id = world.blockAt(x, wy, z)
        if (interior) {
          if (id !== BLOCK_AIR) return false
        } else if (!corner && id !== frameId) {
          return false
        }
      }
    }
    return true
  }

  // --- Frame-break collapse ----------------------------------------------------

  // An edit landed at (x, y, z): re-validate any portal cluster touching it.
  // A cluster whose ring is no longer intact (or whose cells no longer form
  // the fixed 2×3 rectangle) collapses to air — no drops, MC-style.
  #checkCollapse(world, x, y, z) {
    if (this.#filling || world.portals.size === 0) return
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = world.portals.get(`${x + dx},${y + dy},${z + dz}`)
          if (!cell) continue
          const cluster = this.#cluster(world, cell)
          if (!this.#clusterValid(world, cluster)) {
            this.#filling = true // the collapse edits must not re-enter
            for (const c of cluster) world.setBlock(c.x, c.y, c.z, BLOCK_AIR)
            this.#filling = false
          }
          return // one cluster per edit is enough — clusters never touch
        }
      }
    }
  }

  // Flood the connected portal cells around `start` (6 cells for an intact
  // portal — bounded, clusters are tiny).
  #cluster(world, start) {
    const cells = []
    const seen = new Set()
    const stack = [start]
    while (stack.length) {
      const c = stack.pop()
      const k = `${c.x},${c.y},${c.z}`
      if (seen.has(k)) continue
      seen.add(k)
      const cell = world.portals.get(k)
      if (!cell) continue
      cells.push(cell)
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        stack.push({ x: c.x + dx, y: c.y + dy, z: c.z + dz })
      }
    }
    return cells
  }

  // A valid cluster is exactly the configured interior rectangle with its
  // (corner-optional) obsidian ring intact.
  #clusterValid(world, cluster) {
    const { width, height } = NETHER.portal.interior
    if (cluster.length !== width * height) return false
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const c of cluster) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x)
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y)
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z)
    }
    if (maxY - minY !== height - 1) return false
    const spanX = maxX - minX
    const spanZ = maxZ - minZ
    let axis
    if (spanX === width - 1 && spanZ === 0) axis = 'x'
    else if (spanZ === width - 1 && spanX === 0) axis = 'z'
    else return false
    const frameId = NETHER.portal.frameBlockId
    for (let u = -1; u <= width; u++) {
      for (let y = -1; y <= height; y++) {
        const interior = u >= 0 && u < width && y >= 0 && y < height
        const corner = (u === -1 || u === width) && (y === -1 || y === height)
        if (interior || corner) continue
        const x = minX + (axis === 'x' ? u : 0)
        const z = minZ + (axis === 'z' ? u : 0)
        if (world.blockAt(x, minY + y, z) !== frameId) return false
      }
    }
    return true
  }

  // --- Charge & travel ---------------------------------------------------------

  update(delta) {
    const world = this.dims.current
    const p = this.camera.position
    const inField =
      world.blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === BLOCK_PORTAL
    if (!inField) {
      this.justArrived = false
      if (this.charge > 0) {
        this.charge = Math.max(0, this.charge - delta * 2) // decays fast
        this.onCharge?.(this.charge / NETHER.portal.chargeSeconds)
      }
      return
    }
    if (this.justArrived || !this.player.isLocked) return // menus pause the charge
    if (this.charge === 0) this.onChargeStart?.()
    this.charge += delta
    const fraction = Math.min(1, this.charge / NETHER.portal.chargeSeconds)
    this.onCharge?.(fraction)
    if (this.charge >= NETHER.portal.chargeSeconds) {
      this.charge = 0
      this.onCharge?.(0)
      this.#travel()
    }
  }

  // Cross over: scale coordinates 8:1, link to an existing portal near the
  // scaled target, or find a safe pocket and BUILD the return portal there
  // as edits. Arrival lands the feet inside the destination field with the
  // justArrived latch set.
  #travel() {
    const { dims } = this
    const goingDown = dims.current === dims.overworld
    const to = goingDown ? dims.nether : dims.overworld
    const scale = goingDown ? 1 / NETHER.portal.scale : NETHER.portal.scale
    const feet = this.player.body.position
    const tx = Math.floor(feet.x * scale)
    const tz = Math.floor(feet.z * scale)

    const linked = this.#nearestPortal(to, tx, tz)
    const arrival = linked
      ? this.#arrivalFeet(to, linked)
      : this.#buildPortal(to, tx, tz)

    this.justArrived = true
    this.travelCount++
    dims.travel(goingDown ? 'nether' : 'overworld', arrival)
    this.onTravel?.(dims.name)
  }

  // Nearest portal cell within the destination's link radius (horizontal).
  #nearestPortal(world, tx, tz) {
    const radius =
      world === this.dims.nether
        ? NETHER.portal.linkRadius.nether
        : NETHER.portal.linkRadius.overworld
    let best = null
    let bestD2 = radius * radius
    for (const c of world.portals.values()) {
      const d2 = (c.x - tx) ** 2 + (c.z - tz) ** 2
      if (d2 <= bestD2) {
        bestD2 = d2
        best = c
      }
    }
    return best
  }

  // Feet position inside a linked portal: the bottom cell of its column.
  #arrivalFeet(world, cell) {
    let y = cell.y
    while (world.portals.has(`${cell.x},${y - 1},${cell.z}`)) y--
    return { x: cell.x + 0.5, y, z: cell.z + 0.5 }
  }

  // Build a return portal near the scaled target: a full obsidian ring
  // (corners included — sturdier against edge-noise than the optional-corner
  // check requires), portal-filled interior, and a ledge stamped under any
  // unsupported frame column. All setBlock edits — the purity rule holds.
  #buildPortal(world, tx, tz) {
    const spot = this.#findSpot(world, tx, tz)
    const { width, height } = NETHER.portal.interior
    const frameId = NETHER.portal.frameBlockId
    const ledgeId =
      world === this.dims.nether
        ? NETHER.portal.ledgeBlockId.nether
        : NETHER.portal.ledgeBlockId.overworld
    this.#filling = true
    // Ledge: solid footing under the ring row and one block in front, so
    // stepping out never drops the player into whatever was below.
    for (let u = -1; u <= width; u++) {
      for (const dz of [0, 1]) {
        const x = spot.x + u
        const z = spot.z + dz
        if (!isSolid(world.blockAt(x, spot.y - 1, z))) {
          world.setBlock(x, spot.y - 1, z, ledgeId)
        }
      }
    }
    // Ring (x-axis orientation, corners included), field cells directly —
    // construction overwrites whatever the pocket wall held, which is how a
    // frame carves its own niche into a cavern wall.
    for (let u = -1; u <= width; u++) {
      for (let y = -1; y <= height; y++) {
        const interior = u >= 0 && u < width && y >= 0 && y < height
        world.setBlock(spot.x + u, spot.y + y, spot.z, interior ? BLOCK_PORTAL : frameId)
      }
    }
    // Step-out headroom in front of the field.
    for (let u = 0; u < width; u++) {
      for (let y = 0; y < height; y++) {
        const id = world.blockAt(spot.x + u, spot.y + y, spot.z + 1)
        if (isSolid(id)) world.setBlock(spot.x + u, spot.y + y, spot.z + 1, BLOCK_AIR)
      }
    }
    this.#filling = false
    return { x: spot.x + 0.5, y: spot.y, z: spot.z + 0.5 }
  }

  // Deterministic outward column search for a safe frame spot (the
  // relaxation-ladder pattern): a standable pocket — solid floor, air for
  // the frame — near the scaled target. Falls back to a ledge just above
  // the world's fluid surface (the MC obsidian-platform move) when nothing
  // walkable is in range: over a lava sea in the Nether, above the water on
  // an ocean return.
  #findSpot(world, tx, tz) {
    const R = NETHER.portal.searchRadius
    const nether = world === this.dims.nether
    for (let r = 0; r <= R; r += 1) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dz of dx === -r || dx === r ? this.#span(r) : [-r, r]) {
          const x = tx + dx
          const z = tz + dz
          const y = this.#pocketY(world, x, z, nether)
          if (y !== null) return { x, y, z }
        }
      }
    }
    // Relaxation floor: hover the frame one block above the fluid surface —
    // the ledge stamp in #buildPortal supplies the footing.
    return { x: tx, y: world.fluid.level + 2, z: tz }
  }

  #span(r) {
    const out = []
    for (let i = -r; i <= r; i++) out.push(i)
    return out
  }

  // Standable frame spot in this column, or null. Overworld: the surface,
  // dry columns only (ocean returns shift to the nearest dry column).
  // Nether: the first pocket above the lava with frame headroom.
  #pocketY(world, x, z, nether) {
    if (!nether) {
      if (world.terrainHeight(x, z) <= WATER.level) return null // ocean column
      const y = world.surfaceY(x + 0.5, z + 0.5)
      return y > 1 ? y : null
    }
    const { height } = NETHER.portal.interior
    for (let y = NETHER.terrain.lava.level + 2; y < NETHER.terrain.shoulders.roof - height; y++) {
      if (!isSolid(world.blockAt(x, y - 1, z))) continue
      let clear = true
      for (let dy = 0; dy <= height; dy++) {
        if (world.blockAt(x, y + dy, z) !== BLOCK_AIR) {
          clear = false
          break
        }
      }
      if (clear) return y
    }
    return null
  }
}
