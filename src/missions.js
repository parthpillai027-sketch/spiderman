// Story missions (inspired by the 2002 film's story beats, all dialogue
// original), free-roam crimes and collectible backpacks.
import * as THREE from 'three';
import { Actor } from './npcs.js';
import { WATER_Y, SIDEWALK_H, X0, Z0, CELL } from './world.js';
import { tex } from './textures.js';
import { rand, pick, lerp, clamp } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Mission runtime context: everything a mission creates is registered here so
// it is torn down on completion, failure or retry.
class Ctx {
  constructor(mgr, def, index, opts) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.def = def;
    this.index = index;
    this.retry = !!opts.retry;
    this.replay = !!opts.replay;
    this.data = {};
    this.cleanups = [];
    this.actors = [];
    this.ticks = [];
    this.groups = new Set();
    this.timerLeft = null;
    this.onTimeout = null;
    this.failed = false;
  }
  get player() { return this.game.player; }
  get world() { return this.game.world; }
  marker(pos, opts = {}) {
    const m = this.game.markers.add(pos, opts);
    this.cleanups.push(() => this.game.markers.remove(m));
    return m;
  }
  removeMarker(m) {
    this.game.markers.remove(m);
  }
  add(obj) {
    this.game.scene.add(obj);
    this.cleanups.push(() => this.game.scene.remove(obj));
    return obj;
  }
  actor(skin, pos, opts) {
    const a = new Actor(this.game, skin, pos, opts);
    this.actors.push(a);
    this.cleanups.push(() => a.remove());
    return a;
  }
  target(t) {
    this.game.combat.register(t);
    this.cleanups.push(() => this.game.combat.unregister(t));
    return t;
  }
  spawn(center, types, group = 'mission', radius = 6) {
    this.groups.add(group);
    return this.game.enemies.spawnGroup(center, types, group, radius);
  }
  alive(group = 'mission') {
    return this.game.enemies.aliveIn(group);
  }
  every(fn) {
    this.ticks.push(fn);
  }
  objective(text) {
    this.game.hud.objective(this.def.title, text);
  }
  extra(text) {
    this.game.hud.extra(text);
  }
  timer(sec, onTimeout) {
    this.timerLeft = sec;
    this.onTimeout = onTimeout || (() => this.fail('Out of time!'));
  }
  clearTimer() {
    this.timerLeft = null;
    this.game.hud.timer(null);
  }
  say(name, text, dur = 4) {
    this.game.hud.say(name, text, dur);
  }
  tip(text, dur = 7) {
    this.game.hud.say('TIP', text, dur);
  }
  fail(reason) {
    this.mgr.fail(reason);
  }
  cleanup() {
    for (const fn of this.cleanups.reverse()) fn();
    this.cleanups = [];
    for (const gname of this.groups) this.game.enemies.clear(gname);
    this.game.goblin.deactivate();
    this.game.combat.clear();
    if (this.game.player.carrying) this.game.player.carrying = null;
    this.game.hud.prompt(null);
    this.game.hud.extra('');
    this.clearTimer();
  }
}

// ---- reusable steps -------------------------------------------------------------
function story(title, paragraphs) {
  return {
    story: true,
    enter(ctx) {
      ctx.storyDone = false;
      if (ctx.retry) {
        ctx.storyDone = true;
        return;
      }
      ctx.game.showStory(title, paragraphs).then(() => { ctx.storyDone = true; });
    },
    update: (ctx) => ctx.storyDone,
  };
}

function reach(text, posFn, radius, opts = {}) {
  return {
    text,
    enter(ctx) {
      ctx.data.reachPos = posFn(ctx);
      ctx.data.reachMarker = ctx.marker(ctx.data.reachPos, opts.marker || {});
      if (opts.tip) ctx.tip(opts.tip);
    },
    update(ctx) {
      const d = ctx.player.pos.distanceTo(ctx.data.reachPos);
      return d < radius && (!opts.grounded || ctx.player.state === 'ground');
    },
    exit(ctx) {
      ctx.removeMarker(ctx.data.reachMarker);
    },
  };
}

function onRoof(p, b) {
  return p.pos.y >= b.top - 0.4 && p.pos.x > b.x0 - 0.5 && p.pos.x < b.x1 + 0.5 && p.pos.z > b.z0 - 0.5 && p.pos.z < b.z1 + 0.5;
}

function nearestIntersection(p) {
  const i = clamp(Math.round((p.x - X0) / CELL), 1, 11);
  const j = clamp(Math.round((p.z - Z0) / CELL), 1, 11);
  return V(X0 + i * CELL, 0, Z0 + j * CELL);
}

function ring(ctx, pos) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35 });
  const S = 8, T = 0.7;
  for (const [w, h, d, y, z] of [[T, T, S + T, S / 2, 0], [T, T, S + T, -S / 2, 0], [T, S, T, 0, -S / 2], [T, S, T, 0, S / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(0, y, z);
    g.add(m);
  }
  g.position.copy(pos);
  ctx.add(g);
  return { g, mat, pos };
}

function defeatStep(text, group = 'mission') {
  return {
    text,
    update(ctx) {
      const n = ctx.alive(group);
      ctx.extra(`${n} remaining`);
      return n === 0;
    },
    exit(ctx) {
      ctx.extra('');
    },
  };
}

function bomb(ctx, pos, onDefuse) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshBasicMaterial({ map: tex('pumpkin') }));
  mesh.position.copy(pos);
  ctx.add(mesh);
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  light.position.y = 0.55;
  mesh.add(light);
  const t = {
    kind: 'bomb', alive: true, targetable: true, radius: 0.7, lockRange: 45, priority: 0.45, mesh, light,
    get center() { return mesh.position; },
    defuse() {
      if (!t.alive) return;
      t.alive = false;
      const web = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
      mesh.add(web);
      light.visible = false;
      ctx.game.hud.flash('BOMB DEFUSED');
      ctx.game.audio.play('pickup');
      onDefuse();
    },
    onHit() { t.defuse(); },
    onWebHit() { t.defuse(); },
  };
  return ctx.target(t);
}

function buildCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.1, 4.6), new THREE.MeshLambertMaterial({ color: 0x2b2d3a }));
  body.position.y = 0.85;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.85, 2.4), new THREE.MeshLambertMaterial({ color: 0x1a222c }));
  cab.position.set(0, 1.8, -0.3);
  g.add(body, cab);
  for (const x of [-1.05, 1.05]) for (const z of [-1.5, 1.5]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.8), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    w.position.set(x, 0.4, z);
    g.add(w);
  }
  const tl = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 0.1), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  tl.position.set(0, 1.1, -2.32);
  g.add(tl);
  for (const m of g.children) m.castShadow = true;
  return g;
}

function buildTram() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 3.5), new THREE.MeshLambertMaterial({ map: tex('tram') }));
  m.castShadow = true;
  const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 1.2), new THREE.MeshLambertMaterial({ color: 0x444444 }));
  top.position.y = 2.05;
  g.add(m, top);
  return g;
}

// ---------------------------------------------------------------------------
export const MISSIONS = [
  {
    id: 'great-power',
    title: 'With Great Power',
    start: (w) => w.landmarks.start.clone(),
    steps: [
      story('Chapter 1: With Great Power', [
        'Queens, New York. A week ago Peter Parker was a shy science kid who got picked last for everything.',
        'Then, on a class trip to a genetics lab, a genetically engineered spider bit him. Now he can stick to walls, feel danger before it happens - and the web-shooters he built in his bedroom actually work.',
        'Time to find out what he can really do.',
      ]),
      {
        text: 'Swing through the rings',
        enter(ctx) {
          const pts = [V(-195, 20, 0), V(-150, 24, 0), V(-105, 26, 0), V(-60, 24, 0), V(-15, 28, 0)];
          ctx.data.rings = pts.map((p) => ring(ctx, p));
          ctx.data.next = 0;
          ctx.data.ringMarker = ctx.marker(pts[0].clone().add(V(0, -2.2, 0)), { beam: false });
          ctx.data.rings[0].mat.opacity = 0.95;
          ctx.tip('Jump off the roof (SPACE / X), then HOLD SHIFT (R2) to web-swing. Steer with WASD. Release at the bottom of a swing to fly.', 9);
        },
        update(ctx) {
          const d = ctx.data;
          const r = d.rings[d.next];
          r.g.rotation.x += 0.02;
          ctx.extra(`${d.next}/${d.rings.length} rings`);
          if (ctx.player.center.distanceTo(r.pos) < 5) {
            ctx.game.particles.burst(r.pos, 24, { colors: [0xffd23f, 0xffffff], speed: 10, size: 0.3 });
            ctx.game.audio.play('pickup');
            r.g.visible = false;
            d.next++;
            if (d.next === 2) ctx.tip('Tap SPACE (X) mid-air for a web-zip boost. Jump while swinging to launch upward.', 7);
            if (d.next >= d.rings.length) return true;
            d.rings[d.next].mat.opacity = 0.95;
            d.ringMarker.pos.copy(d.rings[d.next].pos).add(V(0, -2.2, 0));
          }
          return false;
        },
        exit(ctx) {
          ctx.removeMarker(ctx.data.ringMarker);
          ctx.extra('');
        },
      },
      {
        text: 'Crawl up to the top of the marked building',
        enter(ctx) {
          const b = ctx.world.nearestBuilding(V(25, 0, -25), 45);
          ctx.data.climb = b;
          ctx.data.climbMarker = ctx.marker(ctx.world.roofPoint(b));
          ctx.tip('Run into any wall to stick to it and crawl. Hold SHIFT (R2) while on a wall to wall-run.', 8);
        },
        update: (ctx) => onRoof(ctx.player, ctx.data.climb),
        exit(ctx) { ctx.removeMarker(ctx.data.climbMarker); },
      },
      {
        text: 'Point-launch to the next rooftop',
        enter(ctx) {
          const a = ctx.data.climb;
          const from = ctx.world.roofPoint(a);
          let best = null, bs = Infinity;
          for (const b of ctx.world.buildings) {
            if (b === a || b.top < a.top - 35 || b.top > a.top + 15) continue;
            const d = from.distanceTo(ctx.world.roofPoint(b));
            if (d < 35 || d > 95) continue;
            const s = Math.abs(d - 55);
            if (s < bs) { bs = s; best = b; }
          }
          ctx.data.launch = best || ctx.world.nearestBuilding(from, 20, Infinity, a);
          ctx.data.launchMarker = ctx.marker(ctx.world.roofPoint(ctx.data.launch));
          ctx.tip('Aim the camera at a ledge until the white diamond appears, then press Q (R1) to zip there and launch off it.', 8);
        },
        update: (ctx) => onRoof(ctx.player, ctx.data.launch),
        exit(ctx) { ctx.removeMarker(ctx.data.launchMarker); },
      },
      {
        text: 'Stop the mugging',
        enter(ctx) {
          const p = nearestIntersection(ctx.world.roofPoint(ctx.data.launch));
          p.y = ctx.world.groundHeight(p.x, p.z, 5);
          ctx.data.mug = p;
          ctx.data.mugMarker = ctx.marker(p, { color: 0xff4040 });
        },
        update(ctx) {
          if (ctx.player.pos.distanceTo(ctx.data.mug) > 42) return false;
          const p = ctx.data.mug;
          ctx.spawn(p, ['brawler', 'brawler', 'gunner'], 'mission', 6);
          const civ = ctx.actor('civ2', V(p.x + 2, ctx.world.groundHeight(p.x + 2, p.z + 1, 5), p.z + 1));
          civ.pose = 'cower';
          ctx.data.civ = civ;
          ctx.say('Mugger', 'Wallet. Now. And the watch.', 3);
          ctx.tip('LEFT CLICK (Square) attacks and zips you to distant enemies. RIGHT CLICK (Triangle) webs them up. When your spider-sense flashes, DODGE with C (Circle).', 10);
          return true;
        },
        exit(ctx) { ctx.removeMarker(ctx.data.mugMarker); },
      },
      Object.assign(defeatStep('Defeat the muggers'), {
        exit(ctx) {
          ctx.extra('');
          ctx.data.civ.pose = 'wave';
          ctx.say('Civilian', 'Whoa... thank you! Who ARE you?', 4);
        },
      }),
      story('Not Bad For Day One', [
        'The muggers are wrapped up for the police, and the city has a new rumor: a masked kid in red and blue, swinging between rooftops.',
        'Peter is thrilled. The powers feel like a gift. He hasn\'t learned what they cost - yet.',
      ]),
    ],
  },
  {
    id: 'carjacker',
    title: 'The Carjacker',
    start: (w) => w.intersection(3, 4),
    reward: 'homemade',
    steps: [
      story('Chapter 2: The Carjacker', [
        'Peter needed money, so he took his powers into an underground wrestling ring. The promoter cheated him - and when a thief robbed that same promoter, Peter stepped aside and let him run.',
        'Tonight a carjacker shot Uncle Ben on a street corner in Queens. Uncle Ben didn\'t make it.',
        'The police say the killer is fleeing toward the warehouses by the river. Peter isn\'t waiting for the police.',
      ]),
      {
        text: 'Chase the getaway car - hit it with webs to slow it down',
        enter(ctx) {
          const path = [V(-150, 0, -100), V(150, 0, -100), V(150, 0, 250), V(178, 0, 250)];
          const car = ctx.add(buildCar());
          car.position.copy(path[0]);
          const d = ctx.data;
          Object.assign(d, { car, path, seg: 1, speed: 21, hits: 0, lost: 0, done: false });
          d.carMarker = ctx.marker(car.position.clone(), { color: 0xff4040, beam: false });
          d.carTarget = ctx.target({
            kind: 'car', alive: true, targetable: true, radius: 1.8, lockRange: 40, priority: 0.7,
            get center() { return car.position.clone().add(V(0, 1.2, 0)); },
            onWebHit() { hit(); },
            onHit() { hit(); },
          });
          const hit = () => {
            if (d.done) return;
            d.hits++;
            ctx.game.particles.burst(car.position.clone().add(V(0, 1.5, 0)), 10, { colors: [0xffffff, 0xcccccc], speed: 5, size: 0.3 });
            if (d.hits >= 6) {
              d.done = true;
              ctx.game.hud.flash('CAR STOPPED!');
              ctx.game.cameraRig.shake(0.4);
            }
          };
          ctx.tip('Swing after the car. RIGHT CLICK (Triangle) fires a web at it when it\'s in range.', 7);
          ctx.say('Police radio', 'Suspect vehicle heading east, dark sedan. All units...', 4);
        },
        update(ctx, dt) {
          const d = ctx.data;
          const car = d.car;
          if (!d.done) {
            d.speed = Math.max(9, 21 - d.hits * 2);
            let move = d.speed * dt;
            while (move > 0 && d.seg < d.path.length) {
              const tgt = d.path[d.seg];
              const dir = tgt.clone().sub(car.position);
              const len = dir.length();
              if (len <= move) {
                car.position.copy(tgt);
                move -= len;
                d.seg++;
              } else {
                car.position.addScaledVector(dir, move / len);
                car.rotation.y = Math.atan2(dir.x, dir.z);
                move = 0;
              }
            }
            if (d.seg >= d.path.length) d.done = true;
            ctx.game.peds.panicAt(car.position);
          }
          if (d.hits >= 3) ctx.game.particles.spawn(car.position.clone().add(V(0, 1.2, 0)), V(rand(-1, 1), 3, rand(-1, 1)), pick([0x444444, 0x666666]), 0.6, 1.0, 1, 0.5);
          d.carMarker.pos.copy(car.position).add(V(0, 2, 0));
          const dist = ctx.player.pos.distanceTo(car.position);
          ctx.extra(`Webs on car: ${d.hits}/6${dist > 120 ? '  -  DON\'T LOSE HIM!' : ''}`);
          d.lost = dist > 170 ? d.lost + dt : 0;
          if (d.lost > 8) ctx.fail('The carjacker got away.');
          return d.done;
        },
        exit(ctx) {
          ctx.data.carTarget.alive = false;
          ctx.removeMarker(ctx.data.carMarker);
          ctx.extra('');
        },
      },
      {
        text: 'Take down the carjacker and his crew',
        enter(ctx) {
          const c = ctx.data.car.position;
          ctx.spawn(c.clone().add(V(0, 0, -4)), ['burglar', 'brawler', 'brawler', 'gunner'], 'mission', 6);
          ctx.say('Carjacker', 'Back off, freak! You don\'t know who you\'re messing with!', 4);
        },
        update(ctx) {
          const n = ctx.alive();
          ctx.extra(`${n} remaining`);
          return n === 0;
        },
      },
      story('Responsibility', [
        'Under the warehouse lights, Peter finally sees the carjacker\'s face. It\'s the thief he let walk away.',
        'Uncle Ben always said that power means owing something to the people around you. Peter understands now. Spider-Man won\'t look the other way again.',
        'New suit unlocked: Homemade Suit (Pause > Suits).',
      ]),
    ],
  },
  {
    id: 'crime-wave',
    title: 'Crime Wave',
    start: (w) => w.roofPoint(w.landmarks.bugle),
    steps: [
      story('Chapter 3: Crime Wave', [
        'A few months later, Spider-Man is the talk of the city. The Daily Bugle calls him a menace on the front page - and pays Peter for the photos on page two.',
        'Tonight the police scanner won\'t stop crackling. Three crimes in progress across Manhattan.',
      ]),
      {
        text: 'Stop the crimes in progress',
        enter(ctx) {
          const sites = [[3, 3, ['brawler', 'brawler', 'brawler', 'gunner']], [8, 6, ['brawler', 'brawler', 'gunner', 'gunner']], [4, 9, ['brute', 'brawler', 'brawler', 'gunner']]];
          ctx.data.sites = sites.map(([i, j, types], k) => {
            const pos = ctx.world.intersection(i, j);
            return { pos, types, group: `crime${k}`, state: 'pending', marker: ctx.marker(pos, { color: 0xff4040 }) };
          });
          ctx.say('Police scanner', 'Armed robbery in progress... assault reported... all units respond.', 4);
        },
        update(ctx) {
          let done = 0;
          for (const s of ctx.data.sites) {
            if (s.state === 'pending' && ctx.player.pos.distanceTo(s.pos) < 45) {
              s.state = 'active';
              ctx.spawn(s.pos, s.types, s.group, 6);
              ctx.game.peds.panicAt(s.pos);
            } else if (s.state === 'active' && ctx.alive(s.group) === 0) {
              s.state = 'done';
              ctx.removeMarker(s.marker);
              ctx.game.hud.flash('CRIME STOPPED');
              ctx.game.audio.play('success');
            }
            if (s.state === 'done') done++;
          }
          ctx.extra(`${done}/3 crimes stopped`);
          return done === 3;
        },
      },
      story('Front Page', [
        'THE DAILY BUGLE: "WALL-CRAWLER STRIKES AGAIN - HERO, OR MENACE IN A MASK?"',
        '"Who wears a mask if he\'s got nothing to hide? I want pictures, Parker. Good ones!" - The Bugle\'s editor-in-chief.',
        'Meanwhile at Oscorp, Norman Osborn has tested an unstable performance formula on himself. Something inside him has changed.',
      ]),
    ],
  },
  {
    id: 'unity-day',
    title: 'Unity Day',
    start: (w) => w.landmarks.plaza.clone().add(V(0, 0, 12)),
    steps: [
      story('Chapter 4: Unity Day', [
        'Oscorp\'s board has voted to sell the company out from under Norman Osborn. Today they celebrate at the city\'s Unity Festival.',
        'Mary Jane Watson - the girl next door Peter has loved since he was six - is somewhere in the crowd.',
        'Then a figure on a bat-winged glider comes screaming out of the sky, laughing like a madman.',
      ]),
      {
        text: 'Defuse the pumpkin bombs before they go off',
        enter(ctx) {
          const w = ctx.world;
          const P = w.landmarks.plaza;
          const B = w.blockRect(6, 5);
          const pts = [V(P.x, SIDEWALK_H + 2.45, B.z0 + 7)];
          for (const b of w.landmarks.balloons) pts.push(b.clone().add(V(1.8, 0.4, 1.8)));
          pts.push(V(B.x1 - 2, SIDEWALK_H + 14.45, P.z));
          ctx.data.defused = 0;
          ctx.data.bombs = pts.map((p) => bomb(ctx, p, () => { ctx.data.defused++; }));
          ctx.game.goblin.activate(P.clone().add(V(0, 40, -40)), { mode: 'harass' });
          ctx.game.goblin.say('Good afternoon, ladies and gentlemen... the party\'s over!');
          ctx.game.peds.panicAt(P);
          ctx.timer(90, () => {
            for (const b of ctx.data.bombs) if (b.alive) ctx.game.combat.explode(b.center.clone(), 7, 30);
            ctx.fail('The pumpkin bombs went off!');
          });
          ctx.tip('Bombs can be webbed (RIGHT CLICK / Triangle) from range or punched up close. Dodge the Goblin\'s throws when your spider-sense flashes!', 9);
        },
        update(ctx) {
          const t = performance.now() / 200;
          for (const b of ctx.data.bombs) if (b.alive) b.light.visible = Math.sin(t) > 0;
          ctx.extra(`${ctx.data.defused}/${ctx.data.bombs.length} bombs`);
          return ctx.data.defused >= ctx.data.bombs.length;
        },
        exit(ctx) { ctx.clearTimer(); ctx.extra(''); },
      },
      {
        text: 'Drive off the Green Goblin',
        enter(ctx) {
          const gob = ctx.game.goblin;
          gob.hp = 320;
          gob.fleeAt = 160;
          gob.setMode('fight');
          ctx.data.fled = false;
          gob.onFlee = () => { ctx.data.fled = true; ctx.data.fledAt = performance.now(); };
          gob.say('You\'ve got a bad habit of spoiling my fun!');
          ctx.tip('Web the Goblin\'s glider (RIGHT CLICK / Triangle) to jam it, or perfect-dodge his dash. Then hit him hard while he\'s down!', 9);
        },
        update: (ctx) => ctx.data.fled && performance.now() - ctx.data.fledAt > 2500,
      },
      story('A New Enemy', [
        'The board members are safe, but the masked attacker escaped. By morning the papers have given him a name: the Green Goblin.',
        'And when Spider-Man caught Mary Jane falling from a festival balcony, she held on a little longer than she needed to.',
      ]),
    ],
  },
  {
    id: 'up-in-flames',
    title: 'Up In Flames',
    start: (w) => {
      const b = w.landmarks.burning;
      return V((b.x0 + b.x1) / 2, SIDEWALK_H, b.z1 + 9);
    },
    steps: [
      story('Chapter 5: Up In Flames', [
        'The Goblin wants Spider-Man\'s attention, and he knows exactly how to get it.',
        'An apartment building is burning. People are trapped on the balconies and the roof, and the fire ladders can\'t reach high enough.',
      ]),
      {
        text: 'Rescue the trapped civilians',
        enter(ctx) {
          const b = ctx.world.landmarks.burning;
          const skins = ['civ0', 'civ1', 'civ3', 'civ2'];
          ctx.data.civs = b.ledges.map((p, k) => {
            const a = ctx.actor(skins[k % skins.length], p.clone(), { facing: 0 });
            a.pose = k % 2 ? 'cower' : 'wave';
            a.marker = ctx.marker(p.clone(), { color: 0x7dd3ff, beam: false });
            return a;
          });
          ctx.data.saved = 0;
          const fires = [];
          for (let k = 0; k < 40; k++) {
            const face = k % 3;
            const y = lerp(SIDEWALK_H + 3, b.top - 1, Math.random());
            if (face === 0) fires.push(V(lerp(b.x0 + 1, b.x1 - 1, Math.random()), y, b.z1 + 0.3));
            else if (face === 1) fires.push(V(b.x0 - 0.3, y, lerp(b.z0 + 1, b.z1 - 1, Math.random())));
            else fires.push(V(b.x1 + 0.3, y, lerp(b.z0 + 1, b.z1 - 1, Math.random())));
          }
          ctx.data.fires = fires;
          ctx.every(() => {
            if (ctx.player.pos.distanceTo(fires[0]) > 260) return;
            for (let k = 0; k < 5; k++) {
              const f = pick(fires);
              ctx.game.particles.spawn(f, V(rand(-0.6, 0.6), rand(2, 4), rand(-0.6, 0.6)), pick([0xff5a1a, 0xff9a1a, 0xffd84a]), rand(0.4, 0.9), 0.8, 2, 0.5);
            }
            const r = ctx.world.roofPoint(b);
            ctx.game.particles.spawn(r.add(V(rand(-8, 8), 1, rand(-8, 8))), V(rand(-1, 1), 5, rand(-1, 1)), pick([0x333333, 0x4a4a4a, 0x222222]), rand(1.2, 2.2), 2.4, 1.5, 0.3);
          });
          ctx.timer(150, () => ctx.fail('The fire spread too far.'));
          ctx.tip('Get close to each trapped civilian and press E (L2) to web them down to safety.', 7);
        },
        update(ctx, dt) {
          const p = ctx.player;
          const b = ctx.world.landmarks.burning;
          let promptShown = false;
          let landed = 0;
          ctx.data.civs.forEach((c, k) => {
            if (c.rescue) {
              const r = c.rescue;
              r.t = Math.min(1, r.t + dt / 2.2);
              const e = r.t * r.t * (3 - 2 * r.t);
              c.pos.lerpVectors(r.from, r.to, e);
              c.pos.y += Math.sin(r.t * Math.PI) * 2;
              c.pose = r.t < 1 ? 'carried' : 'wave';
              if (r.t < 1) ctx.game.lines.line(V(c.pos.x, b.top, b.z1), c.center, 0.05);
              else landed++;
              return;
            }
            if (!promptShown && p.center.distanceTo(c.center) < 3.2) {
              promptShown = true;
              ctx.game.hud.prompt('Press E (L2) to rescue');
              if (ctx.game.input.pressed('interact')) {
                c.rescue = { t: 0, from: c.pos.clone(), to: V(c.pos.x, SIDEWALK_H, b.z1 + 5 + k * 1.5) };
                ctx.removeMarker(c.marker);
                ctx.data.saved++;
                ctx.game.audio.play('thwip');
                ctx.say(['Woman', 'Man', 'Kid', 'Woman'][k % 4], pick(['Thank you, Spider-Man!', 'I thought I was done for!', 'You saved my life!']), 3);
              }
            }
          });
          if (!promptShown) ctx.game.hud.prompt(null);
          ctx.extra(`${ctx.data.saved}/${ctx.data.civs.length} rescued`);
          return landed === ctx.data.civs.length;
        },
        exit(ctx) { ctx.clearTimer(); ctx.game.hud.prompt(null); ctx.extra(''); },
      },
      story('An Offer Refused', [
        'As the last family reached the street, a familiar cackle echoed through the smoke. The Goblin waited on a rooftop - not to fight, but to talk.',
        '"We\'re the same, you and I. Join me, and this city will kneel." Spider-Man refused. The Goblin promised he would regret it.',
        'Days later, at Thanksgiving dinner, Norman Osborn noticed a fresh cut on Peter\'s arm - exactly where the Goblin had wounded Spider-Man.',
      ]),
    ],
  },
  {
    id: 'the-bridge',
    title: 'The Bridge',
    start: (w) => V(296, SIDEWALK_H, 0),
    reward: 'damaged',
    steps: [
      story('Chapter 6: The Bridge', [
        'The Goblin knows who is under the mask - and what Peter loves most.',
        'He has taken Mary Jane high above the Queensboro Bridge. Below the deck, a tram full of passengers hangs by a single fraying cable.',
        '"Let\'s see what a hero is really made of," he cackles. "Choose!"',
      ]),
      {
        text: 'Get to the bridge',
        enter(ctx) {
          const gob = ctx.game.goblin;
          const hold = V(360, 72, -22);
          gob.activate(hold, { mode: 'hold' });
          const mj = ctx.actor('mj', hold.clone().add(V(0, -2.4, 0)));
          mj.pose = 'carried';
          ctx.data.mj = mj;
          const tram = ctx.add(buildTram());
          tram.position.set(395, 11, -14);
          ctx.data.tram = tram;
          ctx.every(() => {
            const t = ctx.data.tram;
            if (!ctx.data.tramSaved) ctx.game.lines.line(V(t.position.x, t.position.y + 2.3, t.position.z), V(395, 22.2, -7.2), 0.12, 0x333333);
            if (ctx.data.holding) {
              mj.pos.copy(gob.pos).add(V(0, -2.4, 0));
              mj.facing = gob.facing;
            }
          });
          ctx.data.holding = true;
          ctx.data.goalMarker = ctx.marker(hold.clone().add(V(0, -6, 0)), { color: 0x7dff4a, beam: false });
          ctx.say('Mary Jane', 'Spider-Man! Help!', 4);
        },
        update: (ctx) => ctx.player.pos.distanceTo(ctx.game.goblin.pos) < 38,
        exit(ctx) { ctx.removeMarker(ctx.data.goalMarker); },
      },
      {
        text: 'Catch Mary Jane!',
        enter(ctx) {
          const mj = ctx.data.mj;
          ctx.data.holding = false;
          mj.fall = { gravity: 7, terminal: 10 };
          mj.vel.set(0, 0, 0);
          mj.pose = 'cower';
          const gob = ctx.game.goblin;
          gob.holdPos.set(380, 88, -45);
          gob.say('Catch, Spider-Man!');
          ctx.data.mjMarker = ctx.marker(mj.pos.clone(), { color: 0xff7ad9, beam: false });
        },
        update(ctx) {
          const mj = ctx.data.mj;
          ctx.data.mjMarker.pos.copy(mj.pos).add(V(0, -1, 0));
          if (ctx.player.center.distanceTo(mj.center) < 3) {
            mj.fall = null;
            mj.vel.set(0, 0, 0);
            mj.pose = 'carried';
            mj.rig.tilt.rotation.x = 0;
            ctx.player.carrying = mj;
            ctx.game.hud.flash('CAUGHT HER!');
            ctx.game.audio.play('success');
            ctx.say('Mary Jane', 'You came!', 3);
            return true;
          }
          const ground = ctx.world.groundHeight(mj.pos.x, mj.pos.z, mj.pos.y + 0.2);
          if (mj.pos.y < WATER_Y + 0.4 || mj.pos.y <= ground + 0.05) ctx.fail('Mary Jane fell!');
          return false;
        },
        exit(ctx) { ctx.removeMarker(ctx.data.mjMarker); },
      },
      {
        text: 'Bring Mary Jane to safety on the bridge deck',
        enter(ctx) {
          ctx.data.safe = V(310, 26, 2);
          ctx.data.safeMarker = ctx.marker(ctx.data.safe, { color: 0x7dff4a, height: 30 });
        },
        update: (ctx) => ctx.player.pos.distanceTo(ctx.data.safe) < 6 && ctx.player.onGround(),
        exit(ctx) {
          ctx.removeMarker(ctx.data.safeMarker);
          const mj = ctx.data.mj;
          ctx.player.carrying = null;
          mj.pos.copy(ctx.data.safe);
          mj.facing = Math.PI / 2;
          mj.pose = 'idle';
          ctx.say('Mary Jane', 'The tram - those people!', 3);
        },
      },
      {
        text: 'Save the tram before the cable snaps',
        enter(ctx) {
          ctx.data.pull = 0;
          ctx.data.tramMarker = ctx.marker(ctx.data.tram.position.clone().add(V(0, 1, 0)), { color: 0xffd23f, beam: false });
          ctx.timer(50, () => {
            ctx.data.tram.visible = false;
            ctx.game.particles.burst(V(395, WATER_Y, -14), 40, { colors: [0x9cc8ff, 0xffffff], speed: 12, size: 0.5, up: 10 });
            ctx.fail('The tram cable snapped!');
          });
          ctx.tip('Get next to the tram and HOLD E (L2) to haul it up.', 6);
        },
        update(ctx, dt) {
          const t = ctx.data.tram;
          if (ctx.data.lift !== undefined) {
            ctx.data.lift = Math.min(1, ctx.data.lift + dt / 2);
            t.position.lerpVectors(V(395, 11, -14), V(395, 27.75, -2), ctx.data.lift * ctx.data.lift);
            return ctx.data.lift >= 1;
          }
          if (Math.random() < 0.3) ctx.game.particles.spawn(V(395, 22.2, -7.2), V(rand(-3, 3), rand(0, 3), rand(-3, 3)), 0xffe27a, 0.15, 0.4);
          const near = ctx.player.center.distanceTo(t.position) < 5.5;
          if (near) {
            if (ctx.game.input.down('interact')) ctx.data.pull = Math.min(1, ctx.data.pull + dt / 2.5);
            else ctx.data.pull = Math.max(0, ctx.data.pull - dt * 0.5);
            ctx.game.hud.prompt('Hold E (L2) to pull the tram up', ctx.data.pull);
            if (ctx.data.pull >= 1) {
              ctx.data.lift = 0;
              ctx.data.tramSaved = true;
              ctx.clearTimer();
              ctx.game.hud.prompt(null);
              ctx.game.hud.flash('TRAM SAVED!');
              ctx.game.audio.play('success');
            }
          } else {
            ctx.game.hud.prompt(null);
          }
          return false;
        },
        exit(ctx) { ctx.removeMarker(ctx.data.tramMarker); ctx.game.hud.prompt(null); },
      },
      {
        text: 'Defeat the Green Goblin',
        enter(ctx) {
          const gob = ctx.game.goblin;
          gob.hp = 320;
          gob.fleeAt = 0;
          gob.setMode('fight');
          ctx.data.down = false;
          gob.onDefeat = () => { ctx.data.down = true; ctx.data.downAt = performance.now(); };
          gob.say('You spoiled everything! Now it\'s just you and me!');
        },
        update: (ctx) => ctx.data.down && performance.now() - ctx.data.downAt > 3000,
      },
      story('The End Of The Goblin', [
        'The Goblin lies beside his wrecked glider. Behind the mask is Norman Osborn - the father of Peter\'s best friend, Harry.',
        'Spider-Man carries Norman home so Harry never has to learn the truth. Not yet.',
        'At the cemetery, Mary Jane tells Peter she loves him. He tells her he can only be her friend. Some secrets you carry alone.',
        'It\'s a gift and a burden, and he has chosen to carry both. The city has its hero.',
        'THANKS FOR PLAYING! Free roam is open. Battle-Damaged Suit unlocked.',
      ]),
    ],
  },
];

