// The End's persistent progress — two latches riding the optional `end`
// save slot (SaveManager.attachEndProgress, the attachTreasure pattern):
// `dragonDefeated` gates the fight from ever re-arming and the one-time
// elytra/exit-portal victory stamps; `celebrated` is the END_MESSAGE
// reveal's replay guard (the challenge.celebrated pattern).
export class EndProgress {
  constructor() {
    this.dragonDefeated = false
    this.celebrated = false
    this.listeners = []
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  #emit() {
    for (const fn of this.listeners) fn(this)
  }

  setDefeated() {
    if (this.dragonDefeated) return
    this.dragonDefeated = true
    this.#emit()
  }

  markCelebrated() {
    if (this.celebrated) return
    this.celebrated = true
    this.#emit()
  }

  serialize() {
    return { dragonDefeated: this.dragonDefeated, celebrated: this.celebrated }
  }

  deserialize(data) {
    this.dragonDefeated = data?.dragonDefeated === true
    this.celebrated = data?.celebrated === true
  }
}
