// Spider-Man: Block City - bootstrap, game loop, menus.
import * as THREE from 'three';
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
    click('btn-controls', () => $('controls').classList.remove('hidden'));
    click('btn-credits', () => $('credits').classList.remove('hidden'));
    click('btn-resume', () => this.resume());
    click('btn-pause-controls', () => $('controls').classList.remove('hidden'));
    click('btn-quit', () => this.quitToTitle());
    click('btn-music', () => {
      const on = this.audio.toggleMusic();
      $('btn-music').textContent = `Music: ${on ? 'On' : 'Off'}`;
    });
    for (const b of document.querySelectorAll('[data-close]')) {
      b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden'));
    }
    $('sens').addEventListener('input', (e) => {
      this.input.sensitivity = 0.0012 + (e.target.value / 100) * 0.004;
    });
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestLock();
    });
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
      else if (this.state === 'story' && this.input.pressed('confirm')) this.hud.closeStory();
      this.input.endFrame();
    }
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
      $('fps').textContent = `${Math.round(this._fpsN / this._fpsT)} FPS`;
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
      const a = this.time * 0.04;
      this.camera.position.set(Math.cos(a) * 280 + 60, 150, Math.sin(a) * 280);
      this.camera.lookAt(40, 40, 0);
      this.traffic.update(raw);
      this.peds.update(raw);
      this.world.update(raw);
      this.updateSky(raw);
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
    this.sky.position.copy(c);
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
