import { CHALLENGE_MESSAGE, GUIDANCE, TREASURE_MESSAGE } from '../config.js'
import { STAGES } from '../quest/Challenge.js'

// Quest log (J to toggle; 🗺 button on touch): a non-modal panel — it never
// touches pointer lock, so the game keeps running while it's open — listing
// every token in hunt order: found ones checked off, the active one showing
// its clue, later ones still sealed. Once the hunt completes it shows
// TREASURE_MESSAGE, so the reward stays readable after the reveal overlay
// is dismissed — and the King's Trial section below unseals, tracking the
// four challenge stages (and the relic shards inside stage 1) in the same
// style. Returns a toggle function for the touch menu button.
export function bindQuestLog(hunt, challenge) {
  const root = document.getElementById('quest-log')
  root.innerHTML = `
    <div id="quest-log-panel">
      <h2>Treasure hunt <span id="quest-progress"></span></h2>
      <ol id="quest-list"></ol>
      <h2>The King's Trial <span id="trial-progress"></span></h2>
      <ol id="trial-list"></ol>
      <p class="controls-hint"><kbd>J</kbd> closes the log &middot; the compass up top points the way.</p>
    </div>`
  const progress = root.querySelector('#quest-progress')
  const list = root.querySelector('#quest-list')
  const trialProgress = root.querySelector('#trial-progress')
  const trialList = root.querySelector('#trial-list')

  const item = (className, html) => {
    const li = document.createElement('li')
    li.className = className
    li.innerHTML = html
    return li
  }

  const renderTreasure = () => {
    progress.textContent = `${hunt.foundCount}/${hunt.tokens.length}`
    list.innerHTML = ''
    let revealed = true // clues unlock in order: active token's clue is the last shown
    for (const token of hunt.tokens) {
      if (token.found) {
        list.appendChild(item('quest-found', `<span class="quest-mark">✦</span> ${token.name} — found`))
      } else if (revealed) {
        revealed = false
        const li = item('quest-active', `<span class="quest-mark">◈</span> ${token.name}<p class="quest-clue"></p>`)
        li.querySelector('.quest-clue').textContent = token.clue
        list.appendChild(li)
      } else {
        list.appendChild(item('quest-locked', `<span class="quest-mark">·</span> A token yet to be revealed`))
      }
    }
    if (hunt.isComplete) {
      const done = document.createElement('li')
      done.className = 'quest-complete'
      done.textContent = TREASURE_MESSAGE
      list.appendChild(done)
    }
  }

  // Stage 1's live detail rows: shards checked off in order, the active
  // shard's clue revealed, later shards sealed — then the delivery clue once
  // all five are carried.
  const renderRelics = () => {
    const relics = challenge.relics
    let revealed = true
    for (const relic of relics.relics) {
      if (relic.found) {
        trialList.appendChild(item('quest-found', `<span class="quest-mark">✦</span> ${relic.name} — recovered`))
      } else if (revealed) {
        revealed = false
        const li = item('quest-active', `<span class="quest-mark">◈</span> ${relic.name}<p class="quest-clue"></p>`)
        li.querySelector('.quest-clue').textContent = relic.clue
        trialList.appendChild(li)
      } else {
        trialList.appendChild(item('quest-locked', `<span class="quest-mark">·</span> A shard yet to be revealed`))
      }
    }
    if (relics.allFound) {
      const li = item('quest-active', `<span class="quest-mark">◈</span> Deliver the shards<p class="quest-clue"></p>`)
      li.querySelector('.quest-clue').textContent = challenge.deliverClue
      trialList.appendChild(li)
    }
  }

  // Stage 2's live detail row: cell progress plus the bill of materials,
  // both derived from the config shape so captain retunes never drift.
  const renderBeacon = () => {
    const s = challenge.structure
    const li = item(
      'quest-active',
      `<span class="quest-mark">◈</span> Build to the blueprint — ${s.satisfied}/${s.total} cells raised<p class="quest-clue"></p>`,
    )
    li.querySelector('.quest-clue').textContent =
      `The ghost shows what remains: ${s.billOfMaterials().join(', ')}.`
    trialList.appendChild(li)
  }

  // Stage 4's live detail row: how to summon the King, or how the duel stands.
  const renderBoss = () => {
    const fight = challenge.bossFight
    const li = item(
      'quest-active',
      `<span class="quest-mark">◈</span> Face the Hollow King<p class="quest-clue"></p>`,
    )
    li.querySelector('.quest-clue').textContent =
      fight.state === 'fighting'
        ? 'The Hollow King walks the ring. Every attack is announced — watch the pose, then move. A charge into a pillar staggers him.'
        : fight.state === 'rumbling'
          ? 'The ground trembles — the King is coming.'
          : "Right-click the beacon's gold core to summon the Hollow King. Fell him and the Trial is yours."
    trialList.appendChild(li)
  }

  // Stage 3's live detail row: how to start the siege, or where it stands.
  const renderSiege = () => {
    const siege = challenge.siege
    const li = item(
      'quest-active',
      `<span class="quest-mark">◈</span> Hold the Trial Grounds<p class="quest-clue"></p>`,
    )
    li.querySelector('.quest-clue').textContent = siege.active
      ? `Wave ${siege.waveIndex + 1} of ${siege.cfg.waves.length} — clear every wave before dawn.`
      : siege.armed
        ? 'The siege is armed — the horde comes at dusk. Hold the ring.'
        : "Right-click the beacon's gold core to arm the siege. It begins at dusk; clear all three waves before dawn."
    trialList.appendChild(li)
  }

  const renderTrial = () => {
    trialList.innerHTML = ''
    if (!challenge.activated) {
      trialProgress.textContent = ''
      trialList.appendChild(
        item('quest-locked', `<span class="quest-mark">·</span> Sealed — the Trial stirs only once the treasure is found.`),
      )
      return
    }
    trialProgress.textContent = challenge.isComplete
      ? 'complete'
      : `stage ${challenge.stage + 1}/${STAGES.length}`
    // The Champion's Testament (guidance layer): each stage row carries a
    // first-person passage from the fallen champion — recovered pages, so the
    // instructions double as lore. Strings live in GUIDANCE.testament.
    const testament = (className, text) => {
      const p = document.createElement('p')
      p.className = `testament ${className}`
      p.textContent = text
      return p
    }
    for (const [index, stage] of STAGES.entries()) {
      if (index < challenge.stage) {
        const li = item('quest-found', `<span class="quest-mark">✦</span> ${stage.name} — complete`)
        li.appendChild(testament('testament-closed', GUIDANCE.testament.closings[index]))
        trialList.appendChild(li)
      } else if (index === challenge.stage) {
        const li = item('quest-active', `<span class="quest-mark">◈</span> ${stage.name}`)
        li.appendChild(testament('testament-active', GUIDANCE.testament.passages[index]))
        trialList.appendChild(li)
        if (index === 0) renderRelics()
        if (index === 1) renderBeacon()
        if (index === 2) renderSiege()
        if (index === 3) renderBoss()
      } else {
        const li = item('quest-locked', `<span class="quest-mark">·</span> ${stage.name} — sealed`)
        li.appendChild(testament('testament-sealed', GUIDANCE.testament.sealedStub))
        trialList.appendChild(li)
      }
    }
    if (challenge.isComplete) {
      const done = document.createElement('li')
      done.className = 'quest-complete'
      done.textContent = CHALLENGE_MESSAGE
      trialList.appendChild(done)
    }
  }

  const render = () => {
    renderTreasure()
    renderTrial()
  }

  const toggle = () => root.classList.toggle('hidden')
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyJ') toggle()
  })
  hunt.onChange(render)
  challenge.onChange(render)
  render()
  return toggle
}
