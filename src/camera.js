// Third-person orbit camera with collision, speed-based FOV and auto-follow
// while traversing (the "cinematic swing cam").
import * as THREE from 'three';
import { clamp, damp, dampAngle } from './util.js';

export class CameraRig {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.yaw = Math.PI;
    this.pitch = 0.25;
    this.dist = 6;
    this.curDist = 6;
    this.fov = 70;
    this.target = new THREE.Vector3();
    this.shakeAmt = 0;
    this.flatForward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.focusOverride = null;
  }

  shake(a) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  snapBehind(yaw) {
    this.yaw = yaw;
    this.pitch = 0.2;
  }

  update(dt, realDt) {
    const g = this.game;
    const p = g.player;
    const look = g.input.look(realDt);
    this.yaw -= look.dx;
    this.pitch = clamp(this.pitch + look.dy, -1.1, 1.25);

    const speed = Math.hypot(p.vel.x, p.vel.z);
    const traversing = ['swing', 'air', 'zip'].includes(p.state) && speed > 14;
    if (traversing && g.input.idleLookFor() > 1.0) {
      const want = Math.atan2(-p.vel.x, -p.vel.z);
      this.yaw = dampAngle(this.yaw, want, 1.6, dt);
      this.pitch = damp(this.pitch, p.vel.y < -12 ? 0.55 : 0.18, 1.2, dt);
    }

    let want = 5.5;
    if (p.state === 'swing' || p.state === 'zip') want = 8.5;
    else if (p.state === 'air') want = 7 + clamp(speed / 20, 0, 2);
    else if (p.state === 'wall') want = 6.5;
    if (g.enemies.activeCount() > 0 && p.state === 'ground') want = 7.5;
    if (g.goblin.active) want = Math.max(want, 9);
    this.dist = damp(this.dist, want, 3, realDt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, -sp, -Math.cos(this.yaw) * cp);
    this.flatForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const focus = this.focusOverride || p.pos;
    const tgt = new THREE.Vector3(focus.x, focus.y + 1.6, focus.z);
    this.target.lerp(tgt, 1 - Math.exp(-25 * realDt));
    if (this.target.distanceTo(tgt) > 30) this.target.copy(tgt);

    // keep the camera out of buildings
    const back = this.forward.clone().negate();
    const hit = g.world.raycast(this.target, back, this.dist + 0.5);
    let d = this.dist;
    if (hit) d = Math.max(1.2, hit.dist - 0.5);
    this.curDist = d < this.curDist ? d : damp(this.curDist, d, 6, realDt);
    // don't let a squeezed camera fill the screen with Spidey's back
    p.rig.root.visible = this.curDist > 1.7;

    const pos = this.target.clone().addScaledVector(back, this.curDist);
    pos.addScaledVector(this.right, 0.6);
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt;
      pos.x += (Math.random() - 0.5) * s;
      pos.y += (Math.random() - 0.5) * s;
      pos.z += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - realDt * 2.5);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target.x + this.right.x * 0.6, this.target.y, this.target.z + this.right.z * 0.6);

    const total = p.vel.length();
    const wantFov = 70 + clamp((total - 15) * 0.55, 0, 24);
    this.fov = damp(this.fov, wantFov, 4, realDt);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
