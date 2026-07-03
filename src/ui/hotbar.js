import { INVENTORY } from '../config.js'
import { createSlotEl, renderSlot } from './slots.js'

// The always-visible hotbar: the first INVENTORY.hotbarSlots inventory slots,
// with the selected slot highlighted. Number keys 1-9 and the mouse wheel
// change the selection (only while playing, so typing with the inventory
// screen open never switches slots).
export function bindHotbar(inventory, player) {
  const bar = document.getElementById('hotbar')
  const slotEls = []
  for (let i = 0; i < INVENTORY.hotbarSlots; i++) {
    const el = createSlotEl()
    bar.appendChild(el)
    slotEls.push(el)
  }

  const render = () => {
    slotEls.forEach((el, i) => {
      renderSlot(el, inventory.slots[i])
      el.classList.toggle('selected', i === inventory.selectedSlot)
    })
  }
  inventory.onChange(render)
  render()

  document.addEventListener('keydown', (e) => {
    if (!player.isLocked) return
    const digit = /^Digit([1-9])$/.exec(e.code)
    if (digit) inventory.select(Number(digit[1]) - 1)
  })
  document.addEventListener('wheel', (e) => {
    if (!player.isLocked || e.deltaY === 0) return
    const n = INVENTORY.hotbarSlots
    const step = e.deltaY > 0 ? 1 : -1
    inventory.select((inventory.selectedSlot + step + n) % n)
  })
}
