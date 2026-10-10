// HUD: health/focus, minimap, objectives, boss bar, combo counter,
// spider-sense, waypoint, prompts, subtitles and story cards.
import * as THREE from '../vendor/three.module.min.js';
import { formatTime } from './util.js';

const $ = (id) => document.getElementById(id);

const MAP = { xmin: -330, xmax: 670, zmin: -330, zmax: 330, s: 0.5 };

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      root: $('hud'), health: $('health-fill'), ghost: $('health-ghost'), focus: $('focus-fill'),
      mini: $('minimap'), objTitle: $('obj-title'), objText: $('obj-text'), objExtra: $('obj-extra'), objective: $('objective'),
      boss: $('boss'), bossName: $('boss-name'), bossFill: $('boss-fill'),
      combo: $('combo'), comboNum: $('combo-num'), sense: $('sense'), perch: $('perch'),
      wp: $('waypoint'), wpDist: $('wp-dist'), prompt: $('prompt'), promptText: $('prompt-text'), promptBar: $('prompt-bar'),
      sub: $('subtitle'), subName: $('sub-name'), subText: $('sub-text'),
      toast: $('toast'), toastTitle: $('toast-title'), toastSub: $('toast-sub'),
      notify: $('notify'), flash: $('flash'), damage: $('damage'), speed: $('speedlines'),
      story: $('story'), storyTitle: $('story-title'), storyBody: $('story-body'),
      bigmap: $('bigmap'), bigmapCanvas: $('bigmap-canvas'), fps: $('fps'), collect: $('collect'),
    };
    this.miniCtx = this.el.mini.getContext('2d');
    this.ghostHp = 100;
    this.timers = { sub: 0, toast: 0, notify: 0, flash: 0, sense: 0, combo: 0, damage: 0 };
    this.storyResolve = null;
    this.mapBase = null;
    this.timerValue = null;
    this._v = new THREE.Vector3();
    this.el.story.addEventListener('click', () => this.closeStory());
  }

  show(on) {
    this.el.root.classList.toggle('hidden', !on);
  }

  // ---- static map image ---------------------------------------------------
  buildMap(world) {
    const { xmin, xmax, zmin, zmax, s } = MAP;
    const c = document.createElement('canvas');
    c.width = (xmax - xmin) * s;
    c.height = (zmax - zmin) * s;
    const ctx = c.getContext('2d');
    const R = (x0, z0, x1, z1, col) => {
      ctx.fillStyle = col;
      ctx.fillRect((x0 - xmin) * s, (z0 - zmin) * s, (x1 - x0) * s, (z1 - z0) * s);
    };
    R(xmin, zmin, xmax, zmax, '#24527e');
    R(-316, -316, 316, 316, '#3b3c40');
    R(440, -260, 660, 260, '#3b3c40');
    for (const p of world.parks) R(p.x0, p.z0, p.x1, p.z1, '#4f8a3a');
    for (const p of world.plazaRects) R(p.x0, p.z0, p.x1, p.z1, '#b09a6a');
    for (const b of world.buildings) {
      const t = Math.min(1, b.top / 150);
      const v = Math.round(110 + t * 120);
      R(b.x0, b.z0, b.x1, b.z1, `rgb(${v},${v},${v + 6})`);
    }
    const br = world.landmarks.bridge;
    if (br) R(br.x0, -7, br.x1, 7, '#8a8f96');
    this.mapBase = c;
  }

  // ---- per-frame ------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const p = g.player;
    for (const k in this.timers) this.timers[k] -= dt;

    const hp = Math.max(0, p.health / p.maxHealth);
    this.el.health.style.width = `${hp * 100}%`;
    this.ghostHp = Math.max(hp * 100, this.ghostHp - dt * 30);
    this.el.ghost.style.width = `${this.ghostHp}%`;
    this.el.health.classList.toggle('low', hp < 0.3);
    this.el.focus.style.width = `${p.focus}%`;

    if (this.timers.sub <= 0) this.el.sub.classList.remove('show');
    if (this.timers.toast <= 0) this.el.toast.classList.remove('show');
    if (this.timers.notify <= 0) this.el.notify.classList.remove('show');
    if (this.timers.flash <= 0) this.el.flash.classList.remove('show');
    if (this.timers.sense <= 0) this.el.sense.classList.remove('show');
    if (this.timers.combo <= 0) this.el.combo.classList.remove('show');
    if (this.timers.damage <= 0) this.el.damage.classList.remove('show');

    const sp = p.vel.length();
    this.el.speed.style.opacity = Math.max(0, Math.min(0.75, (sp - 28) / 35)).toFixed(2);

    this.drawMinimap();
    this.updateWaypoint();
    this.updatePerch();
    if (!this.el.bigmap.classList.contains('hidden')) this.drawBigMap();
  }

  project(pos) {
    const v = this._v.copy(pos).project(this.game.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, behind: v.z > 1 };
  }

  updateWaypoint() {
    const m = this.game.markers.list.find((k) => k.primary);
    const el = this.el.wp;
    if (!m) {
      el.classList.remove('show');
      return;
    }
    el.classList.add('show');
    const target = m.pos.clone().add(new THREE.Vector3(0, 3, 0));
    const d = target.distanceTo(this.game.player.pos);
    this.el.wpDist.textContent = `${Math.round(d)}m`;
    const s = this.project(target);
    let { x, y } = s;
    const W = innerWidth, H = innerHeight, pad = 46;
    if (s.behind) {
      x = W - x;
      y = H - pad;
    }
    const off = s.behind || x < pad || x > W - pad || y < pad || y > H - pad;
    x = Math.min(W - pad, Math.max(pad, x));
    y = Math.min(H - pad, Math.max(pad, y));
    el.classList.toggle('edge', off);
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.setProperty('--wp', `#${m.color.toString(16).padStart(6, '0')}`);
  }

  updatePerch() {
    const p = this.game.player;
    const el = this.el.perch;
    if (!p.perchTarget || p.state === 'zip') {
      el.classList.remove('show');
      return;
    }
    const s = this.project(p.perchTarget);
    if (s.behind) {
      el.classList.remove('show');
      return;
    }
    el.classList.add('show');
    el.style.transform = `translate(${s.x}px, ${s.y}px)`;
  }

  drawMinimap() {
    if (!this.mapBase) return;
    const ctx = this.miniCtx;
    const g = this.game;
    const p = g.player.pos;
    const yaw = g.cameraRig.yaw;
    const W = this.el.mini.width, C = W / 2;
    const zoom = 1.7;
    const { xmin, zmin, s } = MAP;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, C - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#24527e';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(C, C);
    ctx.rotate(yaw);
    ctx.scale(zoom, zoom);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapBase, -(p.x - xmin) * s, -(p.z - zmin) * s);
    ctx.restore();

    const dot = (x, z, col, r = 4, clampEdge = true) => {
      const rx0 = (x - p.x) * s * zoom, rz0 = (z - p.z) * s * zoom;
      let rx = rx0 * Math.cos(yaw) - rz0 * Math.sin(yaw);
      let ry = rx0 * Math.sin(yaw) + rz0 * Math.cos(yaw);
      const d = Math.hypot(rx, ry);
      const lim = C - 8;
      if (d > lim) {
        if (!clampEdge) return;
        rx *= lim / d;
        ry *= lim / d;
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(C + rx, C + ry, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    for (const e of g.enemies.list) if (e.alive) dot(e.pos.x, e.pos.z, '#ff4040', 3, false);
    if (g.goblin.active) dot(g.goblin.pos.x, g.goblin.pos.z, '#7dff4a', 5);
    for (const m of g.markers.list) dot(m.pos.x, m.pos.z, `#${m.color.toString(16).padStart(6, '0')}`, m.primary ? 6 : 3, m.primary);

    // player arrow
    const a = Math.PI - (g.player.facing - yaw);
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(a);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#c4111a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(C, C, C - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  toggleMap(force) {
    const on = force ?? this.el.bigmap.classList.contains('hidden');
    this.el.bigmap.classList.toggle('hidden', !on);
    return on;
  }

  drawBigMap() {
    const cv = this.el.bigmapCanvas;
    const W = Math.min(innerWidth - 40, 1000), H = Math.min(innerHeight - 120, 660);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    const { xmin, xmax, zmin, zmax, s } = MAP;
    const k = Math.min(W / ((xmax - xmin) * s), H / ((zmax - zmin) * s));
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#24527e';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.mapBase, 0, 0, this.mapBase.width * k, this.mapBase.height * k);
    const pt = (x, z) => [(x - xmin) * s * k, (z - zmin) * s * k];
    for (const m of this.game.markers.list) {
      const [x, y] = pt(m.pos.x, m.pos.z);
      ctx.fillStyle = `#${m.color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(x - (m.primary ? 6 : 3), y - (m.primary ? 6 : 3), m.primary ? 12 : 6, m.primary ? 12 : 6);
    }
    const p = this.game.player;
    const [x, y] = pt(p.pos.x, p.pos.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI - p.facing);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#c4111a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = '14px "Press Start 2P", monospace';
    const lm = this.game.world.landmarks;
    const label = (txt, v) => { if (v) { const [lx, ly] = pt(v.x, v.z); ctx.fillText(txt, lx - 30, ly); } };
    label('OSCORP', lm.oscorp && { x: lm.oscorp.x0, z: lm.oscorp.z0 });
    label('BUGLE', lm.bugle && { x: lm.bugle.x0, z: lm.bugle.z0 });
    label('PLAZA', lm.plaza);
    label('BRIDGE', lm.bridge && lm.bridge.mid);
    label('QUEENS', { x: 540, z: -150 });
  }

  // ---- messages -------------------------------------------------------------
  objective(title, text = '') {
    this.el.objective.classList.toggle('hidden', !title);
    this.el.objTitle.textContent = title || '';
    this.el.objText.textContent = text;
  }

  extra(text) {
    this.el.objExtra.textContent = text || '';
  }

  timer(sec) {
    if (sec === null) this.el.objExtra.dataset.timer = '';
    else this.el.objExtra.dataset.timer = formatTime(sec);
  }

  boss(name, hp = 0, max = 1) {
    if (!name) {
      this.el.boss.classList.remove('show');
      return;
    }
    this.el.boss.classList.add('show');
    this.el.bossName.textContent = name;
    this.el.bossFill.style.width = `${Math.max(0, hp / max) * 100}%`;
  }

  combo(n) {
    if (n < 2) {
      this.timers.combo = 0;
      return;
    }
    this.el.comboNum.textContent = n;
    this.el.combo.classList.add('show');
    this.el.combo.classList.remove('pop');
    void this.el.combo.offsetWidth;
    this.el.combo.classList.add('pop');
    this.timers.combo = 2;
  }

  spiderSense(from) {
    this.el.sense.classList.add('show');
    this.timers.sense = 0.6;
    if (from) {
      const s = this.project(from);
      const dir = s.behind ? 'behind' : s.x < innerWidth * 0.35 ? 'left' : s.x > innerWidth * 0.65 ? 'right' : '';
      this.el.sense.dataset.dir = dir;
    }
  }

  say(name, text, dur = 4) {
    this.el.subName.textContent = name ? `${name}:` : '';
    this.el.subText.textContent = text;
    this.el.sub.classList.add('show');
    this.timers.sub = dur;
  }

  toast(title, sub = '', dur = 3.5) {
    this.el.toastTitle.textContent = title;
    this.el.toastSub.textContent = sub;
    this.el.toast.classList.add('show');
    this.timers.toast = dur;
  }

  notify(text, dur = 3) {
    this.el.notify.textContent = text;
    this.el.notify.classList.add('show');
    this.timers.notify = dur;
  }

  flash(text) {
    this.el.flash.textContent = text;
    this.el.flash.classList.remove('show');
    void this.el.flash.offsetWidth;
    this.el.flash.classList.add('show');
    this.timers.flash = 1.1;
  }

  damage() {
    this.el.damage.classList.add('show');
    this.timers.damage = 0.35;
  }

  prompt(text, progress = null) {
    if (!text) {
      this.el.prompt.classList.remove('show');
      return;
    }
    this.el.prompt.classList.add('show');
    this.el.promptText.textContent = text;
    this.el.promptBar.style.width = progress === null ? '0%' : `${Math.round(progress * 100)}%`;
  }

  collectibles(n, total) {
    this.el.collect.textContent = `BACKPACKS ${n}/${total}`;
  }

  story(title, paragraphs) {
    this.el.storyTitle.textContent = title;
    this.el.storyBody.innerHTML = '';
    for (const p of paragraphs) {
      const el = document.createElement('p');
      el.textContent = p;
      this.el.storyBody.appendChild(el);
    }
    this.el.story.classList.remove('hidden');
    this.storyOpenedAt = performance.now();
    return new Promise((res) => {
      this.storyResolve = res;
    });
  }

  get storyOpen() {
    return !!this.storyResolve;
  }

  closeStory() {
    if (!this.storyResolve) return;
    if (performance.now() - this.storyOpenedAt < 400) return;
    this.el.story.classList.add('hidden');
    const r = this.storyResolve;
    this.storyResolve = null;
    this.game.audio.play('ui');
    r();
  }
}
