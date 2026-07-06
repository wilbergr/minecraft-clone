import * as THREE from 'three'
import { mulberry32 } from '../world/noise.js'
import { rgb, speckle, blobs } from '../world/atlas.js'

// Procedural mob skins — the block atlas technique (atlas.js) applied to the
// box-part mobs. Each mob TYPE gets one small canvas "skin sheet" of 16×16
// tiles (seeded painters, zero binary assets), one shared CanvasTexture, ONE
// shared MeshLambertMaterial (+ one red-emissive flash variant for the hurt
// flash), and a set of UV-remapped BoxGeometries whose faces sample tiles
// from the sheet — the head's front face gets the face tile, everything else
// its skin/clothing tile. All of it is cached per type, so material, texture
// and geometry counts stay CONSTANT however many mobs of a kind are alive
// (the per-mob draw-call count is unchanged: still one per body part, one
// FEWER for the magma cube, whose ember eyes are baked into its face tile).
//
// The hurt flash works by material SWAP (Mob.setFlash exchanges shared
// normal/flash materials per mesh), not per-mob emissive — that is what lets
// every zombie share one material. The one exception is the creeper: its
// fuse pulse animates emissive continuously per mob, so Creeper CLONES the
// shared material once per mob (the texture itself stays shared) and keeps
// the old emissive path.
//
// Everything canvas/texture is guarded behind `typeof document`, exactly
// like atlas.js: in node (generator probes) `mobSkin()` returns null and the
// mob classes fall back to their original flat-color materials — cosmetics
// only, no behavior/hitbox difference either way.

const TILE = 16
const GRID = 4 // 4×4 tiles = 64×64 px per mob-type sheet
// Half-texel inset so NearestFilter never bleeds a neighbor tile's edge row.
const PAD = 0.5 / (GRID * TILE)

// --- Painter helpers (rgb/speckle/blobs come from atlas.js) ------------------

// Solid-ish rectangle with light jitter — facial features, bands, patches.
function rect(px, rand, x0, y0, w, h, [r, g, b], jitter = 6) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const j = (rand() * 2 - 1) * jitter
      px(x, y, rgb(r + j, g + j, b + j))
    }
  }
}

// A symmetric pair of eye rectangles (dark sockets or glowing embers).
function eyes(px, rand, xL, y, w, h, color) {
  rect(px, rand, xL, y, w, h, color, 4)
  rect(px, rand, TILE - xL - w, y, w, h, color, 4)
}

// --- Per-type skin definitions ------------------------------------------------
// parts: name -> { size (BoxGeometry dims, IDENTICAL to the subclass's
// originals — cosmetics only), tiles: per-face tile name (px/nx/py/ny/pz/nz,
// `rest` is the default; mobs face +z, so pz is the front). tiles: painters
// drawing each 16×16 tile, atlas.js-style.

