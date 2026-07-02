# Minecraft Clone

A browser-based voxel "Minecraft-style" game built with Three.js. 100% client-side
static — no backend, no API calls; all state lives in the browser.

**Status: Phase 2 of ~7** — procedural chunked voxel terrain with block
breaking/placing. Inventory, combat, save/load, and the treasure hunt land in
subsequent PRs.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173/
```

## Controls

| Input | Action |
|---|---|
| Click | Capture the mouse (pointer lock) |
| Mouse | Look around |
| `W` `A` `S` `D` / arrow keys | Move |
| `Shift` | Sprint |
| Left click | Break the targeted block |
| Right click | Place the selected block on the targeted face |
| `1`–`4` | Select block to place (grass / dirt / stone / sand) |
| `Esc` | Release the mouse |

## Build & deploy

```bash
npm run build      # produces dist/ with base '/'
npm run preview    # serve the production build locally
```

Deploys to **minecraft.gwilber.com** via Cloudflare Pages. Cloudflare builds
with `npm run build` and serves the `dist` output directory; there is no
manual deploy step in this repo.

## Project structure

```
.
├── index.html            # Entry page: overlay, crosshair, canvas mount
├── vite.config.js        # base: '/' (domain-root deploy)
└── src/
    ├── main.js           # Bootstrap: renderer, scene, camera, game loop
    ├── config.js         # All tunables + TREASURE_MESSAGE (see below)
    ├── style.css         # Overlay/crosshair/HUD styles
    ├── world/            # World.js, Chunk.js, blocks.js, noise.js (see below)
    ├── player/           # PlayerControls.js (look/move), BlockInteraction.js
    ├── ui/               # overlay.js — click-to-play + selected-block readout
    ├── inventory/        # Stub — later phase
    ├── combat/           # Stub — later phase
    └── treasure/         # Stub — later phase (treasure hunt)
```

## World architecture (Phase 2)

- **Terrain** is a deterministic function of `WORLD.seed` (see `config.js`):
  a vendored seeded 2D simplex noise (`world/noise.js`) run through 4-octave
  FBM gives each column a surface height; layers assign block types (grass on
  top, dirt below, stone deeper, sand on low "beach" surfaces).
- **Block types** live in the `world/blocks.js` data table (id, name, solid,
  per-face colors). Later phases extend entries with hardness/drops.
- **Chunks** (`world/Chunk.js`) are 16×16×48 `Uint8Array` columns, each meshed
  face-culled into a single `BufferGeometry` with vertex colors — one draw
  call per chunk, hidden faces never emitted. `World.update()` streams chunks
  in around the player (nearest first, budgeted per frame) out to
  `WORLD.renderDistance` and unloads them again as the player moves on.
- **Edits** go through `World.setBlock()`, which records them in an overlay
  map (so they survive chunk unload/reload within a session), updates the
  chunk, and remeshes it plus any bordering chunk. In-browser persistence
  (localStorage save/load) is a later phase.
- **Targeting** uses a voxel grid raycast (Amanatides & Woo) over block data —
  no mesh intersection tests. `player/BlockInteraction.js` owns break/place
  and the `selectedBlockId` seam that Phase 3's inventory/hotbar will drive.

## Treasure hunt & `TREASURE_MESSAGE`

The treasure-hunt system arrives in a later phase, but its config seam exists
now: `src/config.js` exports a `TREASURE_MESSAGE` constant at the top of the
file. That string is the final message revealed when the treasure hunt is
completed — edit it there to personalize the reveal. Clue placement and
discovery logic will live in `src/treasure/`.

## Later phases (separate PRs)

- Inventory + hotbar (persisted to `localStorage`)
- Combat / mobs
- Treasure hunt with clues and the final `TREASURE_MESSAGE` reveal
- Polish: sounds, settings, performance tuning
