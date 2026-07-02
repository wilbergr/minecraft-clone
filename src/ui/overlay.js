// Phase 1 UI: the click-to-play overlay that gates pointer lock.
// Later phases add HUD elements (hotbar, health, treasure clues) here.
export function bindOverlay(player) {
  const overlay = document.getElementById('overlay')

  overlay.addEventListener('click', () => player.lock())
  player.addEventListener('lock', () => overlay.classList.add('hidden'))
  player.addEventListener('unlock', () => overlay.classList.remove('hidden'))
}
