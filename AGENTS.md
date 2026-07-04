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
  multiplied by `skyFactor(depth)` (Chunk.js) — depth being how far the
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
