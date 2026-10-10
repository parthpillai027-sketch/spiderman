// Blocky character rigs (Minecraft proportions) and a pose animator.
import * as THREE from '../vendor/three.module.min.js';
import { skinMaterials, ATLAS } from './skins.js';

export const PX = 1.8 / 32; // one "skin pixel" in world units -> 1.8 block tall characters

const SIZES = { head: [8, 8, 8], body: [8, 12, 4], armL: [4, 12, 4], armR: [4, 12, 4], legL: [4, 12, 4], legR: [4, 12, 4] };
const geoCache = new Map();

// Box for one body part with UVs pointing into that part's row of the skin atlas.
function partGeo(part) {
  if (geoCache.has(part)) return geoCache.get(part);
  const [w, h, d] = SIZES[part];
  const geo = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
  const uv = geo.attributes.uv;
  const { faces } = ATLAS.rows[part];
  for (let i = 0; i < uv.count; i++) {
    const f = faces[Math.floor(i / 4)];
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, (f.x + u * f.w) / ATLAS.W, 1 - (f.y + (1 - v) * f.h) / ATLAS.H);
  }
  geoCache.set(part, geo);
  return geo;
}

function mesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

const webMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.85 });

export function buildCharacter(skinKey, { scale = 1 } = {}) {
  const mat = skinMaterials(skinKey);
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.position.y = 0.95;
  root.add(tilt);
  const body = new THREE.Group();
  body.position.y = -0.95;
  tilt.add(body);

  const legR = new THREE.Group();
  legR.position.set(-2 * PX, 12 * PX, 0);
  const legRMesh = mesh(partGeo('legR'), mat);
  legRMesh.position.y = -6 * PX;
  legR.add(legRMesh);
  const legL = new THREE.Group();
  legL.position.set(2 * PX, 12 * PX, 0);
  const legLMesh = mesh(partGeo('legL'), mat);
  legLMesh.position.y = -6 * PX;
  legL.add(legLMesh);

  const torso = mesh(partGeo('body'), mat);
  torso.position.y = 18 * PX;

  const armR = new THREE.Group();
  armR.position.set(-6 * PX, 22 * PX, 0);
  const armRMesh = mesh(partGeo('armR'), mat);
  armRMesh.position.y = -4 * PX;
  armR.add(armRMesh);
  const handR = new THREE.Object3D();
  handR.position.y = -10 * PX;
  armR.add(handR);

  const armL = new THREE.Group();
  armL.position.set(6 * PX, 22 * PX, 0);
  const armLMesh = mesh(partGeo('armL'), mat);
  armLMesh.position.y = -4 * PX;
  armL.add(armLMesh);
  const handL = new THREE.Object3D();
  handL.position.y = -10 * PX;
  armL.add(handL);

  const head = new THREE.Group();
  head.position.y = 24 * PX;
  const headMesh = mesh(partGeo('head'), mat);
  headMesh.position.y = 4 * PX;
  head.add(headMesh);

  body.add(legR, legL, torso, armR, armL, head);

  // Web cocoon shown when an enemy is fully webbed / KO'd.
  const web = new THREE.Mesh(new THREE.BoxGeometry(10 * PX, 26 * PX, 6 * PX), webMat);
  web.position.y = 13 * PX;
  web.visible = false;
  body.add(web);

  root.scale.setScalar(scale);

  return { root, tilt, body, head, torso, armL, armR, legL, legR, handL, handR, web, skin: skinKey };
}

export function setSkin(rig, skinKey) {
  const mat = skinMaterials(skinKey);
  for (const part of [rig.legR, rig.legL, rig.armR, rig.armL, rig.head]) part.children[0].material = mat;
  rig.torso.material = mat;
  rig.skin = skinKey;
}

// Glider for the Goblin: a bat-winged voxel platform.
export function buildGlider() {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x34383d });
  const mid = new THREE.MeshLambertMaterial({ color: 0x4a5058 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd84a });
  const jet = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
  const add = (w, h, d, x, y, z, m) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    g.add(b);
    return b;
  };
  add(0.9, 0.22, 1.7, 0, -0.11, 0, mid);
  add(0.5, 0.18, 0.5, 0, -0.1, 0.95, dark);
  for (const s of [-1, 1]) {
    add(0.9, 0.12, 1.0, s * 0.85, -0.08, 0.1, dark);
    add(0.7, 0.1, 0.7, s * 1.55, -0.02, 0.0, dark);
    add(0.45, 0.08, 0.45, s * 2.05, 0.06, -0.15, dark);
    add(0.14, 0.1, 0.06, s * 0.15, -0.05, 1.21, glow);
  }
  const jets = [add(0.25, 0.25, 0.2, -0.25, -0.12, -0.9, jet), add(0.25, 0.25, 0.2, 0.25, -0.12, -0.9, jet)];
  g.userData.jets = jets;
  return g;
}

// ---------------------------------------------------------------------------
// Pose animator. Each pose returns target euler angles for the limbs.
const Z = [0, 0, 0];
function limbs(armL, armR, legL, legR, head = Z) {
  return { armL, armR, legL, legR, head };
}

