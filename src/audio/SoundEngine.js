import { AUDIO } from '../config.js'

// Synthesized sound layer (Phase 9). Every effect is generated with WebAudio
// at play time — filtered noise bursts for block sounds, oscillator blips for
// UI/combat — so the build ships zero audio assets and stays fully static.
//
// Browsers refuse to start audio before a user gesture, so the AudioContext
// is created lazily by unlock() (main.js calls it from pointer/key input and
// the pointer-lock event); every play() silently no-ops until then. The mute
// flag persists in its own localStorage key (AUDIO.storageKey) — an audio
// preference, not save data, so it survives world resets.
//
// Block sounds pick a per-material voice from MATERIALS via the `material`
// field on BLOCKS entries (dirt/stone/wood/sand). Every play is detuned by
// ±AUDIO.pitchVariance so repeats don't sound machine-gunned.
//
// `stats` counts plays by name — the headless-verification hook, since CI has
// no speakers to hear the result.

// Per-material noise voices: filter shape + base duration for break/place/
// dig/footstep sounds. `thud` adds a low knock under hard materials.
const MATERIALS = {
  dirt: { type: 'lowpass', freq: 380, dur: 0.14, gain: 0.5 },
  stone: { type: 'bandpass', freq: 850, dur: 0.1, gain: 0.55, thud: 140 },
  wood: { type: 'bandpass', freq: 520, dur: 0.12, gain: 0.5, thud: 200 },
  sand: { type: 'lowpass', freq: 1200, dur: 0.16, gain: 0.4 },
}

export class SoundEngine {
  constructor() {
    this.ctx = null // created on the first user gesture (see unlock)
    this.master = null
    this.noise = null // shared 1s white-noise buffer, source of every burst
    this.muted = localStorage.getItem(AUDIO.storageKey) === '1'
    this.dig = null // { src, material } while the dig loop plays
    this.stats = { played: 0, byName: {} } // headless-test observability
  }

  get ready() {
    return this.ctx !== null
  }

