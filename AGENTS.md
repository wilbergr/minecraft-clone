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

## Treasure hunt (Phase 6)

- `TREASURE_MESSAGE` — the captain-editable final reward text — is the first
  constant at the top of `src/config.js` (clearly banner-commented). It is
  rendered verbatim by the completion modal (`src/ui/treasureReveal.js`) and
  by the quest log once the hunt is complete. Edit that one string only.
- All other hunt tunables live in the `TREASURE` block right below it:
  `rings` / `names` / `clues` are index-matched arrays — add one entry to
  each to extend the hunt. Clue templates take `{dist}` / `{dir}` / `{name}`,
  filled from the generated positions so text always matches the world.
- Token positions are a pure function of `WORLD.seed` (a dedicated
  mulberry32 stream + `terrainHeight`), chained: token 1 a ring-distance
  from spawn, each next token from the previous. Changing seed, rings, or
  terrain params moves the tokens; the saved `found` array is index-based
  and only valid for the same seed (load already rejects seed mismatches).
- Save slot shape: `treasure: { found: [bool per token], celebrated }`
  (`TreasureHunt.serialize()`), wired via `SaveManager.attachTreasure(hunt)`
  once after `load()`. `schemaVersion` stayed 1 — the slot was reserved.
- Collection is proximity-based, driven by `hunt.update(delta,
  camera.position)` every frame with NO pointer-lock gate — headless tests
  teleport onto `__mc.hunt.tokens[i].position` to collect (since Phase 8 use
  `__mc.player.teleport(x, y, z)`, NOT `camera.position.set` — physics resyncs
  the camera from the body every locked frame).
- Token height uses pristine `terrainHeight`, not `surfaceY`: player edits
  never move a token, so positions stay save-stable.

## Touch controls & HUD layout (Phase 7)

- The "is the player in control" flag is `player.isLocked` — pointer lock on
  desktop OR `player.touchActive` on coarse-pointer devices (decided once at
  startup by `isTouchDevice()` in `src/player/TouchControls.js`, which checks
  `(pointer: coarse)`). `player.lock()/unlock()` flip the touch flag and
  dispatch the same lock/unlock events, so ALL game/menu wiring is shared —
  never branch game logic on input scheme, only on `isLocked`.
- Unlike real pointer lock, `touchActive` is updated BEFORE the lock/unlock
  event fires, so touch-path handlers may read it directly (overlay.js does).
- TouchControls is input plumbing only: joystick → `player.touchMove`
  (analog vector, full deflection = sprint), look-drag rotates the camera via
  the same YXZ euler as PointerLockControls, taps/buttons call the existing
  `interaction.attackHook`/`breakTargeted`/`placeAtTargeted`/`mining` seams.
  Tunables in `TOUCH` (src/config.js).
- Browsers synthesize mouse events after taps: `BlockInteraction`'s mousedown
  handler early-returns in touch mode, and touch buttons that open panels
  must use `click` (not pointerdown) so the ghost click is spent on the
  button, not on whatever the panel rendered under the finger.
- HUD layout system: the z-index scale, safe-area convention, and shared
  `.hidden` class are documented in the banner comment at the top of
  `src/style.css` — keep new layers on that scale, pad screen-edge elements
  with `env(safe-area-inset-*)`, and put phone-width fixes in the existing
  `@media (max-width: 600px)` block (the 9-slot hotbar/inv grids must fit
  360px). `body.touch-mode` gates touch-only styling; `.desktop-only` /
  `.touch-only` swap hint text.
- Headless touch testing: emulate with viewport `{width: 390, hasTouch:
  true, isMobile: true}` — `(pointer: coarse)` then matches. Drive input via
  `page.touchscreen` or synthesized PointerEvents on `#touch-look` /
  `#touch-joystick`; `__mc.touch` exposes the TouchControls instance.

## Physics & movement (Phase 8)

