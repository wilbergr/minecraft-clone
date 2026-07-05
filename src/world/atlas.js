import * as THREE from 'three'
import { mulberry32 } from './noise.js'

// Procedural 16×16 block-texture atlas (Phase 13). Every tile is DRAWN onto
// one canvas at boot — noise-speckled stone, striated bark, a grass overhang
// strip — so the repo ships zero binary assets. The canvas becomes the chunk
// material's `map` with NearestFilter and no mipmaps (bilinear filtering and
// mip blending both smear the pixel-art look into mud).
//
// The texture is multiplied by the mesh's vertex colors (the material keeps
// `vertexColors: true`), which is exactly the Phase 11 contract: vertex color
// carries face shade × depth darkening × biome tint, the map carries albedo.
// Tiles for biome-tinted faces (grass top, leaves — `biomeTint` in blocks.js)
// are drawn GRAYSCALE bright, so the tint provides their color.
//
// Tile painters are seeded (mulberry32) per tile name, so the atlas is
// deterministic across boots. UV rects come from `uvRect(name)`; item/hotbar
// icons reuse the same tiles via `tileURL(name)` (a per-tile data URL).
//
// Everything canvas/texture is guarded behind `typeof document` so node
// scripts can still import World with a scene stub to probe the generator.

const TILE = 16
const GRID = 8 // 8×8 tiles = 128×128 px — room to grow
// Inset UV lookups by half a texel so NearestFilter never bleeds a neighbor
// tile's edge row into a face.
const PAD = 0.5 / (GRID * TILE)

// Tile order fixes each tile's atlas slot; painters draw into a 16×16
// ImageData-like context. `ctx` is pre-translated to the tile origin.
const TILE_NAMES = [
  'stone',
  'dirt',
  'grass_top',
  'grass_side',
  'sand',
  'wood_side',
  'wood_top',
  'leaves',
  'planks',
  'iron_ore',
  'coal_ore',
  'gold_ore',
  'furnace_side',
  'furnace_top',
  'torch',
  'snow',
  'snow_side',
  'bed_top',
  'bed_side',
  'chest_top',
  'chest_side',
  'kings_cache_top',
  'kings_cache_side',
  'kings_cache_bottom',
  'diamond_ore',
  'obsidian',
  'netherrack',
  'soul_sand',
  'glowstone',
  'quartz_ore',
  'bedrock',
]

// --- Per-tile painters -------------------------------------------------------
// Each painter gets (px, rand): px(x, y, cssColor) sets one pixel, rand() is
// the tile's seeded PRNG. Helpers below keep them terse.

