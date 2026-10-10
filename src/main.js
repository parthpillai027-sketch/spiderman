// Spider-Man: Block City - bootstrap, game loop, menus.
import * as THREE from '../vendor/three.module.min.js';
import { World } from './world.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { Particles, Lines, Markers } from './effects.js';
import { Combat } from './combat.js';
import { EnemyManager } from './enemies.js';
import { Goblin } from './goblin.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Traffic, Pedestrians } from './npcs.js';
import { HUD } from './hud.js';
import { MissionManager, MISSIONS } from './missions.js';
import { loadSave, writeSave, defaultSave } from './save.js';
import { SUITS } from './skins.js';
import { mulberry32 } from './util.js';

const $ = (id) => document.getElementById(id);

// Time-of-day presets. Missions can force one (the film's finale is at night).
const TOD = {
  day: {
    top: 0x3f74c8, mid: 0x9cc6f0, bottom: 0xf3d2ad, fog: 0xcdd9e6, fogNear: 160, fogFar: 820,
    hemiSky: 0xd6e6ff, hemiGround: 0x8a7a66, hemi: 1.25, sun: 0xfff0d8, sunI: 2.3, dir: [-0.45, 0.78, 0.33],
    glow: 0, disc: 0xfff6c8, stars: 0, cloud: 0x999999,
  },
  dusk: {
    top: 0x23356e, mid: 0xc9806a, bottom: 0xffa860, fog: 0xc98a72, fogNear: 140, fogFar: 720,
    hemiSky: 0xffc8a0, hemiGround: 0x5a4a5a, hemi: 0.95, sun: 0xff9a5a, sunI: 1.7, dir: [-0.85, 0.28, 0.3],
    glow: 0.7, disc: 0xffa860, stars: 0.25, cloud: 0x8a5a50,
  },
  night: {
    top: 0x03061a, mid: 0x0c1534, bottom: 0x1e2c58, fog: 0x10182f, fogNear: 110, fogFar: 640,
    hemiSky: 0x7080c0, hemiGround: 0x202030, hemi: 0.6, sun: 0x9fb4ff, sunI: 0.7, dir: [0.4, 0.72, -0.4],
    glow: 1.15, disc: 0xe8eeff, stars: 1, cloud: 0x1a2038,
  },
};
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

