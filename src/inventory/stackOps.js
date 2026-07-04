import { ITEMS } from './items.js'

// Cursor-stack interaction ops (inventory overhaul). Pure logic over a
// minimal *container adapter* — the generalization of the furnace screen's
// old #getStack/#setStack pair, shared by the inventory, furnace, and chest
// screens so click semantics can never diverge again:
//
//   adapter = {
//     size,                  // slot count
//     get(i),                // stack ({ id, count, durability? }) or null
//     set(i, stack),         // MUST notify its owner (setSlot / markChanged)
//     canAccept(i, stack),   // deposit allowed? (furnace output → false)
//   }
//
// `cursor` is a SlotCursor (ui/slotCursor.js): { stack, set(stack), clear() }.
// Every op respects per-item maxStack (tools are 1, so tools never merge and
// durability rides the stack object wherever it moves).

function maxStackOf(stack) {
  return ITEMS[stack.id].maxStack
}

// Left click: cursor empty → pick the whole stack up; cursor holding →
// place all / merge (remainder stays held) / swap. Returns 'picked' when a
// stack was lifted off the slot, so callers can start a drag from it.
export function leftClick(cursor, adapter, i) {
  const slot = adapter.get(i)
  const held = cursor.stack
  if (!held) {
    if (!slot) return null
    adapter.set(i, null)
    cursor.set(slot)
    return 'picked'
  }
  if (!adapter.canAccept(i, held)) return null
  if (!slot) {
    adapter.set(i, held)
    cursor.clear()
  } else if (slot.id === held.id) {
    const moved = Math.min(held.count, maxStackOf(slot) - slot.count)
    if (moved <= 0) return null // both full — same-id stacks never swap
    slot.count += moved
    held.count -= moved
    adapter.set(i, slot)
    if (held.count === 0) cursor.clear()
    else cursor.set(held)
  } else {
    adapter.set(i, held)
    cursor.set(slot)
  }
  return null
}

// Right click: cursor empty → pick up half (ceil); cursor holding → place
// exactly one into an empty or same-id slot with room.
export function rightClick(cursor, adapter, i) {
  const slot = adapter.get(i)
  const held = cursor.stack
  if (!held) {
    if (!slot) return null
    const take = Math.ceil(slot.count / 2)
    const rest = slot.count - take
    adapter.set(i, rest > 0 ? { ...slot, count: rest } : null)
    cursor.set({ ...slot, count: take })
    return 'picked'
  }
  if (!adapter.canAccept(i, held)) return null
  if (!slot) {
    adapter.set(i, { ...held, count: 1 })
  } else if (slot.id === held.id && slot.count < maxStackOf(slot)) {
    slot.count += 1
    adapter.set(i, slot)
  } else {
    return null
  }
  held.count -= 1
  if (held.count === 0) cursor.clear()
  else cursor.set(held)
  return null
}

// Shift-click quick-transfer: move the slot's stack into an ordered list of
// target ranges — `targets` is [{ adapter, start, end }] (end exclusive) —
// filling existing same-id stacks first, then empties (the Inventory.add
// algorithm generalized to any adapter).
export function quickMove(adapter, i, targets) {
  const stack = adapter.get(i)
  if (!stack) return
  const max = maxStackOf(stack)
  const before = stack.count
  for (const pass of ['merge', 'empty']) {
    for (const t of targets) {
      for (let j = t.start; j < t.end && stack.count > 0; j++) {
        if (t.adapter === adapter && j === i) continue
        if (!t.adapter.canAccept(j, stack)) continue
        const dest = t.adapter.get(j)
        if (pass === 'merge') {
          if (!dest || dest.id !== stack.id || dest.count >= max) continue
          const moved = Math.min(stack.count, max - dest.count)
          dest.count += moved
          t.adapter.set(j, dest)
          stack.count -= moved
        } else if (!dest) {
          t.adapter.set(j, { ...stack })
          stack.count = 0
        }
      }
    }
  }
  if (stack.count !== before) adapter.set(i, stack.count > 0 ? stack : null)
}

// Double-click gather: drain every same-id stack across the open screen's
// adapters into the held cursor stack (up to maxStack), smallest first so
// part-stacks consolidate before full ones break.
export function gather(cursor, adapters) {
  const held = cursor.stack
  if (!held) return
  const max = maxStackOf(held)
  if (held.count >= max) return
  const sources = []
  for (const adapter of adapters) {
    for (let i = 0; i < adapter.size; i++) {
      const s = adapter.get(i)
      if (s && s.id === held.id) sources.push({ adapter, i, s })
    }
  }
  sources.sort((a, b) => a.s.count - b.s.count)
  for (const { adapter, i, s } of sources) {
    if (held.count >= max) break
    const moved = Math.min(s.count, max - held.count)
    held.count += moved
    s.count -= moved
    adapter.set(i, s.count > 0 ? s : null)
  }
  cursor.set(held)
}