const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`

// Base color with per-pixel brightness jitter — the workhorse noise fill.
function speckle(px, rand, [r, g, b], jitter) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const j = (rand() * 2 - 1) * jitter
      px(x, y, rgb(r + j, g + j, b + j))
    }
  }
}

// Scatter `count` little 2×2-ish blobs of a color (ore flecks, pebbles).
function blobs(px, rand, [r, g, b], count) {
  for (let i = 0; i < count; i++) {
    const bx = 1 + Math.floor(rand() * (TILE - 3))
    const by = 1 + Math.floor(rand() * (TILE - 3))
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        if (rand() < 0.85) {
          const j = (rand() * 2 - 1) * 12
          px(bx + dx, by + dy, rgb(r + j, g + j, b + j))
        }
      }
    }
  }
}

const stoneBase = (px, rand) => {
  speckle(px, rand, [141, 141, 141], 14)
  blobs(px, rand, [120, 120, 120], 4) // darker patches so it isn't pure static
}

const PAINTERS = {
  stone: stoneBase,
  dirt(px, rand) {
    speckle(px, rand, [138, 95, 60], 16)
    blobs(px, rand, [110, 74, 44], 4)
    blobs(px, rand, [160, 118, 80], 2)
  },
  // Grayscale — the mesher multiplies in the biome grass tint.
  grass_top(px, rand) {
    speckle(px, rand, [205, 205, 205], 28)
  },
  // Dirt body with a pre-tinted grass overhang strip along the top edge, its
  // lower edge ragged per column. (Baked mid-green: side faces don't ride the
  // biome tint — tinting would color the dirt too.)
  grass_side(px, rand) {
    PAINTERS.dirt(px, rand)
    for (let x = 0; x < TILE; x++) {
      const depth = 2 + Math.floor(rand() * 3)
      for (let y = 0; y < depth; y++) {
        const j = (rand() * 2 - 1) * 14
        px(x, y, rgb(93 + j, 156 + j, 63 + j))
      }
    }
  },
  sand(px, rand) {
    speckle(px, rand, [210, 196, 137], 12)
    blobs(px, rand, [190, 176, 120], 3)
  },
  // Bark: vertical striations with occasional breaks.
  wood_side(px, rand) {
    for (let x = 0; x < TILE; x++) {
      const dark = x % 3 === 1
      for (let y = 0; y < TILE; y++) {
        const j = (rand() * 2 - 1) * 10
        const [r, g, b] = dark && rand() > 0.15 ? [86, 58, 33] : [107, 74, 43]
        px(x, y, rgb(r + j, g + j, b + j))
      }
    }
  },
  // Cut trunk: concentric rings around the center.
  wood_top(px, rand) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
        const ring = Math.floor(d) % 2 === 0
        const j = (rand() * 2 - 1) * 8
        const [r, g, b] = ring ? [156, 127, 78] : [128, 100, 60]
        px(x, y, rgb(r + j, g + j, b + j))
      }
    }
  },
  // Grayscale with strong contrast — tinted per biome like grass_top.
  leaves(px, rand) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = 150 + rand() * 90 - (rand() < 0.2 ? 70 : 0)
        px(x, y, rgb(v, v, v))
      }
    }
  },
  // Horizontal boards with seam lines and the odd nail.
  planks(px, rand) {
    for (let y = 0; y < TILE; y++) {
      const seam = y % 4 === 3
      for (let x = 0; x < TILE; x++) {
        const j = (rand() * 2 - 1) * 10
        const [r, g, b] = seam ? [125, 96, 56] : [165, 129, 78]
        px(x, y, rgb(r + j, g + j, b + j))
      }
    }
    blobs(px, rand, [140, 108, 62], 2)
  },
  iron_ore(px, rand) {
    stoneBase(px, rand)
    blobs(px, rand, [216, 168, 120], 5)
  },
  coal_ore(px, rand) {
    stoneBase(px, rand)
    blobs(px, rand, [46, 46, 46], 5)
  },
  gold_ore(px, rand) {
    stoneBase(px, rand)
    blobs(px, rand, [232, 200, 74], 5)
  },
  diamond_ore(px, rand) {
    stoneBase(px, rand)
    blobs(px, rand, [110, 227, 219], 5)
  },
  // Worked dark stone with a smelting mouth near the bottom.
  furnace_side(px, rand) {
    speckle(px, rand, [95, 95, 95], 10)
    for (let y = 9; y < 14; y++) {
      for (let x = 5; x < 11; x++) {
        const ember = y > 10 && rand() < 0.35
        px(x, y, ember ? rgb(214, 120, 40) : rgb(35, 35, 35))
      }
    }
  },
  furnace_top(px, rand) {
    speckle(px, rand, [74, 74, 74], 10)
    blobs(px, rand, [58, 58, 58], 3)
  },
  // Handle wood filling the lower tile, a flame band on top: the mesher maps
  // the whole tile onto the slim post, so the top of the post glows.
  torch(px, rand) {
    for (let y = 5; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const j = (rand() * 2 - 1) * 12
        px(x, y, rgb(138 + j, 95 + j, 60 + j))
      }
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < TILE; x++) {
        px(x, y, y < 2 ? rgb(255, 233, 168) : rgb(240, 158, 60))
      }
    }
  },
  snow(px, rand) {
    speckle(px, rand, [242, 245, 247], 8)
  },
  snow_side(px, rand) {
    PAINTERS.dirt(px, rand)
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + Math.floor(rand() * 3)
      for (let y = 0; y < depth; y++) {
        const j = (rand() * 2 - 1) * 8
        px(x, y, rgb(238 + j, 242 + j, 245 + j))
      }
    }
  },
  // Bed seen from above: a white pillow band at the head, red blanket below,
  // with a darker fold line where they meet.
  bed_top(px, rand) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const j = (rand() * 2 - 1) * 8
        if (y < 4) px(x, y, rgb(232 + j, 230 + j, 223 + j)) // pillow
        else if (y === 4) px(x, y, rgb(122 + j, 30 + j, 30 + j)) // fold
        else px(x, y, rgb(176 + j, 58 + j, 58 + j)) // blanket
      }
    }
  },
  // Bed seen from the side: blanket over a plank frame with dark feet. The
  // mesher squashes the tile onto the low bed box, so bands read as layers.
  bed_side(px, rand) {
    for (let y = 0; y < TILE; y++) {
      const frame = y >= 10
      for (let x = 0; x < TILE; x++) {
        const j = (rand() * 2 - 1) * 9
        if (frame) px(x, y, rgb(140 + j, 108 + j, 62 + j))
        else px(x, y, rgb(176 + j, 58 + j, 58 + j))
      }
    }
    for (const fx of [0, 1, 14, 15]) {
      for (let y = 12; y < TILE; y++) px(fx, y, rgb(86, 58, 33)) // feet
    }
  },
  // Chest lid seen from above: plank boards inside a dark frame.
  chest_top(px, rand) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const j = (rand() * 2 - 1) * 9
        const frame = x === 0 || x === 15 || y === 0 || y === 15
        const seam = !frame && y % 5 === 2
        if (frame) px(x, y, rgb(96 + j, 66 + j, 36 + j))
        else if (seam) px(x, y, rgb(128 + j, 96 + j, 54 + j))
        else px(x, y, rgb(158 + j, 118 + j, 68 + j))
      }
    }
  },
  // Chest side: plank body, a dark lid band where the halves meet, and a
  // brass latch cluster at the center.
  chest_side(px, rand) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const j = (rand() * 2 - 1) * 9
        const frame = x === 0 || x === 15 || y === 0 || y === 15
        const lid = y === 5 || y === 6
        if (frame) px(x, y, rgb(96 + j, 66 + j, 36 + j))
        else if (lid) px(x, y, rgb(74 + j, 50 + j, 28 + j))
        else px(x, y, rgb(150 + j, 112 + j, 64 + j))
      }
    }
    for (let y = 4; y < 9; y++) {
      for (let x = 7; x < 9; x++) {
        px(x, y, y === 6 ? rgb(160, 130, 50) : rgb(206, 172, 76)) // brass latch
      }
    }
  },
  // The King's Cache (Trial reward): deep royal-purple stone inside a gold
  // frame, a gold crown motif centered on the lid.
  kings_cache_top(px, rand) {
    speckle(px, rand, [74, 58, 99], 12)
    for (let i = 0; i < TILE; i++) {
      for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]]) {
        const j = (rand() * 2 - 1) * 14
        px(x, y, rgb(206 + j, 172 + j, 76 + j)) // gold frame
      }
    }
    // Crown: three points over a band, drawn in bright gold.
    const gold = () => {
      const j = (rand() * 2 - 1) * 10
      return rgb(232 + j, 200 + j, 84 + j)
    }
    for (let x = 5; x <= 10; x++) for (let y = 8; y <= 9; y++) px(x, y, gold())
    for (const cx of [5, 7, 8, 10]) for (let y = 6; y < 8; y++) px(cx, y, gold())
    for (const cx of [5, 10]) px(cx, 5, gold())
  },
  // Side: the purple body with the gold frame and a dark seam where the lid
  // meets the base, echoing the chest_side layout so it reads as a chest.
  kings_cache_side(px, rand) {
    speckle(px, rand, [62, 48, 84], 12)
    for (let i = 0; i < TILE; i++) {
      for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]]) {
        const j = (rand() * 2 - 1) * 14
        px(x, y, rgb(196 + j, 162 + j, 70 + j))
      }
    }
    for (let x = 1; x < 15; x++) {
      const j = (rand() * 2 - 1) * 8
      px(x, 5, rgb(34 + j, 26 + j, 48 + j)) // lid seam
      px(x, 6, rgb(34 + j, 26 + j, 48 + j))
    }
    for (let y = 4; y < 9; y++) {
      for (let x = 7; x < 9; x++) {
        px(x, y, y === 6 ? rgb(170, 138, 54) : rgb(232, 200, 84)) // gold latch
      }
    }
  },
  kings_cache_bottom(px, rand) {
    speckle(px, rand, [50, 38, 69], 10)
    blobs(px, rand, [38, 28, 54], 4)
  },
  // Volcanic glass: near-black body with faint violet sheen streaks.
  obsidian(px, rand) {
    speckle(px, rand, [26, 20, 37], 7)
    blobs(px, rand, [58, 44, 88], 4) // purple glints
    blobs(px, rand, [12, 9, 18], 3) // deep-black patches
  },
  // The Nether's body rock: dark dried-blood red with raw scar patches.
  netherrack(px, rand) {
    speckle(px, rand, [110, 44, 40], 14)
    blobs(px, rand, [84, 30, 28], 4)
    blobs(px, rand, [140, 62, 52], 3)
  },
  // Umber sand with faint dark hollows — the trapped-souls read without
  // literal faces at 16px.
  soul_sand(px, rand) {
    speckle(px, rand, [86, 66, 50], 10)
    blobs(px, rand, [60, 44, 34], 5)
    // A few 2-px "eye pair" hollows.
    for (let i = 0; i < 3; i++) {
      const ex = 2 + Math.floor(rand() * 11)
      const ey = 2 + Math.floor(rand() * 12)
      px(ex, ey, rgb(38, 28, 22))
      px(ex + 2, ey, rgb(38, 28, 22))
    }
  },
  // Bright amber crystal blobs on a warm body — reads glowing even unlit.
  glowstone(px, rand) {
    speckle(px, rand, [212, 160, 82], 16)
    blobs(px, rand, [255, 226, 130], 7)
    blobs(px, rand, [176, 120, 58], 3)
  },
  quartz_ore(px, rand) {
    PAINTERS.netherrack(px, rand)
    blobs(px, rand, [235, 230, 220], 5)
  },
  // Featureless hard gray with deep blotches — clearly "not minable".
  bedrock(px, rand) {
    speckle(px, rand, [74, 74, 74], 24)
    blobs(px, rand, [38, 38, 38], 5)
    blobs(px, rand, [104, 104, 104], 3)
  },
}

// --- Atlas assembly ----------------------------------------------------------

const SLOT = new Map(TILE_NAMES.map((name, i) => [name, i]))

// UV rect (half-texel inset) for a tile, in atlas coordinates. Pure math —
// safe to call in node scripts that never build the canvas. Canvas y runs
// down while UV v runs up (flipY), so v0 addresses the tile's bottom edge.
export function uvRect(name) {
  const slot = SLOT.get(name) ?? 0
  const col = slot % GRID
  const row = Math.floor(slot / GRID)
  const u0 = col / GRID
  const v1 = 1 - row / GRID // top of the tile in UV space
  return {
    u0: u0 + PAD,
    v0: v1 - 1 / GRID + PAD,
    u1: u0 + 1 / GRID - PAD,
    v1: v1 - PAD,
  }
}

let atlasCanvas = null
const iconURLs = new Map() // tile name -> data URL, lazily rendered

function drawTile(ctx, name) {
  const slot = SLOT.get(name)
  const ox = (slot % GRID) * TILE
  const oy = Math.floor(slot / GRID) * TILE
  const rand = mulberry32(0x7e50 ^ slot) // per-tile deterministic stream
  const px = (x, y, color) => {
    ctx.fillStyle = color
    ctx.fillRect(ox + x, oy + y, 1, 1)
  }
  PAINTERS[name](px, rand)
}

function buildCanvas() {
  if (atlasCanvas) return atlasCanvas
  atlasCanvas = document.createElement('canvas')
  atlasCanvas.width = atlasCanvas.height = GRID * TILE
  const ctx = atlasCanvas.getContext('2d')
  for (const name of TILE_NAMES) drawTile(ctx, name)
  return atlasCanvas
}

// The chunk material's map: NearestFilter both ways and no mipmaps — the two
// settings the pixel-art look depends on. sRGB so tile colors match how the
// old vertex-color palette rendered. Returns null without a DOM (node).
export function createAtlasTexture() {
  if (typeof document === 'undefined') return null
  const texture = new THREE.CanvasTexture(buildCanvas())
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Data URL of one tile, for DOM item icons (hotbar/inventory/recipes) — the
// same pixels the world renders, scaled up crisply by image-rendering:
// pixelated in CSS. `tint` (css color) multiplies grayscale tiles (grass).
export function tileURL(name, tint = null) {
  if (typeof document === 'undefined' || !SLOT.has(name)) return ''
  const key = tint ? `${name}:${tint}` : name
  let url = iconURLs.get(key)
  if (!url) {
    const slot = SLOT.get(name)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = TILE
    const ctx = canvas.getContext('2d')
    ctx.drawImage(
      buildCanvas(),
      (slot % GRID) * TILE,
      Math.floor(slot / GRID) * TILE,
      TILE,
      TILE,
      0,
      0,
      TILE,
      TILE,
    )
    if (tint) {
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = tint
      ctx.fillRect(0, 0, TILE, TILE)
    }
    url = canvas.toDataURL()
    iconURLs.set(key, url)
  }
  return url
}
