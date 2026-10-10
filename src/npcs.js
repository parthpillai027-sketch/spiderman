// Ambient life (instanced traffic and pedestrians) plus scripted actors.
import * as THREE from 'three';
import { buildCharacter, animateRig, PX } from './models.js';
import { N, CELL, X0, Z0, BW, SIDEWALK_H } from './world.js';
import { damp, mulberry32 } from './util.js';

const CAR_COLORS = [0xd8c23a, 0xd8c23a, 0xb83227, 0x2e5fa8, 0xe8e8e8, 0x2b2b2b, 0x3f7d4a, 0x8e44ad, 0xd35400];

export class Traffic {
  constructor(game, count = 64) {
    this.game = game;
    const lanes = [];
    for (let line = 1; line < N; line++) {
      const c = X0 + line * CELL;
      lanes.push({ axis: 'x', pos: c + 3.5, dir: 1 }, { axis: 'x', pos: c - 3.5, dir: -1 });
      lanes.push({ axis: 'z', pos: c - 3.5, dir: 1 }, { axis: 'z', pos: c + 3.5, dir: -1 });
    }
    this.lanes = lanes;
    const r = mulberry32(99);
    this.cars = [];
    for (let k = 0; k < count; k++) {
      const lane = lanes[Math.floor(r() * lanes.length)];
      const cruise = 9 + r() * 6;
      this.cars.push({ lane, s: -300 + r() * 600, speed: cruise, cruise, color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)] });
    }
    const n = this.cars.length;
    this.body = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 1.0, 2.0), new THREE.MeshLambertMaterial(), n);
    this.cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.85, 1.8), new THREE.MeshLambertMaterial({ color: 0x24313f }), n);
    this.wheels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.8, 0.3), new THREE.MeshLambertMaterial({ color: 0x151515 }), n * 4);
    this.lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.25, 1.6), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }), n);
    const col = new THREE.Color();
    this.cars.forEach((c, i) => this.body.setColorAt(i, col.setHex(c.color)));
    for (const m of [this.body, this.cabin, this.wheels, this.lights]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = m !== this.lights;
      m.frustumCulled = false;
      game.scene.add(m);
    }
    this._m = new THREE.Matrix4();
    this._o = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  update(dt) {
    const p = this.game.player.pos;
    const byLane = new Map();
    for (const c of this.cars) {
      if (!byLane.has(c.lane)) byLane.set(c.lane, []);
      byLane.get(c.lane).push(c);
    }
    for (const [lane, cars] of byLane) {
      cars.sort((a, b) => (a.s - b.s) * lane.dir);
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        const ahead = cars[i + 1];
        let target = c.cruise;
        if (ahead) {
          const gap = (ahead.s - c.s) * lane.dir;
          if (gap < 10) target = Math.min(target, ahead.speed * (gap < 6 ? 0.3 : 0.9));
        }
        // stop for Spider-Man standing in the road
        if (p.y < 2) {
          const along = (lane.axis === 'x' ? p.x : p.z) - c.s;
          const perp = (lane.axis === 'x' ? p.z : p.x) - lane.pos;
          if (Math.abs(perp) < 2 && along * lane.dir > 0 && along * lane.dir < 9) target = 0;
        }
        c.speed = damp(c.speed, target, target < c.speed ? 6 : 1.5, dt);
        c.s += c.speed * lane.dir * dt;
        if (c.s * lane.dir > 312) c.s = -312 * lane.dir;
      }
    }
    this.cars.forEach((c, i) => {
      const L = c.lane;
      if (L.axis === 'x') this._p.set(c.s, 0.85, L.pos);
      else this._p.set(L.pos, 0.85, c.s);
      const yaw = L.axis === 'x' ? (L.dir > 0 ? 0 : Math.PI) : L.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      this._q.setFromAxisAngle(this._up, yaw);
      this._m.compose(this._p, this._q, this._s);
      this.body.setMatrixAt(i, this._m);
      this.cabin.setMatrixAt(i, this._o.makeTranslation(-0.3, 0.9, 0).premultiply(this._m));
      this.lights.setMatrixAt(i, this._o.makeTranslation(2.12, 0.05, 0).premultiply(this._m));
      let w = 0;
      for (const wx of [-1.35, 1.35]) for (const wz of [-1.0, 1.0]) {
        this.wheels.setMatrixAt(i * 4 + w++, this._o.makeTranslation(wx, -0.45, wz).premultiply(this._m));
      }
    });
    for (const m of [this.body, this.cabin, this.wheels, this.lights]) m.instanceMatrix.needsUpdate = true;
  }
}

// Pedestrians: 6 instanced meshes drive every walker's body parts.
const SKIN = [0xf1c8a5, 0xd8a47f, 0xa86f4b, 0x6b4226, 0xe2b58f];
const SHIRT = [0x2e8b57, 0xc0392b, 0x2980b9, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085];
const PANTS = [0x2c3e50, 0x34405e, 0x222222, 0x5d4037, 0x7f8c8d];

