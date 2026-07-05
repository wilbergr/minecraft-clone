import { BREATH } from '../config.js'

// Breath HUD (deep water): a row of bubbles above the hunger drumsticks —
// the hungerHud pattern, with one extra behavior: the whole row hides while
// the bar is full (a meter that's irrelevant 95% of play shouldn't be a
// tenth permanent HUD row; MC sets the precedent). 💧 rather than 🫧 —
// bubbles are Unicode 14 and missing on older devices.
export function bindBreathHud(breath) {
  const bar = document.getElementById('breath-bar')

  const pips = []
  for (let i = 0; i < BREATH.max / 2; i++) {
    const el = document.createElement('span')
    el.className = 'bubble'
    el.textContent = '💧'
    bar.appendChild(el)
    pips.push(el)
  }

  const render = () => {
    bar.classList.toggle('hidden', breath.isFull)
    pips.forEach((el, i) => {
      // Bubble i covers breath 2i+1..2i+2: full, half, or empty.
      const filled = breath.value - i * 2
      el.className =
        filled >= 2 ? 'bubble' : filled >= 1 ? 'bubble half' : 'bubble empty'
    })
  }
  breath.onChange(render)
  render()
}