const SKINS = {
  zombie: {
    parts: {
      head: { size: [0.5, 0.5, 0.5], tiles: { pz: 'face', rest: 'skin' } },
      body: { size: [0.5, 0.75, 0.25], tiles: { rest: 'shirt' } },
      limb: { size: [0.2, 0.75, 0.24], tiles: { rest: 'pants' } },
      arm: { size: [0.18, 0.18, 0.72], tiles: { rest: 'skin' } },
    },
    tiles: {
      skin(px, rand) {
        speckle(px, rand, [79, 138, 61], 14)
        blobs(px, rand, [58, 108, 44], 3) // necrotic patches
      },
      face(px, rand) {
        SKINS.zombie.tiles.skin(px, rand)
        eyes(px, rand, 3, 5, 2, 2, [18, 30, 16]) // sunken dark sockets
        rect(px, rand, 6, 10, 4, 2, [24, 40, 20]) // slack mouth
      },
      shirt(px, rand) {
        speckle(px, rand, [46, 138, 138], 12)
        blobs(px, rand, [32, 104, 104], 3) // worn tatters
      },
      pants(px, rand) {
        speckle(px, rand, [53, 53, 122], 10)
        blobs(px, rand, [40, 40, 96], 2)
      },
    },
  },

  skeleton: {
    parts: {
      head: { size: [0.5, 0.5, 0.5], tiles: { pz: 'skull', rest: 'bone' } },
      body: { size: [0.4, 0.75, 0.2], tiles: { rest: 'ribs' } },
      limb: { size: [0.14, 0.75, 0.14], tiles: { rest: 'legs' } },
      arm: { size: [0.12, 0.12, 0.6], tiles: { rest: 'bone' } },
    },
    tiles: {
      bone(px, rand) {
        speckle(px, rand, [217, 217, 205], 9)
        blobs(px, rand, [194, 194, 180], 2)
      },
      skull(px, rand) {
        SKINS.skeleton.tiles.bone(px, rand)
        eyes(px, rand, 3, 5, 3, 2, [28, 28, 24]) // hollow sockets
        px(7, 8, rgb(60, 60, 52)) // nose pits
        px(8, 8, rgb(60, 60, 52))
        for (let x = 4; x <= 11; x++) {
          // Grim tooth row: alternating bone/dark columns.
          const c = x % 2 ? [40, 40, 34] : [206, 206, 192]
          px(x, 11, rgb(c[0], c[1], c[2]))
          px(x, 12, rgb(c[0], c[1], c[2]))
        }
      },
      ribs(px, rand) {
        speckle(px, rand, [184, 184, 170], 8)
        for (const y of [3, 6, 9, 12]) {
          rect(px, rand, 1, y, 14, 1, [138, 138, 126], 8) // rib shadows
        }
      },
      legs(px, rand) {
        speckle(px, rand, [143, 143, 132], 8)
        blobs(px, rand, [124, 124, 114], 2)
      },
    },
  },

  creeper: {
    parts: {
      head: { size: [0.5, 0.5, 0.5], tiles: { pz: 'face', rest: 'skin' } },
      body: { size: [0.5, 0.9, 0.3], tiles: { rest: 'skin' } },
      leg: { size: [0.2, 0.35, 0.25], tiles: { rest: 'legs' } },
    },
    tiles: {
      skin(px, rand) {
        // The mottled creeper camo: mid-green static with light + dark clumps.
        speckle(px, rand, [85, 176, 74], 22)
        blobs(px, rand, [140, 214, 120], 4)
        blobs(px, rand, [46, 118, 40], 4)
      },
      face(px, rand) {
        SKINS.creeper.tiles.skin(px, rand)
        const dark = [16, 26, 14]
        eyes(px, rand, 3, 5, 3, 3, dark) // the iconic square eyes
        rect(px, rand, 6, 8, 4, 3, dark, 3) // nose bridge…
        rect(px, rand, 5, 10, 2, 4, dark, 3) // …drooping into the
        rect(px, rand, 9, 10, 2, 4, dark, 3) // open-frown mouth
      },
      legs(px, rand) {
        speckle(px, rand, [61, 138, 53], 16)
        blobs(px, rand, [44, 106, 40], 3)
      },
    },
  },

  drowned: {
    parts: {
      head: { size: [0.5, 0.5, 0.5], tiles: { pz: 'face', rest: 'skin' } },
      body: { size: [0.5, 0.75, 0.25], tiles: { rest: 'shirt' } },
      limb: { size: [0.2, 0.75, 0.24], tiles: { rest: 'pants' } },
      arm: { size: [0.18, 0.18, 0.72], tiles: { rest: 'skin' } },
    },
    tiles: {
      skin(px, rand) {
        speckle(px, rand, [63, 143, 124], 12)
        blobs(px, rand, [46, 112, 98], 3) // waterlogged blotches
      },
      face(px, rand) {
        SKINS.drowned.tiles.skin(px, rand)
        eyes(px, rand, 3, 5, 2, 2, [186, 238, 222]) // pale luminous stare
        rect(px, rand, 6, 10, 4, 2, [24, 56, 48]) // dark mouth
      },
      shirt(px, rand) {
        speckle(px, rand, [42, 100, 112], 12)
        blobs(px, rand, [30, 76, 86], 3) // rotted cloth
      },
      pants(px, rand) {
        speckle(px, rand, [43, 74, 88], 10)
        blobs(px, rand, [32, 56, 68], 2)
      },
    },
  },

  zombified_piglin: {
    parts: {
      head: { size: [0.5, 0.5, 0.5], tiles: { pz: 'face', rest: 'skin' } },
      body: { size: [0.5, 0.75, 0.25], tiles: { rest: 'shirt' } },
      limb: { size: [0.2, 0.75, 0.24], tiles: { rest: 'pants' } },
      arm: { size: [0.18, 0.18, 0.72], tiles: { rest: 'skin' } },
    },
    tiles: {
      skin(px, rand) {
        speckle(px, rand, [201, 141, 114], 12)
        blobs(px, rand, [125, 138, 63], 3) // rotting-green decay patches
      },
      face(px, rand) {
        SKINS.zombified_piglin.tiles.skin(px, rand)
        eyes(px, rand, 3, 4, 2, 2, [30, 20, 16])
        rect(px, rand, 5, 8, 6, 3, [224, 164, 134], 8) // the pig snout
        px(6, 9, rgb(96, 56, 44)) // nostrils
        px(9, 9, rgb(96, 56, 44))
        for (const tx of [4, 11]) {
          px(tx, 11, rgb(235, 230, 214)) // tusks at the mouth corners
          px(tx, 12, rgb(235, 230, 214))
        }
      },
      shirt(px, rand) {
        speckle(px, rand, [125, 138, 63], 12)
        blobs(px, rand, [98, 108, 48], 3)
      },
      pants(px, rand) {
        speckle(px, rand, [138, 109, 46], 10)
        blobs(px, rand, [110, 86, 36], 2)
      },
    },
  },

  magma_cube: {
    // Warm base emissive: the crust's lava cracks read hot in dark caves and
    // the sunless Nether. The flash material overrides it with the hurt red.
    emissive: 0x2a0e00,
    parts: {
      // One box, one draw call: the ember eyes live in the face tile (the
      // fallback path keeps the old separate eye meshes).
      body: { size: [0.9, 0.75, 0.9], tiles: { pz: 'face', rest: 'crust' } },
    },
    tiles: {
      crust(px, rand) {
        speckle(px, rand, [58, 26, 20], 12)
        blobs(px, rand, [36, 16, 12], 3)
        // Glowing fissures: short random walks of ember/yellow pixels.
        for (let i = 0; i < 4; i++) {
          let x = Math.floor(rand() * TILE)
          let y = Math.floor(rand() * TILE)
          const len = 4 + Math.floor(rand() * 6)
          for (let s = 0; s < len; s++) {
            const hot = rand() < 0.3 ? [255, 214, 92] : [244, 138, 32]
            px(x, y, rgb(hot[0], hot[1], hot[2]))
            x = Math.min(TILE - 1, Math.max(0, x + (rand() < 0.5 ? 1 : -1)))
            y = Math.min(TILE - 1, Math.max(0, y + (rand() < 0.6 ? 1 : 0)))
          }
        }
      },
      face(px, rand) {
        SKINS.magma_cube.tiles.crust(px, rand)
        eyes(px, rand, 3, 5, 3, 2, [255, 196, 64]) // ember eyes (were meshes)
        px(4, 5, rgb(255, 240, 160)) // hot cores
        px(11, 5, rgb(255, 240, 160))
      },
    },
  },

  pig: {
    parts: {
      body: { size: [0.6, 0.5, 0.9], tiles: { rest: 'hide' } },
      head: { size: [0.42, 0.4, 0.35], tiles: { pz: 'face', rest: 'headHide' } },
      leg: { size: [0.16, 0.45, 0.16], tiles: { rest: 'legs' } },
    },
    tiles: {
      hide(px, rand) {
        speckle(px, rand, [232, 162, 162], 8)
        blobs(px, rand, [214, 140, 140], 3)
      },
      headHide(px, rand) {
        speckle(px, rand, [239, 176, 172], 8)
      },
      face(px, rand) {
        SKINS.pig.tiles.headHide(px, rand)
        eyes(px, rand, 3, 4, 2, 2, [40, 32, 32])
        rect(px, rand, 5, 8, 6, 4, [246, 190, 186], 6) // the snout
        rect(px, rand, 6, 10, 1, 1, [120, 70, 70], 0) // nostrils
        rect(px, rand, 9, 10, 1, 1, [120, 70, 70], 0)
      },
      legs(px, rand) {
        speckle(px, rand, [216, 143, 143], 8)
        rect(px, rand, 0, 13, 16, 3, [150, 95, 95], 6) // trotters
      },
    },
  },

  cow: {
    parts: {
      body: { size: [0.6, 0.5, 0.9], tiles: { rest: 'hide' } },
      head: { size: [0.42, 0.4, 0.35], tiles: { pz: 'face', rest: 'headHide' } },
      leg: { size: [0.16, 0.45, 0.16], tiles: { rest: 'legs' } },
    },
    tiles: {
      hide(px, rand) {
        speckle(px, rand, [107, 74, 51], 10)
        // Big cream patches: ragged 3–5 px squares, the classic cow mottle.
        for (let i = 0; i < 3; i++) {
          const s = 3 + Math.floor(rand() * 3)
          const x0 = Math.floor(rand() * (TILE - s))
          const y0 = Math.floor(rand() * (TILE - s))
          for (let y = y0; y < y0 + s; y++) {
            for (let x = x0; x < x0 + s; x++) {
              if (rand() < 0.85) {
                const j = (rand() * 2 - 1) * 8
                px(x, y, rgb(216 + j, 207 + j, 192 + j))
              }
            }
          }
        }
      },
      headHide(px, rand) {
        speckle(px, rand, [122, 86, 64], 10)
      },
      face(px, rand) {
        SKINS.cow.tiles.headHide(px, rand)
        rect(px, rand, 6, 0, 4, 8, [222, 214, 200], 8) // white blaze
        eyes(px, rand, 3, 5, 2, 2, [34, 26, 22])
        rect(px, rand, 4, 10, 8, 4, [188, 166, 142], 8) // pale muzzle
        rect(px, rand, 5, 12, 1, 1, [90, 66, 50], 0) // nostrils
        rect(px, rand, 10, 12, 1, 1, [90, 66, 50], 0)
      },
      legs(px, rand) {
        speckle(px, rand, [84, 64, 46], 8)
        rect(px, rand, 0, 13, 16, 3, [122, 118, 110], 6) // gray hooves
      },
    },
  },

  sheep: {
    parts: {
      body: { size: [0.6, 0.5, 0.9], tiles: { rest: 'wool' } },
      head: { size: [0.42, 0.4, 0.35], tiles: { pz: 'face', rest: 'headWool' } },
      leg: { size: [0.16, 0.45, 0.16], tiles: { rest: 'legs' } },
    },
    tiles: {
      wool(px, rand) {
        // Curly fleece: bright base, lighter puffs, soft shade pockets.
        speckle(px, rand, [232, 230, 223], 12)
        blobs(px, rand, [244, 242, 236], 5)
        blobs(px, rand, [206, 202, 192], 4)
      },
      headWool(px, rand) {
        speckle(px, rand, [203, 185, 164], 8)
        rect(px, rand, 0, 0, 16, 4, [236, 234, 227], 10) // wool cap
      },
      face(px, rand) {
        SKINS.sheep.tiles.headWool(px, rand)
        eyes(px, rand, 3, 6, 2, 2, [36, 30, 26])
        rect(px, rand, 7, 10, 2, 2, [216, 160, 150], 4) // pink nose
      },
      legs(px, rand) {
        speckle(px, rand, [191, 174, 153], 8)
        rect(px, rand, 0, 0, 16, 3, [236, 234, 227], 10) // wool at the hip
      },
    },
  },
}