export function poseTargets(name, t, p = {}) {
  const s = Math.sin(t);
  switch (name) {
    case 'idle':
      return limbs([0.05 * Math.sin(t * 0.3), 0, 0.08], [-0.05 * Math.sin(t * 0.3), 0, -0.08], Z, Z);
    case 'walk':
    case 'run': {
      const a = name === 'run' ? 1.1 : 0.6;
      return limbs([s * a, 0, 0.1], [-s * a, 0, -0.1], [-s * a, 0, 0], [s * a, 0, 0]);
    }
    case 'sprint':
      return limbs([0.9 + s * 0.3, 0, 0.3], [0.9 - s * 0.3, 0, -0.3], [-s * 1.3, 0, 0], [s * 1.3, 0, 0], [-0.3, 0, 0]);
    case 'swing':
      return limbs([-0.5, 0, 1.0], [-2.95, 0, -0.1], [-0.7, 0, 0.1], [0.25, 0, -0.1], [-0.2, 0, 0]);
    case 'jump':
      return limbs([-2.6, 0, 0.3], [-2.6, 0, -0.3], [-1.0, 0, 0], [-0.4, 0, 0]);
    case 'fall':
      return limbs([-0.4, 0, 1.9 + s * 0.08], [-0.4, 0, -1.9 - s * 0.08], [0.2, 0, 0.35], [0.2, 0, -0.35]);
    case 'dive':
      return limbs([0.5, 0, 0.35], [0.5, 0, -0.35], [0.1, 0, 0.08], [0.1, 0, -0.08], [-0.8, 0, 0]);
    case 'wall':
      return limbs([-2.5 + s * 0.5, 0, 0.4], [-2.5 - s * 0.5, 0, -0.4], [-0.9 - s * 0.5, 0, 0.3], [-0.9 + s * 0.5, 0, -0.3], [-0.5, 0, 0]);
    case 'zip':
      return limbs([-2.3, 0, 0.15], [-2.3, 0, -0.15], [0.3, 0, 0], [0.5, 0, 0]);
    case 'punchR':
      return limbs([-0.7, 0, 0.3], [-1.65, 0, 0.15], [0.4, 0, 0], [-0.5, 0, 0]);
    case 'punchL':
      return limbs([-1.65, 0, -0.15], [-0.7, 0, -0.3], [-0.5, 0, 0], [0.4, 0, 0]);
    case 'kick':
      return limbs([-0.3, 0, 1.2], [-0.3, 0, -1.2], [0.3, 0, 0], [-1.7, 0, 0]);
    case 'uppercut':
      return limbs([-0.4, 0, 0.5], [-2.9, 0, 0], [-0.6, 0, 0], [0.3, 0, 0]);
    case 'web':
      return limbs([-0.4, 0, 0.3], [-1.55, 0, 0.1], [0.2, 0, 0], [-0.2, 0, 0]);
    case 'windup':
      return limbs([-0.5, 0, 0.4], [1.0, 0, -0.3], [0.4, 0, 0], [-0.4, 0, 0]);
    case 'aim':
      return limbs([-1.4, -0.4, 0], [-1.55, 0, 0], Z, Z);
    case 'hurt':
      return limbs([-0.6, 0, 0.8], [-0.6, 0, -0.8], [0.3, 0, 0], [-0.3, 0, 0], [0.4, 0, 0]);
    case 'ko':
      return limbs([-3.0, 0, 0.3], [-3.0, 0, -0.3], [0, 0, 0.1], [0, 0, -0.1]);
    case 'webbed':
      return limbs([0, 0, 0.05], [0, 0, -0.05], [0, 0, 0], [0, 0, 0]);
    case 'cower':
      return limbs([-2.5, 0, 0.7], [-2.5, 0, -0.7], [-1.2, 0, 0.1], [-1.2, 0, -0.1], [0.4, 0, 0]);
    case 'wave':
      return limbs([0.1, 0, 0.1], [-2.8, 0, -0.5 + Math.sin(t * 3) * 0.4], Z, Z);
    case 'carried':
      return limbs([-0.3, 0, 0.6], [-1.2, 0, -0.4], [-1.2, 0, 0], [-1.0, 0, 0]);
    case 'fly':
      return limbs([-0.3, 0, 0.45], [-0.3, 0, -0.45], [0.05, 0, 0.12], [0.05, 0, -0.12]);
    case 'throw':
      return limbs([-0.3, 0, 0.45], [-2.7, 0, -0.2], [0.05, 0, 0.12], [0.05, 0, -0.12]);
    case 'dodge':
      return limbs([-2.0, 0, 0.6], [-2.0, 0, -0.6], [-1.5, 0, 0], [-1.5, 0, 0]);
    case 'heal':
      return limbs([-1.0, 0, -0.6], [-1.0, 0, 0.6], Z, Z, [0.3, 0, 0]);
    case 'talk':
      return limbs([-0.25 + Math.sin(t * 0.9) * 0.15, 0, 0.15], [-0.7 + Math.sin(t * 1.3) * 0.35, 0.2, -0.25], Z, Z, [Math.sin(t * 1.7) * 0.07, Math.sin(t * 0.6) * 0.12, 0]);
    case 'listen':
      return limbs([0.05, 0, 0.12], [0.05, 0, -0.12], Z, Z, [0.05 + Math.sin(t * 0.5) * 0.04, 0, 0]);
    case 'celebrate':
      return limbs([-3.0, 0, 0.3], [-3.0, 0, -0.3], Z, Z, [-0.3, 0, 0]);
    default:
      return limbs(Z, Z, Z, Z);
  }
}

export function animateRig(rig, name, t, dt, speed = 14) {
  const tg = poseTargets(name, t);
  const k = 1 - Math.exp(-speed * dt);
  for (const part of ['armL', 'armR', 'legL', 'legR', 'head']) {
    const r = rig[part].rotation;
    const v = tg[part];
    r.x += (v[0] - r.x) * k;
    r.y += (v[1] - r.y) * k;
    r.z += (v[2] - r.z) * k;
  }
}
