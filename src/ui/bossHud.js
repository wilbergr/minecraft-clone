// Boss HP bar: a slim strip top-center, just below the compass, alive only
// while a boss is. Purely hook-driven — each fight runner's onBossHealth
// shows/updates it (stamping its boss's name) and onBossGone hides it
// (victory, resets, player death, stage jumps all funnel through those), so
// the bar never polls and never drifts from fight state.
//
// Generalized for the End: takes a list of { fight, name } — only one fight
// can ever be live because the runners live in different dimensions, so the
// single DOM strip is shared safely.
export function bindBossHud(fights) {
  const root = document.getElementById('boss-bar')
  root.innerHTML = `
    <div id="boss-name"></div>
    <div id="boss-track"><div id="boss-fill"></div></div>`
  const nameEl = root.querySelector('#boss-name')
  const fill = root.querySelector('#boss-fill')

  for (const { fight, name } of fights) {
    fight.onBossHealth = (hp, max) => {
      nameEl.textContent = name
      root.classList.remove('hidden')
      fill.style.width = `${Math.max(0, Math.min(100, (hp / max) * 100))}%`
    }
    fight.onBossGone = () => root.classList.add('hidden')
  }
}
