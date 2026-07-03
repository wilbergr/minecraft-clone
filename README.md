# Minecraft Clone

A browser-based voxel "Minecraft-style" game built with Three.js. 100% client-side
static — no backend, no API calls; all state lives in the browser.

**Status: complete (7/7 phases).** Playable on desktop (keyboard + mouse) and
on phones/tablets (touch controls). Live at **https://minecraft.gwilber.com**.

## Features

- **Procedural voxel world** — chunked terrain from seeded simplex noise
  (hills, beaches, dirt/stone layers), trees, and deep iron ore; chunks
  stream in around the player, one draw call each. The world is a pure
  function of `WORLD.seed`, so it regenerates identically every visit.
- **Break & place** — voxel-grid raycast targeting with a highlight outline;
  block hardness, tool speed tiers, and tool-gated blocks (stone wants a
  pickaxe; iron ore wants a stone pickaxe or better).
- **Inventory & crafting** — 36-slot inventory (9-slot hotbar), stack
  handling, and a shapeless recipe table: wood → planks → sticks →
  wooden/stone/iron pickaxes, axes, and swords.
- **Combat** — zombies wander, chase, and hit back; hearts HUD, damage
  vignette, regen after a grace period, knockback, tool durability, and a
  death/respawn cycle (your items are safe).
- **Save/load** — everything (block edits, inventory, health, position,
  treasure progress) autosaves to `localStorage` and restores on reload.
- **Treasure hunt** — three glowing tokens hidden at seed-deterministic
  spots, chained clues, a compass HUD pointing at the active token, a quest
  log, and a final reveal message when all three are found.
- **Mobile & polish** — virtual joystick + drag-look touch controls on
  coarse-pointer devices, tap-friendly HUD, safe-area-aware layout, and an
  in-game controls/help panel.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173/
```

## Controls

### Desktop (keyboard + mouse)

| Input | Action |
|---|---|
| Click | Capture the mouse (pointer lock) |
| Mouse | Look around |
| `W` `A` `S` `D` / arrow keys | Move |
| `Shift` | Sprint |
| Left click | Attack a mob / break the targeted block (hold to keep mining) |
| Right click | Place the selected hotbar block on the targeted face |
| `1`–`9` / mouse wheel | Select the active hotbar slot |
| `E` | Open/close the inventory & crafting screen |
| `J` | Toggle the quest log |
| `H` | Toggle the controls/help panel |
| `Esc` | Release the mouse (or close an open screen) |

### Touch (phones / tablets)

The touch scheme appears automatically on coarse-pointer devices; desktop is
unchanged.

| Input | Action |
|---|---|
| Left virtual joystick | Move (push to the edge to sprint) |
| Drag anywhere else | Look around |
| Tap the world | Attack / break one block |
| Hold ⛏ | Mine continuously |
| Tap ▦ | Place the selected block |
| Tap a hotbar slot | Select it |
| Top-right buttons | ⏸ pause · 🎒 inventory & crafting · 🗺 quest log · ? help |

## Saving & resetting

Progress autosaves to a single versioned `localStorage` key
(`minecraft-clone-save`) every few seconds and on page close — block edits,
inventory, health, position, and treasure-hunt progress. Terrain itself is
never stored; it regenerates from the seed. **Reset world** on the start
overlay (two taps to confirm) erases the save and reloads fresh. Saves are
per-browser and per-device; clearing site data also clears the world.

## Personalizing the treasure message

`TREASURE_MESSAGE` — the reward text revealed when all three tokens are
collected — is the first constant at the top of `src/config.js`. Edit that
one string; the reveal modal and the completed quest log render it verbatim.
All other hunt tunables (distances, token names, clue templates) live in the
`TREASURE` block right below it.

## Build & deploy

```bash
npm run build      # produces dist/ with base '/'
npm run preview    # serve the production build locally
```

Deploys to **minecraft.gwilber.com** via Cloudflare Pages: Cloudflare builds
with `npm run build` and serves the `dist` output directory on merge to
`main`; there is no manual deploy step. The site lives at the domain root,
so `vite.config.js` keeps `base: '/'` and `dist/index.html` references
root-relative `/assets/...` paths.

## Project structure

```
.
├── index.html            # Entry page: overlay + all HUD/screen mount points
├── vite.config.js        # base: '/' (domain-root deploy)
└── src/
    ├── main.js           # Bootstrap: renderer, scene, game loop, UI wiring
    ├── config.js         # TREASURE_MESSAGE + every gameplay tunable
    ├── style.css         # HUD layout system (z-index scale, safe areas)
    ├── world/            # Chunked terrain: World, Chunk, blocks, noise
    ├── player/           # PlayerControls (look/move), BlockInteraction,
    │                     #   TouchControls (mobile scheme)
    ├── inventory/        # Inventory model, item registry, recipe table
    ├── combat/           # Combat, Health, MobManager, Zombie
    ├── treasure/         # TreasureHunt (seed-placed tokens + clues)
    ├── save/             # SaveManager (localStorage schema + autosave)
    └── ui/               # overlay, hotbar, hud, inventoryScreen, questLog,
                          #   treasureHud, treasureReveal, help, resetButton
```

## Architecture notes

- **Determinism**: terrain, trees, ore, and treasure-token positions are all
  pure functions of `WORLD.seed` — only the sparse edit overlay is saved.
- **Config-driven**: every tunable (movement, combat, mobs, mining speeds,
  hunt distances, touch sensitivity) lives in `src/config.js`.
- **Control seam**: all game systems gate on `player.isLocked`, meaning "the
  player is actively in control" — pointer lock on desktop, a touch-session
  flag on mobile — so menus pause combat identically on both.
- **Edits funnel** through `World.setBlock()`; chunk meshes rebuild
  face-culled against generator answers for neighbors, loaded or not.
