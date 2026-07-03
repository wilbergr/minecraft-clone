import { COMBAT } from '../config.js'

// Combat HUD (DOM, like the hotbar): a row of hearts above the hotbar, a red
// vignette flash when the player takes a hit, and the death screen. All of it
// renders purely from Health via onChange — the death screen shows exactly
// while health is zero, so respawning (health.reset) hides it for free.
export function bindHud(health, onRespawn) {
  const bar = document.getElementById('health-bar')
  const flash = document.getElementById('damage-flash')
  const death = document.getElementById('death-screen')

  const hearts = []
  for (let i = 0; i < COMBAT.maxHealth / 2; i++) {
    const el = document.createElement('span')
    el.className = 'heart'
    el.textContent = '♥'
    bar.appendChild(el)
    hearts.push(el)
  }

  death.innerHTML = `
    <div id="death-panel">
      <h1>You died</h1>
      <p class="controls-hint">Your items are safe.</p>
      <button id="respawn-btn">Respawn</button>
    </div>`
  death.querySelector('#respawn-btn').addEventListener('click', onRespawn)

  let flashTimeout
  let lastValue = health.value

  const render = () => {
    hearts.forEach((el, i) => {
      // Heart i covers health 2i+1..2i+2: full, half, or empty.
      const filled = health.value - i * 2
      el.className =
        filled >= 2 ? 'heart' : filled >= 1 ? 'heart half' : 'heart empty'
    })
    death.classList.toggle('hidden', !health.isDead)
    if (health.value < lastValue) {
      flash.classList.add('active')
      clearTimeout(flashTimeout)
      flashTimeout = setTimeout(() => flash.classList.remove('active'), 250)
    }
    lastValue = health.value
  }
  health.onChange(render)
  render()
}
