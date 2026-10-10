// Character skins painted face-by-face, Minecraft-skin style.
// Part sizes (in model pixels): head 8x8x8, body 8x12x4, arms/legs 4x12x4.
// Textures are painted at 2 texels per model pixel into one atlas per character.
import * as THREE from 'three';
import { Painter, makeCanvas, toTexture } from './textures.js';

const DIMS = {
  head: [16, 16, 16],
  body: [16, 24, 8],
  arm: [8, 24, 8],
  leg: [8, 24, 8],
};

// Face order matches BoxGeometry groups: +x (character's left), -x (right), +y, -y, +z (front), -z (back)
const FACE_NAMES = ['left', 'right', 'top', 'bottom', 'front', 'back'];

function faceSizes(kind) {
  const [w, h, d] = DIMS[kind];
  return [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
}

// Every character packs all six body parts into one atlas (one row per part)
// so a whole character renders with a single material.
const PART_ROWS = [['head', 'head'], ['body', 'body'], ['armL', 'arm'], ['armR', 'arm'], ['legL', 'leg'], ['legR', 'leg']];
export const ATLAS = (() => {
  const rows = {};
  let y = 0, W = 0;
  for (const [part, kind] of PART_ROWS) {
    let x = 0;
    const faces = faceSizes(kind).map(([fw, fh]) => {
      const f = { x, y, w: fw, h: fh };
      x += fw;
      return f;
    });
    rows[part] = { kind, faces };
    W = Math.max(W, x);
    y += Math.max(...faces.map((f) => f.h));
  }
  return { W, H: y, rows };
})();

function paintPart(ctx, part, painters, seed) {
  const { faces } = ATLAS.rows[part];
  faces.forEach((f, i) => {
    const p = new Painter(f.w, f.h, seed + i * 13);
    const name = FACE_NAMES[i];
    (painters[name] || painters.all)(p, name);
    ctx.drawImage(p.done(), f.x, f.y);
  });
}

const mul = (c, f) => {
  const r = Math.min(255, ((c >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((c >> 8) & 255) * f) | 0;
  const b = Math.min(255, (c & 255) * f) | 0;
  return (r << 16) | (g << 8) | b;
};

// Radial web: spokes from (cx, cy) plus concentric rings.
function isWeb(x, y, cx, cy, spacing = 3.4, spokes = 8, rot = 0.2) {
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const r = Math.hypot(dx, dy);
  if (r < 0.9) return false;
  const step = (Math.PI * 2) / spokes;
  let a = (Math.atan2(dy, dx) + rot) % step;
  if (a < 0) a += step;
  const da = Math.min(a, step - a);
  if (r * Math.sin(da) < 0.5) return true;
  return r % spacing < 0.62;
}

// Paint a suit face: base colours from regionFn, web lines darkened.
function suit(p, regionFn, cx, cy, opt = {}) {
  const { spacing = 3.4, spokes = 8, dark = 0.32, jit = 0.06 } = opt;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const base = regionFn(x, y);
      if (isWeb(x, y, cx, cy, spacing, spokes)) p.set(x, y, mul(base, dark));
      else p.set(x, y, base, jit);
    }
  }
}

const SPIDER = [
  'k..kk..k',
  '.k.kk.k.',
  '..kkkk..',
  'kkkkkkkk',
  '..kkkk..',
  '.k.kk.k.',
  'k..kk..k',
  '...kk...',
];

const LENS_EYES = [
  '.kkkk......kkkk.',
  'kwwwwk....kwwwwk',
  'kwwwwwk..kwwwwwk',
  '.kwwwwk..kwwwwk.',
  '..kwwwk..kwwwk..',
  '...kkk....kkk...',
];

function tear(p, seed, skin = 0xe0ac7e) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 3; k++) {
    const x = Math.floor(rnd() * (p.w - 4)) + 1;
    const y = Math.floor(rnd() * (p.h - 4)) + 1;
    p.rect(x, y, 2 + Math.floor(rnd() * 2), 2, skin);
    p.set(x - 1, y, 0x2a0505);
    p.set(x + 2, y + 2, 0x2a0505);
  }
}

