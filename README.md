# Minecraft Clone

A browser-based voxel "Minecraft-style" game built with Three.js. 100% client-side
static — no backend, no API calls; all state lives in the browser. Served from
GitHub Pages at <https://wilbergr.github.io/minecraft-clone/>.

**Status: Phase 1 of ~7** — project scaffold plus a navigable flat test world.
World generation, block editing, inventory, combat, and the treasure hunt land
in subsequent PRs.

## Run locally

```bash
cd minecraft-clone
npm install
npm run dev        # http://localhost:5173/minecraft-clone/
```

## Controls

| Input | Action |
|---|---|
| Click | Capture the mouse (pointer lock) |
| Mouse | Look around |
| `W` `A` `S` `D` / arrow keys | Move |
| `Shift` | Sprint |
| `Esc` | Release the mouse |

## Build & deploy

```bash
npm run build      # produces dist/ with base '/minecraft-clone/'
npm run preview    # serve the production build locally
npm run deploy     # build + publish dist/ to gh-pages under /minecraft-clone/
```

Deployment uses the repo-wide `gh-pages --add` convention so publishing this app
preserves the other apps on the Pages branch. From the repo root,
`npm run deploy:minecraft` does the same thing.

## Project structure

```
minecraft-clone/
├── index.html            # Entry page: overlay, crosshair, canvas mount
├── vite.config.js        # base: '/minecraft-clone/' (subpath deploy)
└── src/
    ├── main.js           # Bootstrap: renderer, scene, camera, game loop
    ├── config.js         # All tunables + TREASURE_MESSAGE (see below)
    ├── style.css         # Overlay/crosshair styles
    ├── world/            # World.js (Phase 1 flat test world), Chunk.js (stub)
    ├── player/           # PlayerControls.js — pointer lock + WASD movement
    ├── ui/               # overlay.js (click-to-play); HUD comes later
    ├── inventory/        # Stub — later phase
    ├── combat/           # Stub — later phase
    └── treasure/         # Stub — later phase (treasure hunt)
```

## Treasure hunt & `TREASURE_MESSAGE`

The treasure-hunt system arrives in a later phase, but its config seam exists
now: `src/config.js` exports a `TREASURE_MESSAGE` constant at the top of the
file. That string is the final message revealed when the treasure hunt is
completed — edit it there to personalize the reveal. Clue placement and
discovery logic will live in `src/treasure/`.

## Later phases (separate PRs)

- Voxel terrain with chunks; placing/breaking blocks
- Inventory + hotbar (persisted to `localStorage`)
- Combat / mobs
- Treasure hunt with clues and the final `TREASURE_MESSAGE` reveal
- Polish: sounds, settings, performance tuning
