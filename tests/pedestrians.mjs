// Pedestrian retaliation test: punch a pedestrian, check they fight back and
// Spider-Man loses health, knock them down and check they rejoin the crowd,
// then barge into another one while sprinting.
//
//   node tests/pedestrians.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const failures = [];
page.on('pageerror', (e) => errors.push(e.message));
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures.push(msg);
};
const run = (sec) => page.evaluate((s) => window.__game.advance(s), sec);
await mkdir(join(root, 'tests', 'output'), { recursive: true });

await page.goto(`http://localhost:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 120000 });
await page.click('#btn-new');
await page.evaluate(() => {
  const g = window.__game;
  g.manualStep = true;
  g.hud.closeStory = g.hud.closeStory.bind(g.hud);
});
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await run(0.3);
await run(0.3);

// stand next to a pedestrian, facing them, and punch
const setup = await page.evaluate(() => {
  const g = window.__game;
  g.missions.abort();
  const k = g.peds.peds.findIndex((p) => p.x !== undefined && !p.hidden && Math.abs(p.x) < 250 && Math.abs(p.z) < 250);
  const p = g.peds.peds[k];
  g.player.spawn(p.x !== undefined ? { x: p.x - 1.4, y: 0.35, z: p.z } : g.player.pos);
  g.player.pos.set(p.x - 1.4, 0.35, p.z);
  g.player.state = 'ground';
  g.player.health = 100;
  g.cameraRig.yaw = -Math.PI / 2; // facing +x, toward the pedestrian
  return { k };
});
await page.mouse.click(640, 360);
await run(0.1);
const provoked = await page.evaluate((k) => {
  const g = window.__game;
  const e = g.enemies.list.find((x) => x.pedIndex === k);
  return { hidden: g.peds.peds[k].hidden, angry: !!e, hp: e ? e.hp : null };
}, setup.k);
check(provoked.angry && provoked.hidden, 'punching a pedestrian turns them into an angry fighter');
check(provoked.hp !== null && provoked.hp < 28, `the punch hurt them (${provoked.hp}/28 hp)`);

// stand still and let them hit back
await run(4);
const hurt = await page.evaluate(() => Math.round(window.__game.player.health));
check(hurt < 100, `they hit back and Spider-Man lost health (${hurt}/100)`);
await page.waitForTimeout(1200);
await page.screenshot({ path: join(root, 'tests', 'output', '70-pedestrian-fight.png') });

// knock them down; they should get back up and rejoin the crowd
for (let i = 0; i < 20; i++) {
  const alive = await page.evaluate((k) => window.__game.enemies.list.some((x) => x.pedIndex === k && x.alive), setup.k);
  if (!alive) break;
  await page.mouse.click(640, 360);
  await run(0.25);
}
const ko = await page.evaluate((k) => window.__game.enemies.list.some((x) => x.pedIndex === k && !x.alive), setup.k);
check(ko, 'the pedestrian can be knocked down');
await run(8);
const back = await page.evaluate((k) => ({ hidden: window.__game.peds.peds[k].hidden, still: window.__game.enemies.list.some((x) => x.pedIndex === k) }), setup.k);
check(!back.hidden && !back.still, 'after getting up they go back to walking their route');

// sprinting into someone provokes them too
const bump = await page.evaluate(() => {
  const g = window.__game;
  const k = g.peds.peds.findIndex((p, i) => i > 5 && p.x !== undefined && !p.hidden && Math.abs(p.x) < 250);
  const p = g.peds.peds[k];
  g.player.pos.set(p.x - 0.5, 0.35, p.z);
  g.player.vel.set(15, 0, 0);
  g.player.state = 'ground';
  g.peds.update(0.016);
  return g.enemies.list.some((x) => x.pedIndex === k && x.type === 'civilian');
});
check(bump, 'barging into a pedestrian while sprinting makes them fight back');

await browser.close();
server.close();
if (errors.length) console.error(`\nruntime errors:\n${errors.join('\n')}`);
if (errors.length || failures.length) process.exit(1);
console.log('\nPedestrian test passed.');