// ---------------------------------------------------------------------------
// Spider-Man, classic 2002-film-inspired suit (raised webbing, blue flanks)
function classicSuit(damaged) {
  const RED = 0xb3121b, BOOT = 0x8f0e15, BLUE = 0x1f3f95, EYE = 0xdfe8ef, K = 0x101010;
  const finish = (p, seed) => { if (damaged) tear(p, seed); };
  return {
    head: {
      front: (p) => {
        suit(p, () => RED, 7.5, 9.5);
        p.pattern(0, 5, LENS_EYES, { k: K, w: EYE });
        p.set(2, 6, 0xffffff); p.set(11, 6, 0xffffff);
        if (damaged) { p.rect(10, 6, 4, 3, 0xe0ac7e); p.set(12, 7, 0x4a3020); p.set(11, 7, 0xffffff); }
      },
      back: (p) => suit(p, () => RED, 7.5, 8),
      left: (p) => suit(p, () => RED, 8, 10, { spokes: 6 }),
      right: (p) => suit(p, () => RED, 8, 10, { spokes: 6 }),
      top: (p) => suit(p, () => RED, 7.5, 7.5),
      bottom: (p) => p.fill(BOOT),
    },
    body: {
      front: (p) => {
        suit(p, (x, y) => {
          const bw = y < 4 ? 0 : y < 14 ? 2 : 3;
          return x < bw || x >= 16 - bw ? BLUE : RED;
        }, 7.5, -1);
        p.pattern(4, 6, SPIDER, { k: K });
        finish(p, 7);
      },
      back: (p) => {
        suit(p, (x, y) => {
          const bw = y < 4 ? 0 : y < 14 ? 2 : 3;
          return x < bw || x >= 16 - bw ? BLUE : RED;
        }, 7.5, 6);
        p.pattern(4, 7, SPIDER, { k: 0x6e080d });
      },
      left: (p) => suit(p, (x, y) => (y < 3 ? RED : BLUE), 4, -2),
      right: (p) => suit(p, (x, y) => (y < 3 ? RED : BLUE), 4, -2),
      top: (p) => suit(p, () => RED, 7.5, 4),
      bottom: (p) => p.fill(RED),
    },
    armL: armSuit(RED, BLUE, 'left', damaged),
    armR: armSuit(RED, BLUE, 'right', damaged),
    legL: legSuit(RED, BLUE, BOOT, 'left'),
    legR: legSuit(RED, BLUE, BOOT, 'right'),
  };
}

function armSuit(RED, BLUE, outer, damaged) {
  const glove = (y) => y >= 19;
  const f = (blueTop) => (p, name) => {
    suit(p, (x, y) => (blueTop && y < 12 ? BLUE : glove(y) ? mul(RED, 0.9) : RED), 3.5, -5, { spacing: 3.6 });
    if (damaged && name === 'front') tear(p, 31);
  };
  return {
    left: f(outer === 'left'),
    right: f(outer === 'right'),
    front: f(false),
    back: f(false),
    top: (p) => p.fill(RED, 0.05),
    bottom: (p) => p.fill(mul(RED, 0.85)),
  };
}

function legSuit(RED, BLUE, BOOT, outer) {
  const f = (blue) => (p) => {
    suit(p, (x, y) => (y >= 17 ? BOOT : blue && y < 16 ? BLUE : RED), 3.5, -6, { spacing: 3.6 });
    p.rect(0, 23, 8, 1, 0x2a0a0a);
  };
  return {
    left: f(outer === 'left'),
    right: f(outer === 'right'),
    front: f(false),
    back: f(true),
    top: (p) => p.fill(RED),
    bottom: (p) => p.fill(0x1a1a1a),
  };
}

