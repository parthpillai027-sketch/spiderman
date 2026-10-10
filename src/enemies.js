// Street thugs with token-based attack scheduling (only a couple of enemies
// commit to an attack at once, so free-flow combat stays readable).
import * as THREE from 'three';
import { buildCharacter, animateRig } from './models.js';
import { dampAngle, damp, rand, pick } from './util.js';

export const ENEMY_TYPES = {
  brawler: { hp: 40, speed: 6.5, dmg: 9, range: 2.3, windup: 0.6, cooldown: [1.3, 2.4], skins: ['thugA', 'thugB'] },
  gunner: { hp: 30, speed: 5, dmg: 7, range: 24, windup: 0.9, cooldown: [1.8, 3.0], ranged: true, skins: ['thugB', 'thugA'] },
  brute: { hp: 110, speed: 4.6, dmg: 18, range: 2.9, windup: 0.85, cooldown: [2, 3], scale: 1.35, skins: ['brute'] },
  burglar: { hp: 75, speed: 6.8, dmg: 12, range: 2.3, windup: 0.5, cooldown: [1.1, 2], skins: ['burglar'], name: 'The Carjacker' },
};

export class Enemy {
  constructor(mgr, type, pos, group) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.type = type;
    this.def = ENEMY_TYPES[type];
    this.group = group;
    this.scale = this.def.scale || 1;
    this.rig = buildCharacter(pick(this.def.skins), { scale: this.scale });
    this.pos = this.rig.root.position;
    this.pos.copy(pos);
    this.vel = new THREE.Vector3();
    this.hp = this.maxHp = this.def.hp;
    this.state = 'idle';
    this.timer = 0;
    this.cool = rand(0.6, 1.6);
    this.facing = rand(0, Math.PI * 2);
    this.webLevel = 0;
    this.webTimer = 0;
    this.stagger = 0;
    this.alive = true;
    this.targetable = true;
    this.kind = 'enemy';
    this.radius = 0.6 * this.scale;
    this.aggro = false;
    this.koTime = 0;
    this.animT = Math.random() * 10;
    this.hasToken = false;
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.pose = 'idle';
    this._center = new THREE.Vector3();
    this.game.scene.add(this.rig.root);
    this.game.combat.register(this);
  }

  get center() {
    return this._center.set(this.pos.x, this.pos.y + 1.0 * this.scale, this.pos.z);
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.animT += dt;
    this.vel.y -= 30 * dt;
    const res = g.world.moveBox(this.pos, this.vel, dt, 0.35 * this.scale, 1.8 * this.scale);
    if (res.ground) {
      const f = Math.max(0, 1 - 9 * dt);
      this.vel.x *= f;
      this.vel.z *= f;
    }
    if (this.pos.y < -2 && this.alive) this.knockOut(new THREE.Vector3());

    if (this.state === 'ko') {
      this.koTime += dt;
      this.present(dt, 'ko');
      return;
    }

    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const dy = p.pos.y - this.pos.y;
    if (!this.aggro && dist < 34 && Math.abs(dy) < 16) this.mgr.alertGroup(this.group);

    if (this.webLevel >= 3) {
      this.webTimer -= dt;
      if (this.webTimer <= 0) {
        this.webLevel = 0;
        this.rig.web.visible = false;
      } else {
        this.present(dt, 'webbed');
        return;
      }
    } else if (this.webLevel > 0) {
      this.webTimer -= dt;
      if (this.webTimer <= 0) {
        this.webLevel--;
        this.webTimer = 2;
      }
    }

    if (this.stagger > 0) {
      this.stagger -= dt;
      this.present(dt, 'hurt');
      return;
    }

    const def = this.def;
    const slow = this.webLevel > 0 ? 0.5 : 1;
    let pose = 'idle';
    const wantFace = Math.atan2(dx, dz);

    if (this.state === 'idle') {
      if (this.aggro) this.state = 'chase';
    } else if (this.state === 'chase') {
      this.facing = dampAngle(this.facing, wantFace, 8, dt);
      let mx = 0, mz = 0;
      if (def.ranged) {
        if (dist > 18) { mx = dx / dist; mz = dz / dist; }
        else if (dist < 9) { mx = -dx / dist; mz = -dz / dist; }
        else { mx = (-dz / dist) * this.strafe * 0.5; mz = (dx / dist) * this.strafe * 0.5; }
      } else if (dist > def.range * 0.85) {
        mx = dx / dist;
        mz = dz / dist;
      }
      // separation so they don't stack
      for (const o of this.mgr.list) {
        if (o === this || !o.alive) continue;
        const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
        const od = Math.hypot(ox, oz);
        if (od < 1.6 && od > 0.01) { mx += (ox / od) * 0.8; mz += (oz / od) * 0.8; }
      }
      const sp = def.speed * slow;
      this.vel.x = damp(this.vel.x, mx * sp, 10, dt);
      this.vel.z = damp(this.vel.z, mz * sp, 10, dt);
      pose = Math.hypot(mx, mz) > 0.2 ? 'run' : 'idle';
      this.cool -= dt;
      const inRange = def.ranged ? dist < 28 && Math.abs(dy) < 22 : dist < def.range + 0.6 && Math.abs(dy) < 2.4;
      if (this.cool <= 0 && inRange && !p.dead && this.mgr.requestToken(this)) {
        this.state = 'windup';
        this.timer = def.windup;
        p.spiderSense(this.pos, def.windup);
      }
    } else if (this.state === 'windup') {
      this.facing = dampAngle(this.facing, wantFace, 10, dt);
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
      pose = def.ranged ? 'aim' : 'windup';
      this.timer -= dt;
      if (this.timer <= 0) {
        if (def.ranged) {
          const hand = this.rig.handR.getWorldPosition(new THREE.Vector3());
          const aim = p.center.clone().addScaledVector(p.vel, 0.15);
          aim.x += rand(-0.6, 0.6);
          aim.y += rand(-0.4, 0.4);
          g.combat.fireBullet(hand, aim, def.dmg);
          g.particles.burst(hand, 4, { colors: [0xffe27a, 0xffffff], speed: 3, size: 0.12, life: 0.15 });
        } else {
          this.vel.x += Math.sin(this.facing) * 5;
          this.vel.z += Math.cos(this.facing) * 5;
          if (dist < def.range + 0.7 && Math.abs(dy) < 2.2) {
            if (p.takeDamage(def.dmg, this.pos)) g.audio.play(this.type === 'brute' ? 'heavy' : 'punch');
          }
        }
        this.state = 'recover';
        this.timer = def.ranged ? 0.35 : 0.4;
        this.mgr.releaseToken(this);
        this.cool = rand(def.cooldown[0], def.cooldown[1]);
      }
    } else if (this.state === 'recover') {
      pose = def.ranged ? 'aim' : this.type === 'brute' ? 'punchR' : pick(['punchR', 'punchL']);
      if (this.pose === 'punchL' || this.pose === 'punchR') pose = this.pose;
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'chase';
    }
    this.present(dt, pose);
  }

  present(dt, pose) {
    this.pose = pose;
    const rig = this.rig;
    animateRig(rig, pose, this.animT * (pose === 'run' ? 9 : 2), dt, 14);
    rig.root.rotation.y = this.facing;
    if (pose === 'ko') {
      rig.tilt.rotation.x = damp(rig.tilt.rotation.x, -Math.PI / 2, 8, dt);
      rig.tilt.position.y = damp(rig.tilt.position.y, 0.3, 8, dt);
    } else {
      rig.tilt.rotation.x = damp(rig.tilt.rotation.x, pose === 'hurt' ? -0.35 : 0, 12, dt);
      rig.tilt.position.y = 0.95;
    }
  }

  onHit(dmg, dir, opts = {}) {
    if (!this.alive) return;
    const mult = this.webLevel >= 3 ? 1.5 : 1;
    this.hp -= dmg * mult;
    this.mgr.alertGroup(this.group);
    if (this.state === 'windup') {
      this.state = 'chase';
      this.mgr.releaseToken(this);
      this.cool = 0.8;
    }
    const heavyResist = this.type === 'brute' && !opts.heavy;
    this.stagger = opts.heavy ? 0.8 : heavyResist ? 0.12 : 0.4;
    const k = opts.heavy ? 12 : heavyResist ? 1 : 3;
    this.vel.x += dir.x * k;
    this.vel.z += dir.z * k;
    if (opts.heavy) this.vel.y = 9;
    if (this.webLevel >= 3) {
      this.webLevel = 0;
      this.rig.web.visible = false;
    }
    if (this.hp <= 0) this.knockOut(dir);
  }

  onWebHit() {
    if (!this.alive) return;
    this.mgr.alertGroup(this.group);
    this.webLevel++;
    if (this.webLevel >= 3) {
      this.webLevel = 3;
      this.webTimer = 6;
      this.rig.web.visible = true;
      if (this.state === 'windup') this.state = 'chase';
      this.mgr.releaseToken(this);
    } else {
      this.webTimer = 2.5;
    }
  }

  finish() {
    const d = this.pos.clone().sub(this.game.player.pos).setY(0).normalize();
    this.hp = 0;
    this.knockOut(d);
    this.vel.y = 12;
  }

  knockOut(dir) {
    if (!this.alive) return;
    this.alive = false;
    this.targetable = false;
    this.state = 'ko';
    this.mgr.releaseToken(this);
    this.vel.x += dir.x * 6;
    this.vel.z += dir.z * 6;
    this.vel.y = Math.max(this.vel.y, 5);
    this.rig.web.visible = true;
    this.game.combat.unregister(this);
    this.mgr.onKO(this);
  }

  dispose() {
    this.game.scene.remove(this.rig.root);
    this.game.combat.unregister(this);
    this.mgr.releaseToken(this);
  }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.tokens = 0;
    this.maxTokens = 2;
    this.koCount = 0;
  }

  spawn(type, pos, group = 'default') {
    const e = new Enemy(this, type, pos, group);
    this.list.push(e);
    return e;
  }

  spawnGroup(center, types, group = 'default', radius = 6) {
    const out = [];
    types.forEach((type, k) => {
      const a = (k / types.length) * Math.PI * 2 + Math.random() * 0.5;
      const r = radius * (0.6 + Math.random() * 0.4);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const y = this.game.world.groundHeight(x, z, center.y + 3);
      out.push(this.spawn(type, new THREE.Vector3(x, y + 0.05, z), group));
    });
    return out;
  }

  alertGroup(group) {
    for (const e of this.list) if (e.group === group) e.aggro = true;
  }

  requestToken(e) {
    if (e.hasToken) return true;
    if (this.tokens >= this.maxTokens) return false;
    this.tokens++;
    e.hasToken = true;
    return true;
  }

  releaseToken(e) {
    if (e.hasToken) {
      e.hasToken = false;
      this.tokens = Math.max(0, this.tokens - 1);
    }
  }

  onKO() {
    this.koCount++;
  }

  aliveIn(group) {
    let n = 0;
    for (const e of this.list) if (e.group === group && e.alive) n++;
    return n;
  }

  activeCount() {
    let n = 0;
    for (const e of this.list) if (e.alive && e.aggro) n++;
    return n;
  }

  update(dt) {
    const keep = [];
    for (const e of this.list) {
      e.update(dt);
      if (!e.alive && e.koTime > 25) e.dispose();
      else keep.push(e);
    }
    this.list = keep;
  }

  clear(group = null) {
    const keep = [];
    for (const e of this.list) {
      if (group === null || e.group === group) e.dispose();
      else keep.push(e);
    }
    this.list = keep;
    if (group === null) this.tokens = 0;
  }
}
