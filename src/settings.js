import { SETTINGS } from './config.js'

// Persisted user settings (the game's first): one flat { key: value } object
// over SETTINGS.defaults, in its own localStorage key — the mute-button
// precedent, so preferences survive saves AND world resets. set() persists
// immediately; UI controls subscribe via onChange. Unknown/legacy keys in
// storage are carried along harmlessly; blocked storage degrades to
// in-memory defaults (private browsing, storage denied).
export class Settings {
  constructor() {
    this.values = { ...SETTINGS.defaults }
    this.listeners = []
    try {
      const raw = localStorage.getItem(SETTINGS.storageKey)
      if (raw) Object.assign(this.values, JSON.parse(raw))
    } catch {
      // unreadable or blocked storage: run on defaults
    }
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  get(key) {
    return this.values[key]
  }

  set(key, value) {
    this.values[key] = value
    try {
      localStorage.setItem(SETTINGS.storageKey, JSON.stringify(this.values))
    } catch {
      // storage blocked/full: the setting still applies for this session
    }
    for (const fn of this.listeners) fn(this)
  }
}