class Game {
  constructor() {
    this.canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcdd9e6, 160, 820);
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2000);
    this.clock = new THREE.Clock();

    this.save = loadSave();
    this.state = 'loading';
    this.slowT = 0;
    this.slowScale = 1;
    this.hitstopT = 0;
    this.respawnT = 0;
    this.godMode = false;
    this.time = 0;

    this.setupLights();
    this.setupSky();

    this.input = new Input(this.canvas);
    this.audio = new AudioSys();
    this.particles = new Particles(this.scene);
    this.lines = new Lines(this.scene);
    this.markers = new Markers(this.scene);
    this.world = new World(this.scene);
    this.combat = new Combat(this);
    this.enemies = new EnemyManager(this);
    this.goblin = new Goblin(this);
    this.player = new Player(this);
    this.cameraRig = new CameraRig(this, this.camera);
    this.traffic = new Traffic(this);
    this.peds = new Pedestrians(this);
    this.hud = new HUD(this);
    this.hud.buildMap(this.world);
    this.missions = new MissionManager(this);

    this.player.setSuit(this.save.suit);
    this.player.spawn(this.world.landmarks.start.clone().add(new THREE.Vector3(0, 0.5, 0)));

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.input.usingPad) this.pause();
    };
    window.addEventListener('resize', () => this.resize());
    this.setupMenus();
    if (DEBUG) this.setupDebug();
    window.__game = this;

    $('loading').classList.add('hidden');
    this.showTitle();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- scene dressing ---------------------------------------------------------
  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xd6e6ff, 0x8a7a66, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    this.sunDir = new THREE.Vector3(-0.45, 0.78, 0.33).normalize();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -110; s.right = 110; s.top = 110; s.bottom = -110; s.near = 10; s.far = 900;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
  }

  setupSky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(0x3f74c8) },
        mid: { value: new THREE.Color(0x9cc6f0) },
        bottom: { value: new THREE.Color(0xf3d2ad) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = mix(mid, top, pow(clamp(h * 1.5, 0.0, 1.0), 0.7));
        c = mix(bottom, c, smoothstep(-0.05, 0.22, h)); gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    // a square, Minecraft-style sun
    this.sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false }));
    this.scene.add(this.sunDisc);

    // flat voxel cloud layer, periodic so it can scroll forever
    const r = mulberry32(5);
    const cell = 24, n = 40, period = cell * n;
    const cells = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = Math.sin(i * 0.55) + Math.cos(j * 0.45) + Math.sin((i + j) * 0.3) + r() * 1.2;
      if (v > 1.4) cells.push([i * cell, j * cell]);
    }
    const tiles = [-1, 0, 1];
    const count = cells.length * 9;
    const clouds = new THREE.InstancedMesh(new THREE.BoxGeometry(cell, 6, cell), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, emissive: 0x999999 }), count);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const tx of tiles) for (const tz of tiles) for (const [x, z] of cells) {
      m.makeTranslation(x + tx * period - period / 2, 230, z + tz * period - period / 2);
      clouds.setMatrixAt(k++, m);
    }
    this.clouds = clouds;
    this.cloudPeriod = period;
    this.scene.add(clouds);

    const starPos = [];
    for (let i = 0; i < 900; i++) {
      const a = r() * Math.PI * 2, y = 0.08 + r() * 0.92, rr = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(a) * rr * 1600, y * 1600, Math.sin(a) * rr * 1600);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.stars);

    // live time-of-day state, eased toward this.todTarget every frame
    this.tod = this.todState(TOD.day);
    this.todTarget = this.todState(TOD.day);
    this.todName = 'day';
  }

  todState(p) {
    const c = (h) => new THREE.Color(h);
    return {
      top: c(p.top), mid: c(p.mid), bottom: c(p.bottom), fog: c(p.fog), hemiSky: c(p.hemiSky), hemiGround: c(p.hemiGround),
      sun: c(p.sun), disc: c(p.disc), cloud: c(p.cloud), dir: new THREE.Vector3(...p.dir).normalize(),
      fogNear: p.fogNear, fogFar: p.fogFar, hemi: p.hemi, sunI: p.sunI, glow: p.glow, stars: p.stars,
    };
  }

  setTimeOfDay(name, instant = false) {
    if (!TOD[name]) name = 'day';
    this.todName = name;
    this.todTarget = this.todState(TOD[name]);
    if (instant) this.tod = this.todState(TOD[name]);
  }

  applyTimeOfDay(dt) {
    const a = this.tod, b = this.todTarget;
    const k = 1 - Math.exp(-1.5 * dt);
    for (const key of ['top', 'mid', 'bottom', 'fog', 'hemiSky', 'hemiGround', 'sun', 'disc', 'cloud']) a[key].lerp(b[key], k);
    for (const key of ['fogNear', 'fogFar', 'hemi', 'sunI', 'glow', 'stars']) a[key] += (b[key] - a[key]) * k;
    a.dir.lerp(b.dir, k).normalize();
    const u = this.sky.material.uniforms;
    u.top.value.copy(a.top);
    u.mid.value.copy(a.mid);
    u.bottom.value.copy(a.bottom);
    this.scene.fog.color.copy(a.fog);
    this.scene.fog.near = a.fogNear;
    this.scene.fog.far = a.fogFar;
    this.hemi.color.copy(a.hemiSky);
    this.hemi.groundColor.copy(a.hemiGround);
    this.hemi.intensity = a.hemi;
    this.sun.color.copy(a.sun);
    this.sun.intensity = a.sunI;
    this.sunDir.copy(a.dir);
    this.sunDisc.material.color.copy(a.disc);
    this.clouds.material.emissive.copy(a.cloud);
    this.stars.material.opacity = a.stars;
    for (const m of this.world.facadeMaterials) m.emissiveIntensity = a.glow;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  persist() {
    writeSave(this.save);
  }

  // ---- time control -----------------------------------------------------------
  slowmo(scale, dur) {
    this.slowScale = scale;
    this.slowT = Math.max(this.slowT, dur);
  }
  hitstop(dur) {
    this.hitstopT = Math.max(this.hitstopT, dur);
  }

  // ---- flow -----------------------------------------------------------------------
  showStory(title, paragraphs) {
    this.state = 'story';
    return this.hud.story(title, paragraphs).then(() => {
      if (this.state === 'story') this.state = 'playing';
    });
  }

  onPlayerDeath() {
    this.hud.flash('KNOCKED OUT');
    if (this.missions.active) this.missions.fail('Spider-Man was knocked out.');
    else this.respawnT = 3;
  }

  startGame(newGame) {
    this.audio.init();
    if (newGame) {
      this.missions.abort();
      this.save = defaultSave();
      this.persist();
      this.missions.collectibles.reset();
      this.enemies.clear();
      this.player.setSuit('classic');
    }
    this.hideMenus();
    this.hud.show(true);
    this.setTimeOfDay(this.save.timeOfDay || 'day', true);
    this.state = 'playing';
    this.input.requestLock();
    const start = this.world.landmarks.start.clone().add(new THREE.Vector3(0, 0.5, 0));
    this.player.spawn(start, Math.PI / 2);
    this.cameraRig.snapBehind(-Math.PI / 2);
    if (newGame || this.save.missionIndex === 0) this.missions.start(0);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseLock();
    this.renderPauseMenu();
    $('pause').classList.remove('hidden');
    this.audio.setWind(0);
  }

  resume() {
    $('pause').classList.add('hidden');
    $('controls').classList.add('hidden');
    this.state = 'playing';
    this.input.requestLock();
    this.clock.getDelta();
  }

  hideMenus() {
    for (const id of ['title', 'pause', 'controls', 'credits']) $(id).classList.add('hidden');
  }

  showTitle() {
    this.state = 'title';
    this.hud.show(false);
    this.hideMenus();
    $('title').classList.remove('hidden');
    $('btn-continue').classList.toggle('hidden', !this.save.started);
  }

  quitToTitle() {
    this.missions.abort();
    this.enemies.clear();
    this.combat.clear();
    this.goblin.deactivate();
    this.input.releaseLock();
    this.showTitle();
  }

  setupMenus() {
    const click = (id, fn) => $(id).addEventListener('click', () => { this.audio.init(); this.audio.play('ui'); fn(); });
    click('btn-new', () => this.startGame(true));
    click('btn-continue', () => this.startGame(false));
    click('btn-controls', () => this.openPanel('controls'));
    click('btn-credits', () => this.openPanel('credits'));
    click('btn-resume', () => this.resume());
    click('btn-pause-controls', () => this.openPanel('controls'));
    click('btn-quit', () => this.quitToTitle());
    click('btn-music', () => {
      const on = this.audio.toggleMusic();
      $('btn-music').textContent = `Music: ${on ? 'On' : 'Off'}`;
    });
    for (const b of document.querySelectorAll('[data-close]')) {
      b.addEventListener('click', () => this.closePanel(b.dataset.close));
    }
    // info panels also close on a click outside the card or on Esc
    for (const id of ['controls', 'credits']) {
      $(id).addEventListener('click', (e) => { if (e.target === $(id)) this.closePanel(id); });
    }
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      for (const id of ['controls', 'credits']) if (!$(id).classList.contains('hidden')) this.closePanel(id);
    });
    $('sens').addEventListener('input', (e) => {
      this.input.sensitivity = 0.0012 + (e.target.value / 100) * 0.004;
    });
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestLock();
    });
  }

  openPanel(id) {
    $(id).classList.remove('hidden');
    $(id).querySelector('.close-x').focus();
  }

  closePanel(id) {
    $(id).classList.add('hidden');
    this.audio.play('ui');
  }

  renderPauseMenu() {
    const s = this.save;
    $('stats').innerHTML = [
      `Story: ${Math.min(s.missionIndex, MISSIONS.length)}/${MISSIONS.length} chapters`,
      `Backpacks: ${s.backpacks.length}/${this.world.backpackSpots.length}`,
      `Crimes stopped: ${s.crimes}`,
      `Best combo: ${this.player.maxCombo}`,
    ].map((t) => `<div>${t}</div>`).join('');

    const suits = $('suits');
    suits.innerHTML = '';
    for (const key of Object.keys(SUITS)) {
      const unlocked = s.suits.includes(key);
      const b = document.createElement('button');
      b.className = `chip${s.suit === key ? ' on' : ''}`;
      b.disabled = !unlocked;
      b.textContent = unlocked ? SUITS[key].name : 'Locked';
      b.title = unlocked ? SUITS[key].desc : '';
      b.addEventListener('click', () => {
        s.suit = key;
        this.player.setSuit(key);
        this.persist();
        this.audio.play('ui');
        this.renderPauseMenu();
      });
      suits.appendChild(b);
    }

    const tod = $('tod');
    tod.innerHTML = '';
    for (const name of Object.keys(TOD)) {
      const b = document.createElement('button');
      b.className = `chip${(s.timeOfDay || 'day') === name ? ' on' : ''}`;
      b.textContent = name[0].toUpperCase() + name.slice(1);
      b.title = 'Free-roam time of day (some story chapters set their own)';
      b.addEventListener('click', () => {
        s.timeOfDay = name;
        this.persist();
        if (!this.missions.active) this.setTimeOfDay(name);
        this.audio.play('ui');
        this.renderPauseMenu();
      });
      tod.appendChild(b);
    }

    const ch = $('chapters');
    ch.innerHTML = '';
    MISSIONS.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'chip';
      const open = i <= s.missionIndex && i < MISSIONS.length;
      b.disabled = !open || !!this.missions.active;
      b.textContent = `${i + 1}. ${m.title}`;
      b.addEventListener('click', () => {
        this.missions.abort();
        this.enemies.clear();
        const pos = m.start(this.world).clone().add(new THREE.Vector3(0, 1, 0));
        this.player.spawn(pos);
        this.missions.start(i, { replay: true });
        this.resume();
      });
      ch.appendChild(b);
    });
  }

  setupDebug() {
    $('fps').classList.remove('hidden');
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'playing') return;
      const n = Number(e.key);
      if (n >= 1 && n <= MISSIONS.length) {
        this.missions.abort();
        this.enemies.clear();
        this.save.missionIndex = Math.max(this.save.missionIndex, n - 1);
        this.player.spawn(MISSIONS[n - 1].start(this.world).clone().add(new THREE.Vector3(0, 1, 0)));
        this.missions.start(n - 1, { retry: true });
      }
      if (e.code === 'KeyG') {
        this.godMode = !this.godMode;
        this.hud.notify(`God mode ${this.godMode ? 'ON' : 'OFF'}`);
      }
    });
  }

  // Debug/test hook: run the simulation at a fixed 60 Hz step, independent of
  // how fast the browser can render (headless CI renders very slowly).
  advance(seconds) {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      this.input.poll();
      if (this.state === 'playing') this.update(dt, dt);
      else if (this.state === 'title') {
        this.time += dt;
        this.titleTick(dt);
      }
      else if (this.state === 'story' && this.input.pressed('confirm')) this.hud.closeStory();
      this.input.endFrame();
    }
  }

  // slow orbit over the skyline behind the title menu
  titleTick(dt) {
    const a = this.time * 0.04;
    this.camera.position.set(Math.cos(a) * 280 + 60, 150, Math.sin(a) * 280);
    this.camera.lookAt(40, 40, 0);
    this.traffic.update(dt);
    this.peds.update(dt);
    this.world.update(dt);
    this.updateSky(dt);
  }

  // ---- main loop -----------------------------------------------------------------
  frame() {
    const raw = Math.min(this.clock.getDelta(), 0.05);
    this.time += raw;
    if (this.manualStep) {
      // simulation is being driven by advance(); only draw
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.input.poll();
    this._fpsN = (this._fpsN || 0) + 1;
    this._fpsT = (this._fpsT || 0) + raw;
    if (this._fpsT > 0.5) {
      const info = this.renderer.info.render;
      $('fps').textContent = `${Math.round(this._fpsN / this._fpsT)} FPS · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris`;
      this._fpsN = 0;
      this._fpsT = 0;
    }

    if (this.state === 'playing') {
      if (this.input.pressed('pause')) this.pause();
      else {
        if (this.input.pressed('map')) this.hud.toggleMap();
        let dt = raw;
        if (this.hitstopT > 0) {
          this.hitstopT -= raw;
          dt = raw * 0.05;
        } else if (this.slowT > 0) {
          this.slowT -= raw;
          dt = raw * this.slowScale;
        }
        this.update(dt, raw);
      }
    } else if (this.state === 'story') {
      if (this.input.pressed('confirm')) this.hud.closeStory();
    } else if (this.state === 'paused') {
      if (this.input.pressed('pause') && this.input.usingPad) this.resume();
    } else if (this.state === 'title') {
      this.titleTick(raw);
      if (this.input.usingPad && this.input.pressed('confirm')) this.startGame(!this.save.started);
    }
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  update(dt, raw) {
    this.lines.begin();
    this.player.update(dt);
    this.enemies.update(dt);
    this.goblin.update(dt);
    this.combat.update(dt);
    this.missions.update(dt);
    this.traffic.update(dt);
    this.peds.update(dt);
    this.cameraRig.update(dt, raw);
    this.particles.update(dt);
    this.markers.update(dt);
    this.world.update(dt);
    this.lines.end();
    this.updateSky(dt);
    this.hud.update(raw);

    if (this.player.dead && this.respawnT > 0) {
      this.respawnT -= raw;
      if (this.respawnT <= 0) {
        this.enemies.clear('crime');
        this.missions.crimes.clear();
        this.player.spawn(this.player.lastSafe.clone().add(new THREE.Vector3(0, 1, 0)));
        this.hud.toast('BACK ON YOUR FEET', 'Spider-Man shakes it off.', 2.5);
      }
    }
  }

  updateSky(dt) {
    const c = this.camera.position;
    this.applyTimeOfDay(dt);
    this.sky.position.copy(c);
    this.stars.position.copy(c);
    this.sunDisc.position.copy(c).addScaledVector(this.sunDir, 1500);
    this.sunDisc.lookAt(c);
    const focus = this.state === 'title' ? new THREE.Vector3(40, 0, 0) : this.player.pos;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 400);
    this.clouds.position.x = ((this.time * 3) % this.cloudPeriod);
  }
}

function boot() {
  try {
    new Game();
  } catch (err) {
    console.error(err);
    $('loading').innerHTML = `<div class="card"><h2>Couldn't start the game</h2><p>${String(err.message || err)}</p><p>This game needs WebGL - try a recent Chrome, Edge, Firefox or Safari.</p></div>`;
  }
}

requestAnimationFrame(() => setTimeout(boot, 30));