// Spider-Man, homemade wrestling outfit (red sweatshirt, blue sweatpants)
function homemadeSuit() {
  const RED = 0xc0262d, BLUE = 0x2b4a9a, K = 0x161616, LENS = 0x9fc0d8;
  const cloth = (c) => (p) => p.fill(c, 0.16);
  const sketchy = (p, c) => {
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      p.set(x, y, isWeb(x, y, 7.5, 9, 5, 6, 0.5) ? 0x1d1d1d : c, 0.16);
    }
  };
  const sleeve = (p) => { p.fill(RED, 0.16); p.rect(0, 19, p.w, 5, K, 0.1); };
  const pants = (p) => { p.fill(BLUE, 0.16); p.rect(0, 20, p.w, 4, 0xa01c22, 0.1); };
  return {
    head: {
      front: (p) => {
        sketchy(p, RED);
        p.pattern(0, 5, [
          '.kkkkk....kkkkk.',
          '.kgggk....kgggk.',
          '.kgggkkkkkkgggk.',
          '.kgggk....kgggk.',
          '.kkkkk....kkkkk.',
        ], { k: K, g: LENS });
        p.set(2, 6, 0xffffff); p.set(11, 6, 0xffffff);
      },
      back: (p) => sketchy(p, RED),
      left: (p) => { sketchy(p, RED); p.rect(0, 7, 16, 1, K); },
      right: (p) => { sketchy(p, RED); p.rect(0, 7, 16, 1, K); },
      top: (p) => sketchy(p, RED),
      bottom: cloth(RED),
    },
    body: {
      front: (p) => {
        p.fill(RED, 0.16);
        p.pattern(3, 5, [
          'k...kk...k',
          '.k..kk..k.',
          '..kkkkkk..',
          'kkkkkkkkkk',
          '..kkkkkk..',
          '.k.kkkk.k.',
          'k...kk...k',
          '....kk....',
        ], { k: K });
        p.rect(0, 21, 16, 3, mul(RED, 0.8));
      },
      back: (p) => { p.fill(RED, 0.16); p.rect(0, 21, 16, 3, mul(RED, 0.8)); },
      left: cloth(RED), right: cloth(RED), top: cloth(RED), bottom: cloth(BLUE),
    },
    armL: { all: sleeve, top: cloth(RED), bottom: cloth(K) },
    armR: { all: sleeve, top: cloth(RED), bottom: cloth(K) },
    legL: { all: pants, top: cloth(BLUE), bottom: cloth(0x2a0a0a) },
    legR: { all: pants, top: cloth(BLUE), bottom: cloth(0x2a0a0a) },
  };
}

// The Green Goblin: armoured green suit, yellow eyes, bomb satchel.
function goblinSkin() {
  const G = 0x3f7d2a, GD = 0x2b5a1c, K = 0x0f1a0a, Y = 0xffd84a, T = 0xe8e8d0;
  const armour = (p) => {
    p.fill(G, 0.1);
    for (let y = 3; y < p.h; y += 5) p.rect(0, y, p.w, 1, GD);
  };
  return {
    head: {
      front: (p) => {
        p.fill(G, 0.1);
        p.rect(0, 0, 16, 3, GD);
        p.rect(7, 3, 2, 6, GD);
        p.pattern(0, 5, [
          '..kkk......kkk..',
          '.kyyyk....kyyyk.',
          '..kyyyk..kyyyk..',
          '...kkk....kkk...',
        ], { k: K, y: Y });
        p.pattern(0, 11, [
          '....kkkkkkkk....',
          '....ktktktkk....',
          '.....kkkkkk.....',
        ], { k: K, t: T });
      },
      back: (p) => { p.fill(G, 0.1); p.rect(6, 0, 4, 16, GD); },
      left: (p) => { p.fill(G, 0.1); p.pattern(2, 2, ['kk', 'kgk', '.kgk', '..kk'], { k: K, g: GD }); },
      right: (p) => { p.fill(G, 0.1); p.pattern(10, 2, ['..kk', '.kgk', 'kgk.', 'kk..'], { k: K, g: GD }); },
      top: (p) => { p.fill(G, 0.1); p.rect(6, 0, 4, 16, GD); },
      bottom: (p) => p.fill(GD),
    },
    body: {
      front: (p) => {
        armour(p);
        p.rect(2, 2, 5, 6, GD); p.rect(9, 2, 5, 6, GD);
        p.rect(3, 3, 3, 4, G); p.rect(10, 3, 3, 4, G);
        for (let k = 0; k < 16; k++) p.set(k, 4 + k, 0x5a3a20), p.set(k, 5 + k, 0x5a3a20);
        p.rect(0, 20, 16, 2, 0x4a2f63);
      },
      back: (p) => { armour(p); p.rect(4, 4, 8, 10, GD); },
      left: armour, right: armour, top: armour, bottom: (p) => p.fill(GD),
    },
    armL: { all: (p) => { armour(p); p.rect(0, 18, p.w, 6, GD); }, top: armour, bottom: (p) => p.fill(GD) },
    armR: { all: (p) => { armour(p); p.rect(0, 18, p.w, 6, GD); }, top: armour, bottom: (p) => p.fill(GD) },
    legL: { all: (p) => { armour(p); p.rect(0, 17, p.w, 7, GD); }, top: armour, bottom: (p) => p.fill(K) },
    legR: { all: (p) => { armour(p); p.rect(0, 17, p.w, 7, GD); }, top: armour, bottom: (p) => p.fill(K) },
  };
}

