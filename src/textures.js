// Procedural pixel-art textures. Everything in the game is painted here at
// 16 texels per block so the city reads like a voxel sandbox, with no
// external image assets.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas, { repeat = true, mip = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mip ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mip;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export class Painter {
  constructor(w, h, seed = 7) {
    this.w = w;
    this.h = h;
    this.canvas = makeCanvas(w, h);
    this.ctx = this.canvas.getContext('2d');
    this.data = this.ctx.createImageData(w, h);
    this.rand = mulberry32(seed);
  }
  set(x, y, col, jit = 0) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    let r = (col >> 16) & 255;
    let g = (col >> 8) & 255;
    let b = col & 255;
    if (jit) {
      const f = 1 + (this.rand() - 0.5) * jit;
      r *= f;
      g *= f;
      b *= f;
    }
    const i = (y * this.w + x) * 4;
    const d = this.data.data;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
  }
  get(x, y) {
    const i = (y * this.w + x) * 4;
    const d = this.data.data;
    return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
  }
  rect(x, y, w, h, col, jit = 0) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, col, jit);
  }
  fill(col, jit = 0) {
    this.rect(0, 0, this.w, this.h, col, jit);
  }
  // Stamp a string-art pattern: each char maps to a colour (undefined = skip).
  pattern(x, y, rows, map) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = map[row[i]];
        if (c !== undefined) this.set(x + i, y + j, c);
      }
    });
  }
  line(x0, y0, x1, y1, col) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, col);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  done() {
    this.ctx.putImageData(this.data, 0, 0);
    return this.canvas;
  }
  texture(opts) {
    return toTexture(this.done(), opts);
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font for in-world signs (crisp pixels, no font loading).
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31],
  3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12],
  '-': [0, 0, 0, 31, 0, 0, 0], '!': [4, 4, 4, 4, 4, 0, 4], '.': [0, 0, 0, 0, 0, 12, 12],
  "'": [4, 4, 8, 0, 0, 0, 0], '?': [14, 17, 1, 2, 4, 0, 4], ':': [0, 12, 12, 0, 12, 12, 0],
  '&': [12, 18, 20, 8, 21, 18, 13], $: [4, 15, 20, 14, 5, 30, 4], ' ': [0, 0, 0, 0, 0, 0, 0],
};

export function textWidth(text, scale = 1) {
  return text.length * 6 * scale - scale;
}

export function drawText(p, text, x, y, col, scale = 1) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let row = 0; row < 7; row++) {
      for (let c = 0; c < 5; c++) {
        if (g[row] & (1 << (4 - c))) p.rect(cx + c * scale, y + row * scale, scale, scale, col);
      }
    }
    cx += 6 * scale;
  }
}

// ---------------------------------------------------------------------------
// Facade helpers. One facade tile = 4x4 blocks = 64x64 texels (one floor bay).

function windowA(p, x, y, w, h, frame = 0xe6dfd0, glass = 0x2b3f5c, stone = 0xcfc4b0) {
  p.rect(x - 2, y - 2, w + 4, 3, stone, 0.05);
  p.rect(x - 2, y + h, w + 4, 3, stone, 0.05);
  p.rect(x, y, w, h, frame);
  p.rect(x + 2, y + 2, w - 4, h - 4, glass, 0.14);
  const mx = x + (w >> 1);
  p.rect(mx - 1, y + 2, 2, h - 4, frame);
  p.rect(x + 2, y + (h >> 1) - 1, w - 4, 2, frame);
  for (let k = 0; k < 6; k++) {
    p.set(x + 4 + k, y + 4 + k * 2, 0x8fb3d6);
    p.set(x + 5 + k, y + 4 + k * 2, 0x6f93b8);
  }
}