// --- Sheet assembly ------------------------------------------------------------

// BoxGeometry emits faces in this fixed order, 4 vertices each.
const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz']

function tileRect(slot) {
  const col = slot % GRID
  const row = Math.floor(slot / GRID)
  const u0 = col / GRID
  const v1 = 1 - row / GRID
  return {
    u0: u0 + PAD,
    v0: v1 - 1 / GRID + PAD,
    u1: u0 + 1 / GRID - PAD,
    v1: v1 - PAD,
  }
}

// A BoxGeometry whose per-face UVs address tiles on the type's sheet. The
// default box UVs span [0,1] per face; squeezing them into the tile's rect
// keeps each face's orientation identical to a whole-texture mapping.
function boxWithTiles(size, tiles, slots) {
  const geom = new THREE.BoxGeometry(...size)
  const uv = geom.getAttribute('uv')
  FACE_ORDER.forEach((face, f) => {
    const r = tileRect(slots.get(tiles[face] ?? tiles.rest))
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0))
    }
  })
  return geom
}

// Deterministic per-(type, tile) seed — the atlas's per-slot stream, keyed by
// name so adding a tile never reshuffles the others.
function seedFor(key) {
  let h = 0x51ab
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h
}

const cache = new Map() // type -> { material, flashMaterial, geoms } | null

