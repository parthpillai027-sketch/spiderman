// Procedural voxel Manhattan: street grid, skyscrapers, park, festival plaza,
// warehouse district, the river, a suspension bridge and Queens beyond it.
// All static geometry is merged per material, and every solid volume is an
// axis-aligned box collider stored in a spatial hash.
import * as THREE from 'three';
import { tex, signTexture, billboardTexture, glowTexture } from './textures.js';
import { mulberry32, clamp, lerp } from './util.js';

export const N = 12;
export const CELL = 50;
export const STREET = 14;
export const BW = CELL - STREET;
export const X0 = -300;
export const Z0 = -300;
export const SIDEWALK_H = 0.3;
export const WATER_Y = -0.6;

const MANHATTAN = { x0: -316, x1: 316, z0: -316, z1: 316 };
const QUEENS = { x0: 440, x1: 660, z0: -260, z1: 260 };

// ---------------------------------------------------------------------------
class GeoBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.u = [];
    this.c = [];
    this.i = [];
  }
  quad(o, R, U, n, uw, vh, col, u0 = 0, v0 = 0) {
    const b = this.p.length / 3;
    this.p.push(
      o[0], o[1], o[2],
      o[0] + R[0], o[1] + R[1], o[2] + R[2],
      o[0] + R[0] + U[0], o[1] + R[1] + U[1], o[2] + R[2] + U[2],
      o[0] + U[0], o[1] + U[1], o[2] + U[2],
    );
    for (let k = 0; k < 4; k++) {
      this.n.push(n[0], n[1], n[2]);
      this.c.push(col[0], col[1], col[2]);
    }
    this.u.push(u0, v0, u0 + uw, v0, u0 + uw, v0 + vh, u0, v0 + vh);
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // faces: walls / top / bottom flags. su/sv = world units per texture tile.
  box(x0, y0, z0, x1, y1, z1, o = {}) {
    const { su = 4, sv = su, ts = su, col = [1, 1, 1], walls = true, top = true, bottom = false, u0 = 0, v0 = 0 } = o;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    if (walls) {
      this.quad([x1, y0, z1], [0, 0, -dz], [0, dy, 0], [1, 0, 0], dz / su, dy / sv, col, u0, v0);
      this.quad([x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0], dz / su, dy / sv, col, u0 + 1, v0);
      this.quad([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1], dx / su, dy / sv, col, u0 + 2, v0);
      this.quad([x1, y0, z0], [-dx, 0, 0], [0, dy, 0], [0, 0, -1], dx / su, dy / sv, col, u0 + 3, v0);
    }
    if (top) this.quad([x0, y1, z1], [dx, 0, 0], [0, 0, -dz], [0, 1, 0], dx / ts, dz / ts, col, x0 / ts, -z1 / ts);
    if (bottom) this.quad([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0], dx / ts, dz / ts, col);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const FACADES = ['brick', 'concrete', 'glass', 'deco', 'modern', 'oscorp', 'brownstone', 'warehouse'];

function makeMaterial(key) {
  const m = new THREE.MeshLambertMaterial({ map: tex(key), vertexColors: true });
  if (key === 'lane' || key === 'crosswalk') {
    m.polygonOffset = true;
    m.polygonOffsetFactor = key === 'lane' ? -1 : -2;
    m.polygonOffsetUnits = key === 'lane' ? -1 : -2;
  }
  if (FACADES.includes(key)) {
    // lit windows, faded in by the time-of-day system
    m.emissiveMap = glowTexture(key);
    m.emissive.setHex(0xffffff);
    m.emissiveIntensity = 0;
  }
  return m;
}

// ---------------------------------------------------------------------------
export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.grid = new Map();
    this.cellSize = 32;
    this._stamp = 0;
    this.buildings = [];
    this.parks = [];
    this.plazaRects = [];
    this.landmarks = {};
    this.lamps = [];
    this.G = {};
    this.rand = mulberry32(2002);
    this.dynamic = [];
    this.build();
  }

  // ---- spatial hash ------------------------------------------------------
  _key(cx, cz) {
    return (cx + 2000) * 5000 + (cz + 2000);
  }
  addCollider(x0, y0, z0, x1, y1, z1, extra = {}) {
    const c = { min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), stamp: 0, ...extra };
    this.colliders.push(c);
    const s = this.cellSize;
    for (let cx = Math.floor(x0 / s); cx <= Math.floor(x1 / s); cx++) {
      for (let cz = Math.floor(z0 / s); cz <= Math.floor(z1 / s); cz++) {
        const k = this._key(cx, cz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(c);
      }
    }
    return c;
  }
  removeCollider(c) {
    const s = this.cellSize;
    for (let cx = Math.floor(c.min.x / s); cx <= Math.floor(c.max.x / s); cx++) {
      for (let cz = Math.floor(c.min.z / s); cz <= Math.floor(c.max.z / s); cz++) {
        const arr = this.grid.get(this._key(cx, cz));
        if (arr) {
          const i = arr.indexOf(c);
          if (i >= 0) arr.splice(i, 1);
        }
      }
    }
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
  }
  query(x0, z0, x1, z1) {
    const s = this.cellSize;
    const st = ++this._stamp;
    const out = [];
    for (let cx = Math.floor(x0 / s); cx <= Math.floor(x1 / s); cx++) {
      for (let cz = Math.floor(z0 / s); cz <= Math.floor(z1 / s); cz++) {
        const arr = this.grid.get(this._key(cx, cz));
        if (!arr) continue;
        for (const c of arr) {
          if (c.stamp !== st) {
            c.stamp = st;
            out.push(c);
          }
        }
      }
    }
    return out;
  }

  isLand(x, z) {
    const inM = x >= MANHATTAN.x0 && x <= MANHATTAN.x1 && z >= MANHATTAN.z0 && z <= MANHATTAN.z1;
    const inQ = x >= QUEENS.x0 && x <= QUEENS.x1 && z >= QUEENS.z0 && z <= QUEENS.z1;
    return inM || inQ;
  }
  baseGround(x, z) {
    return this.isLand(x, z) ? 0 : -5;
  }
  groundHeight(x, z, fromY = 1e9) {
    let best = this.baseGround(x, z);
    for (const c of this.query(x, z, x, z)) {
      if (c.ghost) continue;
      if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z && c.max.y <= fromY + 0.05 && c.max.y > best) best = c.max.y;
    }
    return best;
  }
  pointInside(p, pad = 0) {
    for (const c of this.query(p.x, p.z, p.x, p.z)) {
      if (c.ghost) continue;
      if (p.x > c.min.x - pad && p.x < c.max.x + pad && p.y > c.min.y - pad && p.y < c.max.y + pad && p.z > c.min.z - pad && p.z < c.max.z + pad) return c;
    }
    return null;
  }

  // ---- physics: move an upright box (feet at pos) and resolve collisions ---
  moveBox(pos, vel, dt, hw, h, stepUp = 0.65) {
    const res = { ground: false, wall: null, ceiling: false, groundCollider: null };
    const dist = Math.hypot(vel.x, vel.y, vel.z) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.4));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      pos.x += vel.x * sdt;
      this._resolve(pos, vel, 0, hw, h, res, stepUp);
      pos.z += vel.z * sdt;
      this._resolve(pos, vel, 2, hw, h, res, stepUp);
      pos.y += vel.y * sdt;
      this._resolve(pos, vel, 1, hw, h, res, stepUp);
    }
    const base = this.baseGround(pos.x, pos.z);
    if (pos.y <= base) {
      pos.y = base;
      if (vel.y < 0) vel.y = 0;
      res.ground = true;
    }
    return res;
  }
  _resolve(pos, vel, axis, hw, h, res, stepUp) {
    const list = this.query(pos.x - hw, pos.z - hw, pos.x + hw, pos.z + hw);
    for (const c of list) {
      if (c.ghost) continue;
      const minx = pos.x - hw, maxx = pos.x + hw, miny = pos.y, maxy = pos.y + h, minz = pos.z - hw, maxz = pos.z + hw;
      if (maxx <= c.min.x || minx >= c.max.x || maxy <= c.min.y || miny >= c.max.y || maxz <= c.min.z || minz >= c.max.z) continue;
      if (axis === 1) {
        const down = vel.y < 0 || (vel.y === 0 && pos.y + h * 0.5 > (c.min.y + c.max.y) * 0.5);
        if (down) {
          pos.y = c.max.y;
          res.ground = true;
          res.groundCollider = c;
        } else {
          pos.y = c.min.y - h - 1e-3;
          res.ceiling = true;
        }
        vel.y = 0;
      } else {
        const rise = c.max.y - pos.y;
        if (rise > 0 && rise <= stepUp) {
          pos.y = c.max.y;
          continue;
        }
        const v = axis === 0 ? vel.x : vel.z;
        const center = axis === 0 ? pos.x : pos.z;
        const cmin = axis === 0 ? c.min.x : c.min.z;
        const cmax = axis === 0 ? c.max.x : c.max.z;
        const positive = v > 0 || (v === 0 && center < (cmin + cmax) * 0.5);
        const np = positive ? cmin - hw - 1e-3 : cmax + hw + 1e-3;
        if (axis === 0) { pos.x = np; vel.x = 0; } else { pos.z = np; vel.z = 0; }
        const n = new THREE.Vector3();
        if (axis === 0) n.x = positive ? -1 : 1; else n.z = positive ? -1 : 1;
        res.wall = { normal: n, collider: c };
      }
    }
  }

  // ---- ray cast against colliders + ground --------------------------------
  raycast(o, d, maxDist) {
    const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
    const list = this.query(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez));
    let best = maxDist, hit = null, nAxis = 1, nSign = 1;
    const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
    for (const c of list) {
      if (c.ghost) continue;
      const mn = [c.min.x, c.min.y, c.min.z], mx = [c.max.x, c.max.y, c.max.z];
      let tmin = 0, tmax = best, axis = -1, sign = 0, miss = false;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(da[a]) < 1e-9) {
          if (oa[a] < mn[a] || oa[a] > mx[a]) { miss = true; break; }
        } else {
          let t1 = (mn[a] - oa[a]) / da[a], t2 = (mx[a] - oa[a]) / da[a], s = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { miss = true; break; }
        }
      }
      if (miss || axis === -1) continue;
      if (tmin < best) { best = tmin; hit = c; nAxis = axis; nSign = sign; }
    }
    let groundHit = false;
    if (d.y < -1e-6) {
      const t = (this.baseGround(o.x, o.z) - o.y) / d.y;
      if (t >= 0 && t < best) { best = t; hit = null; groundHit = true; nAxis = 1; nSign = 1; }
    }
    if (!hit && !groundHit) return null;
    const normal = new THREE.Vector3();
    normal.setComponent(nAxis, nSign);
    return { dist: best, point: new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best), normal, collider: hit };
  }

  // Pick a web anchor ahead of and above the swinger.
  findSwingAnchor(pos, dir) {
    const desired = new THREE.Vector3(pos.x + dir.x * 20, pos.y + 22, pos.z + dir.z * 20);
    const list = this.query(desired.x - 36, desired.z - 36, desired.x + 36, desired.z + 36);
    let best = null, bestScore = Infinity;
    for (const c of list) {
      if (c.max.y < pos.y + 6 || c.noAnchor) continue;
      let px = clamp(desired.x, c.min.x, c.max.x);
      const py = clamp(desired.y, c.min.y, c.max.y);
      let pz = clamp(desired.z, c.min.z, c.max.z);
      if (px === desired.x && pz === desired.z) {
        // desired point is inside the footprint: snap to nearest wall facing us
        const opts = [
          [Math.abs(desired.x - c.min.x), 0, c.min.x], [Math.abs(c.max.x - desired.x), 0, c.max.x],
          [Math.abs(desired.z - c.min.z), 2, c.min.z], [Math.abs(c.max.z - desired.z), 2, c.max.z],
        ].sort((a, b) => a[0] - b[0]);
        if (opts[0][1] === 0) px = opts[0][2]; else pz = opts[0][2];
      }
      if (py < pos.y + 5) continue;
      const dx = px - pos.x, dy = py - pos.y, dz = pz - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 8 || d > 56) continue;
      const hd = Math.hypot(dx, dz) || 1;
      const ahead = (dx * dir.x + dz * dir.z) / hd;
      if (ahead < -0.1) continue;
      const score = Math.hypot(px - desired.x, py - desired.y, pz - desired.z) - ahead * 10;
      if (score < bestScore) {
        bestScore = score;
        best = new THREE.Vector3(px, py, pz);
      }
    }
    if (best) return best;
    if (pos.y < 170) return new THREE.Vector3(desired.x, Math.max(pos.y + 16, 26), desired.z);
    return null;
  }

  // ---- helpers for missions ---------------------------------------------
  intersection(i, j) {
    return new THREE.Vector3(X0 + i * CELL, 0, Z0 + j * CELL);
  }
  blockRect(i, j) {
    const x0 = X0 + i * CELL + STREET / 2, z0 = Z0 + j * CELL + STREET / 2;
    return { x0, z0, x1: x0 + BW, z1: z0 + BW, cx: x0 + BW / 2, cz: z0 + BW / 2 };
  }
  roofPoint(b) {
    const t = b.tiers[b.tiers.length - 1];
    return new THREE.Vector3((t[0] + t[2]) / 2, b.top, (t[1] + t[3]) / 2);
  }
  buildingAt(x, z) {
    return this.buildings.find((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) || null;
  }
  nearestBuilding(p, minH = 0, maxDist = Infinity, exclude = null) {
    let best = null, bd = maxDist;
    for (const b of this.buildings) {
      if (b.top < minH || b === exclude) continue;
      const d = Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.z0 + b.z1) / 2 - p.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  g(key) {
    return this.G[key] || (this.G[key] = new GeoBuilder());
  }

  build() {
    this.buildLand();
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) this.buildBlock(i, j);
    this.buildStreets();
    this.buildBridge();
    this.buildQueens();
    this.buildWater();
    this.flush();
    this.buildLamps();
    this.pickCollectibleSpots();
  }

  flush() {
    this.facadeMaterials = this.facadeMaterials || [];
    for (const [key, gb] of Object.entries(this.G)) {
      const mat = makeMaterial(key);
      if (FACADES.includes(key)) this.facadeMaterials.push(mat);
      const mesh = new THREE.Mesh(gb.build(), mat);
      mesh.receiveShadow = true;
      mesh.castShadow = FACADES.includes(key) || ['planks', 'log', 'leaves', 'metal', 'girder', 'stone', 'darkroof'].includes(key);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
    }
    this.G = {};
  }

  buildLand() {
    const { x0, x1, z0, z1 } = MANHATTAN;
    this.g('asphalt').box(x0, -6, z0, x1, 0, z1, { walls: false, ts: 2 });
    this.g('seawall').box(x0, -6, z0, x1, 0, z1, { top: false, su: 2 });
    const q = QUEENS;
    this.g('asphalt').box(q.x0, -6, q.z0, q.x1, 0, q.z1, { walls: false, ts: 2 });
    this.g('seawall').box(q.x0, -6, q.z0, q.x1, 0, q.z1, { top: false, su: 2 });
  }

  blockType(i, j) {
    if (i >= 4 && i <= 5 && j >= 1 && j <= 3) return 'park';
    if (i === 6 && j === 5) return 'plaza';
    if (i >= 8 && j >= 9) return 'warehouse';
    if (i <= 1) return 'lowrise';
    return 'city';
  }

  heightFor(i, j) {
    const r = this.rand;
    const d = Math.hypot(i - 6.2, j - 5.8);
    const base = 120 * Math.exp((-d * d) / 16) + 22;
    const h = base * (0.55 + r() * 0.9);
    return clamp(Math.round(h / 4) * 4, 12, 160);
  }

  buildBlock(i, j) {
    const r = this.rand;
    const B = this.blockRect(i, j);
    const type = this.blockType(i, j);
    const surface = type === 'park' ? 'grass' : type === 'plaza' ? 'plaza' : 'sidewalk';
    this.g(surface).box(B.x0, 0, B.z0, B.x1, SIDEWALK_H, B.z1, { walls: false, ts: surface === 'grass' ? 1 : 2 });
    this.g('curb').box(B.x0, 0, B.z0, B.x1, SIDEWALK_H, B.z1, { top: false, su: 1 });
    this.addCollider(B.x0, 0, B.z0, B.x1, SIDEWALK_H, B.z1, { ground: true, noAnchor: true });
    this.lamps.push([B.x0 + 0.8, B.z0 + 0.8], [B.x1 - 0.8, B.z0 + 0.8], [B.x0 + 0.8, B.z1 - 0.8], [B.x1 - 0.8, B.z1 - 0.8]);
    this.lamps.push([B.cx, B.z0 + 0.8], [B.cx, B.z1 - 0.8], [B.x0 + 0.8, B.cz], [B.x1 - 0.8, B.cz]);

    const A = { x0: B.x0 + 2.5, z0: B.z0 + 2.5, x1: B.x1 - 2.5, z1: B.z1 - 2.5 };
    const full = [A.x0, A.z0, A.x1, A.z1];
    const key = `${i},${j}`;

    if (type === 'park') return this.buildPark(B, i, j);
    if (type === 'plaza') return this.buildPlaza(B);

    if (key === '8,3') {
      const b = this.addBuilding(full, 148, 'oscorp', { tiers: [[0, 112], [3, 136], [7, 148]], tint: [1, 1, 1] });
      this.landmarks.oscorp = b;
      const s = signTexture('OSCORP', { fg: 0x7dffb8, bg: 0x0c2418, border: 0x2f8f5f });
      const y = SIDEWALK_H + 104;
      const cx = (A.x0 + A.x1) / 2, cz = (A.z0 + A.z1) / 2;
      this.addSign(s.texture, cx, y, A.z1 + 0.06, 18, 18 / s.aspect, 'z', 1);
      this.addSign(s.texture, cx, y, A.z0 - 0.06, 18, 18 / s.aspect, 'z', -1);
      this.addSign(s.texture, A.x1 + 0.06, y, cz, 18, 18 / s.aspect, 'x', 1);
      this.addSign(s.texture, A.x0 - 0.06, y, cz, 18, 18 / s.aspect, 'x', -1);
      return;
    }
    if (key === '5,7') {
      const b = this.addBuilding(full, 100, 'deco', { tiers: [[0, 80], [3, 92], [6, 100]], tint: [1, 0.97, 0.92] });
      this.landmarks.bugle = b;
      const t = b.tiers[2];
      const cx = (t[0] + t[2]) / 2, cz = (t[1] + t[3]) / 2;
      for (const sx of [-8, 8]) {
        this.g('metal').box(cx + sx - 0.3, b.top, cz - 0.3, cx + sx + 0.3, b.top + 9, cz + 0.3, { su: 1 });
      }
      const s = signTexture('DAILY BUGLE', { fg: 0x111111, bg: 0xf2efe6, border: 0x111111 });
      this.addSign(s.texture, cx, b.top + 6, cz, 22, 22 / s.aspect, 'z', 1, true);
      this.addCollider(cx - 11, b.top + 4, cz - 0.3, cx + 11, b.top + 8, cz + 0.3, { prop: true });
      return;
    }
    if (key === '6,8') {
      const b = this.addBuilding(full, 176, 'deco', { tiers: [[0, 104], [4, 148], [8, 176]], tint: [1, 0.98, 0.94] });
      this.landmarks.empire = b;
      const cx = (A.x0 + A.x1) / 2, cz = (A.z0 + A.z1) / 2;
      this.g('deco').box(cx - 3, b.top, cz - 3, cx + 3, b.top + 12, cz + 3, { col: [1, 0.98, 0.94] });
      this.addCollider(cx - 3, b.top, cz - 3, cx + 3, b.top + 12, cz + 3, { prop: true });
      this.g('metal').box(cx - 0.4, b.top + 12, cz - 0.4, cx + 0.4, b.top + 34, cz + 0.4, { su: 1 });
      this.addCollider(cx - 0.4, b.top + 12, cz - 0.4, cx + 0.4, b.top + 34, cz + 0.4, { prop: true });
      return;
    }
    if (key === '3,7') {
      const b = this.addBuilding(full, 56, 'brick', { tiers: [[0, 56]], tint: [0.95, 0.9, 0.88], noProps: true });
      this.landmarks.burning = b;
      // balconies on the south face where trapped civilians will wait
      b.ledges = [];
      const z = A.z1;
      for (const [x, fl] of [[A.x0 + 6, 3], [A.x1 - 8, 6], [A.x0 + 15, 10]]) {
        const y = SIDEWALK_H + fl * 4;
        this.g('stone').box(x - 1.6, y - 0.4, z, x + 1.6, y, z + 1.6, { su: 1, bottom: true });
        this.g('metal').box(x - 1.6, y, z + 1.45, x + 1.6, y + 1.0, z + 1.6, { su: 1 });
        this.addCollider(x - 1.6, y - 0.4, z, x + 1.6, y, z + 1.6, { prop: true });
        b.ledges.push(new THREE.Vector3(x, y, z + 0.8));
      }
      b.ledges.push(this.roofPoint(b).add(new THREE.Vector3(6, 0, 4)));
      return;
    }
    if (type === 'warehouse') {
      const wh = 8 + Math.floor(r() * 3) * 2;
      if (key === '9,10') {
        const b = this.addBuilding([A.x0, A.z0, A.x1, A.z0 + 14], 12, 'warehouse', { tiers: [[0, 12]], noProps: true });
        this.landmarks.warehouse = new THREE.Vector3(B.cx, SIDEWALK_H, A.z0 + 22);
        this.landmarks.warehouseBuilding = b;
        this.addCrates(A.x0 + 2, A.z0 + 17, A.x1 - 2, A.z1 - 2, 6);
        return;
      }
      if (r() < 0.5) {
        this.addBuilding(full, wh, 'warehouse', { tiers: [[0, wh]], noProps: true });
      } else {
        const m = lerp(A.z0, A.z1, 0.55);
        this.addBuilding([A.x0, A.z0, A.x1, m], wh, 'warehouse', { tiers: [[0, wh]], noProps: true });
        this.addCrates(A.x0 + 1, m + 2, A.x1 - 1, A.z1 - 1, 4);
      }
      return;
    }

    // generic lots
    const lots = [];
    const sr = r();
    if (sr < 0.22) lots.push(full);
    else if (sr < 0.55) {
      if (r() < 0.5) {
        const m = lerp(A.x0, A.x1, 0.4 + r() * 0.2);
        lots.push([A.x0, A.z0, m, A.z1], [m, A.z0, A.x1, A.z1]);
      } else {
        const m = lerp(A.z0, A.z1, 0.4 + r() * 0.2);
        lots.push([A.x0, A.z0, A.x1, m], [A.x0, m, A.x1, A.z1]);
      }
    } else {
      const mx = lerp(A.x0, A.x1, 0.4 + r() * 0.2);
      const mz = lerp(A.z0, A.z1, 0.4 + r() * 0.2);
      lots.push([A.x0, A.z0, mx, mz], [mx, A.z0, A.x1, mz], [A.x0, mz, mx, A.z1], [mx, mz, A.x1, A.z1]);
    }
    const lowrise = type === 'lowrise';
    let startCandidate = null;
    for (const lot of lots) {
      let h = lowrise ? 12 + Math.floor(r() * 3) * 4 : this.heightFor(i, j);
      let style;
      if (lowrise) style = r() < 0.7 ? 'brownstone' : 'brick';
      else if (h > 90) style = ['glass', 'deco', 'modern', 'glass'][Math.floor(r() * 4)];
      else style = ['brick', 'concrete', 'deco', 'modern', 'brick', 'concrete'][Math.floor(r() * 6)];
      if (key === '1,6' && !startCandidate) h = 20;
      const b = this.addBuilding(lot, h, style, {});
      if (key === '1,6' && !startCandidate) startCandidate = b;
    }
    if (startCandidate) {
      this.landmarks.startBuilding = startCandidate;
      this.landmarks.start = this.roofPoint(startCandidate);
    }
  }

  addBuilding(lot, h, style, opts) {
    const r = this.rand;
    const [x0, z0, x1, z1] = lot;
    const base = SIDEWALK_H;
    const tv = 0.82 + r() * 0.26;
    const tint = opts.tint || [tv * (0.97 + r() * 0.06), tv, tv * (0.95 + r() * 0.08)];
    let tiers;
    if (opts.tiers) {
      tiers = opts.tiers.map(([inset, th]) => [x0 + inset, z0 + inset, x1 - inset, z1 - inset, th]);
    } else if (h >= 60 && x1 - x0 > 13 && z1 - z0 > 13 && r() < 0.5) {
      const q = (v) => Math.max(8, Math.round(v / 4) * 4);
      tiers = [[x0, z0, x1, z1, q(h * 0.62)], [x0 + 3, z0 + 3, x1 - 3, z1 - 3, q(h * 0.84)], [x0 + 6, z0 + 6, x1 - 6, z1 - 6, h]];
    } else {
      tiers = [[x0, z0, x1, z1, h]];
    }
    // integer tile offsets keep windows aligned but vary the night-time glow pattern
    const u0 = Math.floor(r() * 8), vOff = Math.floor(r() * 8);
    let yb = base;
    for (const t of tiers) {
      const yt = base + t[4];
      this.g(style).box(t[0], yb, t[1], t[2], yt, t[3], { top: false, su: 4, sv: 4, col: tint, u0, v0: (yb - base) / 4 + vOff });
      this.g('roof').box(t[0], yt, t[1], t[2], yt, t[3], { walls: false, ts: 2 });
      this.addCollider(t[0], yb === base ? 0 : yb, t[1], t[2], yt, t[3], { building: true });
      yb = yt;
    }
    const b = { x0, z0, x1, z1, top: base + h, style, tiers, id: this.buildings.length };
    this.buildings.push(b);
    if (!opts.noProps) this.roofProps(b);
    return b;
  }

  roofProps(b) {
    const r = this.rand;
    const t = b.tiers[b.tiers.length - 1];
    const w = t[2] - t[0], d = t[3] - t[1];
    const y = b.top;
    if (b.top < 100 && w > 9 && d > 9 && r() < 0.42) {
      this.waterTower(t[0] + 2.5 + r() * (w - 9), y, t[1] + 2.5 + r() * (d - 9));
    }
    const nac = Math.floor(r() * 3);
    for (let k = 0; k < nac && w > 6 && d > 6; k++) {
      const x = t[0] + 1 + r() * (w - 4), z = t[1] + 1 + r() * (d - 4);
      this.g('metal').box(x, y, z, x + 2, y + 1.2, z + 1.5, { su: 1 });
      this.addCollider(x, y, z, x + 2, y + 1.2, z + 1.5, { prop: true, noAnchor: true });
    }
    if (w > 8 && d > 8 && r() < 0.35) {
      const x = t[0] + 1.5, z = t[3] - 4.5;
      this.g('stone').box(x, y, z, x + 3, y + 3, z + 3, { su: 1 });
      this.addCollider(x, y, z, x + 3, y + 3, z + 3, { prop: true });
    }
    if (b.top > 110 && r() < 0.6) {
      const cx = (t[0] + t[2]) / 2, cz = (t[1] + t[3]) / 2;
      this.g('metal').box(cx - 0.3, y, cz - 0.3, cx + 0.3, y + 16, cz + 0.3, { su: 1 });
      this.addCollider(cx - 0.3, y, cz - 0.3, cx + 0.3, y + 16, cz + 0.3, { prop: true });
    }
  }

  waterTower(x, y, z) {
    for (const [dx, dz] of [[0, 0], [2.8, 0], [0, 2.8], [2.8, 2.8]]) {
      this.g('log').box(x + dx, y, z + dz, x + dx + 0.4, y + 3, z + dz + 0.4, { su: 1 });
    }
    this.g('planks').box(x - 0.2, y + 3, z - 0.2, x + 3.4, y + 3.3, z + 3.4, { su: 1, bottom: true });
    this.g('planks').box(x, y + 3.3, z, x + 3.2, y + 6.9, z + 3.2, { su: 1 });
    this.g('darkroof').box(x - 0.1, y + 6.9, z - 0.1, x + 3.3, y + 7.5, z + 3.3, { su: 1 });
    this.g('darkroof').box(x + 0.5, y + 7.5, z + 0.5, x + 2.7, y + 8.1, z + 2.7, { su: 1 });
    this.g('darkroof').box(x + 1.1, y + 8.1, z + 1.1, x + 2.1, y + 8.6, z + 2.1, { su: 1 });
    this.addCollider(x - 0.2, y + 3, z - 0.2, x + 3.4, y + 7.5, z + 3.4, { prop: true, waterTower: true });
  }

  addCrates(x0, z0, x1, z1, n) {
    const r = this.rand;
    for (let k = 0; k < n; k++) {
      const x = lerp(x0, x1 - 2, r()), z = lerp(z0, z1 - 2, r());
      if (r() < 0.4) {
        const len = 6, col = [[0.8, 0.3, 0.25], [0.3, 0.45, 0.75], [0.35, 0.6, 0.35]][k % 3];
        const xe = Math.min(x + len, x1);
        this.g('metal').box(x, SIDEWALK_H, z, xe, SIDEWALK_H + 2.6, z + 2.4, { su: 1, col });
        this.addCollider(x, SIDEWALK_H, z, xe, SIDEWALK_H + 2.6, z + 2.4, { prop: true });
      } else {
        const s = 1.2 + r() * 0.6;
        this.g('planks').box(x, SIDEWALK_H, z, x + s, SIDEWALK_H + s, z + s, { su: 1 });
        this.addCollider(x, SIDEWALK_H, z, x + s, SIDEWALK_H + s, z + s, { prop: true, noAnchor: true });
      }
    }
  }

  tree(x, z, y0 = SIDEWALK_H, scale = 1, collide = true) {
    const th = (4 + this.rand() * 3) * scale;
    this.g('log').box(x - 0.5, y0, z - 0.5, x + 0.5, y0 + th, z + 0.5, { su: 1 });
    const L = 2.5 * scale;
    this.g('leaves').box(x - L, y0 + th - 1, z - L, x + L, y0 + th + 2.2 * scale, z + L, { su: 1, bottom: true });
    const L2 = 1.5 * scale;
    this.g('leaves').box(x - L2, y0 + th + 2.2 * scale, z - L2, x + L2, y0 + th + 3.4 * scale, z + L2, { su: 1 });
    if (collide) {
      this.addCollider(x - 0.5, y0, z - 0.5, x + 0.5, y0 + th, z + 0.5, { prop: true, noAnchor: true });
      this.addCollider(x - L, y0 + th - 1, z - L, x + L, y0 + th + 2.2 * scale, z + L, { prop: true, tree: true });
    }
  }

  buildPark(B, i, j) {
    const r = this.rand;
    this.parks.push(B);
    const placed = [];
    const n = 7 + Math.floor(r() * 5);
    const pond = i === 4 && j === 2;
    for (let k = 0; k < n * 3 && placed.length < n; k++) {
      const x = lerp(B.x0 + 3, B.x1 - 3, r()), z = lerp(B.z0 + 3, B.z1 - 3, r());
      if (Math.abs(x - B.cx) < 2 || Math.abs(z - B.cz) < 2) continue;
      if (pond && Math.hypot(x - B.cx, z - B.cz) < 12) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 7)) continue;
      placed.push([x, z]);
      this.tree(x, z, SIDEWALK_H, 1 + r() * 0.4);
    }
    // footpaths
    this.g('dirt').box(B.cx - 1.5, SIDEWALK_H, B.z0, B.cx + 1.5, SIDEWALK_H + 0.02, B.z1, { walls: false, ts: 1 });
    this.g('dirt').box(B.x0, SIDEWALK_H, B.cz - 1.5, B.x1, SIDEWALK_H + 0.03, B.cz + 1.5, { walls: false, ts: 1 });
    if (pond) {
      this.g('water').box(B.cx - 9, SIDEWALK_H, B.cz - 7, B.cx + 9, SIDEWALK_H + 0.05, B.cz + 7, { walls: false, ts: 2 });
      this.g('stone').box(B.cx - 10, SIDEWALK_H, B.cz - 8, B.cx + 10, SIDEWALK_H + 0.4, B.cz - 7, { su: 1 });
      this.g('stone').box(B.cx - 10, SIDEWALK_H, B.cz + 7, B.cx + 10, SIDEWALK_H + 0.4, B.cz + 8, { su: 1 });
    }
  }

  buildPlaza(B) {
    this.plazaRects.push(B);
    const cx = B.cx, cz = B.cz, y = SIDEWALK_H;
    this.landmarks.plaza = new THREE.Vector3(cx, y, cz);
    // stage on the north edge
    this.g('stone').box(cx - 9, y, B.z0 + 3, cx + 9, y + 2, B.z0 + 11, { su: 1, top: false });
    this.g('planks').box(cx - 9, y + 2, B.z0 + 3, cx + 9, y + 2, B.z0 + 11, { walls: false, ts: 1 });
    this.addCollider(cx - 9, y, B.z0 + 3, cx + 9, y + 2, B.z0 + 11, { prop: true });
    for (const sx of [-9, 9]) {
      this.g('metal').box(cx + sx - 0.4, y + 2, B.z0 + 3, cx + sx + 0.4, y + 14, B.z0 + 3.8, { su: 1 });
    }
    this.g('metal').box(cx - 9.4, y + 14, B.z0 + 3, cx + 9.4, y + 15, B.z0 + 3.8, { su: 1 });
    this.addCollider(cx - 9.4, y + 2, B.z0 + 3, cx + 9.4, y + 15, B.z0 + 3.8, { prop: true });
    this.addSign(billboardTexture('unity'), cx, y + 9, B.z0 + 3.9, 16, 8, 'z', 1);
    // billboards on poles around the plaza, facing the centre
    const boards = [
      ['cola', B.x0 + 2, cz, 'x', 1],
      ['bugle', B.x1 - 2, cz, 'x', -1],
      ['oscorp', cx - 8, B.z1 - 2, 'z', -1],
      ['pizza', cx + 8, B.z1 - 2, 'z', -1],
    ];
    for (const [kind, x, z, ax, dir] of boards) {
      const ox = ax === 'x' ? 0 : 4, oz = ax === 'z' ? 0 : 4;
      for (const s of [-1, 1]) {
        this.g('metal').box(x + s * ox - 0.3, y, z + s * oz - 0.3, x + s * ox + 0.3, y + 13, z + s * oz + 0.3, { su: 1 });
      }
      const sx = ax === 'x' ? 0.4 : 6, sz = ax === 'z' ? 0.4 : 6;
      this.g('metal').box(x - sx, y + 8, z - sz, x + sx, y + 14, z + sz, { su: 1 });
      this.addCollider(x - sx, y + 8, z - sz, x + sx, y + 14, z + sz, { prop: true });
      this.addSign(billboardTexture(kind), x + (ax === 'x' ? dir * 0.45 : 0), y + 11, z + (ax === 'z' ? dir * 0.45 : 0), 11.6, 5.8, ax, dir);
    }
    // festival balloons
    this.landmarks.balloons = [];
    const cols = [[1, 0.35, 0.35], [0.4, 0.7, 1], [1, 0.85, 0.3]];
    [[-10, 24, 6], [8, 28, -4], [2, 33, 10]].forEach(([dx, by, dz], k) => {
      const bx = cx + dx, bz = cz + dz;
      this.g('stone').box(bx - 2.5, by, bz - 2.5, bx + 2.5, by + 5, bz + 2.5, { su: 1, col: cols[k], bottom: true });
      this.g('stone').box(bx - 1.5, by + 5, bz - 1.5, bx + 1.5, by + 6.2, bz + 1.5, { su: 1, col: cols[k] });
      this.g('stone').box(bx - 0.6, by - 1, bz - 0.6, bx + 0.6, by, bz + 0.6, { su: 1, col: cols[k], bottom: true });
      this.g('log').box(bx - 0.05, y, bz - 0.05, bx + 0.05, by - 1, bz + 0.05, { su: 1, top: false });
      this.addCollider(bx - 2.5, by, bz - 2.5, bx + 2.5, by + 5, bz + 2.5, { prop: true });
      this.landmarks.balloons.push(new THREE.Vector3(bx, by + 5, bz));
    });
  }

  addSign(texture, x, y, z, w, h, axis, dir, doubleSided = false) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide }),
    );
    m.position.set(x, y, z);
    m.rotation.y = axis === 'z' ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.scene.add(m);
    return m;
  }

  buildStreets() {
    const y = 0.02;
    for (let line = 0; line <= N; line++) {
      const c = X0 + line * CELL;
      for (let s = 0; s < N; s++) {
        const a = X0 + s * CELL + STREET / 2, len = BW;
        // street running along x at z = c
        this.g('lane').quad([a, y, c + 7], [len, 0, 0], [0, 0, -14], [0, 1, 0], len / 4, 1, [1, 1, 1]);
        this.g('crosswalk').quad([a, y + 0.01, c + 7], [3, 0, 0], [0, 0, -14], [0, 1, 0], 3, 1, [1, 1, 1]);
        this.g('crosswalk').quad([a + len - 3, y + 0.01, c + 7], [3, 0, 0], [0, 0, -14], [0, 1, 0], 3, 1, [1, 1, 1]);
        // street running along z at x = c
        this.g('lane').quad([c - 7, y, a], [0, 0, len], [14, 0, 0], [0, 1, 0], len / 4, 1, [1, 1, 1]);
        this.g('crosswalk').quad([c - 7, y + 0.01, a], [0, 0, 3], [14, 0, 0], [0, 1, 0], 3, 1, [1, 1, 1]);
        this.g('crosswalk').quad([c - 7, y + 0.01, a + len - 3], [0, 0, 3], [14, 0, 0], [0, 1, 0], 3, 1, [1, 1, 1]);
      }
    }
  }

  buildBridge() {
    const deckY = 26, x0 = 304, x1 = 462, towers = [345, 421];
    this.g('girder').box(x0, deckY - 4, -7, x1, deckY, 7, { su: 1, top: false, bottom: true });
    this.g('lane').quad([x0, deckY + 0.01, 7], [x1 - x0, 0, 0], [0, 0, -14], [0, 1, 0], (x1 - x0) / 4, 1, [1, 1, 1]);
    this.addCollider(x0, deckY - 4, -7, x1, deckY, 7, { bridge: true, noAnchor: true });
    for (const s of [-1, 1]) {
      this.g('girder').box(x0, deckY, s * 7 - 0.3, x1, deckY + 1.2, s * 7 + 0.3, { su: 1 });
    }
    // anchorages
    this.g('stone').box(304, 0, -8, 316, deckY - 4, 8, { su: 2 });
    this.addCollider(304, 0, -8, 316, deckY - 4, 8, { noAnchor: true });
    this.g('stone').box(450, 0, -8, 462, deckY - 4, 8, { su: 2 });
    this.addCollider(450, 0, -8, 462, deckY - 4, 8, { noAnchor: true });
    // towers
    const top = 76;
    for (const tx of towers) {
      this.g('stone').box(tx - 4, -6, -12, tx + 4, 0.5, 12, { su: 2 });
      this.addCollider(tx - 4, -6, -12, tx + 4, 0.5, 12, {});
      for (const s of [-1, 1]) {
        const z0 = s < 0 ? -10.5 : 7.5, z1 = z0 + 3;
        this.g('girder').box(tx - 1.5, 0.5, z0, tx + 1.5, top, z1, { su: 1 });
        this.addCollider(tx - 1.5, 0.5, z0, tx + 1.5, top, z1, { tower: true });
      }
      for (const yb of [deckY - 4, 50, top - 3]) {
        this.g('girder').box(tx - 1.5, yb, -10.5, tx + 1.5, yb + 2.5, 10.5, { su: 1, bottom: true });
        if (yb > deckY) this.addCollider(tx - 1.5, yb, -10.5, tx + 1.5, yb + 2.5, 10.5, { tower: true });
      }
    }
    // voxel suspension cables + hangers
    const cable = (xa, ya, xb, yb, sag) => {
      const n = Math.ceil(Math.abs(xb - xa) / 1.4);
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        pts.push([lerp(xa, xb, t), lerp(ya, yb, t) - sag * 4 * t * (1 - t)]);
      }
      return pts;
    };
    const spans = [
      cable(x0 + 6, deckY + 1, towers[0], top, -6),
      cable(towers[0], top, towers[1], top, 38),
      cable(towers[1], top, x1 - 6, deckY + 1, -6),
    ];
    for (const s of [-1, 1]) {
      const z = s * 9;
      for (const span of spans) {
        span.forEach(([x, y], k) => {
          this.g('metal').box(x - 0.35, y - 0.35, z - 0.35, x + 0.35, y + 0.35, z + 0.35, { su: 1, bottom: true });
          if (k % 3 === 0 && y > deckY + 2) this.g('metal').box(x - 0.08, deckY + 1.2, z - 0.08, x + 0.08, y, z + 0.08, { su: 1, top: false });
        });
      }
    }
    // invisible anchor volumes so you can swing above the river
    for (let x = x0 + 20; x < x1 - 10; x += 22) this.addCollider(x - 1, deckY + 18, -9.5, x + 1, deckY + 26, 9.5, { ghost: true, anchorOnly: true });
    this.landmarks.bridge = { deckY, x0, x1, towers, top, mid: new THREE.Vector3((towers[0] + towers[1]) / 2, deckY, 0) };
  }

  buildQueens() {
    const r = this.rand;
    for (let x = 470; x + 30 < QUEENS.x1 - 4; x += 42) {
      for (let z = -248; z + 30 < QUEENS.z1 - 4; z += 42) {
        if (Math.abs(z + 15) < 30 && x < 520) continue;
        this.g('sidewalk').box(x, 0, z, x + 30, SIDEWALK_H, z + 30, { walls: false, ts: 2 });
        this.g('curb').box(x, 0, z, x + 30, SIDEWALK_H, z + 30, { top: false, su: 1 });
        this.addCollider(x, 0, z, x + 30, SIDEWALK_H, z + 30, { ground: true, noAnchor: true });
        const m = x + 15;
        for (const [a, b] of [[x + 2, m], [m, x + 28]]) {
          const h = 8 + Math.floor(r() * 3) * 4;
          this.addBuilding([a, z + 2, b, z + 28], h, r() < 0.6 ? 'brownstone' : 'brick', { tiers: [[0, h]] });
        }
      }
    }
  }

  buildWater() {
    const t = tex('water').clone();
    t.needsUpdate = true;
    t.repeat.set(200, 200);
    this.waterTex = t;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshLambertMaterial({ map: t, color: 0xbfd8ff }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = WATER_Y;
    m.receiveShadow = true;
    this.scene.add(m);
  }

  buildLamps() {
    const n = this.lamps.length;
    const pole = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 5.5, 0.25), new THREE.MeshLambertMaterial({ color: 0x2f3a33 }), n);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.35, 0.7), new THREE.MeshBasicMaterial({ color: 0xfff0b8 }), n);
    const m = new THREE.Matrix4();
    this.lamps.forEach(([x, z], k) => {
      m.makeTranslation(x, SIDEWALK_H + 2.75, z);
      pole.setMatrixAt(k, m);
      m.makeTranslation(x, SIDEWALK_H + 5.6, z);
      head.setMatrixAt(k, m);
    });
    pole.castShadow = true;
    this.scene.add(pole, head);
  }

  pickCollectibleSpots() {
    const r = mulberry32(77);
    const spots = [];
    const pool = this.buildings.filter((b) => b.top > 20 && b.x1 < 320);
    const quads = [[], [], [], []];
    for (const b of pool) quads[((b.x0 + b.x1) / 2 > 0 ? 1 : 0) + ((b.z0 + b.z1) / 2 > 0 ? 2 : 0)].push(b);
    for (let k = 0; k < 12; k++) {
      const q = quads[k % 4];
      const b = q.splice(Math.floor(r() * q.length), 1)[0];
      if (!b) continue;
      const p = this.roofPoint(b);
      const t = b.tiers[b.tiers.length - 1];
      p.x = lerp(t[0] + 1.5, t[2] - 1.5, r());
      p.z = lerp(t[1] + 1.5, t[3] - 1.5, r());
      p.y = this.groundHeight(p.x, p.z, b.top + 20);
      spots.push(p);
    }
    this.backpackSpots = spots;
  }

  update(dt) {
    if (this.waterTex) this.waterTex.offset.x += dt * 0.6;
  }
}
