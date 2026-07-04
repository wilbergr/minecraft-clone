import { SLEEP } from '../config.js'

// Sleep feedback (bed feature): wires the Sleep hooks to a toast line (the
// treasure-toast pattern — a .show class a timeout removes) and a brief
// full-screen fade while the night skips past, plus the synth sleep chime.
export function bindSleepFx(sleep, sounds) {
  const toast = document.getElementById('sleep-toast')
  const fade = document.getElementById('sleep-fade')
  let toastTimeout
  let fadeTimeout

  sleep.onMessage = (text) => {
    toast.textContent = text
    toast.classList.add('show')
    clearTimeout(toastTimeout)
    toastTimeout = setTimeout(
      () => toast.classList.remove('show'),
      SLEEP.toastSeconds * 1000,
    )
  }

  sleep.onSleep = () => {
    sounds?.play('sleep')
    fade.classList.add('show')
    clearTimeout(fadeTimeout)
    fadeTimeout = setTimeout(
      () => fade.classList.remove('show'),
      SLEEP.fadeSeconds * 1000,
    )
  }
}
