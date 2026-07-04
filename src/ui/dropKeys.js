// Q-drop (inventory overhaul): while playing, Q throws one item from the
// selected hotbar stack in the look direction; Shift+Q throws the whole
// stack. Never Ctrl+Q — that's the browser-quit hazard that moved sneak
// off Ctrl onto KeyC. Key auto-repeat makes held Q a stream, like Minecraft.
//
// `uiOpen` is the open-UI union main.js already keeps for the overlay:
// pointer-lock release is asynchronous, so isLocked alone would let a Q
// pressed in the same beat a screen opens leak a drop.
export function bindDropKeys(inventory, drops, camera, player, health, sounds = null, uiOpen = null) {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyQ' || !player.isLocked || health.isDead || uiOpen?.()) return
    const stack = inventory.take(inventory.selectedSlot, e.shiftKey ? Infinity : 1)
    if (!stack) return
    drops.throwFrom(camera, stack.id, stack.count, stack.durability)
    sounds?.play('place')
  })
}

// Backdrop-drop: clicking a screen's dim backdrop (outside the panel) while
// the cursor holds a stack throws it — left click the whole stack, right
// click one. This is also how "drag outside the window" resolves: a drag
// released on the backdrop lands here.
export function bindBackdropDrop(root, cursor, drops, camera) {
  root.addEventListener('pointerdown', (e) => {
    if (e.target !== root || !cursor?.stack) return
    if (e.button !== 0 && e.button !== 2) return
    e.preventDefault()
    const held = cursor.stack
    if (e.button === 0) {
      cursor.clear()
      drops.throwFrom(camera, held.id, held.count, held.durability)
    } else {
      held.count -= 1
      cursor.set(held.count > 0 ? held : null)
      drops.throwFrom(camera, held.id, 1, held.durability)
    }
  })
}
