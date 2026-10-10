// In-engine cutscenes: blocky actors on location, framed camera shots,
// letterboxing and a dialogue box with pixel portraits, typewriter text and
// synthesized character voices (auto-advancing when a line has been spoken).
//
// A scene is { setup(api), shots: [{ cam, look, drift?, lines: [[who, text], ...] }] }
// where `who` names an actor registered in setup (or null for narration).
import * as THREE from '../vendor/three.module.min.js';
import { Actor } from './npcs.js';
import { animateRig } from './models.js';
import { skinMaterials, ATLAS } from './skins.js';

const $ = (id) => document.getElementById(id);
const CHARS_PER_SEC = 48;

export class Cutscenes {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.el = {
      root: $('cutscene'), name: $('dlg-name'), text: $('dlg-text'), face: $('dlg-face'), next: $('dlg-next'), box: $('dlg'),
    };
    this.el.root.addEventListener('click', () => this.advance());
    $('dlg-skip').addEventListener('click', (e) => {
      e.stopPropagation();
      this.skip();
    });
  }

  get playing() {
    return !!this.active;
  }

  play(def) {
    return new Promise((resolve) => {
      const g = this.game;
      const s = {
        def, resolve, shot: -1, line: -1, typed: 0, lineText: '', t: 0, shotT: 0,
        cast: {}, spawned: [], props: [], hidden: [], prevVisible: g.player.rig.root.visible,
      };
      this.active = s;
      g.state = 'cutscene';
      g.hud.show(false);
      g.audio.setWind(0);
      this.el.root.classList.remove('hidden');
      def.setup(this.api(s));
      this.openedAt = performance.now();
      this.nextShot();
    });
  }

  // helpers handed to a scene's setup()
  api(s) {
    const g = this.game;
    const face = (root, yaw) => { root.rotation.y = yaw; };
    return {
      // spawn a stand-in character
      actor: (key, name, skin, pos, yaw = 0, pose = 'idle') => {
        const a = new Actor(g, skin, pos, { facing: yaw });
        a.pose = pose;
        face(a.root, yaw);
        s.spawned.push(a);
        s.cast[key] = { name, skin, rig: a.rig, root: a.root, pose };
        return a;
      },
      // Spider-Man himself (the player's rig, in the current suit)
      spidey: (pos, yaw = 0, pose = 'idle') => {
        const p = g.player;
        p.pos.copy(pos);
        p.facing = yaw;
        p.vel.set(0, 0, 0);
        p.state = 'ground';
        p.rig.root.visible = true;
        face(p.rig.root, yaw);
        p.rig.tilt.rotation.set(0, 0, 0);
        s.cast.spidey = { name: 'Spider-Man', skin: p.rig.skin, rig: p.rig, root: p.rig.root, pose };
      },
      // an existing character (mission actor, the Goblin) joins the scene
      cast: (key, name, skin, rig, root, pose = 'idle') => {
        s.cast[key] = { name, skin, rig, root, pose };
      },
      hidePlayer: () => {
        g.player.rig.root.visible = false;
      },
      prop: (obj) => {
        g.scene.add(obj);
        s.props.push(obj);
        return obj;
      },
    };
  }

  nextShot() {
    const s = this.active;
    s.shot++;
    const shot = s.def.shots[s.shot];
    if (!shot) {
      this.finish();
      return;
    }
    s.shotT = 0;
    s.line = -1;
    this.nextLine();
  }

  nextLine() {
    const s = this.active;
    const shot = s.def.shots[s.shot];
    s.line++;
    const line = shot.lines[s.line];
    if (!line) {
      this.nextShot();
      return;
    }
    const [who, text] = line;
    const c = who ? s.cast[who] : null;
    s.speaker = who;
    s.lineText = text;
    s.typed = 0;
    this.el.name.textContent = c ? c.name : '';
    this.el.box.classList.toggle('narration', !c);
    this.el.text.textContent = '';
    this.el.next.classList.remove('show');
    this.drawPortrait(c);
    s.autoAt = null;
    const lineId = (s.lineId = (s.lineId || 0) + 1);
    const voiced = this.game.voices.speak(c ? c.skin : 'narrator', text, () => {
      // spoken in full: finish typing and move on shortly after
      if (this.active === s && s.lineId === lineId) s.autoAt = s.t + 0.7;
    });
    if (!voiced && c) this.game.audio.play('ui');
  }

  drawPortrait(c) {
    const cv = this.el.face;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    cv.classList.toggle('hidden', !c);
    if (!c) return;
    const img = skinMaterials(c.skin).map.image;
    const f = ATLAS.rows.head.faces[4];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, cv.width, cv.height);
  }

  advance() {
    const s = this.active;
    if (!s || performance.now() - this.openedAt < 300) return;
    if (s.typed < s.lineText.length) {
      s.typed = s.lineText.length;
      this.el.text.textContent = s.lineText;
      this.el.next.classList.add('show');
      return;
    }
    this.nextLine();
  }

  skip() {
    if (this.active) this.finish();
  }

  update(dt) {
    const s = this.active;
    if (!s) return;
    s.t += dt;
    s.shotT += dt;
    const shot = s.def.shots[s.shot];
    if (!shot) return;

    if (s.autoAt !== null && s.autoAt !== undefined && s.t >= s.autoAt) {
      s.autoAt = null;
      this.nextLine();
      if (!this.active) return;
    }
    if (s.typed < s.lineText.length) {
      s.typed = Math.min(s.lineText.length, s.typed + dt * CHARS_PER_SEC);
      this.el.text.textContent = s.lineText.slice(0, Math.floor(s.typed));
      if (s.typed >= s.lineText.length) this.el.next.classList.add('show');
    }

    const cam = this.game.camera;
    const d = shot.drift || [0, 0, 0];
    cam.position.set(shot.cam.x + d[0] * s.shotT, shot.cam.y + d[1] * s.shotT, shot.cam.z + d[2] * s.shotT);
    cam.lookAt(shot.look);
    if (cam.fov !== 50) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }

    for (const [key, c] of Object.entries(s.cast)) {
      const pose = key === s.speaker ? 'talk' : c.pose === 'idle' ? 'listen' : c.pose;
      animateRig(c.rig, pose, s.t * 3 + key.length, dt, 8);
    }
  }

  finish() {
    const s = this.active;
    const g = this.game;
    this.active = null;
    g.voices.stop();
    for (const a of s.spawned) a.remove();
    for (const o of s.props) g.scene.remove(o);
    g.player.rig.root.visible = s.prevVisible;
    this.el.root.classList.add('hidden');
    g.hud.show(true);
    g.state = 'playing';
    g.cameraRig.target.copy(g.player.pos);
    g.clock.getDelta();
    s.resolve();
  }
}

// ---- shot helpers for scene scripts ------------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);

// Camera beside two people, looking at the point between them.
export function twoShot(a, b, { dist = 6.5, height = 1.9, side = 1, lookY = 1.4 } = {}) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).setY(0).normalize();
  const perp = V(dir.z, 0, -dir.x).multiplyScalar(side);
  return { cam: mid.clone().addScaledVector(perp, dist).add(V(0, height, 0)), look: mid.clone().add(V(0, lookY, 0)) };
}

// Over-the-shoulder close-up on `who`, seen from roughly where `from` stands.
export function closeUp(who, from, { dist = 2.6, off = 0.8, height = 1.75 } = {}) {
  const dir = from.clone().sub(who).setY(0).normalize();
  const right = V(dir.z, 0, -dir.x);
  return {
    cam: who.clone().addScaledVector(dir, dist).addScaledVector(right, off).add(V(0, height, 0)),
    look: who.clone().add(V(0, 1.55, 0)),
  };
}
