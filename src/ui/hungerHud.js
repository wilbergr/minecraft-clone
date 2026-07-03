import { HUNGER } from '../config.js'

// Hunger HUD (Phase 12): a row of drumsticks mirroring the hearts row
// (ui/hud.js pattern) — hearts sit left of center, hunger right. Renders
// purely from Hunger via onChange; each drumstick covers 2 points, shown
// full / half / empty by opacity like hearts.
export function bindHungerHud(hunger) {
  const bar = document.getElementById('hunger-bar')

  const pips = []
  for (let i = 0; i < HUNGER.max / 2; i++) {
    const el = document.createElement('span')
    el.className = 'drumstick'
    el.textContent = '🍗'
    bar.appendChild(el)
    pips.push(el)
  }

  const render = () => {
    pips.forEach((el, i) => {
      // Drumstick i covers hunger 2i+1..2i+2: full, half, or empty.
      const filled = hunger.value - i * 2
      el.className =
        filled >= 2 ? 'drumstick' : filled >= 1 ? 'drumstick half' : 'drumstick empty'
    })
  }
  hunger.onChange(render)
  render()
}
