# Minecraft Clone

A browser-based voxel "Minecraft-style" game built with Three.js. 100% client-side
static — no backend, no API calls; all state lives in the browser.

**Status: Phase 3 of ~7** — procedural chunked voxel terrain with block
breaking/placing, plus inventory, hotbar, and crafting. Combat, save/load,
and the treasure hunt land in subsequent PRs.

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
| Left click | Break the targeted block (its drop goes to the inventory) |
| Right click | Place the selected hotbar block on the targeted face |
| `1`–`9` / mouse wheel | Select the active hotbar slot |
| `E` | Open/close the inventory & crafting screen |
| `Esc` | Release the mouse (or close the inventory screen) |

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
    ├── style.css         # Overlay/crosshair/hotbar/inventory styles
    ├── world/            # World.js, Chunk.js, blocks.js, noise.js (see below)
    ├── player/           # PlayerControls.js (look/move), BlockInteraction.js
    ├── ui/               # overlay.js, hotbar.js, inventoryScreen.js, slots.js
    ├── inventory/        # Inventory.js (model), items.js, recipes.js
    ├── combat/           # Stub — later phase
    └── treasure/         # Stub — later phase (treasure hunt)
```

## World architecture (Phase 2)

- **Terrain** is a deterministic function of `WORLD.seed` (see `config.js`):
  a vendored seeded 2D simplex noise (`world/noise.js`) run through 4-octave
  FBM gives each column a surface height; layers assign block types (grass on
  top, dirt below, stone deeper, sand on low "beach" surfaces).
- **Block types** live in the `world/blocks.js` data table (id, name, solid,
  per-face colors, inventory drop). Later phases extend entries with
  hardness/tool-tier gating.
- **Trees and iron ore** (Phase 3) are also pure functions of position:
  a per-column hash scatters trees on grass (trunk + small canopy), and a
  per-block hash swaps deep stone for iron ore — both tuned in
  `WORLD.terrain` and consistent whether a chunk is loaded or not.
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
  no mesh intersection tests. `player/BlockInteraction.js` owns break/place,
  driven by the inventory's selected hotbar stack.

## Inventory & crafting (Phase 3)

- **Model** (`inventory/Inventory.js`): a flat array of stacks (`{ id, count }`
  or `null`); the first 9 slots are the hotbar. Fully serializable —
  `serialize()`/`deserialize()` are the seam for Phase 5's localStorage
  persistence. Breaking a block pockets its drop instantly (ground item
  entities are a later phase); placing consumes from the active stack.
- **Items** (`inventory/items.js`): the item registry. Placeable items carry
  a `blockId`; tools carry `tool: { kind, tier, durability }` as data only —
  the combat/tools phase wires mining speed, tier gating, and durability.
- **Recipes** (`inventory/recipes.js`): a shapeless recipe table (inputs
  consumed from anywhere in the inventory) covering wood → planks → sticks →
  wooden/stone/iron tools. Iron ore → ingot is a direct craft until a
  furnace/smelting step exists. The crafting panel renders from this table.
- **UI** (`ui/hotbar.js`, `ui/inventoryScreen.js`): hotbar with 1–9/wheel
  selection; `E` toggles the inventory + crafting screen, which releases
  pointer lock while open and re-locks on close.

## Treasure hunt & `TREASURE_MESSAGE`

The treasure-hunt system arrives in a later phase, but its config seam exists
now: `src/config.js` exports a `TREASURE_MESSAGE` constant at the top of the
file. That string is the final message revealed when the treasure hunt is
completed — edit it there to personalize the reveal. Clue placement and
discovery logic will live in `src/treasure/`.

## Later phases (separate PRs)

- Combat / mobs, tool durability + tier-gated mining
- Save/load persistence to `localStorage` (world edits + inventory)
- Treasure hunt with clues and the final `TREASURE_MESSAGE` reveal
- Polish: sounds, settings, performance tuning
