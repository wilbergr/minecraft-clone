# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Build & verify

- `npm install && npm run build` → `dist/` with base `/` (Cloudflare Pages at
  minecraft.gwilber.com auto-deploys on merge to main; no manual deploy step).
- Browser-verify headless: puppeteer-core + cached Chrome under
  `~/.cache/puppeteer`, launch with `--enable-unsafe-swiftshader` (software
  WebGL — FPS numbers are informational only). Pointer lock DOES work in
  headless Chrome (click `#overlay`, then real key/mouse input works).
  `window.__mc` exposes scene/world/player/interaction/inventory/screen for
  test hooks; set `interaction.target` directly to aim break/place without
  simulating mouse aim.
- Puppeteer quirk: `page.mouse.wheel()` needs a prior `page.mouse.move()` to a
  real position and a generous (300ms+) wait before asserting.
- Software WebGL renders ~3–5 fps and the main loop clamps delta at 0.1s, so
  GAME TIME RUNS AT ~0.3× REAL TIME headless. Never assert time-dependent
  behavior (mob movement, spawns, regen) after a fixed sleep — use
  `page.waitForFunction` with generous timeouts.
- Mob list indexes shift under you (the ambient spawner runs whenever the
  pointer is locked): pin the mob object itself — `__mc.mobs.spawnAt(x, z)`
  returns it — instead of reading `mobs.mobs[0]`.

## Save format (Phase 5)

- One versioned localStorage key (`SAVE.storageKey` in `src/config.js`);
  schema documented at the top of `src/save/SaveManager.js`. Load rejects on
  `schemaVersion` OR `seed` mismatch and starts fresh — when the shape
  changes, bump `SAVE.schemaVersion` and migrate in `SaveManager.load()`.
- Only the sparse edit overlay persists (`World.serializeEdits()` →
  `{"cx,cz": [[blockIndex, blockId], ...]}`); terrain regenerates from the
  seed. ~12 chars per edit ⇒ roughly 300–400k edited blocks fit the ~5MB
  localStorage cap; past `SAVE.warnPayloadChars` saving warns (once) instead
  of throwing.
- `save.treasure` is the reserved Phase 6 slot: write any JSON-serializable
  hunt progress there and it round-trips automatically.
- Live mobs are NOT saved (the ambient spawner repopulates after load), and
  saves are skipped while dead, so a load can never land on the death screen
  (`Health.deserialize` also clamps to >= 1).
- Dirty-flag batching: `World.onEdit` / `inventory.onChange` /
  `health.onChange` mark the save dirty; SaveManager flushes every
  `SAVE.autosaveSeconds` plus once on `beforeunload`. Never serialize per
  frame.

## Sharp edges

- three.js `PointerLockControls` dispatches its `lock`/`unlock` events BEFORE
  updating `isLocked` — never read `player.isLocked` inside those handlers;
  read `document.pointerLockElement` instead (see `src/ui/overlay.js`).
- World generation must stay a pure function of (seed, x, y, z): `blockAt()`
  answers for unloaded chunks straight from the generator, and chunk meshing
  culls border faces against those answers. Any feature stamped into
  `Chunk.generate` (e.g. trees) needs an equivalent per-block read path in
  `World` (`#treeBlockAt`) or border faces desync.
- All world edits funnel through `World.setBlock()`; all item definitions in
  `src/inventory/items.js`; recipes in `src/inventory/recipes.js`; tunables
  in `src/config.js` (keep new knobs there, config-driven pattern).
- Combat pauses whenever the pointer is unlocked (`Combat.update` early
  returns) — menus/inventory/death all freeze mobs, regen, and spawns.
- Never mutate the mob list from inside a `mobs.update()` callback: the fatal
  hit on the player arrives mid-iteration, so death defers `mobs.clear()` to
  respawn (see the NOTE in `src/combat/Combat.js`).