const BUILDERS = {
  brick() {
    const p = new Painter(64, 64, 11);
    const reds = [0x8e3b2e, 0x9c4433, 0x7f3427, 0xa04a36, 0x87392b];
    for (let y = 0; y < 64; y++) {
      const row = y >> 2;
      const off = (row & 1) * 4;
      for (let x = 0; x < 64; x++) {
        if ((y & 3) === 3 || ((x + off) & 7) === 7) p.set(x, y, 0xa59a8c, 0.1);
        else p.set(x, y, reds[(((x + off) >> 3) * 31 + row * 17) % reds.length], 0.08);
      }
    }
    windowA(p, 18, 10, 28, 40);
    return p.texture();
  },
  concrete() {
    const p = new Painter(64, 64, 12);
    p.fill(0xcbbd9f, 0.06);
    for (let x = 0; x < 64; x++) { p.set(x, 31, 0xb3a587); p.set(x, 60, 0xa8997a); p.set(x, 61, 0xa8997a); }
    for (let y = 0; y < 31; y++) p.set(0, y, 0xb3a587);
    for (let y = 32; y < 60; y++) p.set(32, y, 0xb3a587);
    windowA(p, 20, 9, 24, 44, 0x3a3a3a, 0x34506e, 0xb9ab8d);
    return p.texture();
  },
  glass() {
    const p = new Painter(64, 64, 13);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 4; px++) {
        const f = 0.85 + p.rand() * 0.3;
        const sky = p.rand() < 0.18;
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const base = sky ? 0x9cc3e0 : 0x4f7fa6;
            const g = 1.15 - y / 40;
            const r = ((base >> 16) & 255) * f * g, gg = ((base >> 8) & 255) * f * g, b = (base & 255) * f * g;
            p.set(px * 16 + x, py * 16 + y, (Math.min(255, r) << 16) | (Math.min(255, gg) << 8) | Math.min(255, b), 0.04);
          }
        }
      }
    }
    for (let i = 0; i < 64; i++) {
      for (const k of [0, 16, 32, 48]) { p.set(k, i, 0x8a969e); p.set(i, k, 0x8a969e); }
    }
    return p.texture();
  },
  deco() {
    const p = new Painter(64, 64, 14);
    p.fill(0xd9d2c3, 0.05);
    p.rect(0, 0, 10, 64, 0xe8e3d6, 0.04);
    p.rect(54, 0, 10, 64, 0xe8e3d6, 0.04);
    p.rect(10, 0, 1, 64, 0xb5ab98);
    p.rect(53, 0, 1, 64, 0xb5ab98);
    p.rect(15, 6, 34, 40, 0x26384f, 0.15);
    p.rect(31, 6, 2, 40, 0x8c826f);
    for (let k = 0; k < 8; k++) p.set(18 + k, 9 + k * 3, 0x6d8aa8);
    p.rect(15, 48, 34, 14, 0xa79e8c, 0.05);
    for (let x = 0; x < 34; x++) {
      const y = 48 + Math.abs(((x % 8) - 4)) + 3;
      p.set(15 + x, y, 0x8c826f);
      p.set(15 + x, y + 4, 0x8c826f);
    }
    return p.texture();
  },
  modern() {
    const p = new Painter(64, 64, 15);
    p.fill(0x4a4f57, 0.05);
    p.rect(0, 14, 64, 30, 0x6d8fae, 0.1);
    for (let y = 14; y < 44; y++) {
      for (const x of [0, 16, 32, 48]) { p.set(x, y, 0x2f3338); p.set(x + 1, y, 0x2f3338); }
      const t = (y - 14) / 30;
      for (let x = 0; x < 64; x++) if (((x + y) % 23) === 0) p.set(x, y, 0xb5cde3 - Math.floor(t * 8));
    }
    p.rect(0, 44, 64, 2, 0x2f3338);
    p.rect(0, 12, 64, 2, 0x2f3338);
    return p.texture();
  },
  oscorp() {
    const p = new Painter(64, 64, 16);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 4; px++) {
        const f = 0.8 + p.rand() * 0.35;
        const c = p.rand() < 0.15 ? 0x9fe0be : 0x3e8f6a;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const g = 1.2 - y / 30;
          const r = ((c >> 16) & 255) * f * g, gg = ((c >> 8) & 255) * f * g, b = (c & 255) * f * g;
          p.set(px * 16 + x, py * 16 + y, (Math.min(255, r) << 16) | (Math.min(255, gg) << 8) | Math.min(255, b), 0.04);
        }
      }
    }
    for (let i = 0; i < 64; i++) for (const k of [0, 16, 32, 48]) { p.set(k, i, 0x1f3a2c); p.set(i, k, 0x1f3a2c); }
    return p.texture();
  },
  brownstone() {
    const p = new Painter(64, 64, 17);
    p.fill(0x7a4a36, 0.08);
    p.rect(0, 0, 64, 4, 0x5a3426, 0.05);
    for (let x = 0; x < 64; x += 4) p.rect(x, 4, 2, 2, 0x5a3426);
    windowA(p, 8, 12, 18, 38, 0xe6e0d0, 0x2a3242, 0x9a6a52);
    windowA(p, 38, 12, 18, 38, 0xe6e0d0, 0x2a3242, 0x9a6a52);
    return p.texture();
  },
  warehouse() {
    const p = new Painter(64, 64, 18);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) p.set(x, y, (x & 3) < 2 ? 0x7c8288 : 0x646a70, 0.08);
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(p.rand() * 60), y = Math.floor(p.rand() * 60);
      p.rect(x, y, 2 + Math.floor(p.rand() * 4), 2 + Math.floor(p.rand() * 3), 0x8a5a3a, 0.2);
    }
    p.rect(20, 4, 24, 10, 0x2b3038, 0.2);
    p.rect(31, 4, 2, 10, 0x50565c);
    return p.texture();
  },
  roof() {
    const p = new Painter(32, 32, 19);
    p.fill(0x6f6f6a, 0.25);
    for (let k = 0; k < 90; k++) p.set(p.rand() * 32, p.rand() * 32, p.rand() < 0.5 ? 0x4a4a46 : 0x8c8c86);
    return p.texture();
  },
  asphalt() {
    const p = new Painter(32, 32, 20);
    p.fill(0x3a3b3e, 0.18);
    for (let k = 0; k < 40; k++) p.set(p.rand() * 32, p.rand() * 32, 0x2c2d30);
    return p.texture();
  },
  lane() {
    // 4 blocks along the street x 14 blocks across.
    const p = new Painter(64, 224, 21);
    p.fill(0x3a3b3e, 0.18);
    p.rect(0, 108, 64, 2, 0xd9b43a, 0.1);
    p.rect(0, 114, 64, 2, 0xd9b43a, 0.1);
    p.rect(0, 54, 32, 2, 0xe2e2e2, 0.05);
    p.rect(0, 168, 32, 2, 0xe2e2e2, 0.05);
    p.rect(0, 0, 64, 3, 0x2b2c2f);
    p.rect(0, 221, 64, 3, 0x2b2c2f);
    return p.texture();
  },
  crosswalk() {
    const p = new Painter(16, 224, 22);
    for (let y = 0; y < 224; y++) for (let x = 0; x < 16; x++) {
      const band = Math.floor(y / 16) % 2 === 0 && y > 8 && y < 216;
      p.set(x, y, band ? 0xdedede : 0x3a3b3e, band ? 0.05 : 0.18);
    }
    return p.texture();
  },
  sidewalk() {
    const p = new Painter(32, 32, 23);
    p.fill(0xa9a9a4, 0.06);
    for (let i = 0; i < 32; i++) { p.set(i, 0, 0x8d8d88); p.set(i, 16, 0x8d8d88); p.set(0, i, 0x8d8d88); p.set(16, i, 0x8d8d88); }
    return p.texture();
  },
  curb() {
    const p = new Painter(16, 16, 24);
    p.fill(0x9b9b96, 0.08);
    return p.texture();
  },
  seawall() {
    const p = new Painter(16, 16, 25);
    p.fill(0x6d6a63, 0.15);
    for (let i = 0; i < 16; i++) { p.set(i, 7, 0x55524c); p.set(i, 15, 0x55524c); p.set(i < 8 ? 3 : 11, i, 0x55524c); }
    return p.texture();
  },
  grass() {
    const p = new Painter(16, 16, 26);
    p.fill(0x5d9b3a, 0.2);
    for (let k = 0; k < 30; k++) p.set(p.rand() * 16, p.rand() * 16, p.rand() < 0.5 ? 0x6fb046 : 0x4b8a2e);
    return p.texture();
  },
  dirt() {
    const p = new Painter(16, 16, 27);
    p.fill(0x8b6a45, 0.2);
    for (let k = 0; k < 20; k++) p.set(p.rand() * 16, p.rand() * 16, 0x6e5235);
    return p.texture();
  },
  water() {
    const p = new Painter(32, 32, 28);
    p.fill(0x2f6fb5, 0.12);
    for (let k = 0; k < 24; k++) {
      const x = Math.floor(p.rand() * 32), y = Math.floor(p.rand() * 32);
      p.rect(x, y, 3 + Math.floor(p.rand() * 4), 1, 0x5a95d6);
    }
    return p.texture();
  },
  planks() {
    const p = new Painter(16, 16, 29);
    p.fill(0x9a6b3c, 0.1);
    for (let y = 3; y < 16; y += 4) for (let x = 0; x < 16; x++) p.set(x, y, 0x6e4a28);
    for (let r = 0; r < 4; r++) p.set(((r * 5) % 16), r * 4 + 1, 0x6e4a28);
    return p.texture();
  },
  log() {
    const p = new Painter(16, 16, 30);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, (x % 4 === 0) ? 0x47311b : 0x5a3f24, 0.12);
    return p.texture();
  },
  leaves() {
    const p = new Painter(16, 16, 31);
    p.fill(0x3f8a2f, 0.3);
    for (let k = 0; k < 26; k++) p.set(p.rand() * 16, p.rand() * 16, 0x2a5e20);
    for (let k = 0; k < 10; k++) p.set(p.rand() * 16, p.rand() * 16, 0x5aa846);
    return p.texture();
  },
  metal() {
    const p = new Painter(16, 16, 32);
    p.fill(0x6f7c88, 0.06);
    p.rect(0, 0, 16, 1, 0x8d99a4);
    p.rect(0, 15, 16, 1, 0x4e5964);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) p.set(x, y, 0x4e5964);
    return p.texture();
  },
  girder() {
    const p = new Painter(16, 16, 33);
    p.fill(0x7d8a8c, 0.06);
    for (let i = 0; i < 16; i++) { p.set(i, i, 0x5d6a6c); p.set(15 - i, i, 0x5d6a6c); }
    p.rect(0, 0, 16, 1, 0x5d6a6c);
    p.rect(0, 15, 16, 1, 0x5d6a6c);
    return p.texture();
  },
  stone() {
    const p = new Painter(16, 16, 34);
    p.fill(0x8a8a8a, 0.15);
    for (let i = 0; i < 16; i++) { p.set(i, 5, 0x6e6e6e); p.set(i, 11, 0x6e6e6e); }
    for (const [x, y0] of [[4, 0], [11, 6], [7, 12]]) for (let y = y0; y < y0 + 5; y++) p.set(x, y, 0x6e6e6e);
    return p.texture();
  },
  plaza() {
    const p = new Painter(32, 32, 35);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const t = ((x >> 4) + (y >> 4)) & 1;
      p.set(x, y, t ? 0xb8b0a0 : 0xa49c8c, 0.05);
    }
    return p.texture();
  },
  darkroof() {
    const p = new Painter(16, 16, 36);
    p.fill(0x3a3330, 0.12);
    return p.texture();
  },
  tram() {
    const p = new Painter(32, 32, 37);
    p.fill(0xc0392b, 0.05);
    p.rect(2, 6, 28, 12, 0x223344, 0.1);
    for (const x of [9, 16, 23]) p.rect(x, 6, 1, 12, 0xd8d8d8);
    p.rect(0, 22, 32, 2, 0xf1c40f);
    return p.texture();
  },
  pumpkin() {
    const p = new Painter(8, 8, 38);
    p.fill(0xe07b1a, 0.1);
    p.pattern(0, 0, [
      '........',
      '.y....y.',
      '.yy..yy.',
      '........',
      '...yy...',
      '.y.yy.y.',
      '..yyyy..',
      '........',
    ], { y: 0xffe45c });
    return p.texture({ repeat: false, mip: false });
  },
};

