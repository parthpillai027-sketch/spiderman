// Keyboard + mouse + gamepad (DualSense / Xbox standard mapping) input.
// Game code asks for abstract actions so both control schemes share logic.

const KEYMAP = {
  jump: ['Space'],
  swing: ['ShiftLeft', 'ShiftRight'],
  attack: ['Mouse0', 'KeyJ'],
  web: ['Mouse2', 'KeyK'],
  dodge: ['KeyC', 'KeyL'],
  zip: ['KeyQ'],
  heal: ['KeyF'],
  finisher: ['KeyV'],
  interact: ['KeyE'],
  map: ['KeyM'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'Space', 'Mouse0'],
};

// Standard gamepad button indices (PS: Cross=0, Circle=1, Square=2, Triangle=3)
const PADMAP = {
  jump: [0],
  swing: [7], // R2
  attack: [2], // Square
  web: [3], // Triangle
  dodge: [1], // Circle
  zip: [5], // R1
  heal: [13], // D-pad down
  finisher: [4], // L1
  interact: [6], // L2
  map: [8], // Create/Share
  pause: [9], // Options
  confirm: [0],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.sensitivity = 0.0024;
    this.padPrev = [];
    this.padNow = [];
    this.padAxes = [0, 0, 0, 0];
    this.lastLookInput = 0;
    this.usingPad = false;
    this.freeLook = false;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      this.keys.add(code);
      this.pressedKeys.add(code);
      this.usingPad = false;
    });
    window.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Mouse look works with pointer lock, and falls back to plain mouse
    // movement over the game when the browser/frame refuses the lock.
    window.addEventListener('mousemove', (e) => {
      if (!this.locked && (!this.freeLook || e.target !== canvas)) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
      this.lastLookInput = performance.now();
    });
    document.addEventListener('pointerlockerror', () => {
      this.freeLook = true;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.freeLook = true; });
    } catch {
      this.freeLook = true; // pointer lock unavailable (embedded/headless)
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    this.padPrev = this.padNow;
    if (pad) {
      this.padNow = pad.buttons.map((b) => b.pressed || b.value > 0.4);
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      this.padAxes = [dz(pad.axes[0] || 0), dz(pad.axes[1] || 0), dz(pad.axes[2] || 0), dz(pad.axes[3] || 0)];
      if (this.padNow.some(Boolean) || this.padAxes.some((a) => a !== 0)) this.usingPad = true;
      if (this.padAxes[2] || this.padAxes[3]) this.lastLookInput = performance.now();
    } else {
      this.padNow = [];
      this.padAxes = [0, 0, 0, 0];
    }
  }

  endFrame() {
    this.pressedKeys.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  down(action) {
    if (KEYMAP[action].some((k) => this.keys.has(k))) return true;
    return (PADMAP[action] || []).some((b) => this.padNow[b]);
  }

  pressed(action) {
    if (KEYMAP[action].some((k) => this.pressedKeys.has(k))) return true;
    return (PADMAP[action] || []).some((b) => this.padNow[b] && !this.padPrev[b]);
  }

  // Movement vector: x = strafe right, y = forward.
  move() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW')) y += 1;
    if (this.keys.has('KeyS')) y -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyA')) x -= 1;
    x += this.padAxes[0];
    y -= this.padAxes[1];
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  // Camera look delta in radians.
  look(dt) {
    // arrow keys turn the camera too (laptops, or when the mouse can't be captured)
    const ax = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    const ay = (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0);
    if (ax || ay) this.lastLookInput = performance.now();
    const dx = this.mouseDX * this.sensitivity + (this.padAxes[2] * 2.6 + ax * 2.2) * dt;
    const dy = this.mouseDY * this.sensitivity + (this.padAxes[3] * 1.8 + ay * 1.4) * dt;
    return { dx, dy };
  }

  idleLookFor() {
    return (performance.now() - this.lastLookInput) / 1000;
  }
}
