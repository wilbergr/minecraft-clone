// Death-drops toggle: a button on the start overlay beside the mute button
// (the persisted-toggle precedent). ON is Minecraft-style — dying spills
// your kit where you fell; OFF keeps the inventory through death (the
// game's original behavior). State lives in the Settings store.
export function bindDeathDropsButton(settings) {
  const btn = document.getElementById('death-drops-btn')
  const render = () => {
    btn.textContent = settings.get('deathDrops') ? 'Death drops: on' : 'Death drops: off'
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation() // the overlay click would grab pointer lock
    settings.set('deathDrops', !settings.get('deathDrops'))
    render()
  })
  render()
}