const cache = {};
export function tex(name) {
  if (!cache[name]) cache[name] = BUILDERS[name]();
  return cache[name];
}

// Pixel sign: text on a coloured plate with a 1px border.
export function signTexture(text, { fg = 0xffffff, bg = 0x1b1b1b, border = null, scale = 1, pad = 2 } = {}) {
  const w = textWidth(text, scale) + pad * 2 + 2;
  const h = 7 * scale + pad * 2 + 2;
  const p = new Painter(w, h, 40);
  p.fill(bg);
  if (border !== null) {
    p.rect(0, 0, w, 1, border); p.rect(0, h - 1, w, 1, border);
    p.rect(0, 0, 1, h, border); p.rect(w - 1, 0, 1, h, border);
  }
  drawText(p, text, pad + 1, pad + 1, fg, scale);
  return { texture: toTexture(p.done(), { repeat: false, mip: false }), aspect: w / h };
}

// Billboards for the festival plaza. Fictional brands only.
export function billboardTexture(kind) {
  const p = new Painter(96, 48, 50 + kind.length);
  switch (kind) {
    case 'unity': {
      p.fill(0x1d2b6b);
      for (let k = 0; k < 40; k++) p.set(p.rand() * 96, p.rand() * 48, [0xffd23f, 0xff5a5a, 0x7ad7ff][k % 3]);
      drawText(p, 'UNITY', 18, 8, 0xffd23f, 2);
      drawText(p, 'FESTIVAL', 24, 28, 0xffffff, 1);
      drawText(p, 'TODAY', 33, 38, 0xff5a5a, 1);
      break;
    }
    case 'cola': {
      p.fill(0xc0182b);
      p.rect(8, 8, 10, 34, 0x3b1f12);
      p.rect(11, 4, 4, 6, 0x3b1f12);
      p.rect(8, 20, 10, 8, 0xffffff);
      drawText(p, 'BLOCK', 28, 10, 0xffffff, 2);
      drawText(p, 'COLA', 30, 28, 0xffe0e0, 2);
      break;
    }
    case 'bugle': {
      p.fill(0xf2efe6);
      p.rect(0, 0, 96, 14, 0x111111);
      drawText(p, 'DAILY BUGLE', 15, 4, 0xffffff, 1);
      drawText(p, 'HERO OR', 6, 20, 0x111111, 2);
      drawText(p, 'MENACE?', 6, 34, 0xb31313, 2);
      break;
    }
    case 'oscorp': {
      p.fill(0x0d2a1d);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 96; x++) if ((x + y) % 12 === 0) p.set(x, y, 0x184a33);
      drawText(p, 'OSCORP', 13, 10, 0x6dffb0, 2);
      drawText(p, 'BUILDING TOMORROW', 1, 32, 0xc8ffe2, 1);
      break;
    }
    case 'pizza': {
      p.fill(0xffd166);
      p.rect(6, 8, 30, 30, 0xd35400);
      p.rect(9, 11, 24, 24, 0xf4c542);
      for (const [x, y] of [[13, 15], [24, 14], [17, 25], [27, 27], [12, 30]]) p.rect(x, y, 4, 4, 0xb22222);
      drawText(p, 'PIXEL', 44, 12, 0x6b2d00, 1);
      drawText(p, 'PIZZA', 44, 22, 0x6b2d00, 1);
      drawText(p, '$1', 48, 33, 0xb22222, 1);
      break;
    }
    default:
      p.fill(0x333333);
  }
  return toTexture(p.done(), { repeat: false, mip: false });
}

