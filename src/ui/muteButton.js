// Sound mute toggle (Phase 9): the button on the start overlay and the M key
// both flip the SoundEngine's persisted mute flag (see AUDIO.storageKey).
export function bindMuteButton(sounds) {
  const btn = document.getElementById('mute-btn')
  const render = () => {
    btn.textContent = sounds.muted ? 'Sound: off' : 'Sound: on'
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation() // the overlay click would grab pointer lock
    sounds.setMuted(!sounds.muted)
    render()
  })
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM') return
    sounds.setMuted(!sounds.muted)
    render()
  })
  render()
}
