import { TREASURE_MESSAGE } from '../config.js'

// Quest log (J to toggle; 🗺 button on touch): a non-modal panel — it never
// touches pointer lock, so the game keeps running while it's open — listing
// every token in hunt order: found ones checked off, the active one showing
// its clue, later ones still sealed. Once the hunt completes it shows
// TREASURE_MESSAGE, so the reward stays readable after the reveal overlay
// is dismissed. Returns a toggle function for the touch menu button.
export function bindQuestLog(hunt) {
  const root = document.getElementById('quest-log')
  root.innerHTML = `
    <div id="quest-log-panel">
      <h2>Treasure hunt <span id="quest-progress"></span></h2>
      <ol id="quest-list"></ol>
      <p class="controls-hint"><kbd>J</kbd> closes the log &middot; the compass up top points the way.</p>
    </div>`
  const progress = root.querySelector('#quest-progress')
  const list = root.querySelector('#quest-list')

  const render = () => {
    progress.textContent = `${hunt.foundCount}/${hunt.tokens.length}`
    list.innerHTML = ''
    let revealed = true // clues unlock in order: active token's clue is the last shown
    for (const token of hunt.tokens) {
      const li = document.createElement('li')
      if (token.found) {
        li.className = 'quest-found'
        li.innerHTML = `<span class="quest-mark">✦</span> ${token.name} — found`
      } else if (revealed) {
        revealed = false
        li.className = 'quest-active'
        li.innerHTML = `<span class="quest-mark">◈</span> ${token.name}<p class="quest-clue"></p>`
        li.querySelector('.quest-clue').textContent = token.clue
      } else {
        li.className = 'quest-locked'
        li.innerHTML = `<span class="quest-mark">·</span> A token yet to be revealed`
      }
      list.appendChild(li)
    }
    if (hunt.isComplete) {
      const done = document.createElement('li')
      done.className = 'quest-complete'
      done.textContent = TREASURE_MESSAGE
      list.appendChild(done)
    }
  }

  const toggle = () => root.classList.toggle('hidden')
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyJ') toggle()
  })
  hunt.onChange(render)
  render()
  return toggle
}