// ---------------------------------------------------------------------------
export class MissionManager {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.startMarker = null;
    this.failTimer = 0;
    this.crimes = new Crimes(game);
    this.collectibles = new Collectibles(game);
  }

  get index() {
    return this.game.save.missionIndex;
  }

  start(i, opts = {}) {
    this.crimes.clear();
    this.removeStartMarker();
    if (this.active) this.active.ctx.cleanup();
    const def = MISSIONS[i];
    const ctx = new Ctx(this, def, i, opts);
    this.active = { def, ctx, step: -1 };
    this.game.hud.toast(def.title.toUpperCase(), `Mission ${i + 1} of ${MISSIONS.length}`);
    this.game.save.started = true;
    this.nextStep();
  }

  nextStep() {
    const a = this.active;
    const prev = a.def.steps[a.step];
    if (prev && prev.exit) prev.exit(a.ctx);
    a.step++;
    if (a.step >= a.def.steps.length) {
      this.complete();
      return;
    }
    const s = a.def.steps[a.step];
    if (s.text) a.ctx.objective(s.text);
    if (s.enter) s.enter(a.ctx);
  }

  update(dt) {
    this.collectibles.update(dt);
    if (this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) this.retry();
      return;
    }
    if (!this.active) {
      this.freeRoam(dt);
      return;
    }
    const a = this.active;
    const ctx = a.ctx;
    if (ctx.timerLeft !== null) {
      ctx.timerLeft -= dt;
      this.game.hud.timer(Math.max(0, ctx.timerLeft));
      if (ctx.timerLeft <= 0) {
        ctx.timerLeft = null;
        this.game.hud.timer(null);
        ctx.onTimeout();
        if (ctx.failed) return;
      }
    }
    for (const act of ctx.actors) act.update(dt);
    for (const fn of ctx.ticks) fn(dt);
    const s = a.def.steps[a.step];
    if (s && s.update && s.update(ctx, dt) && this.active === a && !ctx.failed) this.nextStep();
  }

  freeRoam(dt) {
    const i = this.index;
    const hud = this.game.hud;
    if (i < MISSIONS.length) {
      const def = MISSIONS[i];
      if (!this.startMarker) {
        this.startPos = def.start(this.game.world);
        this.startMarker = this.game.markers.add(this.startPos, { color: 0xffd23f });
        hud.objective(`Next: ${def.title}`, 'Go to the yellow beam to start the mission');
      }
      if (this.game.player.pos.distanceTo(this.startPos) < 8) this.start(i);
    } else if (!this.freeRoamShown) {
      this.freeRoamShown = true;
      hud.objective('Free Roam', 'Stop crimes and find all the hidden backpacks');
    }
    this.crimes.update(dt);
  }

  removeStartMarker() {
    if (this.startMarker) this.game.markers.remove(this.startMarker);
    this.startMarker = null;
  }

  complete() {
    const a = this.active;
    const def = a.def;
    a.ctx.cleanup();
    this.active = null;
    const save = this.game.save;
    save.missionIndex = Math.max(save.missionIndex, a.ctx.index + 1);
    if (def.reward && !save.suits.includes(def.reward)) save.suits.push(def.reward);
    if (a.ctx.index === MISSIONS.length - 1) save.finished = true;
    this.game.persist();
    this.game.hud.toast('MISSION COMPLETE', def.title, 4);
    this.game.hud.boss(null);
    this.game.audio.play('success');
    this.freeRoamShown = false;
    this.crimes.cooldown = 30;
  }

  fail(reason) {
    const a = this.active;
    if (!a || a.ctx.failed) return;
    a.ctx.failed = true;
    this.game.hud.toast('MISSION FAILED', reason, 3);
    this.game.audio.play('fail');
    this.failTimer = 3;
  }

  retry() {
    const a = this.active;
    if (!a) return;
    a.ctx.cleanup();
    const i = a.ctx.index;
    const replay = a.ctx.replay;
    this.active = null;
    const pos = MISSIONS[i].start(this.game.world);
    this.game.player.spawn(pos.clone().add(V(0, 1, 0)));
    this.start(i, { retry: true, replay });
  }

  abort() {
    if (this.active) this.active.ctx.cleanup();
    this.active = null;
    this.failTimer = 0;
    this.removeStartMarker();
    this.game.hud.objective(null);
  }
}

