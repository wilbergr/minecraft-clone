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
  swept axis-by-axis **Y → X → Z (Minecraft's order — Y-first is
  load-bearing, see the fall-damage note below)** against `world.blockAt()`
  each `step(delta)`, sub-stepped so no axis moves > 0.4 blocks per sweep
  (the 0.1s delta clamp + terminal velocity would tunnel otherwise).
  Downward block sets `grounded`; horizontal block sets `hitWall` (zombies
  read it to hop 1-block steps). All tunables in `PHYSICS` (src/config.js).
- Fall-damage over-count (the "2-block fall hurts" bug) had TWO causes; do
  not reintroduce either. (1) The sweeps used to run X → Z → Y: moving
  horizontally at the pre-drop height overflies step corners, so descending
  stairs/hillsides never touched down and `fallDistance` accumulated across
  the whole slope — a walk down 4 stairs landed as one 5-block "fall" (2
  damage). Y-first hugs terrain, so every real step contact fires `onLand`
  and resets the counter (and `grounded` is fresh for the step-up/edge-stop
  checks). (2) PlayerControls' damping integrator used `accel = speed·k·Δ`,
  whose steady state overshoots the configured speed by `kΔ/(1−e^(−kΔ))` —
  +72% at the clamped 0.1s delta (walk 5 ran at ~8.6), +10% at 60fps —
  fast enough to make even walking ballistic over 1-block descents. It is
  `speed·(1−damp)` now: exact at any frame delta. The damage formula was
  always MC-correct (`floor(fell − 3)` HP, grace 3, `PHYSICS.fall`).
  Residual: sprint (1.8× = 9 b/s vs MC's 1.3×) still genuinely clears
  1-block steps on sustained 1:1 descents and accumulates real fall damage
  — authentic ballistics at that speed; only retuning sprint would change
  it. Regression suite: `node tools/test-fall-damage.mjs` (build +
  `npm install --no-save puppeteer-core` first).
- Traversal is MC-style: `stepHeight: 0.6` means full blocks take a jump
  (`jumpVelocity: 9` / `gravity: 32` ⇒ ~1.27-block apex); holding Space (or
  the touch ⬆ button) auto-hops each landing. Raise `stepHeight` past 1.0 to
  get auto-step instead — the step-up path is already implemented.
- Sneak is **Shift** (MC scheme, mechanics PR), with **KeyC kept as an
  alias** — never Ctrl (pointer lock doesn't intercept Ctrl+W/Ctrl+S —
  Ctrl-sneak while moving would close the tab). Sneak slows via
  `PHYSICS.sneak.speedMultiplier` and edge-stops (per axis, so you can slide
  along a ledge). Sprint is a double-tap-forward latch — see the
  Minecraft-fidelity section below.
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
- Drop LANDING works by sinking: `#floorBelow` scans down from the drop's
  own cell, so the last fall frame leaves the center fractionally inside the
  floor block and the `pos.y <= rest` check snaps it up onto that block's
  top. Never make `#floorBelow` skip solid cells the drop overlaps — drops
  would fall through the world. The flip side: the pop arc must never CARRY
  the drop into a solid cell, or that same scan wedges it on/inside the
  block it entered — mining a block with a solid roof directly above used to
  hang the drop mid-air this way. `update()` clamps the arc (ceiling stop
  while rising, per-axis wall stops for drift); keep those clamps if the arc
  changes. Regression suite: `node tools/test-drops.mjs` (needs `npm run
  build` + `npm install --no-save puppeteer-core`); the roofed repro only
  triggers on high pop rolls under the headless 0.1s delta clamp, so the
  test pins `Math.random` to the max roll around the break call.
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
- Hostile spawns are LIGHT-gated since the mechanics PR (the night-only gate
  is gone — see the Minecraft-fidelity section below): dark cells spawn at
  any hour, caps stay `DAYNIGHT.hostiles.nightMaxCount` at night /
  `COMBAT.mobs.maxCount` by day, and daylight burns remaining SKY-EXPOSED
  hostiles one per `burnStaggerSeconds` (ember particle burst) — roofed and
  cave mobs survive sunrise. `mobs.daynight` is attached by main.js — when
  it's null (bare/test runs) the sky term is zero, so spawning stays
  effectively ungated and old tests keep working.
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

## The underground (Phase 11)

- The world is 96 tall with the surface shifted up 48 blocks (`baseHeight`
  62); every height-anchored tunable moved with it: `sandLevel` 59,
  `WATER.level` 57, `DAYNIGHT.clouds.height` 110. `SAVE.schemaVersion` went
  to 2 — v1 edit overlays index blocks by the old chunkHeight, so old saves
  reset (the load guard already handles that).
- Caves are carved in `World.caveAt` (2-octave 3D value noise from
  `createValueNoise3D`, y-squashed into tunnels, tunables in
  `WORLD.terrain.caves`) — called inside `terrainBlock`, so purity holds for
  both `Chunk.generate` and unloaded-chunk `blockAt`. Sea/beach columns keep
  `seabedKeep` top blocks solid so caves never puncture the seabed (no water
  flow exists). Tuned to ~6% of below-surface cells; a node script that
  imports `World` with a `{ add() {} }` scene stub can measure/re-tune the
  generator without a browser.
- Ores are depth-banded in `WORLD.terrain.ores` (first matching band wins):
  gold (block 12) y 1–16 deep, needs an iron pick; iron (8) y 4–40; coal
  (block 11) y 24–72. Coal drops the `coal` item — Phase 12's
  `FUEL_SECONDS` pre-listed `coal`, so it burns in the furnace as-is.
- Depth lighting (budget, no flood-fill): every solid face's vertex color is
  multiplied by `skyFactor(depth)` (a `World` instance method since the
  Nether — each dimension shapes its own curve) — depth being how far the
  face's AIR cell sits below its column's top solid block, so caves darken
  but a shaft dug open to the sky stays lit on remesh. Column tops are
  cached per mesh build; the 1-block border ring asks `World.topSolidY`
  (loaded chunk scan, else pure generator incl. tree canopies). Blocks with
  `emissive: true` skip darkening.
- Torch is block 13: `solid: false` + `targetable: true` — `isTargetable`
  is what `World.raycast` stops on, and BlockInteraction's stale-target
  check allows targetable non-solids, so torches are aimable/breakable but
  walk-through; `shape: 'torch'` makes the mesher emit a small post instead
  of a cube. `world.torches` (a Map kept in lockstep with the edit overlay,
  rebuilt in `deserializeEdits`) feeds `TorchLights` (src/fx): a FIXED pool
  of `LIGHTING.torch.poolSize` point lights reassigned to the nearest
  torches each frame — pool size never changes at runtime or every material
  recompiles. No torch recipe yet — tests obtain them via
  `__mc.inventory.add('torch', n)`.
- Headless: `__mc.torchLights` exposes the pool (`activeCount`); assert
  depth darkening on chunk `geometry.getAttribute('color')` luminance
  (deep vs surface vertices) rather than screenshots.

## Survival loop (Phase 12): furnace, hunger, passive mobs

- Furnace: block 10 (`interactive: true` in blocks.js) — right click routes
  through `BlockInteraction.useBlockHook` (sneak bypasses, so placing against
  a furnace still works). Smelt recipes + fuel burn times live in
  `src/inventory/recipes.js` (`SMELT_RECIPES` / `FUEL_SECONDS` — `coal` is
  pre-listed so a future coal item just works). Per-furnace state is keyed by
  world position in `src/crafting/Furnaces.js`; it ticks while the pointer is
  locked OR the furnace UI is open (watchable smelt, paused in other menus),
  and a lit flame keeps burning MC-style even if the input empties. Breaking
  the block fires `BlockInteraction.onBlockBroken` → contents spill as ground
  drops. Smelting can't start while the output slot holds a different item.
- Hunger (`src/survival/Hunger.js`, tunables in `HUNGER`): drains by
  time/sprint/mining (main.js feeds `player.isSprinting` +
  `interaction.mining`), gates health regen via `Health.regenGate`, and at
  zero starves the player down to `starve.minHealth` (never kills). Eating
  goes through the Phase 9 use verb: items with `consumable: true` restore
  their `food` points and are REFUSED on a full bar (`__mc.hunger` in tests).
  The drumstick HUD (`ui/hungerHud.js`) mirrors hearts: hearts sit left of
  center, hunger right.
- Passive mobs (`src/combat/PassiveMob.js`, tunables in `PASSIVE_MOBS`):
  pig/cow/sheep quadrupeds sharing the Zombie interface (`group`/`cfg`/
  `update`/`hurt`/`dispose` + `passive: true`), so MobManager keeps ONE mob
  list. They spawn on their own timer/cap onto grass columns only, never
  aggro, panic-flee when hit, and drop `cfg.drop` × `dropCount: [min, max]`
  raw meat (Combat's kill path rolls the range). Anything counting or
  spawning hostiles must filter `!m.passive` — the hostile cap and groan
  picker already do. Test hook: `__mc.mobs.spawnPassiveAt(x, z, kind)`.
- Save schema: `hunger` (number) and `furnaces` (Furnaces.serialize()) are
  OPTIONAL keys wired via `save.attachHunger/attachFurnaces` after load();
  older saves lack them and load fine, so `schemaVersion` stayed 1.
- Furnace/inventory stack moves use `Inventory.setSlot(i, stack)` — the one
  sanctioned direct-slot write (it emits onChange; never poke `slots[]` raw).
- Passive mobs and dawn burn coexist: the burn picks the last HOSTILE
  (`findLastIndex((m) => !m.passive)`), and night gating never touches the
  passive spawn timer — passives spawn day and night.

## Depth & variety (Phase 13): textures, combat depth, biomes

- Textures: `src/world/atlas.js` DRAWS every 16×16 tile onto one canvas at
  boot (seeded mulberry32 per tile — deterministic, zero binary assets).
  The chunk material is `map: atlas + vertexColors: true` — the shader
  multiplies texture × vertex color, so vertex colors are now a pure TINT
  layer: face shade × Phase 11 depth darkening × biome tint. NearestFilter
  both ways and `generateMipmaps: false` are load-bearing (bilinear/mips
  smear the pixel art); UV rects are half-texel inset against bleed. Blocks
  name their tiles via `tex: { top, side, bottom }` in blocks.js;
  `biomeTint: 'top'|'all'` marks faces whose tile is drawn GRAYSCALE and
  colored per biome at mesh time (grass tops, leaves). Item icons reuse the
  tiles (`tileURL(name, tint?)` → data URL + `image-rendering: pixelated`);
  `BLOCKS[id].color` still feeds particles/drops/viewmodel/water. Atlas
  canvas/texture creation is guarded behind `typeof document` so node
  generator probes keep working; `uvRect()` is pure math.
- Biomes: a second low-frequency FBM (`WORLD.terrain.biomes`) bands columns
  desert / plains / forest / snow, ordered along the noise axis so only
  climate neighbors touch. `World.biomeAt(wx, wz)` is pure like all terrain;
  bands set the surface block (sand / grass / snow block 14), tree chance,
  and grass/leaf tints. Terrain relief scales SMOOTHLY from the raw biome
  noise (`biomes.amplitude` lerp), never from the discrete band — discrete
  would step-cliff at borders. `terrainBlock` takes an optional per-column
  `biome` arg (column loops pass it; single queries default). Reshaped
  terrain ⇒ `SAVE.schemaVersion` 3 (old saves reset via the load guard).
- Mob base: `src/combat/Mob.js` owns body-part building, per-mob cloned
  materials + hurt flash, decaying knockback, and `locomote()`.
  Zombie/Skeleton/Creeper/PassiveMob all extend it. `damagePlayer(amount,
  mob)` passes the attacker — Combat shoves the player away from it.
- Skeleton (`COMBAT.mobs.skeleton`): ranged kiter — holds [minRange,
  maxRange], shoots only with line of sight (`world.raycast`), arrows via
  the shared `src/combat/Projectiles.js` (`fromPlayer: false`). Combat
  attaches `mobs.projectiles`; when null (bare runs) skeletons never fire.
- Creeper: fuse ticks inside `fuseRange` (decays back outside), swells and
  flashes via emissive, then sets `mob.exploded` — DETONATION RUNS IN
  MobManager (world.explode + proximity damage + fx), never inside the
  mob's own update, honoring the no-mid-iteration-mutation rule.
  `World.explode(x, y, z, r)` is the batched carve: overlay + chunk writes
  first, then ONE remesh per affected chunk (per-block setBlock would
  remesh the same chunk dozens of times); water/air survive, y 0 stays
  solid, sphere torches unregister.
- Weighted night spawns: `COMBAT.mobs.hostileWeights`; `mobs.spawnAt(x, z,
  kind?)` defaults to zombie so old hooks/tests hold. Dawn burn ignites ALL
  hostiles (creepers too — a deliberate MC divergence that keeps the
  population managed). Ambient groans gate on `mob.growls` (zombies only).
- Bow: hold right click to draw — `interaction.bowHook('start'/'release')`;
  touch ▦ and other tap paths send `'tap'` (fixed `COMBAT.bow.tapCharge`).
  Charge accumulates in `Combat.update` (menus freeze the draw with
  everything else), scales speed/damage, consumes an `arrow` item + bow
  durability. The bow is `tool: { kind: 'bow' }` — tool infra gives
  durability for free, and the kind matches no block so it can't mine.
- Armor: `src/combat/Armor.js`, four wear slots; right click equips
  (`interaction.useItemHook`, wired in main.js), the inventory-screen armor
  row unequips. `Combat.hurtPlayer(amount, knockDir)` is the ONE path for
  combat damage — armor reduction (`COMBAT.armor`) + player knockback
  (`player.applyKnockback`: a decaying `knock` vector ADDED on top of
  control velocity each frame, because PlayerControls overwrites the body's
  horizontal velocity). Fall/void/starve damage bypass hurtPlayer on
  purpose. Saves under the optional `armor` key (attachArmor, still v3).
  Jump-crit: falling (+!grounded, !inWater) swings in `tryAttack` ⇒
  ×`COMBAT.attack.critMultiplier`.
- Headless: `__mc.armor` / `__mc.projectiles` are exposed;
  `interaction.bowHook('start'…'release')` fires without real mouse input;
  spawn kinds via `__mc.mobs.spawnAt(x, z, 'creeper'|'skeleton')`. After
  spawning/moving a mob inside an evaluate, call
  `__mc.scene.updateMatrixWorld(true)` before `combat.tryAttack()` —
  matrices otherwise refresh only at render. Biome scans should prefer
  inland un-caved columns (beaches are sand in EVERY biome, and caves can
  puncture any surface).

## Bed, sleep & spawn point

- The bed is block 15: a deliberate **1-cell bed** (not MC's 2-cell) —
  non-solid + `targetable` + `interactive`, `shape: 'bed'` (the mesher's
  `#emitBed` low box; unlike the emissive torch it takes depth darkening).
  Walk-through like the torch. Recipe: 3 planks + 3 wool; wool is a sheep
  `extraDrop` (the cow-leather mechanism in `PASSIVE_MOBS.kinds.sheep`).
- `interaction.useBlockHook` is wired in main.js to a **dispatcher keyed by
  block id** (`blockUseHandlers`): furnace → furnace screen, bed → sleep. To
  add an interactive block: `interactive: true` in blocks.js + one handler
  row returning true when the click is spent. Since Trial PR 3, `useSelected`
  no longer pre-gates on `block.interactive` — the hook is consulted for
  EVERY targeted block (the dispatcher decides; unmatched ids fall through),
  which is how contextual cases like the siege core work. Sneak still
  bypasses. Break notifications mirror the shape since the inventory
  overhaul: `blockBreakHandlers` in main.js is a per-id map (furnace and
  chest rows spill contents) — see the inventory-overhaul section for the
  explosion-carved path.
- Sleep logic lives in `src/survival/Sleep.js` (tunables in `SLEEP`):
  night-only (`daynight.isNight`) — success sets `sleep.spawn = [x, y, z]`
  (bed block coords) and `setTime(SLEEP.wakeTime)`; a daytime click toasts
  "You can only sleep at night" and does nothing else, but still returns
  true so the click never falls through to block placement.
- Respawn: `PlayerControls.respawn` consults the optional `player.spawnHook`
  (main.js → `sleep.respawnPoint()`). The hook validates the bed still
  exists via `world.blockAt` — which answers from the **edit overlay even
  for unloaded chunks**, so validation is correct at any distance; a missing
  bed clears the spawn, toasts, and falls back to `PLAYER.spawnPoint`.
- Persistence: optional `spawn` save key via `save.attachSleep(sleep)` —
  the hunger/armor optional-slot pattern, `schemaVersion` still 3. Sleep
  feedback (toast `#sleep-toast`, fade `#sleep-fade`, synth `sleep` sound)
  binds in `src/ui/sleepFx.js`; both DOM layers are z-index 6 transient
  feedback, styled at the END of style.css.
- Headless: `__mc.sleep` is exposed; drive sleeping by setting
  `interaction.target` to the bed cell and calling `useSelected()` (no
  pointer-lock gate on that path). `sounds.stats.byName.sleep` counts the
  chime; puppeteer-core is NOT a project dep — `npm install --no-save
  puppeteer-core` before browser verification.

## The King's Trial, PR 1: quest framework + relic scavenger

- `CHALLENGE_MESSAGE` (the captain-editable trial payoff) sits directly under
  `TREASURE_MESSAGE` at the top of `src/config.js`; all trial tunables live in
  the `CHALLENGE` block. The `beacon`/`siege`/`boss` sub-blocks and the
  latched `beaconBuilt`/`siegeCleared`/`bossDefeated` save flags are declared
  but INERT — PRs 2–4 (building, siege, boss) fill them in. `retry: 'free'`
  is the captain's locked decision for those stages.
- `src/quest/Challenge.js` is the stage machine (TreasureHunt-shaped:
  `onChange`, `update(delta, playerPos)` beside `hunt.update` in main.js,
  `serialize`/`deserialize`). It unlocks via `hunt.isComplete` — constructed
  AFTER `save.attachTreasure(hunt)` so it sees restored hunt state, and it
  subscribes to `hunt.onChange` for the live unlock. Saves through the
  optional `challenge` slot (`save.attachChallenge`, a verbatim sibling of
  `attachTreasure`); `schemaVersion` stayed 3.
- The Trial Grounds anchor is ringed off the third treasure token and marked
  with scene meshes only (ring + beam built on activation) — NOTHING is
  stamped into terrain generation. Same for relic shards: placement uses
  ONLY the pristine generators (`terrainHeight`/`biomeAt`/`caveAt`/`treeAt`),
  never `blockAt`, which consults the player-edit overlay and would make
  positions drift between saves.
- `src/quest/TokenField.js` is the shared floating-token helper (mesh +
  beam + bob/spin + proximity) extracted from TreasureHunt — both hunts use
  it; keep visual changes there so they stay identical. Relic meshes build
  lazily on activation, so a sealed trial renders nothing.
- Sea columns are SCARCE on seed 1337 (deepest ocean within 600 blocks is
  h=55 vs WATER.level 57): the Tide Shard placement sweeps outward rings
  deterministically with a depth-relaxation ladder instead of random darts —
  reuse that pattern for any "find a rare column" placement.
- Stage 1 completes by collecting all 5 shards (added as `relic_shard`
  items) then standing inside the anchor ring: found-flags are the source of
  truth; delivery consumes whatever shards are carried, so item loss can
  never soft-lock the trial.
- Headless: `__mc.challenge` (+ `challenge.skipToStage(n)` latches prior
  stages but does NOT bypass the hunt.isComplete unlock gate). Collect by
  `player.teleport` onto `relics.relics[i].position` (same trick as treasure
  tokens); the compass HUD (`treasureHud.js`) targets
  `hunt.activeToken ?? challenge.compassTarget`. When wiping storage in a
  test, set `__mc.save.enabled = false` BEFORE `localStorage.clear()` — the
  beforeunload autosave otherwise resurrects the save on reload.
- Torch recipe exists now (`stick + coal → 4 torches` in recipes.js) — the
  Phase 11 "no torch recipe yet" note is obsolete.

## The King's Trial, PR 2: Raise the Beacon (building stage)

- `world.onEdit` is now a LISTENER LIST: subscribe with `world.onEdit(fn)`
  (never assign — assignment throws now that it's a method). Listeners get
  the edit's world coords `(wx, wy, wz)`; `World.explode` reports its blast
  center once, not per carved block. SaveManager's dirty flag and the
  challenge's beacon re-check both subscribe.
- The beacon spec is captain-retunable in `src/config.js`: edit
  `BEACON_SHAPE` (platform size, pillar height/materials, torch/core ids),
  never `CHALLENGE.beacon.cells` — `beaconCells()` expands the shape into
  the 43-cell list `StructureCheck` walks. `ids: null` on a cell means "any
  solid block" (forgiving); explicit lists are strict (torches + gold core
  are the signature cells).
- Cell dy 0 is the anchor column's SURFACE BLOCK layer
  (`StructureCheck.baseY = anchor.y - 1`), so natural terrain satisfies
  platform cells for free — deliberate ("forgiving in terrain").
- The check runs once on every beacon-stage entry path (delivery advance,
  deserialize, skipToStage — all funnel through `Challenge.#syncBeacon`) and
  on world edits within `CHALLENGE.beacon.checkRadius` of the anchor.
  `evaluate()` uses `world.blockAt`, which answers from the edit overlay even
  for unloaded chunks, so checks are correct at any distance.
- `beaconBuilt` is LATCHED: once the stage completes, later damage (creeper,
  PR 3 siege) never regresses it — `#onWorldEdit` early-returns on the flag.
  Completion doubles the anchor beam's opacity (also re-applied on restore).
- The ghost preview is one `THREE.InstancedMesh` (satisfied cells collapse
  to zero-scale matrices — InstancedMesh has no per-instance visibility),
  built lazily on stage entry and disposed on completion. Cubes are 1.02³ so
  a wrong-material block reads as haloed instead of z-fighting.
- Stage indexes are 0-based: `skipToStage(1)` lands ON the beacon stage
  (relics auto-completed) and shows the ghost immediately; `skipToStage(2)`
  latches `beaconBuilt` and skips past it. Headless: drive builds with
  `__mc.world.setBlock(s.anchorX + cell.dx, s.baseY + cell.dy, s.anchorZ +
  cell.dz, id)` where `s = __mc.challenge.structure`; each setBlock
  re-evaluates synchronously, so `s.satisfied`/`challenge.beaconBuilt` can be
  asserted right after. Stage 2 (siege) is the next inert stub — its tick
  seam is the stage-2 comment in `Challenge.update`.

## The King's Trial, PR 3: The Siege (combat stage)

- Arm trigger: `BlockInteraction.useSelected` no longer pre-gates the use
  dispatcher on `block.interactive` — main.js's `useBlockHook` is consulted
  for EVERY targeted block and decides: `challenge.tryUseBlock` first (the
  contextual case — spends the click only when the block is the gold core ON
  a core cell at the anchor AND `stage === 2`), then the id-keyed
  `blockUseHandlers` (furnace/bed unchanged). Gold ore is never globally
  interactive — cave veins stay plain mining targets. Sneak still bypasses.
- `src/quest/SiegeEvent.js` is the wave runner (tunables in
  `CHALLENGE.siege`): armed at the core → waits for `daynight.isNight` →
  waves from `cfg.waves` spawn evenly on a ring (`spawnRadius`) with a flare
  + horn `flare.leadSeconds` before the mobs rise. A wave's mobs are pinned
  by OBJECT REFERENCE and the wave clears when none remain in `mobs.mobs` —
  counts sword/arrow kills, creeper detonations, and void falls uniformly.
  Deliberately NOT `onMobKilled` (single-slot, Combat's, silent on creeper
  detonations). Its live deps (`mobs`/`daynight`/`health`/`player`) are
  attached by main.js post-construction (the `mobs.daynight` pattern) — bare
  runs leave the siege inert.
- `MobManager.event` (set by the siege): suppresses ambient hostile AND
  passive spawning (wave counts stay exact, draw calls bounded) and DEFERS
  the dawn burn. Failure-first ordering: SiegeEvent checks dawn before
  anything else, fails, clears `mobs.event` — the burn then eats the
  leftover horde. `mobs.despawn(mob)` is the no-credit removal (leash fail
  disperses the wave through it); never call it inside `mobs.update`.
- Fail = dawn (leftovers burn), leaving `arenaRadius` for >
  `leaveGraceSeconds` (wave despawns — "the horde disperses"), or death
  (checked FIRST in update, before the isLocked freeze, because dying
  unlocks the pointer; `Combat.respawn` clears the mobs anyway). All free
  retries: re-arm at the core. Win latches `siegeCleared`, advances to
  stage 3 (boss stub) and turns the anchor beam
  `CHALLENGE.siege.clearedBeamColor` (re-applied on restore in
  `#syncBeacon`).
- Mid-siege state is deliberately NOT saved (mobs never persist): reload =
  disarmed, siege stage (index 2) still active. Only latched `siegeCleared`
  rides the
  `challenge` slot (`schemaVersion` still 3). `skipToStage` calls
  `siege.cancel()` so a jump never leaves `mobs.event` set.
- Compass HUD: `challenge.compassTarget.name` carries the live readout
  ("Wave 2 · 3 remain · dawn in ~2:40") via `siege.hudLabel`; quest log
  stage row shows arm/hold instructions.
- Headless: `__mc.player.lock()` from `page.evaluate` acquires pointer lock
  directly (no overlay click needed). Drive: complete hunt →
  `skipToStage(2)` + `setBlock` the two gold core cells at
  `(s.anchorX, s.baseY+1..2, s.anchorZ)` → set `interaction.target` to the
  core → `useSelected()` → `daynight.setTime(0.6)`. Shrink
  `siege.cfg.breatherSeconds`/`cfg.flare.leadSeconds` for test speed; spy on
  `mobs.spawnAt` for composition asserts; kill pinned mobs via
  `mobs.hit(m, 9999, {x:1,y:0,z:0})`; a creeper in `pinned` is
  `'exploded' in m`, and setting `m.exploded = true` detonates it next
  frame. The siege freezes while the pointer is unlocked (like combat), so
  tests must hold the lock through waves.

## The King's Trial, PR 4: The Hollow King (boss finale)

- `src/combat/Boss.js` extends `Mob` — 12 parts, feet-origin, arms hang from
  PIVOT GROUPS at the shoulders (poses rotate the joint, not the box center).
  The crown + chest core are `MeshBasicMaterial` (unlit = glowing) kept OUT
  of `this.materials`, so the hurt flash / telegraph emissive never touch
  them — `dispose()` is overridden to free both. In `HOSTILES` as `'boss'`
  (`mobs.spawnAt(x, z, 'boss')` works) but never in `hostileWeights`.
- All tunables in `CHALLENGE.boss` (config-driven rule): HP 120, AABB
  1.1×2.8, `knockbackFactor` 0.15 (applied in an overridden `hurt`),
  `phases: [0.66, 0.33]` health fractions, per-attack
  `{telegraphSeconds, cooldownSeconds, …}` blocks, `drop`/`extraDrop` (the
  `kings_crown` trophy + gold ride Combat's normal kill plumbing untouched).
- The state machine is plain readable fields (`phase`, `state`, `attack`,
  `cooldowns`, `lastAttack`) and `boss.startAttack(key, playerPos)` is PUBLIC
  — the headless seam that forces any attack past range/phase/cooldown gates
  (the telegraph still runs). Attacks: slam (AoE), charge (rush;
  `body.hitWall` while charging → 2.5s stagger at ×1.5 damage — `locomote`
  grew a `hop = true` 4th param so the charge does NOT auto-hop walls),
  volley (phase ≥2, 3-arrow fan, skeleton-style lead + LOS), summon (phase
  ≥2, hard cap via `minions.length`), quake (phase 3, marks the player's
  cell then explodes it — craters are real `World.explode` edits and persist).
- MID-UPDATE MUTATION RULE: the boss only SETS `pendingSummon` /
  `pendingQuake`; `MobManager.update` resolves both AFTER the mob loop
  (creeper-`exploded` pattern) and prunes `mob.minions` against the live
  list there too. Never resolve them inside `Boss.update`.
- Phase transitions: 2s invulnerable roar (`hurt` returns false), the crown
  spinning fast IS the tell; attack cooldowns reset. Phase 3 multiplies all
  cooldowns by `phase3CooldownFactor`.
- `src/quest/BossFight.js` is the fight runner (SiegeEvent's sibling, owned
  by Challenge as `challenge.bossFight`, deps attached in main.js):
  core-click at stage 3 → `trySummon()` → 3s rumble → boss rises at the
  anchor via `spawnAt`, pinned BY REFERENCE. Gone from `mobs.mobs` with
  `health <= 0` = victory; gone otherwise (void, despawnRadius) = quietly
  re-summonable. Leash: outside `CHALLENGE.siege.arenaRadius` >
  `leash.playerSeconds` or LOS broken > `leash.losSeconds` → roar + despawn
  (fresh summon = full health, so leashing IS the heal). `mobs.event` is set
  for the whole fight; death/skips route through `cancel()` so it never
  leaks. Mid-fight state is not saved (mobs never persist).
- Victory: `Challenge.#onBossWin` latches `bossDefeated`, advances to
  complete, fires `onComplete` — owned by `bindChallengeReveal`
  (`src/ui/challengeReveal.js`, `#challenge-reveal` modal rendering
  `CHALLENGE_MESSAGE`) with the treasure reveal's `celebrated` replay guard
  (`challenge.markCelebrated()`). The api exposes `show()` so the future
  guidance layer can wrap the moment. Boss HP bar: `src/ui/bossHud.js`
  (`#boss-bar`), purely driven by `bossFight.onBossHealth`/`onBossGone`.
- Observability seam for the guidance PR: `bossFight.onBossEvent(type,
  data)` — rumble/rise/telegraph/slam/charge/volley/summon/quake/quakeMark/
  stagger/phase/leash. main.js wires only fx to it today.
- Headless: shrink `__mc.bossFight.cfg.…` (it IS `CHALLENGE.boss`, so
  `boss.cfg` too) before summoning; summon = `skipToStage(3)` + setBlock the
  two core cells + set `interaction.target` to a core cell + `useSelected()`;
  or spawn bare via `mobs.spawnAt(x, z, 'boss')` (no leash/HP bar without
  the runner). Force attacks with `boss.startAttack('quake', camera.position)`;
  `waitForFunction` on `boss.state`/`boss.phase`/`challenge.stage` — never
  fixed sleeps. Reveal is `__mc.challengeReveal` (`.isOpen`).

## Inventory overhaul: cursor stacks, drop/throw, chests, sort

- One interaction model for every screen: `src/inventory/stackOps.js` (pure
  ops over a *container adapter* `{ size, get, set, canAccept }`) +
  `src/ui/slotCursor.js` (the shared held-stack ghost) + `bindSlotPointer`
  in `src/ui/slots.js` (left pick/place/merge/swap, right split/place-one,
  drag = pointerdown-pick + pointerup-place on a different slot, shift-click
  `quickMove`, double-click `gather`). Inventory/furnace/chest screens all
  build adapters and share ONE SlotCursor (main.js) — never reimplement slot
  clicks. `Inventory.swap` is gone. Right click resets the double-click
  window on purpose (fast split-then-pick must not gather).
- Screen close calls `cursor.flushInto(inventory, drops, camera)` — held
  stack returns to the inventory, overflow is thrown at the player. The held
  stack also rides the optional `cursor` save key (`attachCursor`): on load
  it's ADDED to the inventory, not restored to the cursor. `schemaVersion`
  still 3.
- Tool durability follows items everywhere now: `Inventory.add(id, count,
  durability?)` third arg, ground-drop entities carry `durability`, and the
  furnace/chest spill paths pass it — dropping a used tool can't refresh it.
- Drop/throw: `Inventory.take(index, count)` (slot-addressed removal that
  returns what it removed) + `GroundItems.throwFrom(camera, id, count,
  durability?)`; `spawn` takes opts `{ vx, vy, vz, pickupDelay, durability }`
  (per-entity `pickupDelay` beats the global — throws need `FEEDBACK.drops.
  throw.pickupDelaySeconds` or they boomerang back through the magnet).
  Q = drop one, Shift+Q = stack (`ui/dropKeys.js`, gated on `isLocked` AND
  the main.js `anyUIOpen()` union — pointer-lock release is async, so
  isLocked alone leaks a drop when a screen opens). Backdrop click in any
  screen throws the held cursor stack (left all / right one).
- Chests: block 16 (plain full cube), `src/crafting/Chests.js` is a Furnaces
  sibling (Map by "x,y,z", `markChanged`, `onBroken` spill, optional
  `chests` save key via `attachChests`) with NO update tick. The chest
  screen's "double chest" is the lite adjacent view: `openAt` checks the 4
  horizontal neighbors via `world.blockAt` and shows that chest's grid too —
  state stays strictly per-block, no pairing metadata.
- Explosion spill (orphan fix): `World.explode` returns its carved cells
  `[{x, y, z, id}]`; `MobManager` forwards them to the optional
  `mobs.onBlocksExploded` hook, which main.js routes through the same
  `blockBreakHandlers` map as player mining. Without this, exploded
  furnace/chest state stayed keyed in the map and resurrected into a newly
  placed block at the same coordinates. New content blocks: add ONE row to
  each map.
- Sort: `sortedStacks(slots)` in stackOps (pure; merges stackables, orders
  blocks/tools/food/misc) + `Inventory.setRange(start, stacks)` (single
  emit). Buttons via `makeSortRow` on the main grid + chest grids — never
  the hotbar.
- Headless: `__mc.cursor` / `__mc.chests` / `__mc.chestScreen` are exposed;
  drive slots by dispatching `PointerEvent`s on `screen.slotEls[i]` /
  `chestScreen.chestEls[i]` (pointerdown acts; remember a document-level
  pointerup between clicks to clear the drag origin). Double-click tests
  must dispatch both pointerdowns in ONE `page.evaluate` — headless frames
  run ~300ms, blowing the 0.4s window across CDP round trips. Thrown drops:
  wait for `drops.items[i].landed` before teleporting onto them (airborne
  items slide downhill). The old "collect output by clicking" rule still
  holds: furnace output takes a press with an EMPTY cursor only.

## The King's Trial guidance layer (Herald, wisps, stele, testament)

- All strings and knobs live in the `GUIDANCE` block in src/config.js —
  purely additive, nothing inside `CHALLENGE`, zero save keys, zero
  `Challenge.js` changes. The Herald's lines carry a deliberate TONE ARC
  (empathetic at unlock → urgent by the siege → lightly scolding on boss
  deaths → warm farewell); keep the arc when editing lines.
- `bindGuidance` (src/quest/guidance.js) is the single main.js touch point.
  It must bind AFTER bindTreasureReveal/bindChallengeReveal and their
  onToggle assignments: it WRAPS three single-slot hooks — `reveal.onToggle`
  (unlock apparition fires on dismiss), `bossFight.onBossEvent` (boss-stage
  lines on top of the fx handler), and `challenge.onComplete` (Herald
  farewell + dissolve, THEN the existing challengeReveal modal — the modal
  itself is untouched). It also takes over `challenge.onToast`: every trial
  message rides the QUEUED `#herald-line` banner (each message holds ≥
  `GUIDANCE.banner.minSeconds`), never the single-slot `#treasure-toast` —
  treasureHud keeps only hunt.onCollect.
- `src/quest/Herald.js`: NOT a Mob (plain Group, no `userData.mob` ⇒
  intangible to combat raycasts). `lineKeyFor(challenge)` is the pure
  stage→key derivation; scripted beats (`unlock`/`bossRetry`/`bossLeash`/
  `bossPhase2/3`/`complete`) arrive via hooks. Failure detection is
  STAGE-gated (`c.stage === 2/3` on the active→idle transition), never the
  latched flags — `skipToStage` leaves stale latches (siegeCleared stays
  true after a skip past-and-back) that would mask real fails.
- `src/fx/WispTrail.js` reads `hunt.activeToken ?? challenge.compassTarget`
  (the compass HUD's exact expression) and bursts into the existing particle
  pool — no new draw calls. It also owns the gold-core shimmer (stage 2
  disarmed / stage 3 idle). `src/quest/RuneStele.js` draws its rune face on
  one seeded canvas (atlas.js technique, `typeof document`-guarded); lit
  lines ⇔ `challenge.stage > i`, so restores are correct with no code.
- Headless seams: `__mc.herald` (`lineKey`, `state`:
  hidden/apparition/resident/dissolving/gone), `__mc.wisps.stats`
  (`bursts`/`shimmers`), `__mc.stele` (`litCount`, `redraws`),
  `__mc.heraldBanner.current`, sound counters `herald`/`runeIgnite`/
  `trialComplete`. The apparition takes `GUIDANCE.herald.apparitionSeconds`
  of GAME time (~3× real headless) — shrink `__mc.herald.cfg.
  apparitionSeconds` before dismissing the treasure reveal, and remember
  localStorage does NOT survive across separate puppeteer launches (each
  gets a fresh profile).

## The King's Cache (Trial reward, ender-style global chest)

- Block 17 (`BLOCK_KINGS_CACHE`): every placed cache opens the SAME global
  27-slot store — `src/crafting/EnderStore.js`, a Chests sibling minus
  everything positional (one shared `slots` array, `markChanged` seam, no
  tick). Breaking the block drops only the block item; there is deliberately
  NO `blockBreakHandlers` row — contents persist in the store. Rides the
  optional `enderChest` save key (`attachEnderStore`, `schemaVersion` still
  3) as `{ granted, slots }`.
- The grant is item-not-recipe: `grantKingsCache` in main.js gives ONE
  `kings_cache` block when `challenge.isComplete`, latched by
  `enderStore.granted` (pre-reward completed saves grant once on load via
  the boot call; reloads never re-grant). Wired AFTER bindGuidance so the
  grant toast rides the Herald banner. Chosen over a gated recipe because
  the crafting panel renders RECIPES statically — no conditional-recipe
  machinery exists.
- Because the one copy is unrecoverable if destroyed, the block is
  `blastResistant: true` — a generic blocks.js flag `World.explode` skips
  (currently its only user). Mining still works normally.
- The cache reuses ChestScreen: `openStore(store, title)` fronts any
  `{ slots }` container with `markChanged()`/`onChange()`; `screen.owner`
  tracks whose markChanged the slot adapters call, and the store view hides
  the adjacent-chest grid. Don't build a second chest-like screen.
- Headless: `__mc.enderStore` (`slots`/`granted`); open by setting
  `interaction.target` to a placed cache cell + `useSelected()`, or call
  `chestScreen.openStore(__mc.enderStore)` directly; drive the grant with
  `challenge.skipToStage(4)` (fires onChange).

## Deep water: ocean biome, breath & the Tide-Drowned Dive

- Oceans are a THIRD noise field, not a biome band: `world.oceanNoise`
  (`WORLD.terrain.ocean`) smoothsteps `terrainHeight` down toward
  `floorHeight` (44 = 13 under `WATER.level` 57) across the
  `[maskStart, maskFull]` continentalness band, entirely inside
  `terrainHeight` — purity holds for free, and everything downstream (water
  fill/mesh, sand beaches, no trees, `seabedKeep` cave sealing, all quest
  placement guards) keys off height vs WATER.level unchanged. Where the mask
  is zero, heights are byte-identical to the pre-ocean generator. Retune
  with `node tools/probe-ocean.mjs` (committed; asserts coverage band,
  dive-worthy column supply, spawn-column purity, and an unmasked-column
  regression against the pre-ocean formula — exits 1 on failure). Seed 1337:
  13.8% coverage, basins to 14 deep, nearest dive column ~176 blocks out,
  spawn h=63 untouched. Terrain reshape ⇒ `SAVE.schemaVersion` 4 (the
  v2→v3 precedent; old saves reset via the load guard).
- Hostile night spawns skip water-covered columns (`#spawnNear` checks
  `terrainHeight <= WATER.level` — mobs spawn at `surfaceY`, the SEABED for
  ocean columns). Ocean nights are quiet on purpose; passives were already
  grass-gated.
- Breath (`src/survival/Breath.js`, knobs in `BREATH`): Hunger's structural
  twin — drains while the CAMERA cell is water, refills fast in air, and at
  zero `onDrown` fires per interval → main.js wires it to `health.damage()`
  DIRECTLY (armor never reduces it — the fall/void/starve precedent) with
  NO floor: drowning kills, unlike starvation, because surfacing is always
  available. Ticks inside hunger's `isLocked && !isDead` gate; reset on
  respawn; deliberately NOT saved (resets full on load — `SaveManager`
  untouched). Timings read `breath.cfg` (IS the `BREATH` object), so tests
  shrink them like `bossFight.cfg`. Bubble HUD (`ui/breathHud.js`,
  `#breath-bar` above the drumsticks, armor-row slot mirrored right) hides
  whenever the bar is full.
- ONE submerged flag for everything: `updateUnderwater()` in main.js runs
  the old water-tint camera-cell test and drives the tint, breath drain, fog
  swap, splash + spray, and audio muffle — they can never disagree. It runs
  AFTER `daynight.update` so the submerged fog (near/far from `WATER.fog`,
  color lerped `colorBlend` toward the water color) overwrites what DayNight
  wrote; surfaced frames restore `GRAPHICS.fogNear/fogFar` and leave color
  to DayNight.
- Swim-down is sneak (Shift, or the C alias) in the `PlayerControls` water
  branch — Space wins when both are held; touch inherits it through the ⬇
  sneak toggle button (added in the mechanics PR). Sharp
  edge: `PhysicsBody.step` clamps downward speed to `WATER.physics.
  sinkSpeed` and applies drag AFTER the owner sets velocity, so
  `swimDownSpeed` above sinkSpeed is effectively capped — the dive reads as
  "sustained max sink" (~2.3× the passive drag equilibrium), not the raw
  knob value.
- Underwater audio: a PERMANENT lowpass `BiquadFilter` sits in the master
  chain (`master → filter → destination`, built at unlock);
  `sounds.setUnderwater(bool)` ramps its cutoff (`AUDIO.underwater`), and
  `sounds.underwater` is the test-visible state (latched pre-unlock). The
  `splash` voice fires on submerged-flag TRANSITIONS (enter loud, exit
  soft) and counts in `stats.byName.splash` like everything else.
- The Tide Shard (relic index 4) now REQUIRES the dive: `#findSeaSpot`'s
  primary pass wants `h <= WATER.level - CHALLENGE.relics.minDiveDepth`
  (10), keeping the old `-3`/`-2` rungs as the never-fail fallback ladder.
  Same save shape, same clue, same index — on seed 1337 it lands at
  y=46, so the ±4 collect band tops out at 50, five blocks under the
  waterline: surface treading can never collect it.
- Headless: `__mc.breath` (shrink `breath.cfg.drainPerSecond` /
  `drown.intervalSeconds` / `drown.damage` before drowning runs — real
  timings take ~50s of wall clock), `sounds.underwater`,
  `stats.byName.splash`; drive the dive with `page.keyboard.down('KeyC')`
  and compare descent per-frame against the passive sink (both descend —
  assert the RATE, not the direction). `sounds.unlock()` +
  `player.lock()` from `page.evaluate` work without real gestures. Fog
  asserts: `scene.fog.near === WATER.fog.near` submerged,
  `GRAPHICS.fogNear` surfaced.

## Minecraft-fidelity mechanics (light spawning, MC controls, fidelity pack, armor wear)

- **Light-based spawning:** `world.lightAt(x, y, z, skyBrightness)` is the one
  light query — pure, `max(skyFactor(depth) × skyBrightness, torch falloff)`
  over `world.torches` with radius `LIGHTING.torch.distance` (protective
  bubble ≡ visible glow; ignores walls like the visual point lights — the
  Phase 11 no-flood-fill rule). `daynight.skyBrightness` is the sampled sun
  intensity normalized to its keyframe max (~1 noon, ~0.1 night). Hostiles
  spawn wherever light ≤ `COMBAT.mobs.spawnLight.maxLight` (0.25): with the
  shipped constants that's deep caves (floor 0.15) at any hour, the surface
  only at night (~0.1), and nothing within ~10.5 blocks of a torch.
  `#spawnNear` tries `spawnLight.attempts` ring spots, walking each column
  top-down for spawnable cells (solid floor + 2 air) — surface AND cave
  pockets — with a 3D min-distance check; `spawnAt(x, z, kind, y=null)`
  places feet at `y` when given. The dawn burn only ignites mobs with
  `topSolidY(col) <= feet y` (sky-exposed); cave/roofed mobs survive.
  Siege/boss (`mobs.event`) and the ocean wet-column guard are untouched.
- **Controls are MC's:** Shift = sneak/dive (KeyC alias kept), sprint =
  double-tap-forward latch (`PLAYER.sprint.doubleTapSeconds`), forward-only
  by construction, cleared on forward release / sneak / unlock, and refused
  by the optional `player.canSprintHook` (main.js: `hunger.value >
  PLAYER.sprint.minHunger`, MC's starving rule — bare runs sprint freely).
  Touch has a 4th action button ⬇ — a sneak TOGGLE (same thumb can't hold
  while look-dragging) driving `keys.sneak`, cleared by `#releaseAll`
  (`touch.sneakBtn` in tests).
- **Fidelity pack:** bed day-click sets the spawn WITHOUT a time skip
  (modern MC); night sleep refuses while a hostile is within
  `SLEEP.monsterRadius` of the bed (`sleep.mobs = combat.mobs` attached in
  main.js, null skips). Mining multiplies breakTime by
  `COMBAT.mining.inWaterFactor` / `airborneFactor` (5× each, exclusive —
  reads `player.body.inWater/grounded`). Attachment pops: a `world.onEdit`
  subscriber in main.js (`popAttachmentAbove`) breaks a non-solid
  `targetable` block (torch id 13, bed id 15) into its drop when the cell
  under it is no longer solid — one level, cascades via the recursive edit;
  `onBlocksExploded` sweeps carved cells so the blast's top shell pops too.
- **Armor durability:** `armor()` items carry `armor.durability` from
  `COMBAT.armorDurability` (leather 80, iron 192); `Armor.slots` hold
  `{ id, durability }`. Every reduced hit (`Armor.reduce`, points computed
  BEFORE wear) ticks 1 off each equipped piece; at 0 the piece vanishes and
  `armor.onBreak` fires (main.js → the new `toolBreak` voice). Durability
  rides `Inventory.add(id, count, durability)` (now also for armor) through
  equip/unequip/drops; `Armor.deserialize` accepts the old bare-string slot
  shape (→ full durability), so the `armor` save key migrated with NO schema
  bump — `SAVE.schemaVersion` is still 4. Slot durability bars + tooltips
  cover armor via `ITEMS[id].tool?.durability ?? armor?.durability`; the HUD
  shield row has a worst-piece wear underline (`#armor-durability`).
- Headless seams: `__mc.config` exposes the LIVE config module — shrink
  `config.COMBAT.mobs.spawnRadiusMin/Max` for deterministic spawn-ring
  tests, etc. Double-tap tests must dispatch `keydown W / keyup / keydown`
  SYNCHRONOUSLY in one evaluate — headless timers stretch (a setTimeout(80)
  can take ~1.8s under SwiftShader), blowing the 0.25s window. Dive rate
  asserts: sampled `body.velocity.y` is post-drag, ≈ −2.15 held vs ≈ −1.2
  passive — assert the gap, not the raw `swimDownSpeed` knob. A cave pocket
  for spawn tests: probe columns with a node scene-stub (`new World({ add()
  {} })`) for floor-solid/air/air cells deep below `topSolidY`; seed 1337's
  old pocket around (-60, 4, 0) is a LAVA POOL now (below `lava.level`) —
  use the relocated Deep Shard pocket around (-61, 23, -2) instead.

## MC-style inventory: armor slots + player preview

- The inventory screen is laid out MC-style: `#inventory-equip` (a vertical
  4-slot armor column beside the live player figure) above the grids. The
  wear slots are a REAL container adapter (`screen.armorAdapter`,
  index-matched to `ARMOR_SLOTS`) on the shared cursor model — drag/click/
  shift-click equip and unequip ride the exact same `stackOps` code paths as
  every other slot. `canAccept(i, stack)` is the type gate
  (`ITEMS[id].armor.slot === ARMOR_SLOTS[i]`): wrong-type drops stay on the
  cursor. NOTHING is keyed by item id, so new armor tiers slot in with zero
  changes here.
- `Armor.setSlot(slot, piece)` is the one sanctioned direct wear-slot write
  (the `Inventory.setSlot` convention): it emits, so the armor HUD, open
  screens, and the save dirty flag all follow. The adapter's `set` fills in
  `ITEMS[id].armor.durability` when a stack carries none. Right-click-equip
  in game (`interaction.useItemHook` → `Armor.equipSelected`) is untouched;
  `Armor.unequip` survives as API but the screen no longer calls it.
- Shift-click: armor items in the grids quick-equip (the armor adapter is
  prepended to `#quickTargets` when the clicked stack is armor); shift-click
  on a wear slot sends the piece to the main grid, then the hotbar.
- The player figure is `src/ui/playerPreview.js`: a SECOND tiny
  `THREE.WebGLRenderer`+Scene (the main renderer owns the fullscreen canvas
  and can't composite into a DOM panel) drawing a Mob-style box-part body.
  Each wear slot has one overlay layer group sharing ONE material, tinted
  from the equipped item's `tint` at refresh — tier-generic for free. Its
  rAF loop runs ONLY while the screen is open (`start()`/`stop()` from
  open/close); construction is try/caught so a failed second GL context
  degrades to an empty pane, never a crash.
- Empty wear slots show faint type glyphs via CSS `::before` on
  `.armor-slot-<slot>.empty` — the `empty` class is toggled in
  `screen.render()`, not by `renderSlot`.
- Headless: `__mc.screen.preview` (`frames` counts real draws — wait for it
  to move, it's SLOW under SwiftShader; `armorParts.<slot>.visible`,
  `armorMaterials.<slot>.color`). Drive drags by dispatching
  `pointerdown` on the source slot el and `pointerup` on
  `screen.armorEls[i].el` (plus a document-level pointerup between
  gestures); `PointerEvent` needs explicit `{ button: 0, bubbles: true }`.

## Diamond tier (top material tier)

- Diamond ore is block 18: a new FIRST row in `WORLD.terrain.ores` (deepest
  band y 1–12, chance 0.008 — rarer than gold; bands stay ordered deep →
  shallow, first hit wins). It gates on `pickaxe minTier: 3` (iron+) like
  gold, and drops the `diamond` gem item directly (coal-style, no smelting).
  Retune with `node tools/probe-diamond.mjs` (the probe-ocean/cave pattern:
  scene-stub World, asserts in-band + rarer-than-gold, exits 1 on failure).
- Tier 4 = diamond everywhere tiers are keyed: `COMBAT.attack.swordDamage[4]`
  8, `toolDurability[4]` 512, `armorDurability.diamond` 384, `TIER_TINT[4]`
  cyan. Mining speed needed no code — `speedPerTier` is linear in tier. A
  diamond pickaxe mines every gated block (obsidian, the lava feature's
  crust block, raised the highest gate to minTier 4 — diamond only).
- Full diamond armor is 3/8/6/3 = 20 points — exactly
  `COMBAT.armor.maxReduction` (0.8) at 0.04/point, so the set IS the cap;
  don't add points above it, they'd be dead weight.
- The diamond shovel debuts the `shovel` tool kind: grass/dirt/sand/snow name
  it at `minTier: 0` (the axe-on-wood pattern — speed-only, hands still
  work), so it can never break pickaxe-gated blocks (kind mismatch) and no
  lower-tier shovels exist (deliberate: diamond-task scope). Viewmodel has a
  shovel head branch — unknown tool kinds otherwise render as axes.
- All additions are additive: no new save keys, `SAVE.schemaVersion` stayed
  4 (adding an ore band changes some deep stone cells but never heights or
  quest placement, so old saves keep loading). Headless sharp edge: the
  interval autosave (`SaveManager.update`) does NOT check `save.enabled` —
  a test that plants a hand-written save before `page.goto` must also stub
  `__mc.save.save = () => {}` or a locked-pointer autosave tick overwrites it.

## Lava & obsidian (underground hazard / light source, Nether prep)

- Lava is block 19 (`liquid: true`, not solid — water's whole flag set) but
  generated in ONE place: `World.terrainBlock` returns lava for carved cave
  cells at `y <= WORLD.terrain.lava.level` (10). Both generation paths share
  that function, so purity holds with zero mirroring (unlike water's
  two-site fill). NO flow simulation, same as water: breaking a pool wall
  opens a dry hole beside standing lava; `World.explode` leaves liquids
  alone. **Generated water and lava can provably never touch** (`seabedKeep`
  seals sea columns; a probe assert stands guard) — a future bucket/liquid-
  carrying feature owes the water+lava reaction question an answer before it
  ships. Retune with `node tools/probe-lava.mjs` (band containment,
  coverage, the no-contact invariant, Deep Shard placement, surface supply,
  obsidian crust — exits 1 on failure).
- Obsidian is block 20: generated as a crust wherever solid stone touches a
  lava cell (a 6-neighbor test in `terrainBlock`, gated to
  `y <= lava.level + 1` so it stays off the hot path). Ores WIN over the
  crust on purpose — a diamond vein in a pool wall stays a diamond vein
  (~4% of diamonds are lava-adjacent, the guarded-treasure tension).
  `minTier: 4` (diamond pickaxe only), `blastResistant`, drops itself,
  placeable — the future Nether portal frame material.
- Rendering: a third mesh pass (`Chunk.#buildLavaMesh`, `chunk.lavaMesh`, a
  child of the solid mesh like water) on `world.lavaMaterial` — an UNLIT
  `MeshBasicMaterial`, so pools glow full-bright in dark caves with zero
  lights (the Boss crown idiom). Solid faces whose exposed cell IS lava get
  a warm vertex-color tint (`LIGHTING.lava.faceTint`) instead of depth
  darkness — mesh-time, radius 1, the no-flood-fill budget rule.
- The exposed-surface registry: `#buildLavaMesh` records every open-top lava
  cell in `chunk.lavaSurfaces` (world coords, rebuilt on every remesh). It
  feeds THREE consumers: `LavaLights` (src/fx — TorchLights' sibling pool,
  `LIGHTING.lava.poolSize` 3, plus a min-separation rule so one lake can't
  eat the whole pool; it also tracks `.nearest` for ambience), the lava term
  in `world.lightAt` (pools suppress hostile spawns like torches — but
  LOADED-CHUNKS-ONLY, documented in the method; safe because the spawn ring
  is always inside the loaded radius), and the `lavaPop`/ember ambience
  timer in main.js.
- Physics: `body.inWater` means "in ANY liquid" (every consumer wants that —
  fall-distance clear, no crits, 5× mining, no footsteps, swim controls);
  `body.inLava` narrows it. `LAVA.physics` (viscous, ~half water speeds)
  swaps in via `inLava`; PlayerControls picks the table once per update.
  When gating on real water, test `inWater && !inLava` (main.js does, for
  breath and the extinguish).
- Burning (`src/survival/Burning.js`, Breath's value-less sibling; knobs in
  `LAVA`): contact tick 4 dmg / 0.5s with the FIRST tick on entry (no
  grace), then a 4s after-burn (1 dmg/s) on exit, extinguished the moment
  the player is in water. Damage goes through `health.damage()` directly —
  armor NEVER reduces it (the fall/void/starve/drown precedent). Ticks
  inside the hunger/breath `isLocked && !isDead` gate; reset on respawn
  beside hunger/breath; deliberately not saved. Breath does NOT drain in
  lava (you're on fire, not holding breath). `updateUnderwater` generalized
  to the camera cell's liquid id: `#lava-tint` (full wash in lava, an
  `.afterburn` edge glow while on fire), `LAVA.fog` (near-blind), the
  `sizzle` voice on transitions, and the one shared audio muffle.
- Mobs burn on the same cadence in the `MobManager` loop (per-mob
  `burnTimer`; `mob.lavaProof` exempts future lava-immune kinds) and die
  via the dawn-burn removal path — ember burst, NO kill credit, NO drops.
  Ground drops whose cell is lava are destroyed in `GroundItems.update`
  (ember + sizzle) — covers thrown items sinking in and mined blocks popped
  into an adjacent pool.
- Deep Shard: `RelicHunt.#findCaveSpot`'s scan floor is clamped to
  `y > lava.level + 1` — the old pocket at y 7.5 sits inside a pool now. On
  seed 1337 the shard relocated to (-61, 23.5, -2); found-flags stay valid
  (index-matched). `SAVE.schemaVersion` stayed 4 (the diamond precedent —
  deep cells changed, heights and quest anchors didn't); the one guard is
  ~5 lines in main.js after `save.load()`: feet restored inside lava →
  teleport to `surfaceY`.
- Headless: `__mc.burning` (shrink `burning.cfg.burn/afterburn` — cfg IS
  the live `LAVA` object), `__mc.lavaLights` (`activeCount`, `nearest`),
  sound counters `sizzle`/`lavaPop`. Nearest exposed pool to spawn on seed
  1337: cell (10, 10, 15) (3 deep, obsidian floor at y 7, dry standable
  ledge at (15, 12, 20)). Mob-in-lava test: `mobs.spawnAt(x + .5, z + .5,
  'zombie', poolY)`, pin the returned mob, and wait for it to leave
  `mobs.mobs` with `drops.count` unchanged.

## The Nether (dimension architecture, generation, portal)

- **Two `World` instances, one scene.** Every world parents its chunk meshes
  AND its sun/ambient lights under `world.root` (a per-world `THREE.Group`);
  `src/world/Dimensions.js` travels by toggling `root.visible` — the
  renderer skips lights in invisible subtrees, so lighting swaps with the
  terrain in one bit. The controller also: disposes the inactive world's
  chunks (`world.disposeChunks()` — edits persist, the queue regenerates on
  return), reassigns `.world` on player + player.body + interaction +
  combat + mobs + projectiles + drops + torchLights + lavaLights +
  chestScreen (the complete list — grep `Dimensions.js` before adding a
  world-holding system), clears mobs/projectiles/drops (none persist —
  travel = the death/reload semantic), sets `furnaces.dim`/`chests.dim` to
  `'N|'` (container keys are dimension-prefixed; overworld keys stay bare so
  old saves load), and hands off fog/sky. Quest systems (hunt/challenge/
  guidance/sleep) are DELIBERATELY not swapped: their meshes live in the
  overworld root, their `update()` calls in main.js gate on
  `dims.current === world`, and beds refuse the Nether.
- **Per-world seams on `World`** (read these instead of config globals):
  `fluid` ({id, level} — generation liquid fill + the wet-column spawn
  guard), `skyFactor(depth)` (depth-light curve; the Nether overrides it
  FLAT at `NETHER.lighting.minSkyLight` — under a roof everything is
  "deep"), `hasSky` (gates the dawn burn and DayNight visual writes —
  `daynight.active` keeps the clock ticking in the Nether but skips scene
  writes; the dimension controller owns the static red haze), and
  `spawnProfile` (weights/caps/light gate + a pinned `skyBrightness` —
  EMPTY weights = spawn nothing, which is how the Nether stays quiet until
  its mobs ship; MobManager bails on a zero-total table).
- **NetherWorld generation contract** (`src/world/NetherWorld.js`):
  `terrainHeight()` returns `WORLD.chunkHeight`, so EVERY cell is answered
  by `terrainBlock` — the whole sandwich (bedrock caps, netherrack
  shoulders, FBM floor+ceiling relief, ySquash-0.55 3D wall field, lava
  seas at y<=26, obsidian shells, glowstone ceiling clusters, soul sand,
  quartz) lives there as one pure function; the overworld water-fill and
  tree paths never run. `surfaceY` is a LOAD-BEARING override: the base
  scans top-down and would answer "on the roof"; the Nether scans bottom-up
  above the lava level for a standable pocket. Retune with
  `node tools/probe-nether.mjs` (includes an overworld height-checksum
  regression — the Nether must never move an overworld block).
- **Save**: optional keys `dimension` + `netherEdits`
  (`attachNether`/`attachDimensions`), container maps reuse their existing
  slots with prefixed keys — `SAVE.schemaVersion` stayed 4, old saves load
  clean into the overworld. Nether-side torches/glowstone/portals rebuild
  from the nether overlay like everything registry-backed.
- **Bedrock** (block 25) debuts the generic `unbreakable` flag —
  BlockInteraction red-flashes it beside the tier gate. Emissive CUBES
  (glowstone, block 23) skip depth darkening in the mesher (the old check
  only covered the torch shape path). PLACED glowstone joins the torch
  light registry (setBlock/#recordEdit/#rebuildRegistries all gain the
  second id) — generated clusters deliberately don't (the registry is
  edit-backed).
- **The portal** (block 26 + `src/world/Portals.js` + `src/fx/PortalPanels.js`):
  the field block is non-solid, non-targetable, and NEVER MESHED (the
  mesher skips it like a liquid); `world.portals` is the torch-registry
  pattern verbatim, so portals need no save key and rebuild on load.
  Ignition: flint & steel (`tool.kind 'igniter'` — matches no block; wears
  only on success) through `interaction.useItemHook`; detection is a fixed
  2×3 interior / 4×5 obsidian ring, both orientations, corners optional,
  candidate cell = target + normal. Frame-break collapse: a Portals onEdit
  subscriber on BOTH worlds re-validates the touched cluster (flood +
  rectangle + ring check) — the `#filling` flag suppresses re-entry during
  ignition/construction/collapse writes.
- **Travel**: stand in the field `NETHER.portal.chargeSeconds` (camera-cell
  test; menus pause, leaving decays, `#portal-tint` vignette + rising
  drone). 8:1 scaling; link to an existing portal within
  `linkRadius` (24 nether / 192 overworld) else BUILD the return portal as
  edits near the scaled target — deterministic outward pocket search with a
  ledge-above-the-fluid fallback (covers lava seas and ocean returns), full
  obsidian ring, ledge stamped under unsupported cells, step-out headroom
  carved. Construction works with ZERO chunks loaded (blockAt/setBlock +
  overlay). `justArrived` latches on arrival (and at boot, so a save
  restored inside a field never auto-travels) and clears when the camera
  leaves the field. Death in the Nether → overworld respawn
  (`dims.travel('overworld')` in the bindHud respawn handler, before
  `combat.respawn`).
- Headless: `__mc.dims` (`.current/.overworld/.nether/.travel(name, feet?)`),
  `__mc.portals` (`travelCount`, `tryIgnite`), `__mc.portalPanels`
  (`.count`), `__mc.world` is now a GETTER for `dims.current`. Shrink
  `__mc.config.NETHER.portal.chargeSeconds` before charge tests; always
  pass `feet` to a bare `dims.travel('nether', …)` (keeping overworld
  coordinates means a lethal fall); sound counters `ignite`/`portalCharge`/
  `portalTravel`/`netherAmbience`. Nether floor near origin on seed 1337:
  the arrival pocket is (0, 57, 0).

## Nether mobs & survival polish (N5 + N4)

- **Zombified piglin** (`src/combat/ZombifiedPiglin.js`): the Zombie class is
  now parameterized — `new Zombie(world, x, z, cfg, colors)` — and the chase
  branch gates on `wantsToChase()` (base: always true). The piglin overrides
  it with an `angered` flag set in an overridden `hurt` (any hit provokes,
  including the killing blow and the manager's lava tick — harmless). Anger
  SPREAD lives in MobManager (`#spreadAnger`, wired through `mob.onAngered`
  in `spawnAt` — the onHiss pattern): one flat pass angering neutral piglins
  within `cfg.angerRadius`, no cascade (a directly-set flag doesn't re-fire
  the hook). Drops `gold_ore` via the normal cfg.drop plumbing. Ambient
  groans play `mob.voice ?? 'zombie'` — the piglin's is the new `piglin`
  SoundEngine voice.
- **Magma cube** (`src/combat/MagmaCube.js`): single-box Mob that moves ONLY
  in hops — grounded, a timer launches it (`body.velocity.y =
  cfg.hopVelocity` set BEFORE `locomote`, which never writes y except the
  hitWall hop) toward the player inside aggroRange, randomly otherwise;
  `locomote(…, hop=false)` so hitWall can't stack a second jump. `lavaProof:
  true` skips the manager's lava burn tick. Drops nothing. Squash-stretch
  scales group.scale.y (feet-anchored origin, so it reads as weight).
- Both live in `HOSTILES` and `NETHER.spawn.weights` (0.7/0.3, cap 6) —
  never in `COMBAT.mobs.hostileWeights`. Config blocks:
  `COMBAT.mobs.zombifiedPiglin` / `.magmaCube`. Mob cfg objects are held by
  REFERENCE, so tests can mutate live (e.g. `config.COMBAT.mobs.
  zombifiedPiglin.wanderSpeed = 0` freezes neutral piglins for drift asserts).
- **Soul sand slowdown** (N4): a generic `slow` field on the blocks.js row
  (soul sand 0.4), read OWNER-SIDE only — `PlayerControls.update` and
  `Mob.locomote` each multiply their move speed by the feet-cell block's
  factor (one `blockAt` at `floor(y - 0.05)`); PhysicsBody never reads it,
  and airborne feet sit in air so jumps escape the drag. New sticky blocks =
  one field, zero code.
- **Quartz block** (id 27): 4 quartz → 1, decorative. (The last block id in
  use is 32 — gravel took 28, the End took 29–32; the next feature takes 33.)
- Already shipped in N1–N3 (don't re-add): netherrack `FUEL_SECONDS` row,
  the Nether bed-refusal toast (main.js `blockUseHandlers[BLOCK_BED]`
  checks `dims.current`), and quest-UI dimension gating (treasureHud
  `isActive` + the `dims.current === world` update gate, which covers the
  wisps/stele through guidance.update).
- Headless suite: `node tools/test-nether-mobs.mjs` (build + `npm install
  --no-save puppeteer-core` first) — covers all of the above plus a portal
  round-trip and overworld night-spawn regression, and writes the
  git-ignored `tools/nether-mobs-pair.png` screenshot. Ground-drop entities
  carry `itemId`, not `id` (test-assert sharp edge). `mobs.event = true` is
  the clean way to suppress ambient spawns during scripted mob tests
  (spawnAt bypasses it).

## Water-visuals polish (shimmer + rising bubbles)

- The two §7 "cut for v1" deep-water rows, resurrected: the water surface
  animates via a slow sine on `waterMaterial.opacity` — ONE uniform write
  per frame in main.js (`updateWaterShimmer`, knobs in `WATER.shimmer`),
  written to `dims.current.waterMaterial` and running on REAL time like the
  clouds (menus don't freeze the sea). NEVER animate water geometry —
  per-frame remeshing is forbidden; the headless suite pins the chunk
  position-attribute `version` to stand guard. The water atlas tile stayed
  cut: the water pass emits no UVs and its material has no map, so a texture
  means new mesher UV plumbing — revisit only with a broader pass.
- `Particles.burst(x, y, z, color, count, opts?)` grew an optional opts arg:
  `gravityScale` (per-slot Float32Array multiplier on the global gravity —
  negative = buoyant, default 1 keeps every existing caller byte-identical),
  `speed` (initial scatter), and `lifetimeSeconds` (per-burst base life).
  Still one pooled THREE.Points, one draw call. Rising bubbles are just
  bursts with `gravityScale < 0` — reuse them instead of new mesh systems.
- Bubble knobs live in `WATER.bubbles`: the ambient emitter
  (`updateWaterBubbles`, lava-pops throttle pattern) gates on
  `player.isLocked` + the camera-cell liquid being water; water ENTRY also
  fires a buoyant burst beside the existing falling spray, inside
  `updateUnderwater`'s transition branch.
- Headless suite: `node tools/test-water-visuals.mjs` (build +
  `npm install --no-save puppeteer-core` first; strict port 4742) — shimmer
  oscillation/bounds, no-remesh guard, default-burst fall regression, bubble
  rise, entry + ambient emissions underwater, breath/fog/tint regressions;
  writes the git-ignored `tools/water-visuals.png`. Sharp edge: buoyant test
  particles with long lifetimes outlive later test phases — detect NEW
  emissions with an exclusion set of already-live negative-gravity slots,
  never by "any negative slot".

## The Drowned (aquatic hostile, deep-water sequel)

- `src/combat/Drowned.js` extends Zombie through the N5 cfg/colors seam;
  config in `COMBAT.mobs.drowned`. Its update swaps AI by medium: submerged
  (`body.inWater`) it swim-chases in 3D — horizontal via `locomote`, vertical
  by setting `body.velocity.y` BEFORE the physics step (the player's
  held-Space idiom; water gravity/drag run after the owner, so the knob is
  effectively capped by `WATER.physics.sinkSpeed` downward), melee on 3D
  distance (attacks from below). Out of water `super.update()` runs the whole
  Zombie ground AI at the slower `chaseSpeed`. Drops `rotten_flesh`.
- Aquatic spawning: `#spawnNear`'s fluid-covered-column skip now branches to
  `#trySpawnAquatic`, which rolls `profile.aquaticWeights` — a SEPARATE table
  from the land weights (`COMBAT.mobs.aquaticWeights = { drowned: 1 }`,
  carried by the overworld `spawnProfile` only; NetherWorld's profile omits
  the key, so nothing ever rises in lava seas). The mob is placed at a random
  fully-submerged cell (feet + head both water) of a column at least
  `aquaticSpawn.minDepth` deep. Land hostiles still never spawn in water and
  the drowned never rolls on dry columns, by construction.
- The light gate reuses `world.lightAt`, but the SKY term is attenuated
  `aquaticSpawn.lightPerDepth` per block of water above the cell first
  (underwater cells sit above their column's topSolidY, so skyFactor is 1
  and plain lightAt would read full daylight): at night any deep column
  spawns, at noon only cells under ~9.4+ blocks of water (the deepest
  basins). Torch/glowstone falloff passes through unattenuated — placed
  lights still suppress.
- The dawn burn skips submerged mobs (`!m.body?.inWater` in the findLastIndex
  predicate) — a drowned ignites only once it's out of the water; this also
  correctly exempts any land mob that wandered into the sea.
- `mobs.spawnAt` now stamps `mob.kind` (class names minify away — tests key
  off it).
- Headless suite: `node tools/test-drowned.mjs` (build + `npm install
  --no-save puppeteer-core` first; screenshot artifact
  `tools/drowned-underwater.png`). Deep-ocean test spot on seed 1337:
  (186, 8) — every spawn-ring column 10–18 blocks out is water-covered and
  ≥ 3 deep, about half ≥ 12 deep, so all-drowned ambient asserts hold there.
  The suite verifies the served bundle hash against `dist/index.html` before
  running — parallel worktrees run vite previews too, and a foreign server
  squatting your strict port otherwise makes you test STALE code (the
  fetch-loop "wait for the port" pattern can't tell whose server answered).
## Falling blocks (sand & gravel)

- `gravity: true` on a blocks.js row (sand 4, gravel 28) makes it fall when
  an EDIT leaves the cell below non-solid — `src/fx/FallingBlocks.js`
  converts it to air + a full-size falling cube (self-contained tween, knobs
  in `FALLING`) that sweeps down via `world.blockAt` and `setBlock`s where it
  lands. Both ends are overlay edits, so generator purity holds and generated
  beaches/deserts NEVER spontaneously collapse (generation doesn't fire
  onEdit; `deserializeEdits` doesn't either, so loading can't trigger falls).
- Triggers are exactly the popAttachmentIn pair in main.js: the per-world
  `onEdit` subscribers plus the `onBlocksExploded` cell sweep. `falling.
  onEdit(w, x, y, z)` checks the cell ABOVE the edit (unsupported column —
  cascades upward through the recursive setBlock→onEdit chain) and the cell
  itself (sand placed in mid-air falls immediately, MC-style).
- `tryFall` pushes the entity BEFORE its setBlock(air): the recursion means
  a column's entities land bottom-of-column-first, so a mixed sand/gravel
  stack re-settles in its original order (the headless suite asserts this).
  `FALLING.maxSpeed` stays under 1 block per clamped 0.1s frame — faster
  lets the cube's center skip a cell and land beneath a 1-thick floor.
- Landing rules: the rest cell is one above the first SOLID cell below, so
  liquids are fallen through and the landing setBlock replaces the water/
  lava cell (the no-flow rule); a torch/bed occupying the rest cell is
  spilled as a ground drop first; landing in the player's cell is safe by
  construction — PhysicsBody's embedded self-heal (`PHYSICS.ejectSpeed`)
  lifts them on top. Entities carry their spawn world and parent the mesh
  under `world.root`, so dimension travel mid-fall just hides them while
  they finish landing as overlay edits (no Dimensions.js changes needed).
- Falling entities are transient (mob/drop precedent): a save mid-fall loses
  the block on reload (it's air in the overlay until it lands) — falls last
  well under a second, accepted. `tileTexture(name)` in atlas.js is the
  one-tile NearestFilter texture seam the cube mesh uses (cached, null in
  node). Gravel (block 28, item `gravel`) is NOT generated anywhere yet —
  obtainable via drops only; underground veins are a future follow-up. The
  next free block id is 29.
- Headless suite: `node tools/test-falling-blocks.mjs` (build + `npm install
  --no-save puppeteer-core` first); `__mc.falling` (`count`, `blocks`,
  `tryFall`). SHARP EDGE for every suite: sibling worktrees run vite
  previews concurrently — check `pgrep -fa "vite preview"` before picking a
  "unique" port; a strictPort collision makes the test silently hit ANOTHER
  build's server (ports 4731/4738/4741/4742/4747/4761 are taken). The suite
  adopts the drowned suite's served-bundle-hash guard, which turns that
  failure mode into an immediate loud abort.

## Death drops & user settings

- Minecraft-style death drops (mechanics report §6.5): `Combat.#die` calls
  the optional `combat.deathSpillHook` (attached in main.js — the
  mobs.daynight pattern, so bare runs stay keep-inventory). The hook owns the
  WHOLE decision; when it spills, `spillPlayerItems`
  (`src/combat/DeathDrops.js`) drops every inventory slot + each equipped
  armor piece + the held cursor stack as ground items at the feet, then
  empties them (one `setRange` emit; hotbar selection persists; durability
  rides each drop). Spill entities carry `despawnSeconds:
  FEEDBACK.drops.deathSpill.despawnSeconds` (300) and `noEvict: true` — the
  over-cap eviction in `GroundItems.spawn` takes the oldest ORDINARY drop
  first, so a busy site can't erase the kit. Per-entity `despawnSeconds` is
  pinned only when the opt is passed; plain drops keep reading the LIVE
  global (the read-at-call-time config seam — `tools/test-drops.mjs` shrinks
  it on already-spawned entities and must keep passing).
- Exemptions (all in the main.js hook, checked at death time): the setting
  OFF; `mobs.event` true (siege/boss deaths keep the kit — the Trial is
  retry-friendly by captain decision, `retry: 'free'`); a non-overworld
  death (respawn travels home and `dims.travel` clears all drops, so a
  Nether spill would silently vanish); feet below y 0 (the void consumes
  items). The death-screen hint (`#death-hint`, `bindHud`'s third arg)
  reports which way it went; to make that possible `Health.damage` now fires
  `onDeath` BEFORE the fatal `onChange` emit, so death-screen renderers see
  post-spill state.
- The game's first persisted user setting: `Settings` (`src/settings.js`) —
  its OWN localStorage key (`SETTINGS.storageKey` in config, the mute-button
  precedent: preferences survive saves and world resets), flat values over
  `SETTINGS.defaults` (`deathDrops: true`). UI is `#death-drops-btn` on the
  start overlay (`src/ui/settingsButton.js`). A new setting = one default in
  config + one control.
- Headless: `__mc.settings` is exposed; drive a death with
  `__mc.health.damage(999)` (works while pointer-locked — it bypasses the
  Combat.update pause); spilled entities are recognizable by `e.noEvict`.
  Suite: `node tools/test-death-drops.mjs` (build + `npm install --no-save
  puppeteer-core` first).

## The End (third dimension, Ender Dragon, elytra)

- **Dimensions is an N-world registry now**: `new Dimensions({ worlds:
  { overworld, nether, end }, … })`, `dims.name` reverse-looks-up `current`,
  `travel(name)` resolves `dims.worlds[name]` and NO-OPS on unknown names
  (main.js applies any saved dimension directly). Named accessors
  `dims.overworld/nether/end` survive for Portals/tests. The per-world look
  moved ONTO the World instances: `world.atmosphere` ({ skyColor, fog } |
  null = DayNight owns it) and `world.containerPrefix` ('' | 'N|' | 'E|') —
  the controller reads both; adding a world is one registry entry.
  `dims.onTravel` is assigned in main.js to cancel the dragon fight on any
  dimension leave — don't reassign it, wrap it.
- **EndWorld** (`src/world/EndWorld.js`, knobs in `END`): the NetherWorld
  contract — full-height `terrainHeight`, the whole island in `terrainBlock`
  as a pure function. A floating end-stone lens (~88 across, surface y
  60–64, teardrop underside to y 32, void below — `PHYSICS.voidY` handles
  falls) + six flat-topped obsidian pillars on a seed-rotated ring, exposed
  as `end.pillars` ([{x, z, top}] — the crystal pedestals, no world queries
  needed). Inert fluid (`level: -1`), `hasSky` false, EMPTY spawn profile
  (nothing ambient-spawns; the fight runner owns the population), inherited
  `skyFactor`/`surfaceY` (no roof — but `surfaceY` answers 0 on void
  columns, so only query island columns). Retune with
  `node tools/probe-end.mjs` (asserts island metrics + overworld height AND
  nether block checksums — a third dimension must never move the first two).
- **End portal** (`src/world/EndPortal.js`): a flat 3×3-interior ring of 12
  craftable frame blocks (block 30; 2 obsidian + 2 quartz block + 1 diamond
  each) that SELF-ACTIVATES on completion — no eye item (the "no flint"
  divergence). Field block 31 = the block-26 never-meshed archetype,
  horizontal, riding the `world.endPortals` registry (a SECOND map — the
  nether-portal systems assume vertical 2×3 clusters and stay untouched)
  through setBlock/#recordEdit/#rebuildRegistries; no save key. Detection +
  collapse are onEdit subscribers on overworld + End only (never the
  Nether); the charge tests the FEET cell (`player.body.position`, floored)
  — the field sits at floor level, the camera-cell test would never see it.
  Travel keys on the standing dimension: overworld → End (first arrival
  stamps the 5×5 obsidian platform at `END.arrival`, idempotent, anchored to
  the DESIGN surfaceY so digging can't drift it); End → home (bed spawn via
  `player.spawnHook`, else world spawn). One-way until victory by
  construction: the only End-side field is the victory-stamped exit portal.
  The NETHER portal is guarded OUT of the End (tryIgnite/update bail outside
  the overworld⇄nether pair — its #travel is a binary flip).
- **Shared flight seams (built here, the ghast reuses them)**:
  `PhysicsBody.gravityScale` (default 1, multiplied into the AIR gravity
  integration only — liquids keep their own tables; 0 = float with collision
  intact) and `Projectiles.spawn` opts `gravity` (default null = the live
  `COMBAT.projectiles.gravity` read; 0 = straight fireballs). Both additive;
  every existing body/arrow byte-identical at the defaults.
- **The dragon** (`src/combat/EnderDragon.js`, knobs in `END.dragon`):
  KINEMATIC — update() drives `group.position` along orbit/swoop/perch paths
  and never steps the body (hit tests still work: melee via part userData,
  arrows via body.half/height). Phases are fight BEATS, not health bands:
  1 crystals (runner heals it, never perches), 2 perch cycles (crystals
  dead; perched damage ×1.5 — the melee window), 3 enrage under 0.33 health.
  The swoop is a quadratic bezier SOLVED to pass through the player's marked
  position at t=0.5 (P1 = 2M − (P0+P2)/2); `startAttack(key, playerPos)` is
  the public headless seam (forces any attack, telegraph still runs).
  `mob.persistent` (new, MobManager) skips the distance-despawn — the arena
  outspans despawnRadius; the void check still applies. Crystals
  (`src/combat/EndCrystal.js`) are Mob-shaped fight entities in HOSTILES as
  'end_crystal' — health 1, kinematic spin/bob, never persisted (every
  attempt faces all six).
- **DragonFight** (`src/quest/DragonFight.js`, BossFight's sibling owned by
  main.js): arms whenever the player stands in the End with
  `endProgress.dragonDefeated` false → rumble → rise + 6 crystals + healing
  beams (meshes under the END root so they vanish on travel). Runner-side
  healing (`healPerCrystalPerSecond × alive`) drives the HP-bar refill;
  crystal pops route through `combat.hurtPlayer` (armor counts); NO leash —
  the void is the wall. Victory: latch `EndProgress.dragonDefeated`
  (optional `end` save slot via `save.attachEndProgress`), stamp the exit
  ring (12 frames — EndPortal's detector self-activates it, fill + bloom
  free) + dragon egg (block 32) as edits, grant the ONE elytra runner-side
  (`inventory.add` + throw overflow — never a death drop, the void would
  eat it), fire onComplete → `bindEndReveal` (END_MESSAGE + celebrated
  guard). `bindBossHud` now takes a LIST of { fight, name } — only one can
  be live (different dimensions). End toasts ride the Herald banner queue.
- **Elytra**: item in E4 (armor chest slot, 0 points, durability 432,
  maxStack 1, never crafted); glide model in `PlayerControls.#updateGlide`
  (knobs in `PLAYER.glide`): deploys on a FRESH Space press (the
  `jumpTapped` #onKey edge — held-Space auto-hop can't auto-deploy; touch
  taps ride jumpBuffer) while airborne + descending + wings worn. While
  gliding it owns the body's whole velocity (pitch-to-speed momentum, look
  steering, A/D bank, constant sink + gravityScale 0.12) and clears
  fallDistance; exits on grounded/inWater/hitWall/wings-gone. Wear is glide
  TIME via the new `Armor.wearSlot('chest')` (1 per glide.wearSeconds).
  `player.armor` is attached by main.js — bare runs never glide.
- **Save**: all optional keys — `endEdits` (attachEnd), `end`
  ({ dragonDefeated, celebrated }, attachEndProgress), `dimension: 'end'`;
  containers reuse their maps under 'E|'. `SAVE.schemaVersion` stayed 4;
  pre-End saves load clean (verified in the suite).
- **Headless** (`node tools/test-end.mjs`, strict port 4746; build + `npm
  install --no-save puppeteer-core` first): covers all five phases + the
  pre-End-save and reload-into-End compatibility passes; writes git-ignored
  `tools/end-*.png`. Seams: `__mc.endPortal` (travelCount),
  `__mc.endPortalPanels`, `__mc.dragonFight` (`.dragon/.crystals/.beams`),
  `__mc.endProgress`, `__mc.endReveal`; sound counters
  `endPortalOpen/dragonRoar/crystalBreak/wind/endAmbience`. Sharp edges: a
  test that wants the island QUIET sets `endProgress.dragonDefeated = true`
  before traveling (the fight self-arms); the E2 test ring persists in
  endPortals, so later asserts count SPECIFIC cells, not map size; a
  gravityScale-1 restore after floating at y 90 is a LETHAL fall — teleport
  down before resuming; shrink `END.dragon.summonSeconds/rise.seconds` and
  hold `attacks.perch.seconds` open for kill windows.

## Procedural mob skins (textured mobs)

- `src/combat/mobSkins.js` is the atlas.js of mobs: per mob TYPE it draws a
  64×64 canvas "skin sheet" of 16×16 tiles (seeded painters reusing the
  exported atlas `rgb`/`speckle`/`blobs` vocabulary), builds ONE shared
  `MeshLambertMaterial` (+ one red-emissive `flashMaterial` for the hurt
  flash) and a set of UV-remapped `BoxGeometry` parts whose faces sample
  tiles — the head's `pz` (front) face gets the face tile. Everything is
  cached forever per type (`mobSkin(type)`), so material/texture/geometry
  counts are CONSTANT in mob count; `typeof document`-guarded, returning
  null in node so probes and bare runs fall back to the original flat-color
  materials. Part sizes in the skin defs MUST mirror the subclass `GEOM`
  dims — cosmetics only, hitboxes are the separate AABBs.
- Skinned mobs share one material, so the hurt flash is a material SWAP:
  `Mob.makeSkin(type, colors)` + `Mob.skinnedPart(name, x, y, z)` register
  meshes in `mob.skinMeshes`, and `setFlash` exchanges shared normal/flash
  materials (never an emissive write — that would flash the whole kind).
  `Mob.dispose` still only disposes `this.materials` (per-mob clones);
  shared skin resources are never disposed. Boss/dragon/crystal keep the
  old per-mob `makeMaterials` path untouched.
- The CREEPER is the one exception: its fuse pulse animates emissive
  continuously per mob, so it clones the shared material once per creeper
  (`skin.material.clone()` — the texture stays shared) into
  `this.materials.skin` and keeps the old emissive path; its meshes are
  deliberately NOT `skinnedPart`s. The MAGMA CUBE goes the other way: the
  textured body is ONE mesh (ember eyes baked into the face tile — the
  fallback keeps the two eye meshes), and its base material carries a warm
  `emissive` from the skin def (flash still overrides red).
- Variants ride the N5 seam grown by one arg: `new Zombie(world, x, z, cfg,
  colors, skinType)` — drowned passes `'drowned'`, the piglin
  `'zombified_piglin'`; PassiveMob passes its `kind` (pig/cow/sheep each
  have a sheet). New mob = one `SKINS` entry (parts + tile painters);
  unknown types just fall back to flat colors.
- Headless suite: `node tools/test-mob-textures.mjs` (build + `npm install
  --no-save puppeteer-core` first; strict port 4757) — asserts mapped
  materials per type, per-type sharing/bounded counts, flash isolation,
  the node fallback, combat/spawn spot-checks; writes git-ignored
  `tools/mob-textures-{overworld,nether}.png`. For posed screenshots:
  zero the live cfg speeds, set `wanderTimer = 999` / `wanderDir = null`
  (+ `shootTimer`/`hopTimer` where they exist) — unlocking the pointer
  instead would raise the overlay over the frame.

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
