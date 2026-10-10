// Targeting and projectiles: web shots, thug bullets, pumpkin bombs, razor bats.
import * as THREE from 'three';
import { tex } from './textures.js';

const GRAV = 20;

export class Combat {
  constructor(game) {
    this.game = game;
    this.targets = new Set();
    this.projectiles = [];
    this.webGeo = new THREE.BoxGeometry(0.28, 0.28, 0.7);
    this.webMat = new THREE.MeshBasicMaterial({ color: 0xf6f6f6 });
    this.bulletGeo = new THREE.BoxGeometry(0.1, 0.1, 0.9);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });
    this.bombGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    this.bombMat = new THREE.MeshBasicMaterial({ map: tex('pumpkin') });
    this.batMat = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
    this.batEye = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  }

  register(t) {
    this.targets.add(t);
  }
  unregister(t) {
    this.targets.delete(t);
  }

  findTarget(origin, dir, range, filter = null) {
    let best = null, bs = Infinity;
    for (const t of this.targets) {
      if (!t.alive || !t.targetable) continue;
      if (filter && !filter(t)) continue;
      const c = t.center;
      const dx = c.x - origin.x, dy = c.y - origin.y, dz = c.z - origin.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > (t.lockRange || range)) continue;
      const dot = d > 0.01 ? (dx * dir.x + dy * dir.y + dz * dir.z) / d : 1;
      if (dot < -0.3 && d > 5) continue;
      const score = d * (1.7 - dot) * (t.priority || 1);
      if (score < bs) {
        bs = score;
        best = t;
      }
    }
    return best;
  }

  _add(p) {
    this.game.scene.add(p.mesh);
    this.projectiles.push(p);
    return p;
  }

  fireWeb(from, target) {
    const mesh = new THREE.Mesh(this.webGeo, this.webMat);
    mesh.position.copy(from);
    return this._add({ type: 'web', pos: mesh.position, target, speed: 80, mesh, life: 1.5, trail: from.clone() });
  }

  fireBullet(from, to, dmg = 7) {
    const mesh = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    mesh.position.copy(from);
    const vel = to.clone().sub(from).normalize().multiplyScalar(60);
    mesh.lookAt(to);
    this.game.audio.play('shot');
    return this._add({ type: 'bullet', pos: mesh.position, vel, dmg, mesh, life: 1.2 });
  }

  throwBomb(from, to, dmg = 22, radius = 5.5, flight = 1.15) {
    const mesh = new THREE.Mesh(this.bombGeo, this.bombMat);
    mesh.position.copy(from);
    const vel = new THREE.Vector3(
      (to.x - from.x) / flight,
      (to.y - from.y + 0.5 * GRAV * flight * flight) / flight,
      (to.z - from.z) / flight,
    );
    return this._add({ type: 'bomb', pos: mesh.position, vel, dmg, radius, mesh, life: 3.5 });
  }

  spawnBat(from) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.45), this.batMat);
    const wl = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.35), this.batMat);
    const wr = wl.clone();
    wl.position.x = 0.45;
    wr.position.x = -0.45;
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.05), this.batEye);
    eye.position.set(0, 0.04, 0.24);
    g.add(body, wl, wr, eye);
    g.position.copy(from);
    const p = {
      type: 'bat', pos: g.position, mesh: g, wings: [wl, wr], life: 7,
      vel: new THREE.Vector3((Math.random() - 0.5) * 10, 6, (Math.random() - 0.5) * 10),
    };
    p.batTarget = {
      kind: 'bat', alive: true, targetable: true, radius: 0.5, priority: 0.6,
      get center() { return p.pos; },
      onHit: () => this._killBat(p),
      onWebHit: () => this._killBat(p),
    };
    this.register(p.batTarget);
    return this._add(p);
  }

  _killBat(p) {
    p.life = 0;
    p.batTarget.alive = false;
    this.game.particles.burst(p.pos, 8, { colors: [0x2a2a30, 0xff3b2f], speed: 5, size: 0.2 });
  }

  explode(pos, radius, dmg) {
    const g = this.game;
    g.particles.explosion(pos, radius > 5 ? 1.2 : 1);
    g.audio.play('explosion');
    const pc = g.player.center;
    const d = pc.distanceTo(pos);
    g.cameraRig.shake(Math.max(0.15, 1.2 - d / 40));
    if (d < radius) g.player.takeDamage(Math.round(dmg * (1 - (d / radius) * 0.5)), pos);
  }

  update(dt) {
    const g = this.game;
    const player = g.player;
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.type === 'web') {
        const t = p.target;
        if (t && t.alive) {
          const c = t.center;
          const dir = c.clone().sub(p.pos);
          const d = dir.length();
          if (d < 0.9 + (t.radius || 0.6)) {
            t.onWebHit();
            g.audio.play('webhit');
            g.particles.burst(p.pos, 8, { colors: [0xffffff, 0xdddddd], speed: 4, size: 0.18, life: 0.4 });
            p.life = 0;
            continue;
          }
          p.pos.addScaledVector(dir, Math.min(d, p.speed * dt) / d);
          p.mesh.lookAt(c);
        } else {
          p.life = Math.min(p.life, 0.2);
        }
        g.lines.line(p.trail, p.pos, 0.04);
      } else if (p.type === 'bullet') {
        p.pos.addScaledVector(p.vel, dt);
        if (player.hitTest(p.pos, 0.25)) {
          player.takeDamage(p.dmg, p.pos);
          p.life = 0;
        } else if (g.world.pointInside(p.pos) || p.pos.y < 0) {
          g.particles.burst(p.pos, 4, { colors: [0xffe27a], speed: 3, size: 0.12, life: 0.25 });
          p.life = 0;
        }
      } else if (p.type === 'bomb') {
        p.vel.y -= GRAV * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += dt * 6;
        p.mesh.rotation.y += dt * 4;
        const ground = g.world.groundHeight(p.pos.x, p.pos.z, p.pos.y + 0.5);
        if (p.pos.y <= ground + 0.3 || g.world.pointInside(p.pos) || player.center.distanceTo(p.pos) < 1.4 || p.life < 0.05) {
          this.explode(p.pos, p.radius, p.dmg);
          p.life = 0;
        }
      } else if (p.type === 'bat') {
        const desired = player.center.clone().sub(p.pos);
        const d = desired.length();
        desired.multiplyScalar(13 / Math.max(d, 0.01));
        p.vel.lerp(desired, 1 - Math.exp(-2.2 * dt));
        p.pos.addScaledVector(p.vel, dt);
        p.mesh.lookAt(p.pos.clone().add(p.vel));
        const flap = Math.sin(performance.now() / 40) * 0.6;
        p.wings[0].rotation.z = flap;
        p.wings[1].rotation.z = -flap;
        if (d < 1.1) {
          player.takeDamage(7, p.pos);
          this._killBat(p);
        }
      }
    }
    const keep = [];
    for (const p of this.projectiles) {
      if (p.life > 0) keep.push(p);
      else {
        g.scene.remove(p.mesh);
        if (p.batTarget) {
          p.batTarget.alive = false;
          this.unregister(p.batTarget);
        }
      }
    }
    this.projectiles = keep;
  }

  clear() {
    for (const p of this.projectiles) {
      this.game.scene.remove(p.mesh);
      if (p.batTarget) this.unregister(p.batTarget);
    }
    this.projectiles = [];
  }
}
