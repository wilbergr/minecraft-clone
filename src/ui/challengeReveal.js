import { CHALLENGE_MESSAGE } from '../config.js'

// The Trial's completion reveal — bindTreasureReveal's sibling, rendering
// CHALLENGE_MESSAGE (the captain-editable constant at the top of config.js)
// when the Hollow King falls. It owns challenge.onComplete (single-slot, like
// hunt.onComplete) and exposes show() on its api, so the future guidance
// layer can WRAP the moment (Herald farewell, stele capstone) by intercepting
// the hook and calling api.show() itself — without rebuilding the modal.
// markCelebrated() persists that the reveal was seen; a reload after
// completion doesn't replay it.
export function bindChallengeReveal(challenge, player) {
  const root = document.getElementById('challenge-reveal')
  root.innerHTML = `
    <div id="challenge-panel">
      <div id="challenge-crown" aria-hidden="true">♛</div>
      <h1>The Trial is complete!</h1>
      <p id="challenge-reveal-message"></p>
      <button id="challenge-continue-btn">Claim your realm</button>
    </div>`
  root.querySelector('#challenge-reveal-message').textContent = CHALLENGE_MESSAGE

  const api = { isOpen: false, onToggle: null, show: null }

  const show = () => {
    api.isOpen = true
    root.classList.remove('hidden')
    player.unlock()
    challenge.markCelebrated()
    api.onToggle?.(true)
  }
  api.show = show
  root.querySelector('#challenge-continue-btn').addEventListener('click', () => {
    api.isOpen = false
    root.classList.add('hidden')
    player.lock()
    api.onToggle?.(false)
  })

  challenge.onComplete = show
  // A save can hold a finished-but-unrevealed trial (page closed between the
  // kill and the celebrated autosave) — catch up now.
  if (challenge.isComplete && !challenge.celebrated) show()
  return api
}