- One shared model: `src/physics/PhysicsBody.js` — an AABB (feet-center
  `position`, `width`/`height` from `PHYSICS.playerAABB` / `PHYSICS.mobAABB`)
  swept axis-by-axis X → Z → Y against `world.blockAt()` each `step(delta)`,
  sub-stepped so no axis moves > 0.4 blocks per sweep (the 0.1s delta clamp +
  terminal velocity would tunnel otherwise). Downward block sets `grounded`;
  horizontal block sets `hitWall` (zombies read it to hop 1-block steps).
  All tunables in `PHYSICS` (src/config.js).
- Traversal is MC-style: `stepHeight: 0.6` means full blocks take a jump
  (`jumpVelocity: 9` / `gravity: 32` ⇒ ~1.27-block apex); holding Space (or
  the touch ⬆ button) auto-hops each landing. Raise `stepHeight` past 1.0 to
  get auto-step instead — the step-up path is already implemented.
- Sneak is **KeyC**, not Ctrl (pointer lock doesn't intercept Ctrl+W/Ctrl+S —
  Ctrl-sneak while moving would close the tab). Sneak slows via
  `PHYSICS.sneak.speedMultiplier` and edge-stops (per axis, so you can slide
  along a ledge).
- The player body owns the feet position; the camera is resynced to
  `feet + eyeHeight` every locked frame. To move the player programmatically
  (tests, warps) call `player.teleport(x, y, z)` — it clears velocity and
  fall distance so no stale fall damage lands. `player.respawn()` and
  `deserialize()` route through it.
- Fall damage: PhysicsBody tracks `fallDistance`, fires `onLand(blocks)`;
  Combat wires it to `health.damage((blocks - grace) * damagePerBlock)`.
  Falling below `PHYSICS.voidY` (mined-out world floor) is lethal for the
  player and despawns mobs.
- Physics freezes until `world.chunkReadyAt(x, z)` (gen queue is nearest-
  first, so ~1 frame after load/respawn) and while the pointer is unlocked —
  menus pause falling too. A body embedded in solid blocks (e.g. a block
  placed into a mob) self-heals by rising at `PHYSICS.ejectSpeed`; block
  placement into the player's exact AABB is refused
  (`BlockInteraction.#overlapsPlayer`).

## Feedback, sound & equip-and-use (Phase 9)

- Mining is hold-to-break: `BlockInteraction` accumulates `progress += delta
  / breakTime` (breakTime = block `hardness` ÷ matching-tool tier factor) and
  breaks at 1.0, with canvas-generated crack stages (`src/fx/CrackOverlay.js`)
  tracking progress. Progress resets on target/hotbar-slot change or
  `FEEDBACK.mining.tapGraceSeconds` after release. `breakTargeted()` is still
  the tap/test seam — one call now applies `tapSeconds` of progress, and taps
  accumulate within the grace window (soft blocks: 1 tap; hard: several).
- Right click / touch ▦ route through `interaction.useSelected()` — the
  "use" verb: items with `consumable: true` (items.js) are eaten (token
  `FEEDBACK.consume.healAmount` heal — placeholder until hunger exists),
  otherwise the held block places via `placeAtTargeted()` (unchanged seam).
- The `fx` object (`{ sounds, particles, drops, viewmodel, health }`, built
  in main.js) is how game systems reach the feedback layer. Every hook is
  optional-chained, so systems still run bare (tests, future headless tools).
- Sound is 100% synthesized WebAudio (`src/audio/SoundEngine.js`) — zero
  audio assets. Voices are keyed by name + the per-block `material` field in
  blocks.js (dirt/stone/wood/sand); every play detunes ±AUDIO.pitchVariance.
  The AudioContext is created lazily on the first user gesture
  (`sounds.unlock()`, wired in main.js) — `play()` no-ops before that. Mute
  (M key / overlay "Sound" button) persists in its own localStorage key, NOT
  the save. Headless: AudioContext runs fine in headless Chrome; assert on
  `__mc.sounds.stats.byName` play counters, not audibility.
- Particles: `src/fx/Particles.js` is one pooled `THREE.Points` — a single
  draw call however many bursts are live. `burst(x, y, z, colorHex, count)`
  is generic; reuse it for new effects instead of adding mesh systems.
