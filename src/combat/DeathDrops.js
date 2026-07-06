import { FEEDBACK } from '../config.js'
import { ARMOR_SLOTS } from './Armor.js'

// Minecraft-style death drops (mechanics report §6.5): spill the whole kit —
// every inventory slot, each equipped armor piece, and the held cursor
// stack — as ground items at the body, then empty them. Each spilled entity
// carries the longer deathSpill despawn window and is exempt from the
// oldest-over-cap eviction, so a full kit survives the walk back. Hotbar
// selection persists; respawn is otherwise untouched.
//
// WHETHER to spill is the caller's decision, not this function's: the user
// setting, the trial-arena exemption, and the Nether/void guards all live in
// main.js's deathSpillHook wiring. Returns how many drop entities spawned.
export function spillPlayerItems({ position, inventory, armor, cursor, drops }) {
  const { despawnSeconds } = FEEDBACK.drops.deathSpill
  let spilled = 0
  const spill = (stack) => {
    if (!stack) return
    const entity = drops.spawn(position.x, position.y + 0.9, position.z, stack.id, stack.count, {
      durability: stack.durability,
      despawnSeconds,
      noEvict: true,
    })
    if (entity) spilled++
  }

  for (const stack of inventory.slots) spill(stack)
  inventory.setRange(0, new Array(inventory.size).fill(null)) // one emit

  for (const slot of ARMOR_SLOTS) {
    const piece = armor.slots[slot]
    if (!piece) continue
    spill({ id: piece.id, count: 1, durability: piece.durability })
    armor.setSlot(slot, null)
  }

  if (cursor?.stack) {
    spill(cursor.stack)
    cursor.clear()
  }
  return spilled
}
