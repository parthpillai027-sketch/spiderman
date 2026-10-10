// Voxel particles, web lines and objective markers.
import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 1500) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, white);
    scene.add(this.mesh);
    this.list = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._e = new THREE.Euler();
  }

  spawn(pos, vel, color, size = 0.25, life = 0.8, grav = -18, drag = 1.2) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      pos: pos.clone(), vel: vel.clone(), color, size, life, max: life, grav, drag,
      rot: Math.random() * 6, spin: (Math.random() - 0.5) * 10,
    });
  }

  burst(pos, n, { colors = [0xffffff], speed = 6, size = 0.25, life = 0.7, grav = -18, up = 2, drag = 1.2 } = {}) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2 - 0.6, (Math.random() - 0.5) * 2)
        .normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      v.y += up;
      this.spawn(pos, v, colors[i % colors.length], size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), grav, drag);
    }
  }

  explosion(pos, scale = 1) {
    this.burst(pos, 40 * scale, { colors: [0xffd84a, 0xff8a1a, 0xff4a1a, 0xfff1b0], speed: 14 * scale, size: 0.6 * scale, life: 0.6, grav: -4, up: 2 });
    this.burst(pos, 26 * scale, { colors: [0x3a3a3a, 0x555555, 0x2a2a2a], speed: 6 * scale, size: 1.0 * scale, life: 1.4, grav: 3, up: 3 });
  }

  update(dt) {
    let n = 0;
    const alive = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y += p.grav * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.rot += p.spin * dt;
      const s = p.size * Math.min(1, (p.life / p.max) * 2);
      this._e.set(p.rot, p.rot * 0.7, 0);
      this._q.setFromEuler(this._e);
      this._s.set(s, s, s);
      this._m.compose(p.pos, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this.mesh.setColorAt(n, this._c.setHex(p.color));
      alive.push(p);
      n++;
    }
    this.list = alive;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.list = [];
  }
}

// Immediate-mode thick lines (webs, cables). Call begin() each frame.
export class Lines {
  constructor(scene, max = 32) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf4f4f4 }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.pool.push(m);
    }
    this.n = 0;
  }
  begin() {
    this.n = 0;
  }
  line(a, b, thick = 0.07, color = 0xf4f4f4) {
    if (this.n >= this.pool.length) return;
    const m = this.pool[this.n++];
    const d = a.distanceTo(b);
    if (d < 1e-3) return;
    m.position.copy(a);
    m.lookAt(b);
    m.scale.set(thick, thick, d);
    m.material.color.setHex(color);
    m.visible = true;
  }
  end() {
    for (let i = this.n; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}

// Objective markers: tall light beams + spinning voxel diamond.
export class Markers {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.t = 0;
  }
  add(pos, { color = 0xffd23f, height = 90, label = '', primary = true, radius = 1.3, beam = true } = {}) {
    const g = new THREE.Group();
    g.position.copy(pos);
    let beamMesh = null;
    if (beam) {
      beamMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, height, 10, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beamMesh.position.y = height / 2;
      g.add(beamMesh);
    }
    const gem = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshBasicMaterial({ color }));
    gem.position.y = 2.2;
    gem.rotation.set(Math.PI / 4, 0, Math.PI / 4);
    g.add(gem);
    this.scene.add(g);
    const m = { pos: g.position, group: g, gem, beam: beamMesh, color, label, primary };
    this.list.push(m);
    return m;
  }
  remove(m) {
    if (!m) return;
    this.scene.remove(m.group);
    const i = this.list.indexOf(m);
    if (i >= 0) this.list.splice(i, 1);
  }
  clear() {
    for (const m of [...this.list]) this.remove(m);
  }
  update(dt) {
    this.t += dt;
    for (const m of this.list) {
      m.gem.rotation.y += dt * 2;
      m.gem.position.y = 2.2 + Math.sin(this.t * 3) * 0.3;
      if (m.beam) m.beam.material.opacity = 0.22 + Math.sin(this.t * 4) * 0.08;
    }
  }
}