- Viewmodel (`src/fx/Viewmodel.js`): a camera-child group (main.js does
  `scene.add(camera)` — removing that makes it vanish), materials render
  depthTest-off at renderOrder 100 so it never clips terrain. `swing()`
  retriggers only after the previous arc finishes, so calling it every frame
  while mining yields a continuous chop; `use()` is the place/eat pulse.
- Ground drops (`src/fx/GroundItems.js`): block breaks and mob kills spawn
  drop entities that pop on a SELF-CONTAINED arc (own gravity constant — do
  not couple to the physics pass) and vacuum to the player inside
  `FEEDBACK.drops.magnetRadius`. Inventory-full pickups retry on a backoff;
  the entity list is capped (oldest despawns first).
- Zombie audio hooks live OUTSIDE Zombie.js (idle groans in
  `MobManager.update`, attack growl in Combat's damagePlayer wrapper) so mob
  AI stays sound-agnostic; footsteps watch camera movement
  (`src/audio/Footsteps.js`) without touching PlayerControls.

## Day/night, sea water & swimming (Phase 10)

- The clock is `src/sky/DayNight.js`: `time` in [0,1) — 0 sunrise, 0.25 noon,
  0.5 sunset, 0.75 midnight — advancing only while `player.isLocked` (menus
  pause time like they pause physics). All sky visuals lerp through
  `DAYNIGHT.keyframes`; `World.#buildLights` now exposes `world.sun` /
  `world.ambient` for it to drive. Test seam: `__mc.daynight.setTime(t)`
  applies instantly. Clock persists via `SaveManager.attachDayNight` (the
  `daynight` save slot); unlike treasure it is NOT dirty-flagged — serialize()
  reads the live clock and the while-playing autosave interval picks it up.
- Hostile spawns are night-gated in `MobManager.update`: no spawns while
  `daynight.isNight` is false, night cap is `DAYNIGHT.hostiles.nightMaxCount`,
  and daylight burns remaining zombies one per `burnStaggerSeconds` (ember
  particle burst). `mobs.daynight` is attached by main.js — when it's null
  (bare/test runs) spawning is ungated, so old tests keep working.
- Water is block id 9 (`BLOCK_WATER`, `liquid: true`, NOT solid): generation
  fills air at `y <= WATER.level` in both `Chunk.generate` and the
  `World.blockAt` unloaded-chunk path (keep the two in sync — purity rule
  below). Not solid ⇒ raycasts pass through (can't be mined/targeted),
  collision ignores it, and `surfaceY` answers the SEABED for sea columns.
  Placement replaces water (BlockInteraction allows air OR water); broken
  blocks leave air, not water — there is no flow simulation.
- Water renders as a second translucent double-sided mesh per chunk
  (`chunk.waterMesh`, materialized from `world.waterMaterial`), parented as a
  CHILD of the solid `chunk.mesh` so scene add/remove/position stay
  one-object; only water-vs-air faces are emitted (water-vs-water and
  water-vs-solid cull), open tops drop `WATER.surfaceDrop` for a waterline.
- Swimming: `PhysicsBody` sets `body.inWater` from the block at the body's
  midsection and swaps in `WATER.physics` (gentle gravity, sink cap, vertical
  drag, fallDistance cleared — water landings never hurt). Space held in
  water swims up (`PlayerControls`), with a `breachBoost` jump when against a
  wall so you can climb the 1-block shore lip. The camera-submerged blue wash
  is the `#water-tint` DOM overlay (z-index 3), toggled in main.js.
- Clouds are ONE merged mesh (`src/sky/Clouds.js`) — a 3×3 tile repeat that
  snaps to the tile grid around the camera; keep it a single draw call.
- Headless note: to test night behavior, `__mc.daynight.setTime(0.7)` then
  `__mc.mobs.spawnTimer = 0.1` (the 5s spawn interval is ~17s real time at
  headless speed); dawn burn: `setTime(0.2)` and wait for `mobs.count === 0`.

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
