// Spider-Man: traversal (run, wall-crawl, web-swing, point-launch, web-zip)
// and free-flow combat (lunge strikes, combos, webs, dodges, focus).
import * as THREE from '../vendor/three.module.min.js';
import { buildCharacter, animateRig, setSkin } from './models.js';
import { clamp, approachXZ, dampAngle, damp } from './util.js';
import { WATER_Y } from './world.js';

const G = 32;
const HW = 0.35;
const H = 1.8;
const _v = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game;
    this.rig = buildCharacter('classic');
    game.scene.add(this.rig.root);
    this.pos = this.rig.root.position;
    this.vel = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.state = 'air';
    this.facing = 0;
    this.health = 100;
    this.maxHealth = 100;
    this.focus = 0;
    this.anchor = new THREE.Vector3();
    this.ropeLen = 0;
    this.swingTime = 0;
    this.wall = { normal: new THREE.Vector3(), collider: null };
    this.zipTarget = new THREE.Vector3();
    this.zipTime = 0;
    this.zipFx = { time: 0, point: new THREE.Vector3() };
    this.lungeTarget = null;
    this.lungeTime = 0;
    this.t = { swingCd: 0, wallLock: 0, attackCd: 0, webCd: 0, dodgeCd: 0, invuln: 0, zipCd: 0, combo: 0, sense: 0, action: 0, airZip: 0, coyote: 0, flip: 0 };
    this.sinceDamage = 99;
    this.combo = 0;
    this.maxCombo = 0;
    this.action = null;
    this.animT = 0;
    this.flipAngle = 0;
    this.carrying = null;
    this.lastSafe = new THREE.Vector3();
    this.perchTarget = null;
    this._perchTimer = 0;
    this.dead = false;
    this.controlsLocked = false;
    this.mv = { x: 0, y: 0 };
    this.moveDir = new THREE.Vector3();
    this.moveMag = 0;
    this.stats = { webs: 0, hits: 0, distance: 0 };
  }

  setSuit(key) {
    setSkin(this.rig, key);
  }

  spawn(pos, yaw = this.facing) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.state = 'air';
    this.dead = false;
    this.health = this.maxHealth;
    this.facing = yaw;
    this.rig.tilt.rotation.set(0, 0, 0);
    this.rig.tilt.position.y = 0.95;
    this.lastSafe.copy(pos);
    this.lungeTarget = null;
    this.updateCenter();
  }

  updateCenter() {
    this.center.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
  }

  hitTest(p, pad = 0) {
    return (
      p.x > this.pos.x - HW - pad && p.x < this.pos.x + HW + pad &&
      p.z > this.pos.z - HW - pad && p.z < this.pos.z + HW + pad &&
      p.y > this.pos.y - pad && p.y < this.pos.y + H + pad
    );
  }

  handPos(out = new THREE.Vector3()) {
    return this.rig.handR.getWorldPosition(out);
  }

  move(dt) {
    return this.game.world.moveBox(this.pos, this.vel, dt, HW, H);
  }

  onGround() {
    return this.game.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.1) >= this.pos.y - 0.08;
  }

  isClimbable(w) {
    return w && w.collider && w.collider.max.y - this.pos.y > 1.2 && !w.collider.noClimb;
  }

  playAction(name, time) {
    this.action = name;
    this.t.action = time;
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    for (const k in this.t) this.t[k] -= dt;
    this.sinceDamage += dt;
    if (this.dead) {
      this.animate(dt);
      return;
    }
    const inp = g.input;
    const cam = g.cameraRig;
    const locked = this.controlsLocked;
    const mv = locked ? { x: 0, y: 0 } : inp.move();
    this.mv = mv;
    this.moveMag = Math.min(1, Math.hypot(mv.x, mv.y));
    this.moveDir.set(0, 0, 0).addScaledVector(cam.flatForward, mv.y).addScaledVector(cam.right, mv.x);
    if (this.moveDir.lengthSq() > 1e-4) this.moveDir.normalize();

    const pressed = (a) => !locked && inp.pressed(a);
    const held = (a) => !locked && inp.down(a);

    if (pressed('dodge')) this.dodge();
    if (pressed('heal')) this.heal();
    if (pressed('finisher')) this.finisher();
    if (pressed('web')) this.shootWeb();
    if (pressed('attack')) this.attack();
    if (pressed('zip')) this.zip();

    const before = this.pos.clone();
    switch (this.state) {
      case 'ground': this.updateGround(dt, held, pressed); break;
      case 'air': this.updateAir(dt, held, pressed); break;
      case 'swing': this.updateSwing(dt, held, pressed); break;
      case 'wall': this.updateWall(dt, held, pressed); break;
      case 'zip': this.updateZip(dt); break;
      case 'lunge': this.updateLunge(dt); break;
      default: this.state = 'air';
    }
    this.stats.distance += this.pos.distanceTo(before);

    if (this.carrying) {
      // carried actor rides on Spidey's left side
      const c = this.carrying;
      c.root.position.set(this.pos.x + Math.cos(this.facing) * 0.55, this.pos.y + 0.35, this.pos.z - Math.sin(this.facing) * 0.55);
      c.root.rotation.y = this.facing;
    }

    // river: Spidey gets fished back to the last safe spot
    if (this.pos.y < WATER_Y + 0.3 && !g.world.isLand(this.pos.x, this.pos.z)) {
      g.particles.burst(new THREE.Vector3(this.pos.x, WATER_Y, this.pos.z), 20, { colors: [0x9cc8ff, 0xffffff], speed: 8, size: 0.3, up: 6 });
      this.pos.copy(this.lastSafe).add(new THREE.Vector3(0, 1, 0));
      this.vel.set(0, 0, 0);
      this.state = 'air';
      this.takeDamage(8, null, true);
      g.hud.notify('Splash! Back to dry land.');
    }

    if (this.t.combo <= 0 && this.combo > 0) {
      this.combo = 0;
      g.hud.combo(0);
    }
    if (this.sinceDamage > 5 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 6 * dt);

    this._perchTimer -= dt;
    if (this._perchTimer <= 0) {
      this._perchTimer = 0.1;
      this.perchTarget = this.findPerch();
    }
    this.updateCenter();
    this.drawWebs();
    this.animate(dt);
    g.audio.setWind(this.vel.length());
  }

  // ---- traversal ------------------------------------------------------------
  updateGround(dt, held, pressed) {
    const sprint = held('swing');
    const spd = (sprint ? 17 : 9) * this.moveMag;
    approachXZ(this.vel, this.moveDir.x * spd, this.moveDir.z * spd, (this.moveMag > 0.1 ? 80 : 60) * dt);
    this.vel.y -= G * dt;
    if (pressed('jump')) {
      this.vel.y = sprint ? 15.5 : 12.5;
      this.state = 'air';
      this.game.audio.play('whoosh');
    }
    const res = this.move(dt);
    if (res.ground) {
      this.t.coyote = 0.12;
      if (this.game.world.isLand(this.pos.x, this.pos.z)) this.lastSafe.copy(this.pos);
    } else if (this.t.coyote <= 0 && this.state === 'ground') {
      this.state = 'air';
    }
    if (res.wall && sprint && this.isClimbable(res.wall) && this.moveDir.dot(res.wall.normal) < -0.4) this.enterWall(res.wall);
  }

  updateAir(dt, held, pressed) {
    this.vel.y = Math.max(this.vel.y - G * dt, -75);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.moveMag > 0.1) {
      this.vel.x += this.moveDir.x * 20 * dt * this.moveMag;
      this.vel.z += this.moveDir.z * 20 * dt * this.moveMag;
      const ns = Math.hypot(this.vel.x, this.vel.z);
      const cap = Math.max(hs, 11);
      if (ns > cap) {
        this.vel.x *= cap / ns;
        this.vel.z *= cap / ns;
      }
    }
    const drag = 1 - 0.06 * dt;
    this.vel.x *= drag;
    this.vel.z *= drag;

    if (held('swing') && this.t.swingCd <= 0 && this.vel.y < 6) {
      const gh = this.game.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.1);
      if (this.pos.y - gh > 3 && this.startSwing()) return;
    }
    if (pressed('jump') && this.t.airZip <= 0) this.webZipBoost();

    const vy = this.vel.y;
    const res = this.move(dt);
    if (this.state !== 'air') return;
    if (res.ground) this.land(vy);
    else if (res.wall && this.t.wallLock <= 0 && this.isClimbable(res.wall)) this.enterWall(res.wall);
  }

  land(vy) {
    this.state = 'ground';
    if (vy < -28) {
      this.game.peds.bumpAround(this.pos, 2.5); // a hard landing next to someone startles them into a fight
      this.game.cameraRig.shake(Math.min(0.5, -vy / 120));
      this.game.particles.burst(this.pos.clone().add(new THREE.Vector3(0, 0.2, 0)), 10, { colors: [0xbbbbbb, 0x999999], speed: 5, size: 0.35, up: 1, grav: -4 });
      this.game.audio.play('land');
    }
  }

  webZipBoost() {
    const cam = this.game.cameraRig;
    const dir = this.moveMag > 0.1 ? this.moveDir.clone() : cam.flatForward.clone();
    const hs = Math.max(Math.hypot(this.vel.x, this.vel.z), 22);
    this.vel.x = dir.x * hs;
    this.vel.z = dir.z * hs;
    this.vel.y = Math.max(this.vel.y, 7);
    this.t.airZip = 0.8;
    this.zipFx.time = 0.18;
    this.zipFx.point.copy(this.pos).addScaledVector(dir, 16).add(new THREE.Vector3(0, 6, 0));
    this.game.audio.play('zip');
  }

  startSwing() {
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const dir = hv.length() > 4 ? hv.clone().normalize() : this.game.cameraRig.flatForward.clone();
    if (this.moveMag > 0.1) dir.lerp(this.moveDir, 0.6).normalize();
    const a = this.game.world.findSwingAnchor(this.pos, dir);
    if (!a) return false;
    this.anchor.copy(a);
    this.ropeLen = this.pos.distanceTo(a) * 0.96;
    this.state = 'swing';
    this.swingTime = 0;
    if (hv.length() < 12) this.vel.addScaledVector(dir, 10);
    this.stats.webs++;
    this.game.audio.play('thwip');
    return true;
  }

  updateSwing(dt, held, pressed) {
    this.swingTime += dt;
    if (!held('swing')) return this.releaseSwing(false);
    if (pressed('jump')) return this.releaseSwing(true);
    this.vel.y -= G * dt;
    const pump = this.moveMag > 0.1 ? this.moveDir : this.game.cameraRig.flatForward;
    this.vel.addScaledVector(pump, 17 * dt * (this.moveMag > 0.1 ? this.moveMag : 0.5));
    const res = this.move(dt);
    const d = _v.copy(this.pos).sub(this.anchor);
    const len = d.length();
    if (len > this.ropeLen) {
      d.multiplyScalar(1 / len);
      this.pos.copy(this.anchor).addScaledVector(d, this.ropeLen);
      const vr = this.vel.dot(d);
      if (vr > 0) this.vel.addScaledVector(d, -vr);
    }
    const sp = this.vel.length();
    if (sp > 62) this.vel.multiplyScalar(62 / sp);
    if (res.ground) {
      this.state = 'ground';
      return;
    }
    if (res.wall && this.isClimbable(res.wall)) {
      this.enterWall(res.wall);
      return;
    }
    const rel = _v.copy(this.pos).sub(this.anchor);
    const ahead = rel.x * this.vel.x + rel.z * this.vel.z;
    const angle = Math.acos(clamp(-rel.y / Math.max(rel.length(), 0.01), -1, 1));
    if ((ahead > 0 && angle > 1.0 && this.vel.y > 0) || this.pos.y > this.anchor.y - 2 || this.swingTime > 3.5) this.releaseSwing(false, true);
  }

  releaseSwing(jump, auto = false) {
    this.state = 'air';
    this.t.swingCd = auto ? 0.12 : 0.08;
    if (jump) {
      this.vel.y = Math.max(this.vel.y, 0) + 13;
      this.vel.x *= 1.1;
      this.vel.z *= 1.1;
      this.t.flip = 0.5;
      this.game.audio.play('whoosh');
    } else {
      this.vel.multiplyScalar(1.06);
      if (this.vel.y > 0) this.vel.y += 3;
    }
  }

  enterWall(w) {
    this.state = 'wall';
    this.wall.normal.copy(w.normal);
    this.wall.collider = w.collider;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.vel.set(0, clamp(Math.max(this.vel.y, 0) + hs * 0.5, 0, 22), 0);
    this.game.audio.play('land');
  }

  updateWall(dt, held, pressed) {
    const n = this.wall.normal;
    const tng = _v.set(n.z, 0, -n.x);
    const side = this.game.cameraRig.right.dot(tng) >= 0 ? 1 : -1;
    const sp = held('swing') ? 15 : 6.5;
    const ty = this.mv.y * sp;
    const ts = this.mv.x * side * sp;
    this.vel.y = damp(this.vel.y, ty, 8, dt);
    this.vel.x = tng.x * ts - n.x * 3;
    this.vel.z = tng.z * ts - n.z * 3;
    if (pressed('jump')) {
      const f = this.game.cameraRig.flatForward;
      this.vel.set(n.x * 12 + f.x * 4, 13, n.z * 12 + f.z * 4);
      this.state = 'air';
      this.t.wallLock = 0.35;
      this.t.flip = 0.45;
      this.game.audio.play('whoosh');
      return;
    }
    const res = this.move(dt);
    if (res.ground && this.mv.y < -0.1) {
      this.state = 'ground';
      return;
    }
    if (res.wall) {
      this.wall.normal.copy(res.wall.normal);
      this.wall.collider = res.wall.collider;
    } else if (this.wrapCorner()) {
      // crawled around the corner onto the neighbouring face
    } else {
      const c = this.wall.collider;
      if (c && this.pos.y > c.max.y - 1.4) {
        this.pos.y = c.max.y + 0.05;
        this.pos.addScaledVector(n, -0.9);
        this.vel.set(-n.x * 4, 6, -n.z * 4);
        this.t.flip = 0.4;
        this.game.audio.play('whoosh');
      }
      this.state = 'air';
      this.t.wallLock = 0.3;
    }
  }

  // Sliding sideways off the end of a wall: hop onto the adjacent face of the
  // same box instead of falling off.
  wrapCorner() {
    const c = this.wall.collider;
    if (!c || this.pos.y > c.max.y - 1.4) return false;
    const n = this.wall.normal;
    const a = n.x !== 0 ? 'z' : 'x';
    const b = a === 'z' ? 'x' : 'z';
    const nb = n.x !== 0 ? n.x : n.z;
    const inset = (side) => (side > 0 ? c.max[b] - 0.5 : c.min[b] + 0.5);
    let dir = 0;
    if (this.pos[a] - HW >= c.max[a] - 0.05) dir = 1;
    else if (this.pos[a] + HW <= c.min[a] + 0.05) dir = -1;
    if (!dir) return false;
    const next = this.pos.clone();
    next[a] = dir > 0 ? c.max[a] + HW + 0.02 : c.min[a] - HW - 0.02;
    next[b] = inset(nb);
    // something else (a neighbouring building) is in the way
    if (this.game.world.pointInside(new THREE.Vector3(next.x, next.y + 0.9, next.z), -0.05)) return false;
    this.pos.copy(next);
    this.wall.normal.set(0, 0, 0);
    this.wall.normal[a] = dir;
    return true;
  }

  zip() {
    if (this.t.zipCd > 0 || this.state === 'zip') return;
    if (this.perchTarget) {
      this.zipTarget.copy(this.perchTarget);
      this.state = 'zip';
      this.zipTime = 0;
      this.t.zipCd = 0.4;
      this.stats.webs++;
      this.game.audio.play('zip');
    } else if (this.state === 'air' || this.state === 'swing') {
      this.state = 'air';
      this.webZipBoost();
    }
  }

  updateZip(dt) {
    this.zipTime += dt;
    const d = _v.copy(this.zipTarget).sub(this.pos);
    const len = d.length();
    if (len < 1.2 || this.zipTime > 2.5) {
      this.pos.copy(this.zipTarget);
      const f = this.game.cameraRig.flatForward;
      this.vel.set(f.x * 11, 17, f.z * 11);
      this.state = 'air';
      this.t.wallLock = 0.3;
      this.t.flip = 0.55;
      this.game.audio.play('whoosh');
      return;
    }
    this.vel.copy(d).multiplyScalar(58 / len);
    this.pos.addScaledVector(this.vel, Math.min(dt, len / 58));
  }

  // Point-launch target: the top edge of whatever the camera is aimed at.
  findPerch() {
    const g = this.game;
    const cam = g.cameraRig;
    const hit = g.world.raycast(cam.target, cam.forward, 85);
    if (!hit || !hit.collider) return null;
    const c = hit.collider;
    if (c.ground) return null;
    const top = c.max.y;
    if (top - this.pos.y < -3 || top - this.pos.y > 75) return null;
    let x = hit.point.x, z = hit.point.z;
    if (hit.normal.y === 0) {
      x -= hit.normal.x * 0.8;
      z -= hit.normal.z * 0.8;
    }
    x = clamp(x, c.min.x + 0.4, c.max.x - 0.4);
    z = clamp(z, c.min.z + 0.4, c.max.z - 0.4);
    const p = new THREE.Vector3(x, top + 0.05, z);
    if (p.distanceTo(this.pos) < 7) return null;
    if (g.world.pointInside(new THREE.Vector3(x, top + 1, z))) return null;
    return p;
  }

  // ---- combat -----------------------------------------------------------------
  attack() {
    if (this.t.attackCd > 0 || this.state === 'wall' || this.state === 'zip') return;
    const g = this.game;
    const dir = this.moveMag > 0.1 ? this.moveDir : g.cameraRig.forward;
    const tgt = g.combat.findTarget(this.center, dir, 20);
    this.t.attackCd = 0.24;
    if (!tgt) {
      // no enemy around: a punch can still land on a pedestrian right in front of you
      const k = g.peds.nearest(this.pos, 2.4, this.moveMag > 0.1 ? this.moveDir : g.cameraRig.flatForward);
      const ped = k >= 0 ? g.peds.provoke(k, 'hit') : null;
      if (ped) {
        this.strike(ped);
        return;
      }
      this.playAction(['punchR', 'punchL', 'kick'][Math.floor(Math.random() * 3)], 0.22);
      g.audio.play('whoosh');
      return;
    }
    const d = tgt.center.distanceTo(this.center);
    if (d > 2.8) {
      this.state = 'lunge';
      this.lungeTarget = tgt;
      this.lungeTime = 0;
      g.audio.play('zip');
      return;
    }
    this.strike(tgt);
  }

  strike(tgt) {
    const g = this.game;
    this.combo = this.t.combo > 0 ? this.combo + 1 : 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.t.combo = 2.0;
    const heavy = this.combo % 5 === 0;
    const anims = ['punchR', 'punchL', 'kick', 'punchR'];
    this.playAction(heavy ? 'uppercut' : anims[(this.combo - 1) % 4], 0.22);
    const dir = tgt.center.clone().sub(this.center);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    dir.normalize();
    this.facing = Math.atan2(dir.x, dir.z);
    const dmg = heavy ? 22 : 11 + Math.min(6, Math.floor(this.combo / 4));
    tgt.onHit(dmg, dir, { heavy, source: 'player' });
    this.stats.hits++;
    this.focus = Math.min(100, this.focus + (heavy ? 10 : 6));
    g.particles.burst(tgt.center, heavy ? 14 : 7, { colors: [0xffffff, 0xffe27a, 0xff9a3a], speed: heavy ? 9 : 6, size: 0.2, life: 0.35, grav: -5 });
    g.audio.play(heavy ? 'heavy' : 'punch');
    g.hitstop(heavy ? 0.08 : 0.035);
    g.cameraRig.shake(heavy ? 0.35 : 0.12);
    if (this.state === 'air') this.vel.y = Math.max(this.vel.y, 2.5);
    this.vel.x *= 0.2;
    this.vel.z *= 0.2;
    g.hud.combo(this.combo);
  }

  updateLunge(dt) {
    const t = this.lungeTarget;
    this.lungeTime += dt;
    if (!t || !t.alive || this.lungeTime > 0.75) {
      this.state = 'air';
      return;
    }
    const d = t.center.clone().sub(this.center);
    const len = d.length();
    if (len < 1.9) {
      this.state = this.onGround() ? 'ground' : 'air';
      this.vel.set(0, this.state === 'air' ? 3 : 0, 0);
      this.strike(t);
      return;
    }
    this.vel.copy(d).multiplyScalar(44 / len);
    this.facing = Math.atan2(d.x, d.z);
    this.move(dt);
  }

  shootWeb() {
    if (this.t.webCd > 0 || this.state === 'zip') return;
    const g = this.game;
    this.t.webCd = 0.28;
    this.playAction('web', 0.25);
    const tgt = g.combat.findTarget(this.center, g.cameraRig.forward, 32);
    const hand = this.handPos();
    if (tgt) {
      g.combat.fireWeb(hand, tgt);
      const d = tgt.center.clone().sub(this.center);
      this.facing = Math.atan2(d.x, d.z);
    } else {
      const aim = hand.clone().addScaledVector(g.cameraRig.forward, 30);
      g.combat.fireWeb(hand, { alive: true, center: aim, radius: 0.5, onWebHit() {} });
    }
    this.stats.webs++;
    g.audio.play('thwip');
  }

  dodge() {
    if (this.t.dodgeCd > 0 || this.state === 'swing' || this.state === 'zip') return;
    const g = this.game;
    const dir = this.moveMag > 0.1 ? this.moveDir.clone() : g.cameraRig.flatForward.clone().negate();
    this.vel.x = dir.x * 19;
    this.vel.z = dir.z * 19;
    this.vel.y = this.state === 'ground' ? 5 : Math.max(this.vel.y, 4);
    if (this.state === 'wall') this.t.wallLock = 0.3;
    this.state = 'air';
    this.t.invuln = 0.45;
    this.t.dodgeCd = 0.55;
    this.t.flip = 0.45;
    this.playAction('dodge', 0.4);
    g.audio.play('whoosh');
    if (this.t.sense > 0) {
      g.slowmo(0.35, 0.6);
      this.focus = Math.min(100, this.focus + 15);
      g.hud.flash('PERFECT DODGE');
      this.t.sense = 0;
      if (g.goblin.active) g.goblin.onPerfectDodge();
    }
  }

  heal() {
    if (this.focus < 34 || this.health >= this.maxHealth) {
      if (this.focus < 34) this.game.hud.notify('Not enough focus to heal - land hits to build it.');
      return;
    }
    this.focus -= 34;
    this.health = Math.min(this.maxHealth, this.health + 35);
    this.playAction('heal', 0.5);
    this.game.particles.burst(this.center, 16, { colors: [0x7dff9a, 0xffffff], speed: 4, size: 0.2, up: 3, grav: 2 });
    this.game.audio.play('pickup');
  }

  finisher() {
    const g = this.game;
    if (this.focus < 50) {
      g.hud.notify('Finishers need half a focus bar.');
      return;
    }
    const tgt = g.combat.findTarget(this.center, g.cameraRig.forward, 16, (t) => t.kind === 'enemy' || (t.kind === 'boss' && t.stunned));
    if (!tgt) return;
    this.focus -= 50;
    const d = tgt.center.clone().sub(this.center);
    this.facing = Math.atan2(d.x, d.z);
    this.pos.copy(tgt.center).addScaledVector(d.normalize(), -1.6);
    this.pos.y = Math.max(this.pos.y - 1, g.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1));
    if (tgt.finish) tgt.finish();
    else tgt.onHit(45, d.setY(0).normalize(), { heavy: true, source: 'finisher' });
    this.playAction('uppercut', 0.5);
    g.slowmo(0.25, 0.7);
    g.cameraRig.shake(0.5);
    g.particles.burst(tgt.center, 24, { colors: [0xffffff, 0xff3b3b, 0x3b6bff], speed: 10, size: 0.25 });
    g.audio.play('heavy');
    g.hud.flash('FINISHER');
  }

  spiderSense(from, time) {
    const g = this.game;
    if (this.t.sense <= 0) g.audio.play('sense');
    this.t.sense = Math.max(this.t.sense, time + 0.25);
    g.hud.spiderSense(from);
  }

  takeDamage(dmg, from, ignoreInvuln = false) {
    const g = this.game;
    if ((!ignoreInvuln && this.t.invuln > 0) || this.dead || g.godMode) return false;
    this.health -= dmg;
    this.sinceDamage = 0;
    if (this.combo > 0) {
      this.combo = 0;
      g.hud.combo(0);
    }
    g.hud.damage();
    g.cameraRig.shake(0.4);
    g.audio.play('hurt');
    if (from) {
      const dir = this.pos.clone().sub(from);
      dir.y = 0;
      if (dir.lengthSq() > 1e-4) {
        dir.normalize();
        this.vel.x += dir.x * 8;
        this.vel.z += dir.z * 8;
      }
    }
    this.t.invuln = 0.35;
    this.playAction('hurt', 0.3);
    if (this.state === 'wall' || this.state === 'swing' || this.state === 'lunge') this.state = 'air';
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.state = 'dead';
      g.onPlayerDeath();
    }
    return true;
  }

  // ---- presentation ---------------------------------------------------------------
  drawWebs() {
    const L = this.game.lines;
    if (this.state === 'swing') L.line(this.handPos(), this.anchor, 0.06);
    else if (this.state === 'zip') L.line(this.handPos(), this.zipTarget, 0.06);
    else if (this.state === 'lunge' && this.lungeTarget) L.line(this.handPos(), this.lungeTarget.center, 0.05);
    if (this.zipFx.time > 0) {
      this.zipFx.time -= 1 / 60;
      L.line(this.handPos(), this.zipFx.point, 0.05);
    }
  }

  animate(dt) {
    const rig = this.rig;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    let pose = 'idle';
    let rate = 2;
    switch (this.state) {
      case 'ground':
        pose = hs > 12 ? 'sprint' : hs > 5 ? 'run' : hs > 0.6 ? 'walk' : 'idle';
        rate = pose === 'idle' ? 2 : hs * 0.9 + 2;
        break;
      case 'air':
        pose = this.vel.y > 4 ? 'jump' : this.vel.y < -14 ? 'dive' : 'fall';
        rate = 6;
        break;
      case 'swing': pose = 'swing'; break;
      case 'wall':
        pose = 'wall';
        rate = 1 + Math.abs(this.vel.y) * 0.9 + Math.hypot(this.vel.x, this.vel.z) * 0.5;
        break;
      case 'zip':
      case 'lunge':
        pose = 'zip';
        break;
      case 'dead': pose = 'ko'; break;
      default:
    }
    if (this.t.action > 0 && this.action && !this.dead) pose = this.action;
    this.animT += dt * rate;
    animateRig(rig, pose, this.animT, dt, 18);

    // body orientation
    let wantYaw = this.facing;
    if (this.state === 'wall') wantYaw = Math.atan2(-this.wall.normal.x, -this.wall.normal.z);
    else if (hs > 1.2 && this.state !== 'lunge' && this.t.action <= 0) wantYaw = Math.atan2(this.vel.x, this.vel.z);
    this.facing = dampAngle(this.facing, wantYaw, 12, dt);
    rig.root.rotation.y = this.facing;

    let tx = 0, tz = 0;
    if (this.state === 'swing') {
      const d = _v.copy(this.anchor).sub(this.center);
      const cf = Math.cos(this.facing), sf = Math.sin(this.facing);
      const lx = d.x * cf - d.z * sf;
      const lz = d.x * sf + d.z * cf;
      tx = clamp(Math.atan2(lz, d.y), -1.3, 1.3);
      tz = clamp(Math.atan2(-lx, d.y), -1.0, 1.0);
    } else if (this.state === 'air') {
      tx = this.vel.y < -14 ? 1.0 : clamp(hs / 60, 0, 0.4);
    } else if (this.state === 'ground' && hs > 12) {
      tx = 0.25;
    } else if (this.state === 'zip' || this.state === 'lunge') {
      tx = 0.6;
    }
    if (this.dead) {
      rig.tilt.rotation.x = damp(rig.tilt.rotation.x, -Math.PI / 2, 8, dt);
      rig.tilt.position.y = damp(rig.tilt.position.y, 0.3, 8, dt);
      return;
    }
    rig.tilt.position.y = 0.95;
    if (this.t.flip > 0) {
      this.flipAngle += dt * ((Math.PI * 2) / 0.45);
      rig.tilt.rotation.x = this.flipAngle;
    } else {
      if (this.flipAngle !== 0) {
        rig.tilt.rotation.x = 0;
        this.flipAngle = 0;
      }
      rig.tilt.rotation.x = damp(rig.tilt.rotation.x, tx, 10, dt);
    }
    rig.tilt.rotation.z = damp(rig.tilt.rotation.z, tz, 10, dt);
  }
}
