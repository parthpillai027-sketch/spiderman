// The Green Goblin boss: glider flight, pumpkin bombs, razor bats, dash
// attacks. Web his glider or perfect-dodge his dash to knock him down, then
// beat on him while he's grounded.
import * as THREE from '../vendor/three.module.min.js';
import { buildCharacter, buildGlider, animateRig } from './models.js';
import { clamp, damp, dampAngle, rand, pick } from './util.js';

const TAUNTS = [
  'Is that the best a spider can do?',
  'You should have joined me, Spider-Man!',
  'The itsy-bitsy spider, swatted again!',
  'This city will learn to fear the Goblin!',
  'Come out, come out, little bug!',
];
const HURT = ['Argh! Lucky shot!', 'You little pest!', 'Enough!'];

export class Goblin {
  constructor(game) {
    this.game = game;
    this.obj = new THREE.Group();
    this.rig = buildCharacter('goblin', { scale: 1.1 });
    this.rig.root.position.y = 0.12;
    this.glider = buildGlider();
    this.obj.add(this.rig.root, this.glider);
    this.pos = this.obj.position;
    this.vel = new THREE.Vector3();
    this.active = false;
    this.kind = 'boss';
    this.name = 'Green Goblin';
    this.radius = 1.3;
    this.lockRange = 45;
    this.priority = 0.8;
    this.maxHp = 320;
    this.hp = 320;
    this.state = 'off';
    this.mode = 'fight';
    this.timer = 0;
    this.angle = 0;
    this.webMeter = 0;
    this.hitsTaken = 0;
    this.fleeAt = 0;
    this.onFlee = null;
    this.onDefeat = null;
    this.tauntTimer = 8;
    this.dashDir = new THREE.Vector3();
    this.dashHit = false;
    this.facing = 0;
    this.animT = 0;
    this.pose = 'fly';
    this.holdPos = new THREE.Vector3();
    this._center = new THREE.Vector3();
  }

  get alive() {
    return this.active && !['defeated', 'flee', 'off'].includes(this.state);
  }
  get targetable() {
    return this.mode === 'fight';
  }
  get stunned() {
    return this.state === 'stunned';
  }
  get center() {
    return this._center.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
  }