// Generic humans: thugs, civilians, Mary Jane.
function humanSkin(s) {
  const skin = s.skin ?? 0xd8a47f;
  const hair = s.hair ?? 0x3b2a1a;
  const shirt = s.shirt ?? 0x4a6fa5;
  const jacket = s.jacket ?? shirt;
  const pants = s.pants ?? 0x2f3b5a;
  const shoes = s.shoes ?? 0x222222;
  const hat = s.hat ?? null;
  const longHair = !!s.longHair;
  const mask = s.mask ?? null;

  const face = (p) => {
    p.fill(skin, 0.05);
    if (mask) {
      p.fill(mask, 0.12);
      p.rect(2, 7, 12, 4, skin);
      p.rect(5, 12, 6, 2, skin);
    }
    if (!mask) {
      p.rect(0, 0, 16, longHair ? 5 : 4, hair, 0.1);
      if (longHair) { p.rect(0, 5, 2, 9, hair, 0.1); p.rect(14, 5, 2, 9, hair, 0.1); }
      p.rect(3, 7, 3, 1, hair);
      p.rect(10, 7, 3, 1, hair);
    }
    p.rect(3, 8, 3, 2, 0xffffff); p.rect(10, 8, 3, 2, 0xffffff);
    p.rect(4, 8, 2, 2, s.eyes ?? 0x2a4a7a); p.rect(10, 8, 2, 2, s.eyes ?? 0x2a4a7a);
    if (!mask) p.rect(7, 10, 2, 2, mul(skin, 0.85));
    p.rect(6, 12, 4, 1, s.lips ?? mul(skin, 0.6));
    if (hat) { p.rect(0, 0, 16, 5, hat, 0.12); p.rect(0, 5, 16, 1, mul(hat, 0.7)); }
  };
  const side = (p) => {
    p.fill(mask || skin, 0.05);
    if (!mask) p.rect(0, 0, 16, longHair ? 14 : 5, hair, 0.1);
    if (!mask) p.rect(6, 8, 3, 3, mul(skin, 0.85));
    if (hat) p.rect(0, 0, 16, 6, hat, 0.12);
  };
  const back = (p) => {
    p.fill(mask || hair, 0.1);
    if (!mask && !longHair) p.rect(0, 11, 16, 5, skin, 0.05);
    if (hat) p.rect(0, 0, 16, 6, hat, 0.12);
  };
  const top = (p) => p.fill(hat || mask || hair, 0.1);

  const torso = (front) => (p) => {
    p.fill(jacket, 0.12);
    if (front && jacket !== shirt) p.rect(5, 0, 6, 20, shirt, 0.1);
    if (s.dress) p.rect(0, 16, p.w, 8, s.dress, 0.1);
    else { p.rect(0, 20, p.w, 4, pants, 0.1); p.rect(0, 20, p.w, 1, 0x1a1a1a); }
  };
  const arm = (p) => {
    p.fill(s.bareArms ? skin : jacket, s.bareArms ? 0.05 : 0.12);
    if (!s.bareArms && s.sleeve) p.rect(0, 0, p.w, s.sleeve, jacket, 0.12);
    p.rect(0, 20, p.w, 4, skin, 0.05);
  };
  const leg = (p) => {
    if (s.dress) { p.fill(skin, 0.05); p.rect(0, 0, p.w, 9, s.dress, 0.1); }
    else p.fill(pants, 0.12);
    p.rect(0, 21, p.w, 3, shoes, 0.1);
  };
  return {
    head: { front: face, left: side, right: side, back, top, bottom: (p) => p.fill(skin) },
    body: { front: torso(true), back: torso(false), left: torso(false), right: torso(false), top: (p) => p.fill(jacket), bottom: (p) => p.fill(pants) },
    armL: { all: arm, top: (p) => p.fill(jacket), bottom: (p) => p.fill(skin) },
    armR: { all: arm, top: (p) => p.fill(jacket), bottom: (p) => p.fill(skin) },
    legL: { all: leg, top: (p) => p.fill(pants), bottom: (p) => p.fill(shoes) },
    legR: { all: leg, top: (p) => p.fill(pants), bottom: (p) => p.fill(shoes) },
  };
}