// The one entry point: shared skin resources for a mob type, built on first
// use and cached forever (atlas semantics — mobs never dispose them). Null
// without a DOM (node probes) or for unknown types: callers fall back to the
// original flat-color materials.
export function mobSkin(type) {
  if (typeof document === 'undefined') return null
  let skin = cache.get(type)
  if (skin !== undefined) return skin
  const def = SKINS[type]
  if (!def) {
    cache.set(type, null)
    return null
  }

  const names = Object.keys(def.tiles)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = GRID * TILE
  const ctx = canvas.getContext('2d')
  const slots = new Map()
  names.forEach((name, i) => {
    slots.set(name, i)
    const ox = (i % GRID) * TILE
    const oy = Math.floor(i / GRID) * TILE
    const rand = mulberry32(seedFor(`${type}:${name}`))
    const px = (x, y, color) => {
      ctx.fillStyle = color
      ctx.fillRect(ox + x, oy + y, 1, 1)
    }
    def.tiles[name](px, rand)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace

  const material = new THREE.MeshLambertMaterial({ map: texture })
  if (def.emissive) material.emissive.setHex(def.emissive)
  const flashMaterial = material.clone() // shares the texture
  flashMaterial.emissive.setHex(0x8a1a1a)

  const geoms = {}
  for (const [part, spec] of Object.entries(def.parts)) {
    geoms[part] = boxWithTiles(spec.size, spec.tiles, slots)
  }

  skin = { material, flashMaterial, geoms }
  cache.set(type, skin)
  return skin
}
