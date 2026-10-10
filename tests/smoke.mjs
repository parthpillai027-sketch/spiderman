// Headless gameplay smoke test. Boots the game in Chromium, drives the
// simulation at a fixed timestep (headless WebGL renders too slowly for
// real-time input), checks core mechanics and plays into every mission.
// Fails on any console/page error or broken mechanic. Screenshots land in
// tests/output/.
//
//   npm test           (first time: npm i && npx playwright install chromium)
//   SHOTS=0 npm test   (skip screenshots)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'tests', 'output');
const shots = process.env.SHOTS !== '0';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(root, path || 'index.html'));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/index.html?debug`;

const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const failures = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_/.test(m.text())) errors.push(`console: ${m.text()}`);
});
page.on('requestfailed', (r) => {
  if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push(`requestfailed: ${r.url()}`);
});

if (shots) await mkdir(outDir, { recursive: true });
const shot = async (name) => {
  if (!shots) return;
  await page.waitForTimeout(1200); // let the render loop draw the new state
  await page.screenshot({ path: join(outDir, `${name}.png`) });
};
const run = (sec) => page.evaluate((s) => window.__game.advance(s), sec);
const state = () => page.evaluate(() => {
  const g = window.__game;
  const v = g.player.vel;
  return {
    state: g.state, pstate: g.player.state, pos: g.player.pos.toArray().map((x) => +x.toFixed(1)),
    speed: +Math.hypot(v.x, v.y, v.z).toFixed(1), hp: Math.round(g.player.health),
    mission: g.missions.active && g.missions.active.def.id, step: g.missions.active && g.missions.active.step,
    alive: g.enemies.list.filter((e) => e.alive).length,
  };
});
const log = async (label) => {
  const s = await state();
  console.log(label.padEnd(24), JSON.stringify(s));
  return s;
};
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures.push(msg);
};

await page.goto(url);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 90000 });
await shot('01-title');

await page.click('#btn-new');
await page.evaluate(() => { window.__game.manualStep = true; });
await run(0.2);
check((await state()).state === 'story', 'new game opens the chapter 1 story card');
await shot('02-story');
await page.keyboard.press('Enter');
await run(0.3);
let s = await log('after intro');
check(s.state === 'playing' && s.mission === 'great-power', 'mission 1 is running after the story');
await shot('03-rooftop');

// ---- traversal ---------------------------------------------------------------
const x0 = s.pos[0];
await page.keyboard.down('KeyW');
await run(1.0);
s = await log('walked 1s');
check(s.pos[0] - x0 > 5, 'walking moves Spider-Man forward');

await page.keyboard.press('Space');
await run(0.25);
await page.keyboard.down('ShiftLeft');
let swung = false, maxSpeed = 0;
for (let i = 0; i < 16; i++) {
  await run(0.25);
  const st = await state();
  if (st.pstate === 'swing') swung = true;
  maxSpeed = Math.max(maxSpeed, st.speed);
  if (i % 4 === 3) await log(`swing t=${((i + 1) / 4).toFixed(1)}s`);
  if (i === 6) await shot('04-swing');
}
check(swung, 'holding SHIFT in the air attaches a web swing');
check(maxSpeed > 20, `swinging builds speed (max ${maxSpeed})`);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await run(3);
s = await log('after swing');
check(s.pos[1] < 60 && s.state === 'playing', 'player lands somewhere sensible');

// wall crawl: place Spidey facing a tall building wall and push into it
const wallSetup = await page.evaluate(() => {
  const g = window.__game;
  const b = g.world.buildings.filter((k) => k.top > 50).sort((a, c) => a.x0 - c.x0)[20];
  g.player.spawn({ x: b.x0 - 1.2, y: 0.3, z: (b.z0 + b.z1) / 2, clone() { return this; } });
  g.player.pos.set(b.x0 - 1.2, 0.3, (b.z0 + b.z1) / 2);
  g.player.state = 'ground';
  g.cameraRig.yaw = -Math.PI / 2; // look toward +x (the wall)
  return { top: b.top };
});
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await run(0.6);
let ws = await log('into wall');
check(ws.pstate === 'wall', 'sprinting into a wall starts wall-crawling');
await page.keyboard.up('ShiftLeft');
await run(1.5);
const ws2 = await log('crawled up');
check(ws2.pos[1] > ws.pos[1] + 4, 'holding forward crawls up the wall');
await shot('05-wall');
await page.keyboard.up('KeyW');
void wallSetup;

// corner wrap: crawl sideways off the end of a free-standing wall
const corner = await page.evaluate(() => {
  const g = window.__game;
  const V = (x, y, z) => g.player.pos.clone().set(x, y, z);
  const b = g.world.buildings.find((k) => k.top > 30 && k.x1 < 300
    && !g.world.pointInside(V(k.x0 - 1, 3, k.z1 + 1)) && !g.world.pointInside(V(k.x0 + 1, 3, k.z1 + 1)));
  g.player.pos.set(b.x0 - 0.36, 3, b.z1 - 1.5);
  g.player.vel.set(0, 0, 0);
  g.player.state = 'wall';
  g.player.wall.normal.set(-1, 0, 0);
  g.player.wall.collider = g.world.pointInside(V(b.x0 + 0.5, 3, b.z1 - 1.5));
  g.cameraRig.yaw = -Math.PI / 2;
  return !!g.player.wall.collider;
});
await page.keyboard.down('KeyD');
let wrapped = false;
for (let i = 0; i < 8; i++) {
  await run(0.2);
  const w = await page.evaluate(() => ({ s: window.__game.player.state, nz: window.__game.player.wall.normal.z }));
  if (w.s === 'wall' && w.nz === 1) wrapped = true;
}
await page.keyboard.up('KeyD');
check(corner && wrapped, 'crawling sideways wraps around a building corner');

// ---- combat --------------------------------------------------------------------
await page.evaluate(() => {
  const g = window.__game;
  g.missions.abort();
  const p = g.world.intersection(5, 6);
  g.player.spawn(p.clone().add({ x: 0, y: 0.5, z: 0 }));
  g.player.state = 'ground';
  g.enemies.spawnGroup(p, ['brawler', 'brawler', 'gunner'], 'test', 5);
});
await run(0.5);
let before = (await state()).alive;
for (let i = 0; i < 70; i++) {
  if (i % 7 === 6) await page.mouse.click(640, 360, { button: 'right' });
  else await page.mouse.click(640, 360);
  await run(0.18);
  if (i === 10) await shot('06-combat');
}
s = await log('after brawl');
check(s.alive < before, `attacking knocks enemies out (${before} -> ${s.alive})`);
check(s.hp > 0 || s.state === 'playing', 'player survives or respawns');

// ---- every mission boots -------------------------------------------------------
for (let n = 1; n <= 6; n++) {
  await page.keyboard.press(`Digit${n}`);
  await run(0.3);
  if ((await state()).state === 'story') {
    await page.keyboard.press('Enter');
    await run(0.3);
  }
  await page.keyboard.down('KeyW');
  await run(1.0);
  await page.keyboard.up('KeyW');
  await page.mouse.click(640, 360, { button: 'right' });
  await run(1.0);
  s = await log(`mission ${n}`);
  check(s.mission !== null && s.state === 'playing', `mission ${n} starts and runs`);
  if (n === 6) {
    await run(3);
    const tod = await page.evaluate(() => ({ name: window.__game.todName, glow: window.__game.world.facadeMaterials[0].emissiveIntensity }));
    check(tod.name === 'night' && tod.glow > 0.8, `the bridge finale plays at night with lit windows (glow ${tod.glow.toFixed(2)})`);
  }
  await shot(`10-mission-${n}`);
}

// ---- boss: webbing the glider stuns the Goblin ------------------------------------------
const boss = await page.evaluate(() => {
  const g = window.__game;
  g.godMode = true;
  const gob = g.goblin;
  gob.setMode('fight');
  gob.hp = 320;
  for (let i = 0; i < 6; i++) gob.onWebHit();
  const stunned = gob.state === 'stunned';
  for (let i = 0; i < 4; i++) gob.onHit(15, g.cameraRig.flatForward);
  return { stunned, hp: gob.hp };
});
check(boss.stunned, 'enough web hits jam the Goblin\'s glider');
check(boss.hp < 320, `hitting a stunned Goblin hurts him (${boss.hp})`);
await run(2);
await shot('20-goblin');

await page.keyboard.press('KeyM');
await page.evaluate(() => { window.__game.manualStep = false; });
await shot('21-map');
await page.keyboard.press('KeyM');
await page.keyboard.press('Escape');
await shot('22-pause');

await browser.close();
server.close();
if (errors.length) console.error(`\n${errors.length} runtime error(s):\n${[...new Set(errors)].join('\n')}`);
if (failures.length) console.error(`\n${failures.length} failed check(s):\n${failures.join('\n')}`);
if (errors.length || failures.length) process.exit(1);
console.log('\nSmoke test passed.');
