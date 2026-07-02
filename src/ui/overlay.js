// UI bindings: the click-to-play overlay that gates pointer lock, and the
// selected-block readout. Later phases replace the readout with a real
// hotbar and add health / treasure-clue HUD elements here.
export function bindOverlay(player) {
  const overlay = document.getElementById('overlay')

  overlay.addEventListener('click', () => player.lock())
  player.addEventListener('lock', () => overlay.classList.add('hidden'))
  player.addEventListener('unlock', () => overlay.classList.remove('hidden'))
}

export function bindHud(interaction) {
  const readout = document.getElementById('selected-block')
  const render = (block) => {
    readout.textContent = `Block: ${block.name} (1–4 to switch)`
  }
  interaction.onSelectionChange = render
  render(interaction.selectedBlock)
}