  activate(pos, { hp = 320, fleeAt = 0, mode = 'fight' } = {}) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.maxHp = 320;
    this.hp = hp;
    this.fleeAt = fleeAt;
    this.mode = mode;
    this.state = mode === 'hold' ? 'hold' : 'circle';
    this.holdPos.copy(pos);
    this.timer = 2.5;
    this.webMeter = 0;
    this.rig.tilt.rotation.set(0, 0, 0);
    this.rig.tilt.position.y = 0.95;
    if (!this.active) {
      this.game.scene.add(this.obj);
      this.game.combat.register(this);
    }
    this.active = true;
    this.game.audio.play('laugh');
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'fight' || mode === 'harass') {
      this.state = 'circle';
      this.timer = 2;
    } else if (mode === 'hold') {
      this.state = 'hold';
      this.holdPos.copy(this.pos);
    }
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.state = 'off';
    this.game.scene.remove(this.obj);
    this.game.combat.unregister(this);
    this.game.hud.boss(null);
  }

  phase() {
    const f = this.hp / this.maxHp;
    return f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  }

  say(text) {
    this.game.hud.say('Green Goblin', text, 3);
  }

  steerTo(target, maxSpeed, accel, dt) {
    const d = target.clone().sub(this.pos);
    const want = d.multiplyScalar(1.6);
    if (want.length() > maxSpeed) want.setLength(maxSpeed);
    this.vel.lerp(want, 1 - Math.exp(-accel * dt));
    this.pos.addScaledVector(this.vel, dt);
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const p = g.player;
    const ph = this.phase();
    const speedMul = 1 + (ph - 1) * 0.25;
    this.animT += dt;
    let pose = 'fly';
    const toP = p.center.clone().sub(this.center);
    let faceYaw = Math.atan2(toP.x, toP.z);

    // engine exhaust
    if (this.state !== 'defeated') {
      const back = new THREE.Vector3(-Math.sin(this.facing), 0, -Math.cos(this.facing));
      const jp = this.pos.clone().addScaledVector(back, 1.0);
      jp.y -= 0.1;
      if (Math.random() < 0.7) g.particles.spawn(jp, back.clone().multiplyScalar(4).add(new THREE.Vector3(0, -1, 0)), pick([0xff9a1a, 0xffd84a]), 0.18, 0.25, 0, 2);
    }

    switch (this.state) {
      case 'hold': {
        const t = this.holdPos.clone();
        t.y += Math.sin(this.animT * 2) * 0.6;
        this.steerTo(t, 20, 3, dt);
        break;
      }
      case 'circle': {
        const harass = this.mode === 'harass';
        this.angle += dt * 0.45 * speedMul;
        const R = harass ? 30 : 22;
        const ground = g.world.groundHeight(p.pos.x, p.pos.z, p.pos.y + 1);
        const h = Math.max(p.pos.y + (harass ? 16 : 9), ground + 8);
        const want = new THREE.Vector3(p.pos.x + Math.cos(this.angle) * R, h, p.pos.z + Math.sin(this.angle) * R);
        this.steerTo(want, 32 * speedMul, 2.2, dt);
        faceYaw = Math.atan2(this.vel.x, this.vel.z);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (harass) {
            this.state = 'bombWindup';
            this.timer = 0.7;
          } else {
            const r = Math.random();
            if (r < 0.42) { this.state = 'bombWindup'; this.timer = 0.7; }
            else if (r < 0.8 || ph === 1) { this.state = 'dashWindup'; this.timer = 0.9; p.spiderSense(this.pos, 0.95); }
            else { this.state = 'batsWindup'; this.timer = 0.6; }
          }
        }
        break;
      }
      case 'bombWindup': {
        pose = 'throw';
        this.vel.multiplyScalar(Math.max(0, 1 - 4 * dt));
        this.pos.addScaledVector(this.vel, dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          const n = this.mode === 'harass' ? 1 : ph;
          const hand = this.rig.handR.getWorldPosition(new THREE.Vector3());
          for (let k = 0; k < n; k++) {
            const aim = p.pos.clone().addScaledVector(p.vel, 0.6);
            aim.x += k === 0 ? 0 : rand(-4, 4);
            aim.z += k === 0 ? 0 : rand(-4, 4);
            g.combat.throwBomb(hand, aim, 20 + ph * 2, 5.5, 1.15);
          }
          p.spiderSense(hand, 1.0);
          g.audio.play('laugh');
          this.state = 'circle';
          this.timer = (this.mode === 'harass' ? rand(4, 6) : rand(2.5, 4)) / speedMul;
        }
        break;
      }
      case 'batsWindup': {
        pose = 'throw';
        this.vel.multiplyScalar(Math.max(0, 1 - 4 * dt));
        this.pos.addScaledVector(this.vel, dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          for (let k = 0; k < 1 + ph; k++) g.combat.spawnBat(this.center.clone());
          p.spiderSense(this.pos, 0.8);
          this.say('Razor bats - fly, my pretties!');
          this.state = 'circle';
          this.timer = rand(3, 4.5) / speedMul;
        }
        break;
      }
      case 'dashWindup': {
        pose = 'fly';
        const back = toP.clone().setY(0).normalize().multiplyScalar(-6);
        this.vel.lerp(back, 1 - Math.exp(-3 * dt));
        this.pos.addScaledVector(this.vel, dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          this.dashDir.copy(p.center).sub(this.center).normalize();
          this.state = 'dash';
          this.timer = 1.1;
          this.dashHit = false;
          g.audio.play('glider');
        }
        break;
      }
      case 'dash': {
        const sp = 44 + ph * 4;
        this.vel.copy(this.dashDir).multiplyScalar(sp);
        this.pos.addScaledVector(this.vel, dt);
        faceYaw = Math.atan2(this.dashDir.x, this.dashDir.z);
        if (!this.dashHit && this.center.distanceTo(p.center) < 2.4) {
          this.dashHit = true;
          p.takeDamage(18 + ph * 2, this.pos);
        }
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'circle';
          this.timer = rand(2.2, 3.5) / speedMul;
        }
        break;
      }
      case 'stunned': {
        pose = 'hurt';
        const ground = g.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1);
        const toward = p.pos.clone().sub(this.pos).setY(0);
        const want = this.pos.clone();
        if (toward.length() > 5) want.addScaledVector(toward.normalize(), 3);
        want.y = Math.max(ground + 1.4, p.pos.y + 0.4);
        this.steerTo(want, 8, 2, dt);
        if (Math.random() < 0.5) g.particles.spawn(this.pos.clone(), new THREE.Vector3(rand(-1, 1), 2, rand(-1, 1)), pick([0x444444, 0x666666]), 0.5, 1.0, 1, 0.5);
        this.timer -= dt;
        if (this.timer <= 0 || this.hitsTaken >= 8) {
          this.state = 'recover';
          this.timer = 1.0;
          this.say(pick(HURT));
        }
        break;
      }
      case 'recover': {
        this.vel.y = damp(this.vel.y, 18, 4, dt);
        this.vel.x = damp(this.vel.x, 0, 3, dt);
        this.vel.z = damp(this.vel.z, 0, 3, dt);
        this.pos.addScaledVector(this.vel, dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'circle';
          this.timer = 2;
        }
        break;
      }
      case 'flee': {
        this.vel.lerp(new THREE.Vector3(30, 22, -30), 1 - Math.exp(-1.5 * dt));
        this.pos.addScaledVector(this.vel, dt);
        faceYaw = Math.atan2(this.vel.x, this.vel.z);
        this.timer -= dt;
        if (this.timer <= 0) this.deactivate();
        break;
      }
      case 'defeated': {
        pose = 'ko';
        this.vel.y -= 25 * dt;
        this.pos.addScaledVector(this.vel, dt);
        const ground = g.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1);
        if (this.pos.y <= ground) {
          this.pos.y = ground;
          this.vel.set(0, 0, 0);
          if (this.timer > 0) {
            g.particles.explosion(this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 0.8);
            g.audio.play('explosion');
            this.timer = 0;
          }
        }
        this.rig.tilt.rotation.x = damp(this.rig.tilt.rotation.x, -Math.PI / 2, 4, dt);
        this.rig.tilt.position.y = damp(this.rig.tilt.position.y, 0.3, 4, dt);
        break;
      }
      default:
    }

    // stay out of buildings and the river
    if (this.state !== 'defeated') {
      const minY = g.world.groundHeight(this.pos.x, this.pos.z, 1e9) + 1.5;
      if (this.pos.y < minY && this.state !== 'stunned') this.pos.y = damp(this.pos.y, minY + 2, 6, dt);
      if (this.pos.y < 2) this.pos.y = 2;
    }

    this.facing = dampAngle(this.facing, faceYaw, 6, dt);
    this.obj.rotation.y = this.facing;
    const lateral = this.vel.x * Math.cos(this.facing) - this.vel.z * Math.sin(this.facing);
    this.obj.rotation.z = damp(this.obj.rotation.z, clamp(-lateral * 0.02, -0.5, 0.5), 4, dt);
    this.obj.rotation.x = damp(this.obj.rotation.x, this.state === 'dash' ? 0.3 : 0, 4, dt);
    this.pose = pose;
    animateRig(this.rig, pose, this.animT * 3, dt, 10);

    if (this.mode === 'fight' && this.state !== 'flee') g.hud.boss(this.name, this.hp, this.maxHp);
    if (this.mode !== 'hold' && this.alive) {
      this.tauntTimer -= dt;
      if (this.tauntTimer <= 0) {
        this.tauntTimer = rand(10, 16);
        this.say(pick(TAUNTS));
      }
    }
  }

  stun(time = 4) {
    this.state = 'stunned';
    this.timer = time;
    this.hitsTaken = 0;
    this.webMeter = 0;
    this.game.hud.flash('GLIDER JAMMED!');
    this.game.audio.play('heavy');
  }

  onPerfectDodge() {
    if (this.mode === 'fight' && (this.state === 'dash' || this.state === 'dashWindup') && this.center.distanceTo(this.game.player.center) < 14) {
      this.stun(3.5);
    }
  }

  onWebHit() {
    if (!this.alive || this.mode !== 'fight' || this.state === 'stunned' || this.state === 'recover') return;
    this.webMeter++;
    const need = 2 + this.phase();
    this.game.hud.notify(`Glider webbed ${this.webMeter}/${need}`);
    if (this.webMeter >= need) this.stun(4.5);
  }

  onHit(dmg, dir) {
    if (!this.alive || this.mode !== 'fight') return;
    const stunned = this.state === 'stunned';
    this.hp -= stunned ? dmg : dmg * 0.35;
    if (stunned) this.hitsTaken++;
    this.vel.addScaledVector(dir, stunned ? 2 : 6);
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'defeated';
      this.timer = 1;
      this.vel.set(dir.x * 6, 6, dir.z * 6);
      this.game.hud.boss(null);
      this.game.audio.play('laugh');
      if (this.onDefeat) this.onDefeat();
      return;
    }
    if (this.fleeAt > 0 && this.hp <= this.fleeAt) {
      this.state = 'flee';
      this.timer = 4;
      this.game.hud.boss(null);
      this.say('This isn\'t over, Spider-Man! Not by a long shot!');
      this.game.audio.play('laugh');
      if (this.onFlee) this.onFlee();
    }
  }
}
