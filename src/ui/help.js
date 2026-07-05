// Controls / how-to-play panel (Phase 7). Opened from the start overlay's
// "Controls" button, the H key, or the touch menu's ? button. Modal like the
// inventory screen: opening releases control (pausing combat), closing hands
// it back — but only if the player was actually playing when it opened, so
// browsing controls from the start overlay doesn't launch the game.
//
// Both input schemes are always listed (CSS leads with the active one via
// body.touch-mode) so desktop players learn the game works on their phone
// and vice versa.
export function bindHelp(player) {
  const root = document.getElementById('help-screen')
  root.innerHTML = `
    <div id="help-panel">
      <h2>How to play <button id="help-close-btn" class="panel-close-btn" type="button" aria-label="Close">✕</button></h2>
      <p class="help-goal">
        Explore, mine, craft, and fight — and follow the compass to the three
        lost tokens. Find them all to reveal the hidden treasure. Progress
        saves automatically in your browser.
      </p>
      <div id="help-columns">
        <section class="help-scheme help-desktop">
          <h3>Keyboard &amp; mouse</h3>
          <ul>
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows — move · <kbd>Shift</kbd> — sprint</li>
            <li><kbd>Space</kbd> — jump (hold to keep hopping) · <kbd>C</kbd> — sneak</li>
            <li>In water: <kbd>Space</kbd> — swim up · <kbd>C</kbd> — dive. Watch your bubbles — surface (or find an air pocket) before they run out</li>
            <li>Mouse — look around</li>
            <li>Left click — attack / hold to mine (cracks show progress)</li>
            <li>Right click — use the held item: place a block, eat food, wear armor</li>
            <li>Hold right click with a bow — draw; release to shoot (needs arrows)</li>
            <li><kbd>1</kbd>–<kbd>9</kbd> / wheel — pick a hotbar slot</li>
            <li><kbd>Q</kbd> — drop one item · <kbd>Shift</kbd>+<kbd>Q</kbd> — drop the stack</li>
            <li><kbd>E</kbd> — inventory &amp; crafting · <kbd>J</kbd> — quest log</li>
            <li><kbd>H</kbd> — this panel · <kbd>Esc</kbd> — release the mouse</li>
            <li><kbd>M</kbd> — mute / unmute sound</li>
          </ul>
        </section>
        <section class="help-scheme help-touch">
          <h3>Touch</h3>
          <ul>
            <li>Left stick — move (push to the edge to sprint)</li>
            <li>Drag anywhere else — look around</li>
            <li>Tap the world — attack / break one block</li>
            <li>Tap ⬆ — jump · hold ⛏ — keep mining · tap ▦ — place / use item</li>
            <li>Tap a hotbar slot to select it</li>
            <li>Top right: ⏸ pause · 🎒 inventory · 🗺 quest log · ? help</li>
          </ul>
        </section>
      </div>
      <p class="controls-hint">
        Better tools mine faster; some blocks need the right tool. Broken
        blocks drop items — walk near to scoop them up. Watch your hearts
        after dark&hellip; zombies bite, skeletons shoot, and that hissing
        green thing is about to explode. Armor softens the blows; attacks
        landed mid-fall crit. Sound toggles on the pause screen (or
        <kbd>M</kbd>).
      </p>
    </div>`

  const api = { isOpen: false, onToggle: null }
  let wasPlaying = false

  const open = () => {
    api.isOpen = true
    wasPlaying = document.pointerLockElement !== null || player.touchActive
    root.classList.remove('hidden')
    player.unlock()
    api.onToggle?.(true)
  }
  const close = () => {
    api.isOpen = false
    root.classList.add('hidden')
    if (wasPlaying) player.lock()
    api.onToggle?.(false)
  }
  api.toggle = () => (api.isOpen ? close() : open())

  root.querySelector('#help-close-btn').addEventListener('click', close)
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') api.toggle()
    else if (e.code === 'Escape' && api.isOpen) close()
  })
  // The start overlay's "Controls" button (index.html) opens it too.
  document.getElementById('help-btn')?.addEventListener('click', (e) => {
    e.stopPropagation() // the overlay click would grab pointer lock
    open()
  })

  return api
}