export const HUMAN_SPECS = {
  thugA: { skin: 0xc68e6a, hair: 0x1d1d1d, jacket: 0x3d3d3d, shirt: 0x8a1c1c, pants: 0x34405e, hat: 0x111111 },
  thugB: { skin: 0x8d5a3b, hair: 0x111111, jacket: 0x5b4a2e, shirt: 0xdedede, pants: 0x2b2b2b, mask: 0x1a1a1a },
  brute: { skin: 0xd6a07a, hair: 0x6b3d1e, jacket: 0x2d4a2d, shirt: 0x2d4a2d, pants: 0x3b3b3b, hat: 0x2d2d2d, bareArms: true },
  burglar: { skin: 0xd2a07c, hair: 0x5a4632, jacket: 0x6b6b5e, shirt: 0x393939, pants: 0x3a3a46, hat: 0x2a2a2a },
  mj: { skin: 0xf0c6a8, hair: 0xb8331e, shirt: 0xe58aa0, jacket: 0xe58aa0, dress: 0xd46a86, shoes: 0xb3121b, longHair: true, bareArms: true, eyes: 0x3d6b3d, lips: 0xc0505a },
  civ0: { skin: 0xe2b58f, hair: 0x2b1d10, shirt: 0x2e8b57, pants: 0x3a3a3a },
  civ1: { skin: 0x9a6640, hair: 0x111111, shirt: 0xf0c419, jacket: 0x444f7a, pants: 0x222244 },
  civ2: { skin: 0xf1caa6, hair: 0xd9b45a, shirt: 0x8e44ad, pants: 0x5d6d7e, longHair: true },
  civ3: { skin: 0x6b4226, hair: 0x1a1a1a, shirt: 0xe67e22, pants: 0x2c3e50, hat: 0xc0392b },
};

const cache = new Map();
export function skinMaterials(key) {
  if (cache.has(key)) return cache.get(key);
  let spec;
  if (key === 'classic') spec = classicSuit(false);
  else if (key === 'damaged') spec = classicSuit(true);
  else if (key === 'homemade') spec = homemadeSuit();
  else if (key === 'goblin') spec = goblinSkin();
  else spec = humanSkin(HUMAN_SPECS[key] || HUMAN_SPECS.civ0);
  let seed = 100;
  for (const ch of key) seed += ch.charCodeAt(0);
  const canvas = makeCanvas(ATLAS.W, ATLAS.H);
  const ctx = canvas.getContext('2d');
  PART_ROWS.forEach(([part], k) => paintPart(ctx, part, spec[part], seed + k));
  const material = new THREE.MeshLambertMaterial({ map: toTexture(canvas, { repeat: false, mip: false }) });
  cache.set(key, material);
  return material;
}

export const SUITS = {
  classic: { name: 'Classic Suit', desc: 'Raised webbing, blue flanks. The real deal.' },
  homemade: { name: 'Homemade Suit', desc: 'Sweatshirt, goggles and a marker-pen spider. Stitched together for the wrestling ring.' },
  damaged: { name: 'Battle-Damaged Suit', desc: 'Torn up after the final fight on the bridge.' },
};
