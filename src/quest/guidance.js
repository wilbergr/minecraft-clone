import { Herald } from './Herald.js'
import { RuneStele } from './RuneStele.js'
import { WispTrail } from '../fx/WispTrail.js'
import { bindHeraldBanner } from '../ui/heraldBanner.js'

// The King's Trial guidance layer, bound in one place (design report §6/§7):
// Herald + wisp trail + prophecy stele + banner, all subscribing to
// challenge.onChange and the fx hooks main.js already wires — zero
// Challenge.js changes. Call bindGuidance AFTER bindTreasureReveal /
// bindChallengeReveal and their onToggle assignments: it wraps those
// single-slot hooks (reveal.onToggle for the unlock apparition,
// bossFight.onBossEvent for boss-stage lines, challenge.onComplete for the
// farewell ceremony) around whatever main.js installed first.
export function bindGuidance({
  scene,
  world,
  camera,
  player,
  challenge,
  hunt,
  reveal,
  challengeReveal,
  health,
  sounds,
  particles,
}) {
  const banner = bindHeraldBanner()
  const herald = new Herald({ challenge, world, scene, camera, banner, sounds, particles, health })
  const wisps = new WispTrail({ hunt, challenge, particles, player, camera })
  const stele = new RuneStele({ challenge, world, scene, sounds, particles })

  // §8.7 (captain-locked): ALL trial messages ride the Herald banner queue.
  // The shared #treasure-toast slot is single-slot with a 4s fuse — trial
  // beats used to overwrite each other AND the treasure-hunt toasts.
  challenge.onToast = (text) => banner.announce(text)

  // The unlock apparition waits for the treasure reveal to be dismissed so
  // the two celebration moments never fight for attention (§2.1 fix).
  const prevRevealToggle = reveal.onToggle
  reveal.onToggle = (open) => {
    prevRevealToggle?.(open)
    if (!open) herald.onRevealDismissed()
  }

  // Boss-stage Herald lines observe the existing onBossEvent seam on top of
  // the fx handler — boss internals untouched.
  const prevBossEvent = challenge.bossFight.onBossEvent
  challenge.bossFight.onBossEvent = (type, data) => {
    prevBossEvent?.(type, data)
    herald.onBossEvent(type, data)
  }

  // Completion ceremony: the Herald speaks its farewell and dissolves for
  // good, THEN the existing challengeReveal modal (unchanged) renders
  // CHALLENGE_MESSAGE. The stele capstone ignites via its own onChange.
  const showReveal = challenge.onComplete
  challenge.onComplete = () => {
    sounds.play('trialComplete')
    herald.farewell(() => (showReveal ?? challengeReveal.show)())
  }

  return {
    banner,
    herald,
    wisps,
    stele,
    update(delta, playerPos) {
      herald.update(delta, playerPos)
      wisps.update(delta)
      stele.update(delta)
    },
  }
}
