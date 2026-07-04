// Boss HP bar (King's Trial stage 4): a slim strip top-center, just below
// the compass, alive only while the Hollow King is. Purely hook-driven —
// BossFight's onBossHealth shows/updates it and onBossGone hides it (victory,
// leash reset, player death, stage jumps all funnel through those), so the
// bar never polls and never drifts from the fight state.
export function bindBossHud(bossFight) {
  const root = document.getElementById('boss-bar')
  root.innerHTML = `
    <div id="boss-name">The Hollow King</div>
    <div id="boss-track"><div id="boss-fill"></div></div>`
  const fill = root.querySelector('#boss-fill')

  bossFight.onBossHealth = (hp, max) => {
    root.classList.remove('hidden')
    fill.style.width = `${Math.max(0, Math.min(100, (hp / max) * 100))}%`
  }
  bossFight.onBossGone = () => root.classList.add('hidden')
}