export class Pedestrians {
  constructor(game, count = 110) {
    this.game = game;
    const r = mulberry32(4242);
    const parts = {
      head: [8, 8, 8], torso: [8, 12, 4], armL: [4, 12, 4], armR: [4, 12, 4], legL: [4, 12, 4], legR: [4, 12, 4],
    };
    this.meshes = {};
    for (const [k, [w, h, d]] of Object.entries(parts)) {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(w * PX, h * PX, d * PX), new THREE.MeshLambertMaterial(), count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.frustumCulled = false;
      game.scene.add(m);
      this.meshes[k] = m;
    }
    // invisible rig used to compute part matrices
    const root = new THREE.Object3D();
    const mk = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
    const legL = mk(root, 2 * PX, 12 * PX, 0), legR = mk(root, -2 * PX, 12 * PX, 0);
    const armL = mk(root, 6 * PX, 22 * PX, 0), armR = mk(root, -6 * PX, 22 * PX, 0);
    this.dummy = {
      root, legL, legR, armL, armR,
      parts: {
        head: mk(root, 0, 28 * PX, 0), torso: mk(root, 0, 18 * PX, 0),
        legL: mk(legL, 0, -6 * PX, 0), legR: mk(legR, 0, -6 * PX, 0),
        armL: mk(armL, 0, -4 * PX, 0), armR: mk(armR, 0, -4 * PX, 0),
      },
    };
    this.peds = [];
    const col = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = Math.floor(r() * N), j = Math.floor(r() * N);
      const x0 = X0 + i * CELL + 7 + 1.3, z0 = Z0 + j * CELL + 7 + 1.3;
      const side = BW - 2.6;
      const ped = { x0, z0, side, t: r() * side * 4, speed: 1.2 + r() * 0.9, dir: r() < 0.5 ? 1 : -1, phase: r() * 6, panic: 0 };
      this.peds.push(ped);
      const shirt = SHIRT[Math.floor(r() * SHIRT.length)];
      this.meshes.head.setColorAt(k, col.setHex(SKIN[Math.floor(r() * SKIN.length)]));
      this.meshes.torso.setColorAt(k, col.setHex(shirt));
      this.meshes.armL.setColorAt(k, col.setHex(shirt));
      this.meshes.armR.setColorAt(k, col.setHex(shirt));
      const pants = PANTS[Math.floor(r() * PANTS.length)];
      this.meshes.legL.setColorAt(k, col.setHex(pants));
      this.meshes.legR.setColorAt(k, col.setHex(pants));
    }
    this.alarm = null;
    this.alarmTime = 0;
  }

  panicAt(pos) {
    this.alarm = pos.clone();
    this.alarmTime = 8;
  }

  update(dt) {
    this.alarmTime -= dt;
    const d = this.dummy;
    const cam = this.game.camera.position;
    this.peds.forEach((p, k) => {
      let speed = p.speed;
      if (this.alarmTime > 0 && this.alarm) {
        const dx = p.x - this.alarm.x, dz = p.z - this.alarm.z;
        if (dx * dx + dz * dz < 45 * 45) speed *= 3;
      }
      p.t = (p.t + speed * p.dir * dt + p.side * 4) % (p.side * 4);
      const seg = Math.floor(p.t / p.side), u = p.t - seg * p.side;
      let x, z, yaw;
      if (seg === 0) { x = p.x0 + u; z = p.z0; yaw = Math.PI / 2; }
      else if (seg === 1) { x = p.x0 + p.side; z = p.z0 + u; yaw = 0; }
      else if (seg === 2) { x = p.x0 + p.side - u; z = p.z0 + p.side; yaw = -Math.PI / 2; }
      else { x = p.x0; z = p.z0 + p.side - u; yaw = Math.PI; }
      if (p.dir < 0) yaw += Math.PI;
      p.x = x;
      p.z = z;
      const far = (x - cam.x) ** 2 + (z - cam.z) ** 2 > 260 * 260;
      if (far && p.init) return;
      p.init = true;
      p.phase += dt * speed * 4.5;
      const s = Math.sin(p.phase) * 0.7;
      d.root.position.set(x, SIDEWALK_H, z);
      d.root.rotation.y = yaw;
      d.legL.rotation.x = -s; d.legR.rotation.x = s;
      d.armL.rotation.x = s; d.armR.rotation.x = -s;
      d.root.updateMatrixWorld(true);
      for (const [name, o] of Object.entries(d.parts)) this.meshes[name].setMatrixAt(k, o.matrixWorld);
    });
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
  }
}

// A fully skinned character driven by mission scripts (MJ, civilians).
export class Actor {
  constructor(game, skin, pos, { facing = 0 } = {}) {
    this.game = game;
    this.rig = buildCharacter(skin);
    this.root = this.rig.root;
    this.root.position.copy(pos);
    this.pos = this.root.position;
    this.facing = facing;
    this.pose = 'idle';
    this.vel = new THREE.Vector3();
    this.fall = null; // { gravity, terminal }
    this.animT = Math.random() * 5;
    this.lying = false;
    game.scene.add(this.root);
  }
  get center() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 1, this.pos.z);
  }
  update(dt) {
    this.animT += dt;
    if (this.fall) {
      this.vel.y = Math.max(this.vel.y - this.fall.gravity * dt, -this.fall.terminal);
      this.pos.addScaledVector(this.vel, dt);
      this.rig.tilt.rotation.x += dt * 1.5;
    }
    animateRig(this.rig, this.pose, this.animT * 4, dt, 10);
    this.root.rotation.y = this.facing;
    if (!this.fall) this.rig.tilt.rotation.x = damp(this.rig.tilt.rotation.x, 0, 6, dt);
  }
  remove() {
    this.game.scene.remove(this.root);
  }
}
