import { TREASURE_MESSAGE } from '../config.js'

// The completion reveal: a celebratory modal (styled like the death screen,
// but gold) that renders TREASURE_MESSAGE — the one obvious constant at the
// top of src/config.js — when the third token is collected. Showing it
// releases pointer lock (which also pauses combat) so the player can read
// and click in peace; dismissing re-locks. markCelebrated() persists that
// the reveal was seen, so a reload after completion doesn't replay it.
export function bindTreasureReveal(hunt, player) {
  const root = document.getElementById('treasure-reveal')
  root.innerHTML = `
    <div id="treasure-panel">
      <div id="treasure-sparkles" aria-hidden="true">✦ ✦ ✦</div>
      <h1>Treasure found!</h1>
      <p id="treasure-message"></p>
      <button id="treasure-continue-btn">Keep exploring</button>
    </div>`
  root.querySelector('#treasure-message').textContent = TREASURE_MESSAGE

  const api = { isOpen: false, onToggle: null }

  const show = () => {
    api.isOpen = true
    root.classList.remove('hidden')
    player.unlock()
    hunt.markCelebrated()
    api.onToggle?.(true)
  }
  root.querySelector('#treasure-continue-btn').addEventListener('click', () => {
    api.isOpen = false
    root.classList.add('hidden')
    player.lock()
    api.onToggle?.(false)
  })

  hunt.onComplete = show
  // A save can hold a finished-but-unrevealed hunt (page closed in the beat
  // between the last collect and the autosave marking it celebrated) — catch
  // up now rather than never showing the payoff.
  if (hunt.isComplete && !hunt.celebrated) show()
  return api
}