// ---------------------------------------------------------------------------
// Free-roam street crimes (unlocked after Chapter 2).
class Crimes {
  constructor(game) {
    this.game = game;
    this.crime = null;
    this.cooldown = 25;
  }
  clear() {
    if (this.crime) {
      this.game.markers.remove(this.crime.marker);
      this.game.enemies.clear('crime');
    }
    this.crime = null;
  }
  update(dt) {
    const g = this.game;
    if (g.save.missionIndex < 2) return;
    const p = g.player.pos;
    if (!this.crime) {
      this.cooldown -= dt;
      if (this.cooldown > 0) return;
      for (let k = 0; k < 20; k++) {
        const pos = g.world.intersection(1 + Math.floor(Math.random() * 11), 1 + Math.floor(Math.random() * 11));
        const d = pos.distanceTo(p);
        if (d > 70 && d < 230) {
          this.crime = { pos, state: 'pending', life: 150, marker: g.markers.add(pos, { color: 0xff4040, primary: false }) };
          g.hud.notify(pick(['POLICE SCANNER: Robbery in progress!', 'POLICE SCANNER: Assault reported!', 'POLICE SCANNER: Gang activity nearby!']), 4);
          break;
        }
      }
      return;
    }
    const c = this.crime;
    c.life -= dt;
    if (c.state === 'pending') {
      if (p.distanceTo(c.pos) < 45) {
        c.state = 'active';
        const types = pick([['brawler', 'brawler', 'gunner'], ['brawler', 'brawler', 'brawler', 'gunner'], ['brute', 'brawler', 'gunner'], ['gunner', 'gunner', 'brawler', 'brawler']]);
        g.enemies.spawnGroup(c.pos, types, 'crime', 6);
        g.peds.panicAt(c.pos);
      } else if (c.life <= 0) {
        this.clear();
        this.cooldown = 20;
      }
    } else if (c.state === 'active' && g.enemies.aliveIn('crime') === 0) {
      g.save.crimes++;
      g.persist();
      g.hud.toast('CRIME STOPPED', `${g.save.crimes} crimes stopped total`, 2.5);
      g.audio.play('success');
      g.player.focus = Math.min(100, g.player.focus + 20);
      this.game.markers.remove(c.marker);
      this.crime = null;
      this.cooldown = rand(35, 60);
    }
  }
}

