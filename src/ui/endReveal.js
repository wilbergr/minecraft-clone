import { END_MESSAGE } from '../config.js'

// The End's completion reveal — bindChallengeReveal's sibling, rendering
// END_MESSAGE (the captain-editable constant at the top of config.js) when
// the Ender Dragon falls. It owns dragonFight.onComplete (single-slot) and
// exposes show(); progress.markCelebrated() persists that the reveal was
// seen, so a reload after victory doesn't replay it.
export function bindEndReveal(dragonFight, progress, player) {
  const root = document.getElementById('end-reveal')
  root.innerHTML = `
    <div id="end-panel">
      <div id="end-sigil" aria-hidden="true">◆</div>
      <h1>The dragon is defeated!</h1>
      <p id="end-reveal-message"></p>
      <button id="end-continue-btn">Take flight</button>
    </div>`
  root.querySelector('#end-reveal-message').textContent = END_MESSAGE

  const api = { isOpen: false, onToggle: null, show: null }

  const show = () => {
    api.isOpen = true
    root.classList.remove('hidden')
    player.unlock()
    progress.markCelebrated()
    api.onToggle?.(true)
  }
  api.show = show
  root.querySelector('#end-continue-btn').addEventListener('click', () => {
    api.isOpen = false
    root.classList.add('hidden')
    player.lock()
    api.onToggle?.(false)
  })

  dragonFight.onComplete = show
  // A save can hold a defeated-but-unrevealed dragon (page closed between
  // the kill and the celebrated autosave) — catch up now.
  if (progress.dragonDefeated && !progress.celebrated) show()
  return api
}
