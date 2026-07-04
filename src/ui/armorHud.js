import { COMBAT } from '../config.js'

// Armor HUD (Phase 13): a row of shields directly above the hearts
// (ui/hud.js pattern). Each shield covers 2 armor points, shown full / half /
// empty by opacity like hearts; the whole row hides when nothing is worn
// (MC hides the empty armor bar too). Renders purely from Armor via onChange.
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

  const render = () => {
    const points = armor.points
    bar.classList.toggle('hidden', points <= 0)
    pips.forEach((el, i) => {
      // Shield i covers armor points 2i+1..2i+2: full, half, or empty.
      const filled = points - i * 2
      el.className =
        filled >= 2 ? 'shield' : filled >= 1 ? 'shield half' : 'shield empty'
    })
  }
  armor.onChange(render)
  render()
}
