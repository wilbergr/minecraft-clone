import { GUIDANCE } from '../config.js'

// The Herald's banner (guidance layer): a cinematic subtitle strip above the
// hotbar carrying every King's Trial message — Herald speech AND the trial's
// former toasts (§8.7: the shared #treasure-toast slot is single-slot with a
// 4s fuse, so trial beats used to overwrite each other and the treasure
// toasts; this element replaces it for all trial text). Messages QUEUE:
// each holds the banner at least GUIDANCE.banner.minSeconds, the last one
// lingers, and consecutive duplicates collapse — nothing is ever silently
// overwritten. Herald speech carries a flavor line under the main sentence.
export function bindHeraldBanner() {
  const root = document.getElementById('herald-line')
  root.innerHTML = `
    <div id="herald-line-main"></div>
    <div id="herald-line-flavor"></div>`
  const main = root.querySelector('#herald-line-main')
  const flavor = root.querySelector('#herald-line-flavor')

  const queue = []
  let showing = false
  let hideTimer = null
  let nextTimer = null

  const api = {
    current: null, // { text, flavor } on screen right now (test seam)
    // A plain trial message (the former toast path): text only.
    announce: (text) => enqueue({ text, flavor: '' }),
    // A Herald line: main sentence + flavor line, spoken styling.
    say: (line) => enqueue({ text: line.text, flavor: line.flavor ?? '' }),
  }

  const enqueue = (msg) => {
    const last = queue[queue.length - 1] ?? (showing ? api.current : null)
    if (last && last.text === msg.text) return // collapse duplicates
    queue.push(msg)
    if (queue.length > GUIDANCE.banner.maxQueue) queue.splice(0, queue.length - GUIDANCE.banner.maxQueue)
    if (!showing) showNext()
  }

  const showNext = () => {
    clearTimeout(hideTimer)
    clearTimeout(nextTimer)
    const msg = queue.shift()
    if (!msg) {
      showing = false
      // Last message lingers past its minSeconds, then fades.
      hideTimer = setTimeout(
        () => root.classList.remove('show'),
        (GUIDANCE.banner.lingerSeconds - GUIDANCE.banner.minSeconds) * 1000,
      )
      return
    }
    showing = true
    api.current = msg
    main.textContent = `✦ ${msg.text} ✦`
    flavor.textContent = msg.flavor
    flavor.classList.toggle('hidden', !msg.flavor)
    root.classList.add('show')
    nextTimer = setTimeout(showNext, GUIDANCE.banner.minSeconds * 1000)
  }

  return api
}
