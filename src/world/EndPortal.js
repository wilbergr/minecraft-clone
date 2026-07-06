import { END, PLAYER } from '../config.js'
import { BLOCK_AIR, BLOCK_OBSIDIAN, isSolid } from './blocks.js'

// The End portal (the End) — Portals' flat-ring cousin: a 3×3 interior ring
// of 12 craftable frame blocks (corners empty, MC's silhouette) laid on any
// floor that SELF-ACTIVATES the moment the ring completes — no activation
// item (no endermen ⇒ no eyes of ender; the recipe cost is the gate, the
// "no flint" divergence precedent). Standing ON the field (the FEET cell —
// the field sits at floor level, so the nether portal's camera-cell test
// would never trigger) charges the same decay/vignette loop, then travel.
//
// Direction is keyed on the dimension you stand in: overworld field → the
// End (first arrival stamps a 5×5 obsidian platform as edits at the probed
// END.arrival column); End field → home to the bed/world spawn. The End is
// one-way until victory by construction — the only End-side field is the
// exit portal the dragon's death stamps (src/quest/DragonFight.js), and
// death routes home through the existing keep-inventory respawn.
//
// Ring detection and frame-break collapse are onEdit subscribers on the two
// worlds an End portal can live in (never the Nether — activation there is
// refused by not subscribing). Everything works through blockAt/setBlock, so
// detection and collapse are correct even with zero chunks loaded; field
// cells ride the world.endPortals registry (rebuilt from the edit overlay on
// load — no save key).
export class EndPortal {
  // True while activation/collapse writes field cells — the onEdit
  // subscriber must not re-enter on its own edits.
  #filling = false

