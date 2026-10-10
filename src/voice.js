// Character voices via the browser's built-in speech synthesis (Web Speech
// API). Each character gets a profile (male/female voice, pitch, speed), so
// the cast sounds distinct without any recorded audio. Silently does nothing
// where speech synthesis is unavailable.

const PROFILES = {
  narrator: { g: 'm', pitch: 0.85, rate: 0.95 },
  peter: { g: 'm', pitch: 1.15, rate: 1.05 },
  spidey: { g: 'm', pitch: 1.05, rate: 1.08 },
  ben: { g: 'm', pitch: 0.75, rate: 0.88 },
  may: { g: 'f', pitch: 0.95, rate: 0.9 },
  mj: { g: 'f', pitch: 1.15, rate: 1.0 },
  harry: { g: 'm', pitch: 1.0, rate: 1.0 },
  norman: { g: 'm', pitch: 0.6, rate: 0.9 },
  jameson: { g: 'm', pitch: 0.9, rate: 1.3 },
  officer: { g: 'm', pitch: 0.8, rate: 0.95 },
  chief: { g: 'm', pitch: 0.7, rate: 1.1 },
  goblin: { g: 'm', pitch: 1.6, rate: 1.05 },
  thug: { g: 'm', pitch: 0.7, rate: 1.1 },
  civilian: { g: 'm', pitch: 1.1, rate: 1.1 },
  civilianF: { g: 'f', pitch: 1.2, rate: 1.1 },
  radio: { g: 'm', pitch: 0.8, rate: 1.25 },
};

// Speaker names used by in-game subtitles -> voice profile.
const BY_NAME = {
  'Green Goblin': 'goblin', 'Mary Jane': 'mj', 'Spider-Man': 'spidey', Peter: 'peter',
  Mugger: 'thug', Carjacker: 'thug', Civilian: 'civilian', Man: 'civilian', Kid: 'civilianF', Woman: 'civilianF',
  'Police radio': 'radio', 'Police scanner': 'radio',
};

const FEMALE = ['female', 'samantha', 'zira', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'susan', 'serena', 'allison', 'ava', 'jenny', 'aria', 'libby', 'sonia', 'google us english'];
const MALE = ['male', 'daniel', 'david', 'alex', 'fred', 'george', 'rishi', 'guy', 'ryan', 'tom', 'mark', 'james', 'oliver', 'aaron'];

export class Voices {
  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    this.enabled = true;
    this.voices = [];
    this.spoken = 0;
    if (this.supported) {
      const load = () => {
        this.voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
        this._m = null;
        this._f = null;
      };
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  pick(g) {
    const cacheKey = g === 'f' ? '_f' : '_m';
    if (this[cacheKey]) return this[cacheKey];
    const words = g === 'f' ? FEMALE : MALE;
    const other = g === 'f' ? MALE : FEMALE;
    const name = (v) => v.name.toLowerCase();
    let v = this.voices.find((x) => words.some((w) => name(x).includes(w)) && !(g === 'f' && name(x).includes('male') && !name(x).includes('female')));
    if (!v) v = this.voices.find((x) => !other.some((w) => name(x).includes(w))) || this.voices[0] || null;
    this[cacheKey] = v;
    return v;
  }

  profileFor(key) {
    if (!key) return PROFILES.narrator;
    if (PROFILES[key]) return PROFILES[key];
    if (BY_NAME[key]) return PROFILES[BY_NAME[key]];
    if (['classic', 'homemade', 'damaged'].includes(key)) return PROFILES.spidey;
    return null;
  }

  // Speak `text` as `who` (a profile key, skin key or subtitle name).
  // Returns true if speech started; onEnd fires when it finishes.
  speak(who, text, onEnd) {
    if (!this.supported || !this.enabled) return false;
    const prof = this.profileFor(who);
    if (!prof) return false;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/\s-+\s/g, ', ').replace(/\.\.\./g, '. '));
      const v = this.pick(prof.g);
      if (v) u.voice = v;
      u.lang = v ? v.lang : 'en-US';
      u.pitch = prof.pitch;
      u.rate = prof.rate;
      u.volume = 1;
      if (onEnd) {
        u.onend = onEnd;
        u.onerror = onEnd;
      }
      speechSynthesis.speak(u);
      this.spoken++;
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    if (this.supported) {
      try { speechSynthesis.cancel(); } catch { /* ignore */ }
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stop();
  }
}