// ---------------------------------------------------------------------------
// Peter's lost backpacks, hidden on rooftops across Manhattan.
const MEMORIES = [
  'A note from Aunt May: "Wheat germ in your lunch. Don\'t make a face."',
  'A second-place science fair ribbon. Still bitter about the volcano kid.',
  'A photo of Uncle Ben teaching Peter to drive. Neither of them is smiling.',
  'A library card with forty-two dollars in late fees.',
  'A homemade web-fluid recipe, three attempts crossed out.',
  'A ticket stub from the school play. MJ was the lead. Peter ran the lights.',
  'A broken camera lens. Spider-Man photos are hard on equipment.',
  'Harry\'s old chess set, missing one knight.',
  'A sketch of a spider emblem, scribbled in the margins of a chemistry exam.',
  'A crumpled Daily Bugle with "PAYS $300?!" circled in red pen.',
  'A Polaroid of Peter, Harry and MJ at Coney Island.',
  'Uncle Ben\'s old wristwatch. Peter thought he\'d lost it forever.',
];

class Collectibles {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.built = false;
  }
  build() {
    this.built = true;
    const g = this.game;
    const spots = g.world.backpackSpots;
    this.total = spots.length;
    const mat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x4a301a });
    const red = new THREE.MeshLambertMaterial({ color: 0xb3121b });
    spots.forEach((pos, k) => {
      if (g.save.backpacks.includes(k)) return;
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.95, 0.45), mat);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.35, 0.5), dark);
      flap.position.y = 0.32;
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.05), red);
      badge.position.set(0, 0.0, 0.25);
      grp.add(body, flap, badge);
      grp.position.copy(pos).add(V(0, 0.9, 0));
      g.scene.add(grp);
      const marker = g.markers.add(pos, { color: 0x9fd3ff, primary: false, height: 14, radius: 0.35 });
      this.items.push({ k, grp, marker, base: grp.position.y });
    });
    this.refresh();
  }
  refresh() {
    this.game.hud.collectibles(this.game.save.backpacks.length, this.total);
  }
  update(dt) {
    if (!this.built) this.build();
    const g = this.game;
    const t = performance.now() / 1000;
    for (const it of [...this.items]) {
      it.grp.rotation.y += dt * 1.5;
      it.grp.position.y = it.base + Math.sin(t * 2 + it.k) * 0.15;
      if (g.player.center.distanceTo(it.grp.position) < 2.4) {
        g.scene.remove(it.grp);
        g.markers.remove(it.marker);
        this.items.splice(this.items.indexOf(it), 1);
        g.save.backpacks.push(it.k);
        g.persist();
        g.audio.play('pickup');
        g.hud.toast(`BACKPACK ${g.save.backpacks.length}/${this.total}`, MEMORIES[it.k % MEMORIES.length], 5);
        this.refresh();
      }
    }
  }
  reset() {
    for (const it of this.items) {
      this.game.scene.remove(it.grp);
      this.game.markers.remove(it.marker);
    }
    this.items = [];
    this.built = false;
  }
}
