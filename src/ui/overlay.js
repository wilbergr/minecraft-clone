// The click-to-play overlay that gates pointer lock. Shown whenever the
// pointer is unlocked AND no in-game UI (inventory screen) is open — so
// opening the inventory doesn't flash "click to play" over it. Returns the
// refresh function so other UI (the inventory screen) can re-evaluate.
export function bindOverlay(player, isUiOpen) {
  const overlay = document.getElementById('overlay')

  overlay.addEventListener('click', () => player.lock())
  // Read pointerLockElement, not player.isLocked: PointerLockControls fires
  // its lock/unlock events *before* updating isLocked, so the flag is stale
  // inside these handlers while the DOM state is already current. (The
  // touch-mode flag has no such lag — PlayerControls sets touchActive
  // before dispatching — so reading it here is safe.)
  const update = () =>
    overlay.classList.toggle(
      'hidden',
      document.pointerLockElement !== null || player.touchActive || isUiOpen(),
    )
  player.addEventListener('lock', update)
  player.addEventListener('unlock', update)
  return update
}