  constructor(dims, player, camera) {
    this.dims = dims
    this.player = player
    this.camera = camera
    this.charge = 0
    // Re-trigger latch (the Portals convention): set on arrival, cleared the
    // first frame the feet leave a field. Starts true so a save restored
    // standing on a field doesn't auto-travel.
    this.justArrived = true
    this.onChargeStart = null // () — the rising tone starts
    this.onCharge = null // (fraction 0..1) — drives the vignette
    this.onTravel = null // (dimensionName) — travel feedback
    this.onOpen = null // (x, y, z) — a ring completed (field center cell)
    this.travelCount = 0 // test observability
    dims.overworld.onEdit((x, y, z) => this.#onEdit(dims.overworld, x, y, z))
    dims.end.onEdit((x, y, z) => this.#onEdit(dims.end, x, y, z))
  }

  // --- Ring detection & collapse ---------------------------------------------

  #onEdit(world, x, y, z) {
    if (this.#filling) return
    this.#checkCollapse(world, x, y, z)
    this.#checkActivation(world, x, y, z)
  }

  // Any edit whose cell could participate in a ring (as frame OR interior —
  // so clearing a blocked interior also completes) tests the ≤25 candidate
  // interior anchors that would contain it.
  #checkActivation(world, x, y, z) {
    const N = END.portal.interior
    for (let du = -N; du <= 1; du++) {
      for (let dv = -N; dv <= 1; dv++) {
        const ax = x + du
        const az = z + dv
        if (!this.#ringComplete(world, ax, y, az)) continue
        this.#filling = true
        for (let u = 0; u < N; u++) {
          for (let v = 0; v < N; v++) {
            world.setBlock(ax + u, y, az + v, END.portal.blockId)
          }
        }
        this.#filling = false
        this.onOpen?.(ax + 1, y, az + 1)
        return
      }
    }
  }

  // Is there a complete, unfilled ring whose interior min corner sits at
  // (ax, ay, az)? All 12 ring cells frame blocks, all 9 interior cells air
  // (corners are anything, MC-style).
  #ringComplete(world, ax, ay, az) {
    const N = END.portal.interior
    for (let u = -1; u <= N; u++) {
      for (let v = -1; v <= N; v++) {
        const interior = u >= 0 && u < N && v >= 0 && v < N
        const corner = (u === -1 || u === N) && (v === -1 || v === N)
        const id = world.blockAt(ax + u, ay, az + v)
        if (interior) {
          if (id !== BLOCK_AIR) return false
        } else if (!corner && id !== END.portal.frameBlockId) {
          return false
        }
      }
    }
    return true
  }

  // An edit landed beside a field cell: re-validate its cluster — a ring no
  // longer 12 intact frames (or cells no longer the 3×3 rectangle) collapses
  // its field to air, no drops (the nether-portal rule).
  #checkCollapse(world, x, y, z) {
    if (world.endPortals.size === 0) return
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = world.endPortals.get(`${x + dx},${y + dy},${z + dz}`)
          if (!cell) continue
          const cluster = this.#cluster(world, cell)
          if (!this.#clusterValid(world, cluster)) {
            this.#filling = true
            for (const c of cluster) world.setBlock(c.x, c.y, c.z, BLOCK_AIR)
            this.#filling = false
          }
          return // one cluster per edit — clusters never touch
        }
      }
    }
  }

  // Flood the connected field cells around `start` (9 for an intact portal).
  #cluster(world, start) {
    const cells = []
    const seen = new Set()
    const stack = [start]
    while (stack.length) {
      const c = stack.pop()
      const k = `${c.x},${c.y},${c.z}`
      if (seen.has(k)) continue
      seen.add(k)
      const cell = world.endPortals.get(k)
      if (!cell) continue
      cells.push(cell)
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        stack.push({ x: c.x + dx, y: c.y + dy, z: c.z + dz })
      }
    }
    return cells
  }

  // A valid cluster is exactly the flat 3×3 with its 12-frame ring intact.
  #clusterValid(world, cluster) {
    const N = END.portal.interior
    if (cluster.length !== N * N) return false
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const c of cluster) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x)
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y)
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z)
    }
    if (minY !== maxY || maxX - minX !== N - 1 || maxZ - minZ !== N - 1) return false
    for (let u = -1; u <= N; u++) {
      for (let v = -1; v <= N; v++) {
        const interior = u >= 0 && u < N && v >= 0 && v < N
        const corner = (u === -1 || u === N) && (v === -1 || v === N)
        if (interior || corner) continue
        if (world.blockAt(minX + u, minY, minZ + v) !== END.portal.frameBlockId) return false
      }
    }
    return true
  }

  // --- Charge & travel ---------------------------------------------------------

  update(delta) {
    const world = this.dims.current
    // End portals exist only in the overworld and the End.
    if (world !== this.dims.overworld && world !== this.dims.end) return
    const feet = this.player.body.position
    const inField =
      world.blockAt(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z)) ===
      END.portal.blockId
    if (!inField) {
      this.justArrived = false
      if (this.charge > 0) {
        this.charge = Math.max(0, this.charge - delta * 2) // decays fast
        this.onCharge?.(this.charge / END.portal.chargeSeconds)
      }
      return
    }
    if (this.justArrived || !this.player.isLocked) return // menus pause the charge
    if (this.charge === 0) this.onChargeStart?.()
    this.charge += delta
    const fraction = Math.min(1, this.charge / END.portal.chargeSeconds)
    this.onCharge?.(fraction)
    if (this.charge >= END.portal.chargeSeconds) {
      this.charge = 0
      this.onCharge?.(0)
      this.#travel()
    }
  }

  #travel() {
    const { dims } = this
    this.justArrived = true
    this.travelCount++
    if (dims.current === dims.overworld) {
      dims.travel('end', this.#arrivalFeet())
    } else {
      dims.travel('overworld', this.#homeFeet())
    }
    this.onTravel?.(dims.name)
  }

  // Feet at the arrival column by the island rim, stamping the 5×5 obsidian
  // platform as edits on the way (idempotent — only cells that aren't
  // already obsidian are written, so later arrivals cost nothing). Anchored
  // to the DESIGN surface (END.island.surfaceY), not the live one, so the
  // platform never drifts with player digging.
  #arrivalFeet() {
    const end = this.dims.end
    const a = END.arrival
    const y = END.island.surfaceY // feet level; the platform is its floor
    const r = Math.floor(END.portal.platformSize / 2)
    this.#filling = true // platform edits must not trigger the ring scanner
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const x = a.x + dx
        const z = a.z + dz
        if (end.blockAt(x, y - 1, z) !== BLOCK_OBSIDIAN) {
          end.setBlock(x, y - 1, z, BLOCK_OBSIDIAN)
        }
        // Step-out headroom over the platform.
        for (const hy of [y, y + 1]) {
          if (isSolid(end.blockAt(x, hy, z))) end.setBlock(x, hy, z, BLOCK_AIR)
        }
      }
    }
    this.#filling = false
    return { x: a.x + 0.5, y, z: a.z + 0.5 }
  }

  // Home: the bed spawn when one is set (player.spawnHook validates the bed
  // still exists), else the world spawn column.
  #homeFeet() {
    const custom = this.player.spawnHook?.()
    if (custom) return custom
    const { x, z } = PLAYER.spawnPoint
    return { x, y: this.dims.overworld.surfaceY(x, z), z }
  }
}
