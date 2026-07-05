import { COMBAT } from '../config.js'
import { ITEMS } from '../inventory/items.js'
import { ARMOR_SLOTS } from '../combat/Armor.js'

// Armor HUD (Phase 13): a row of shields directly above the hearts
// (ui/hud.js pattern). Each shield covers 2 armor points, shown full / half /
// empty by opacity like hearts; the whole row hides when nothing is worn
// (MC hides the empty armor bar too). A thin underline (fidelity pack)
// mirrors the hotbar's tool-durability tint — it tracks the most-worn
// equipped piece, green → red, so imminent shatters read at a glance.
// Renders purely from Armor via onChange.
export function bindArmorHud(armor) {
  const bar = document.getElementById('armor-bar')
  const maxPips = Math.ceil(
    COMBAT.armor.maxReduction / COMBAT.armor.reductionPerPoint / 2,
  )

  const pips = []
  for (let i = 0; i < maxPips; i++) {
    const el = document.createElement('span')
    el.className = 'shield'
    el.textContent = '🛡'
    bar.appendChild(el)
    pips.push(el)
  }
  const wearBar = document.createElement('div')
  wearBar.id = 'armor-durability'
  bar.appendChild(wearBar)

  const render = () => {
    const points = armor.points
    bar.classList.toggle('hidden', points <= 0)
    pips.forEach((el, i) => {
      // Shield i covers armor points 2i+1..2i+2: full, half, or empty.
      const filled = points - i * 2
      el.className =
        filled >= 2 ? 'shield' : filled >= 1 ? 'shield half' : 'shield empty'
    })
    // Most-worn piece's remaining durability, as a fraction of its max.
    let frac = 1
    for (const slot of ARMOR_SLOTS) {
      const piece = armor.slots[slot]
      const max = piece ? ITEMS[piece.id]?.armor?.durability : undefined
      if (max) frac = Math.min(frac, Math.max(0, piece.durability / max))
    }
    wearBar.style.display = frac < 1 ? 'block' : 'none'
    wearBar.style.width = `${Math.round(frac * 100)}%`
    wearBar.style.background = `hsl(${Math.round(frac * 110)}, 75%, 48%)`
  }
  armor.onChange(render)
  render()
}
