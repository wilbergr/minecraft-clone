// Reset-world button on the click-to-play overlay. Two-click confirm, since
// it erases all progress: the first click arms it (label turns into a
// warning), the second click wipes the save and reloads; clicking anywhere
// else disarms it back to harmless.
export function bindResetButton(save) {
  const button = document.getElementById('reset-world-btn')
  let armed = false

  const disarm = () => {
    armed = false
    button.textContent = 'Reset world'
    button.classList.remove('armed')
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation() // the overlay click would grab pointer lock
    if (armed) {
      save.reset()
    } else {
      armed = true
      button.textContent = 'Erase all progress?'
      button.classList.add('armed')
    }
  })
  // Capture phase so the overlay's own click handler can't run first.
  document.addEventListener(
    'click',
    (e) => {
      if (armed && e.target !== button) disarm()
    },
    true,
  )
}
