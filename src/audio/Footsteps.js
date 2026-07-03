import { AUDIO } from '../config.js'
import { BLOCKS } from '../world/blocks.js'

// Footstep sounds (Phase 9). Watches the camera's horizontal movement each
// frame — PlayerControls stays untouched — and plays one step per
// AUDIO.footstep.strideBlocks of ground covered, voiced by the material of
// the block under the player's feet. Returns the per-frame update function.
export function createFootsteps(sounds, player, camera, world) {
  let lastX = camera.position.x
  let lastZ = camera.position.z
  let travelled = 0

  return () => {
    const dx = camera.position.x - lastX
    const dz = camera.position.z - lastZ
    lastX = camera.position.x
    lastZ = camera.position.z
    if (!player.isLocked) return
    if (player.body?.grounded === false) return // airborne (Phase 8): no steps
    const dist = Math.hypot(dx, dz)
    if (dist > 1) return // teleport (respawn/load), not a step
    travelled += dist
    if (travelled < AUDIO.footstep.strideBlocks) return
    travelled = 0
    const wx = Math.floor(camera.position.x)
    const wz = Math.floor(camera.position.z)
    const ground = world.blockAt(wx, world.surfaceY(camera.position.x, camera.position.z) - 1, wz)
    sounds.play('footstep', { material: BLOCKS[ground]?.material })
  }
}
