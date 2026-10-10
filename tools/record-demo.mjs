// Records a gameplay showcase video (for pitching / client reviews).
// Steps the simulation at a fixed frame rate and screenshots every frame,
// so the result is smooth even on machines without a GPU.
//
//   node tools/record-demo.mjs [out.mp4]      (needs playwright + ffmpeg)
import { createServer } from 'node:http';
import { readFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] || join(root, 'tests', 'output', 'demo.mp4');
const frames = join(root, 'tests', 'output', 'frames');
const FPS = 24;
const W = 1280, H = 720;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

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

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`http://localhost:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 90000 });
await page.evaluate(() => { window.__game.manualStep = true; });
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });

let n = 0;
const file = (i) => join(frames, `f${String(i).padStart(5, '0')}.jpg`);
async function capture(seconds, each = null) {
  const count = Math.round(seconds * FPS);
  for (let i = 0; i < count; i++) {
    if (each) await each(i);
    await page.evaluate((dt) => window.__game.advance(dt), 1 / FPS);
    await page.screenshot({ path: file(n++), type: 'jpeg', quality: 88 });
  }
  console.log(`captured ${n} frames`);
}
async function hold(seconds) {
  await page.screenshot({ path: file(n), type: 'jpeg', quality: 88 });
  const src = file(n++);
  for (let i = 1; i < Math.round(seconds * FPS); i++) await copyFile(src, file(n++));
}
const setup = (fn, arg) => page.evaluate(fn, arg);

// 1. title screen
await capture(3);

// 2. new game + story card
await page.click('#btn-new');
await page.evaluate(() => { window.__game.godMode = true; });
await page.evaluate(() => window.__game.advance(0.1));
await hold(3);
await page.keyboard.press('Enter');
await page.evaluate(() => window.__game.advance(0.1));

// 3. daytime swing down the avenue through midtown
await setup(() => {
  const g = window.__game;
  g.missions.abort();
  g.hud.objective('With Great Power', 'Swing through Midtown');
  const p = g.player;
  p.spawn(p.pos.clone().set(-170, 48, 0), -Math.PI / 2);
  p.vel.set(30, 4, 0);
  g.cameraRig.yaw = -Math.PI / 2;
  g.cameraRig.pitch = 0.12;
  g.cameraRig.target.set(-170, 50, 0);
});
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await capture(8);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');

// 4. wall-run up a skyscraper and vault onto the roof
await setup(() => {
  const g = window.__game;
  const p = g.player;
  const V = (x, y, z) => p.pos.clone().set(x, y, z);
  const b = g.world.buildings.find((k) => k.top > 38 && k.top < 60 && k.x0 > -150 && k.x1 < 150
    && !g.world.pointInside(V(k.x0 - 2, 1, (k.z0 + k.z1) / 2)));
  p.spawn(V(b.x0 - 6, 0.3, (b.z0 + b.z1) / 2), -Math.PI / 2);
  p.state = 'ground';
  g.cameraRig.yaw = -Math.PI / 2;
  g.cameraRig.pitch = -0.25;
  g.cameraRig.target.copy(p.pos);
});
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await capture(4.5);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await capture(0.8);

// 5. street brawl
await setup(() => {
  const g = window.__game;
  const p = g.player;
  const c = g.world.intersection(5, 6);
  p.spawn(c.clone().add({ x: -8, y: 0.5, z: 0 }), Math.PI / 2);
  p.state = 'ground';
  p.focus = 60;
  g.enemies.spawnGroup(c, ['brawler', 'brawler', 'gunner', 'brute', 'brawler'], 'demo', 5);
  g.enemies.alertGroup('demo');
  g.cameraRig.yaw = -Math.PI / 2;
  g.cameraRig.pitch = 0.3;
  g.cameraRig.target.copy(p.pos);
});
await capture(7, async (i) => {
  if (i % 5 === 0) {
    if (i % 35 === 20) await page.mouse.click(W / 2, H / 2, { button: 'right' });
    else if (i % 60 === 45) await page.keyboard.press('KeyC');
    else await page.mouse.click(W / 2, H / 2);
  }
  if (i === 130) await page.keyboard.press('KeyV');
});
await setup(() => window.__game.enemies.clear());

// 6. night: the Green Goblin over the bridge
await setup(() => {
  const g = window.__game;
  g.setTimeOfDay('night', true);
  const p = g.player;
  p.spawn(p.pos.clone().set(330, 26.2, 0), Math.PI / 2);
  p.state = 'ground';
  g.goblin.activate(p.pos.clone().add({ x: 18, y: 9, z: -12 }), { mode: 'fight' });
  g.cameraRig.yaw = -Math.PI / 2;
  g.cameraRig.pitch = 0.05;
  g.cameraRig.target.copy(p.pos);
  g.hud.objective('The Bridge', 'Defeat the Green Goblin');
});
await capture(7, async (i) => {
  if (i % 8 === 0) await page.mouse.click(W / 2, H / 2, { button: i < 60 ? 'right' : 'left' });
});
await setup(() => window.__game.goblin.deactivate());

// 7. night swing through the lit-up city
await setup(() => {
  const g = window.__game;
  const p = g.player;
  p.spawn(p.pos.clone().set(-40, 55, 0), -Math.PI / 2);
  p.vel.set(32, 2, 0);
  g.cameraRig.yaw = -Math.PI / 2;
  g.cameraRig.pitch = 0.1;
  g.cameraRig.target.set(-40, 57, 0);
  g.hud.objective('Free Roam', 'Patrol the city');
});
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await capture(7);

await browser.close();
server.close();

execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%05d.jpg'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'medium', '-movflags', '+faststart', out]);
console.log(`wrote ${out}`);