  // Create (or resume) the AudioContext. Must be called from a user gesture
  // at least once; safe to call every time.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      this.ctx = new Ctx()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : AUDIO.masterVolume
      this.master.connect(this.ctx.destination)
      // One second of white noise, reused (with random offsets) by every
      // noise-based sound instead of allocating buffers per play.
      const len = this.ctx.sampleRate
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
  }

  setMuted(muted) {
    this.muted = muted
    localStorage.setItem(AUDIO.storageKey, muted ? '1' : '0')
    if (this.master) this.master.gain.value = muted ? 0 : AUDIO.masterVolume
    if (muted) this.stopDig()
  }

  // Play a named effect. opts: `material` picks the block voice where it
  // applies; `gain` scales volume (distance attenuation for mob sounds).
  play(name, opts = {}) {
    if (!this.ctx) return
    this.stats.played++
    this.stats.byName[name] = (this.stats.byName[name] || 0) + 1
    if (this.muted) return // counted (for tests) but not synthesized

    const m = MATERIALS[opts.material] ?? MATERIALS.dirt
    const v = opts.gain ?? 1
    switch (name) {
      case 'break':
        this.#burst({ ...m, dur: m.dur * 1.6, gain: m.gain * v })
        if (m.thud) this.#tone({ type: 'triangle', from: m.thud, to: m.thud * 0.6, dur: 0.1, gain: 0.35 * v })
        break
      case 'place':
        this.#burst({ ...m, dur: m.dur * 0.7, gain: m.gain * 0.7 * v })
        break
      case 'footstep':
        this.#burst({ ...m, dur: 0.07, gain: AUDIO.footstep.gain * v })
        break
      case 'hit': // player's swing lands on a mob
        this.#tone({ type: 'sine', from: 170, to: 90, dur: 0.12, gain: 0.5 * v })
        this.#burst({ type: 'bandpass', freq: 700, dur: 0.05, gain: 0.25 * v })
        break
      case 'hurt': // player takes damage
        this.#tone({ type: 'square', from: 220, to: 110, dur: 0.2, gain: 0.3 * v })
        break
      case 'zombie': // ambient idle groan
        this.#groan(85, 0.55, 0.35 * v)
        break
      case 'zombieAttack':
        this.#groan(130, 0.3, 0.5 * v)
        break
      case 'click': // UI buttons
        this.#tone({ type: 'square', from: 1250, to: 1100, dur: 0.035, gain: 0.15 * v })
        break
      case 'pickup': // ground item vacuumed into the inventory
        this.#tone({ type: 'sine', from: 520, to: 900, dur: 0.09, gain: 0.3 * v })
        break
      case 'eat': // two soft chomps
        this.#burst({ type: 'lowpass', freq: 450, dur: 0.08, gain: 0.4 * v })
        this.#burst({ type: 'lowpass', freq: 380, dur: 0.08, gain: 0.4 * v, when: 0.14 })
        break
      case 'bow': // string twang + a short air whoosh (Phase 13)
        this.#tone({ type: 'triangle', from: 480, to: 180, dur: 0.12, gain: 0.35 * v })
        this.#burst({ type: 'highpass', freq: 1800, dur: 0.18, gain: 0.2 * v })
        break
      case 'arrowHit': // thock into a block
        this.#burst({ type: 'bandpass', freq: 900, dur: 0.05, gain: 0.35 * v })
        this.#tone({ type: 'triangle', from: 220, to: 140, dur: 0.07, gain: 0.25 * v })
        break
      case 'fuse': // creeper hiss — a long airy sizzle
        this.#burst({ type: 'highpass', freq: 3200, dur: 1.4, gain: 0.4 * v })
        break
      case 'explosion': // deep boom under a wide noise blast
        this.#burst({ type: 'lowpass', freq: 300, dur: 0.7, gain: 0.9 * v })
        this.#tone({ type: 'sine', from: 110, to: 30, dur: 0.6, gain: 0.7 * v })
        break
      case 'equip': // armor clink
        this.#burst({ type: 'bandpass', freq: 1400, dur: 0.06, gain: 0.3 * v })
        this.#tone({ type: 'square', from: 900, to: 700, dur: 0.06, gain: 0.15 * v })
        break
      case 'sleep': // two soft descending sine chimes — a tiny lullaby
        this.#tone({ type: 'sine', from: 620, to: 310, dur: 0.5, gain: 0.25 * v })
        this.#tone({ type: 'sine', from: 460, to: 230, dur: 0.6, gain: 0.2 * v, when: 0.3 })
        break
      case 'horn': // war horn — the siege's wave call (two rising saws a fifth apart)
        this.#tone({ type: 'sawtooth', from: 150, to: 200, dur: 1.0, gain: 0.35 * v })
        this.#tone({ type: 'sawtooth', from: 100, to: 133, dur: 1.0, gain: 0.28 * v })
        break
    }
  }

  // Continuous scratching while actively mining a block. Idempotent per
  // material: BlockInteraction calls startDig every frame it makes progress
  // and stopDig when it doesn't.
  startDig(material) {
    if (!this.ctx || this.muted) return
    if (this.dig?.material === material) return
    this.stopDig()
    const m = MATERIALS[material] ?? MATERIALS.dirt
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filter = this.ctx.createBiquadFilter()
    filter.type = m.type
    filter.frequency.value = m.freq * 1.2
    const gain = this.ctx.createGain()
    gain.gain.value = 0.07
    src.connect(filter).connect(gain).connect(this.master)
    src.start()
    this.dig = { src, material }
  }

  stopDig() {
    if (!this.dig) return
    this.dig.src.stop()
    this.dig = null
  }

  #pitch() {
    return 1 + (Math.random() * 2 - 1) * AUDIO.pitchVariance
  }

  // Filtered slice of the shared noise buffer with an exponential decay.
  #burst({ type, freq, dur, gain, when = 0 }) {
    const t = this.ctx.currentTime + when
    const pitch = this.#pitch()
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = pitch
    const filter = this.ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq * pitch
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(filter).connect(g).connect(this.master)
    src.start(t, Math.random() * 0.5, dur + 0.02)
  }

  // Oscillator sweep from `from` to `to` Hz with an exponential decay.
  #tone({ type, from, to, dur, gain, when = 0 }) {
    const t = this.ctx.currentTime + when
    const pitch = this.#pitch()
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(from * pitch, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to * pitch), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.connect(g).connect(this.master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  // Zombie voice: two detuned saws with a tremolo LFO — a wobbly groan.
  #groan(freq, dur, gain) {
    const t = this.ctx.currentTime
    const pitch = this.#pitch()
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    const lfo = this.ctx.createOscillator()
    const lfoGain = this.ctx.createGain()
    lfo.frequency.value = 6
    lfoGain.gain.value = gain * 0.5
    lfo.connect(lfoGain).connect(g.gain)
    g.connect(this.master)
    for (const detune of [1, 1.02]) {
      const osc = this.ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = freq * pitch * detune
      osc.connect(g)
      osc.start(t)
      osc.stop(t + dur)
    }
    lfo.start(t)
    lfo.stop(t + dur)
  }
}
