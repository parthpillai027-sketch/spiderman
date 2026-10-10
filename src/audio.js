// Fully synthesized audio (Web Audio): no sound files to license.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.sfxVol = 0.8;
    this.musicVol = 0.22;
    this._musicTimer = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.gain.value = this.sfxVol;
    this.sfx.connect(this.master);
    this.music = c.createGain();
    this.music.gain.value = this.musicOn ? this.musicVol : 0;
    this.music.connect(this.master);

    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // continuous wind for traversal speed
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = c.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.sfx);
    src.start();
    this.startMusic();
  }

  _noise(dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.5, attack = 0.005 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  _tone(freq, dur, { type = 'sine', f1 = freq, gain = 0.3, delay = 0, attack = 0.005, dest = null } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'thwip':
        this._noise(0.14, { f0: 5200, f1: 1400, q: 2.5, gain: 0.35 });
        this._tone(1800, 0.08, { type: 'triangle', f1: 700, gain: 0.06 });
        break;
      case 'zip':
        this._noise(0.3, { f0: 600, f1: 3500, q: 1.5, gain: 0.3 });
        break;
      case 'punch':
        this._tone(140, 0.12, { f1: 50, gain: 0.5 });
        this._noise(0.08, { type: 'lowpass', f0: 1800, f1: 300, gain: 0.4 });
        break;
      case 'heavy':
        this._tone(110, 0.25, { f1: 35, gain: 0.7 });
        this._noise(0.18, { type: 'lowpass', f0: 2200, f1: 200, gain: 0.5 });
        break;
      case 'whoosh':
        this._noise(0.22, { f0: 300, f1: 1500, q: 1.2, gain: 0.2, attack: 0.05 });
        break;
      case 'land':
        this._noise(0.12, { type: 'lowpass', f0: 600, f1: 100, gain: 0.35 });
        break;
      case 'shot':
        this._noise(0.09, { type: 'highpass', f0: 1500, f1: 800, gain: 0.35 });
        this._tone(300, 0.06, { type: 'square', f1: 90, gain: 0.12 });
        break;
      case 'explosion':
        this._noise(1.1, { type: 'lowpass', f0: 900, f1: 60, gain: 0.9, attack: 0.01 });
        this._tone(80, 0.6, { f1: 30, gain: 0.5 });
        break;
      case 'hurt':
        this._tone(220, 0.15, { type: 'sawtooth', f1: 110, gain: 0.15 });
        break;
      case 'sense':
        this._tone(1500, 0.22, { type: 'sine', f1: 1700, gain: 0.12 });
        this._tone(2200, 0.18, { type: 'sine', f1: 2000, gain: 0.08, delay: 0.05 });
        break;
      case 'ui':
        this._tone(880, 0.06, { type: 'square', gain: 0.07 });
        break;
      case 'pickup':
        [660, 880, 1320].forEach((f, i) => this._tone(f, 0.12, { type: 'square', gain: 0.08, delay: i * 0.07 }));
        break;
      case 'success':
        [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.3, { type: 'triangle', gain: 0.18, delay: i * 0.12 }));
        break;
      case 'fail':
        [392, 330, 262].forEach((f, i) => this._tone(f, 0.35, { type: 'sawtooth', gain: 0.1, delay: i * 0.18 }));
        break;
      case 'laugh':
        for (let i = 0; i < 6; i++) this._tone(420 - i * 25, 0.11, { type: 'sawtooth', f1: 300 - i * 20, gain: 0.12, delay: i * 0.13 });
        break;
      case 'glider':
        this._noise(0.6, { f0: 200, f1: 900, q: 0.8, gain: 0.25, attack: 0.1 });
        break;
      case 'webhit':
        this._noise(0.1, { f0: 900, f1: 400, q: 1, gain: 0.25 });
        break;
      default:
    }
  }

  setWind(speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = Math.min(1, Math.max(0, (speed - 10) / 45)) * 0.32;
    this.windGain.gain.setTargetAtTime(g, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(350 + speed * 18, t, 0.2);
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.music) this.music.gain.setTargetAtTime(this.musicOn ? this.musicVol : 0, this.ctx.currentTime, 0.3);
    return this.musicOn;
  }

  // Original heroic loop in D minor: i - VI - III - VII.
  startMusic() {
    if (!this.ctx || this._musicTimer) return;
    const chords = [
      [146.83, 174.61, 220.0], // Dm
      [116.54, 146.83, 174.61], // Bb
      [174.61, 220.0, 261.63], // F
      [130.81, 164.81, 196.0], // C
    ];
    const melody = [
      587, 0, 698, 880, 0, 784, 698, 659,
      587, 0, 523, 587, 698, 0, 659, 0,
      523, 0, 587, 698, 0, 880, 784, 698,
      659, 0, 587, 523, 587, 0, 0, 0,
    ];
    const step = 60 / 132 / 2;
    let i = 0;
    let next = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.ctx) return;
      while (next < this.ctx.currentTime + 0.25) {
        const bar = Math.floor(i / 8) % 4;
        const ch = chords[bar];
        const delay = next - this.ctx.currentTime;
        if (i % 8 === 0) this._tone(ch[0] / 2, step * 7.5, { type: 'triangle', gain: 0.5, delay, dest: this.music, attack: 0.02 });
        if (i % 2 === 0) this._tone(ch[(i / 2) % 3] * 2, step * 0.9, { type: 'square', gain: 0.08, delay, dest: this.music });
        const m = melody[i % 32];
        if (m && Math.floor(i / 32) % 2 === 1) this._tone(m, step * 1.6, { type: 'triangle', gain: 0.22, delay, dest: this.music, attack: 0.01 });
        if (i % 4 === 0) this._noiseAt(delay, 0.05, 0.12);
        i++;
        next += step;
      }
    };
    this._musicTimer = setInterval(tick, 60);
  }

  _noiseAt(delay, dur, gain) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.music);
    s.start(t);
    s.stop(t + dur + 0.02);
  }
}