// ---------------------------------------------------------------------------
// Night-time window glow. Each facade tile (64px = one 4x4-block bay) has its
// glass areas listed here; the glow texture covers 8x8 bays at 32px per bay
// and lights a random subset, so lit windows don't repeat building to building.
const PANELS = [];
for (let y = 0; y < 64; y += 16) for (let x = 0; x < 64; x += 16) PANELS.push([x + 1, y + 1, 14, 14]);
const GLASS = {
  brick: [[20, 12, 24, 36]],
  concrete: [[22, 11, 20, 40]],
  deco: [[15, 6, 34, 40]],
  modern: [[2, 14, 14, 30], [18, 14, 14, 30], [34, 14, 14, 30], [50, 14, 14, 30]],
  glass: PANELS,
  oscorp: PANELS,
  brownstone: [[10, 14, 14, 34], [40, 14, 14, 34]],
  warehouse: [[20, 4, 24, 10]],
};
const LIT = [0xffd27a, 0xffe2a8, 0xffc864, 0xfff0d0, 0xa8d8ff];

export function glowTexture(style) {
  const key = `glow-${style}`;
  if (cache[key]) return cache[key];
  const p = new Painter(256, 256, 900 + style.length);
  p.fill(0x000000);
  const chance = style === 'warehouse' ? 0.15 : style === 'glass' || style === 'oscorp' ? 0.3 : 0.45;
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      for (const [x, y, w, h] of GLASS[style] || []) {
        if (p.rand() > chance) continue;
        const col = LIT[Math.floor(p.rand() * LIT.length)];
        p.rect(bx * 32 + (x >> 1), by * 32 + (y >> 1), Math.max(1, w >> 1), Math.max(1, h >> 1), col, 0.15);
      }
    }
  }
  const t = p.texture();
  t.repeat.set(1 / 8, 1 / 8);
  cache[key] = t;
  return t;
}
