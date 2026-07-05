import { GRAPHICS, NETHER } from '../config.js'

// Dimension controller (the Nether): owns { overworld, nether, current } and
// the travel swap. Both worlds share one scene — travel toggles each world's
// root group (terrain AND its lights: the renderer skips lights in invisible
// subtrees), disposes the inactive world's chunks (edits persist in its
// overlay; the budgeted queue regenerates on return), reassigns the `world`
// reference on every live system that holds one, clears the ambient
// populations (mobs / projectiles / ground drops — none persist in the save,
// the death/reload semantic), retargets the container key prefix, hands off
// fog/sky ownership, and finally teleports the player if a landing spot was
// given.
//
// Overworld-bound quest systems (hunt / challenge / guidance / sleep) are
// deliberately NOT swapped: they keep their overworld ref permanently, their
// meshes live in the overworld root, and main.js gates their update() calls
// on `dims.current === dims.overworld`.
export class Dimensions {
  constructor({ overworld, nether, scene, player, interaction, combat, drops, torchLights, lavaLights, furnaces, chests, chestScreen, daynight }) {
    this.overworld = overworld
    this.nether = nether
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
    this.current = overworld
    this.onTravel = null // callback(name) — travel feedback (sound/particles)
    nether.root.visible = false
  }

  get name() {
    return this.current === this.nether ? 'nether' : 'overworld'
  }

  // Fog baseline for the current dimension — updateUnderwater's surfaced
  // branch restores from here instead of GRAPHICS constants. `color: null`
  // means "DayNight owns the color" (the overworld); the Nether's static
  // red is re-asserted every surfaced frame since nothing else writes it.
  baseFog() {
    if (this.current === this.nether) {
      return { near: NETHER.fog.near, far: NETHER.fog.far, color: NETHER.fog.color }
    }
    return { near: GRAPHICS.fogNear, far: GRAPHICS.fogFar, color: null }
  }

  // Switch dimensions. `feet` (optional {x, y, z}) is where the player lands;
  // omitted, the player keeps their current coordinates (the load-restore
  // path — the saved position already belongs to the saved dimension).
  travel(name, feet = null) {
    const target = name === 'nether' ? this.nether : this.overworld
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

      // Container state is keyed by position; the dimension prefix keeps a
      // Nether furnace at (x,y,z) distinct from an overworld one there.
      const prefix = target === this.nether ? 'N|' : ''
      this.furnaces.dim = prefix
      this.chests.dim = prefix

      this.#applyAtmosphere()
    }
    if (feet) this.player.teleport(feet.x, feet.y, feet.z)
    this.onTravel?.(this.name)
  }

  // Fog/sky ownership handoff: DayNight paints the overworld every frame
  // while `active`; in the Nether it keeps the clock ticking but stops
  // writing, and the controller sets the static red haze once.
  #applyAtmosphere() {
    const nether = this.current === this.nether
    this.daynight.active = !nether
    if (nether) {
      this.scene.background.setHex(NETHER.skyColor)
      this.scene.fog.color.setHex(NETHER.fog.color)
      this.scene.fog.near = NETHER.fog.near
      this.scene.fog.far = NETHER.fog.far
    } else {
      this.scene.fog.near = GRAPHICS.fogNear
      this.scene.fog.far = GRAPHICS.fogFar
      this.daynight.update(0) // repaint sky/fog color for the current hour
    }
  }
}
