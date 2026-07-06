import { GRAPHICS } from '../config.js'

// Dimension controller: owns the world registry { overworld, nether, end }
// and the travel swap. All worlds share one scene — travel toggles each
// world's root group (terrain AND its lights: the renderer skips lights in
// invisible subtrees), disposes the inactive world's chunks (edits persist in
// its overlay; the budgeted queue regenerates on return), reassigns the
// `world` reference on every live system that holds one, clears the ambient
// populations (mobs / projectiles / ground drops — none persist in the save,
// the death/reload semantic), retargets the container key prefix, hands off
// fog/sky ownership, and finally teleports the player if a landing spot was
// given.
//
// Per-world knobs live ON the World instances (the config-driven pattern):
// `atmosphere` (null = DayNight owns the sky/fog — the overworld; otherwise
// a static { skyColor, fog } the controller paints) and `containerPrefix`
// ('' | 'N|' | 'E|'). Adding a world means one registry entry — nothing in
// here is world-count-specific.
//
// Overworld-bound quest systems (hunt / challenge / guidance / sleep) are
// deliberately NOT swapped: they keep their overworld ref permanently, their
// meshes live in the overworld root, and main.js gates their update() calls
// on `dims.current === dims.overworld`.
export class Dimensions {
  constructor({ worlds, scene, player, interaction, combat, drops, torchLights, lavaLights, furnaces, chests, chestScreen, daynight }) {
    this.worlds = worlds // { overworld, nether, end, ... } — name -> World
    this.scene = scene
    this.player = player
    this.interaction = interaction
    this.combat = combat
    this.drops = drops
    this.torchLights = torchLights
    this.lavaLights = lavaLights
    this.furnaces = furnaces
    this.chests = chests
    this.chestScreen = chestScreen
    this.daynight = daynight
    this.current = worlds.overworld
    this.onTravel = null // callback(name) — travel feedback (sound/particles)
    for (const world of Object.values(worlds)) {
      world.root.visible = world === this.current
    }
  }

  // Named accessors (Portals, tests, and the quest gating read these).
  get overworld() {
    return this.worlds.overworld
  }

  get nether() {
    return this.worlds.nether
  }

  get end() {
    return this.worlds.end
  }

  get name() {
    for (const [name, world] of Object.entries(this.worlds)) {
      if (world === this.current) return name
    }
    return 'overworld'
  }

  // Fog baseline for the current dimension — updateUnderwater's surfaced
  // branch restores from here instead of GRAPHICS constants. `color: null`
  // means "DayNight owns the color" (the overworld); a static atmosphere's
  // color is re-asserted every surfaced frame since nothing else writes it.
  baseFog() {
    const a = this.current.atmosphere
    if (a) return { near: a.fog.near, far: a.fog.far, color: a.fog.color }
    return { near: GRAPHICS.fogNear, far: GRAPHICS.fogFar, color: null }
  }

  // Switch dimensions. `feet` (optional {x, y, z}) is where the player lands;
  // omitted, the player keeps their current coordinates (the load-restore
  // path — the saved position already belongs to the saved dimension).
  // Unknown names are a quiet no-op (a save written by a future build).
  travel(name, feet = null) {
    const target = this.worlds[name]
    if (!target) return
    if (target !== this.current) {
      const prev = this.current
      this.current = target
      prev.root.visible = false
      target.root.visible = true
      prev.disposeChunks()

      // The verified world-reference swap list — every live system that
      // holds a world. Quest systems are deliberately absent (see above).
      this.player.world = target
      this.player.body.world = target
      this.interaction.world = target
      this.combat.world = target
      this.combat.mobs.world = target
      this.combat.projectiles.world = target
      this.drops.world = target
      this.torchLights.world = target
      this.lavaLights.world = target
      this.chestScreen.world = target // the adjacent-chest ("double chest") probe

      // Ambient populations never travel (and never persist): clear them so
      // nothing renders in — or attacks from — the wrong dimension.
      this.combat.mobs.clear()
      this.combat.projectiles.clear()
      this.drops.clear()

      // Container state is keyed by position; the per-world prefix keeps a
      // Nether/End furnace at (x,y,z) distinct from an overworld one there.
      this.furnaces.dim = target.containerPrefix
      this.chests.dim = target.containerPrefix

      this.#applyAtmosphere()
    }
    if (feet) this.player.teleport(feet.x, feet.y, feet.z)
    this.onTravel?.(this.name)
  }

  // Fog/sky ownership handoff: DayNight paints the overworld every frame
  // while `active`; in a skyless world it keeps the clock ticking but stops
  // writing, and the controller paints the world's static atmosphere once.
  #applyAtmosphere() {
    const a = this.current.atmosphere
    this.daynight.active = this.current.hasSky
    if (a) {
      this.scene.background.setHex(a.skyColor)
      this.scene.fog.color.setHex(a.fog.color)
      this.scene.fog.near = a.fog.near
      this.scene.fog.far = a.fog.far
    } else {
      this.scene.fog.near = GRAPHICS.fogNear
      this.scene.fog.far = GRAPHICS.fogFar
      this.daynight.update(0) // repaint sky/fog color for the current hour
    }
  }
}
