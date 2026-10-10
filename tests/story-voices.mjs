// Story Mode + voices test. Headless Chromium has no speech voices, so a
// recording stand-in replaces window.speechSynthesis: it logs every utterance
// (text, pitch, rate, voice) and "finishes" each one after 50 ms. The test
// plays Chapter 1's opening hands-free and checks narration, distinct
// character voices and auto-advancing dialogue. Screenshots: tests/output/.
//
//   node tests/story-voices.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'tests', 'output');
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
await page.addInitScript(() => {
  window.__spoken = [];
  let current = null;
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const synth = {
    getVoices: () => [{ name: 'Test Male', lang: 'en-US' }, { name: 'Test Female', lang: 'en-US' }],
    addEventListener() {},
    cancel() { current = null; },
    speak(u) {
      current = u;
      window.__spoken.push({ text: u.text, pitch: u.pitch, rate: u.rate, voice: u.voice && u.voice.name });
      setTimeout(() => { if (current === u && u.onend) u.onend(); }, 50);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
});
await mkdir(outDir, { recursive: true });
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures.push(msg);
};
const shot = async (name) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
};
const spoken = () => page.evaluate(() => window.__spoken);

await page.goto(`http://localhost:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 120000 });
const labels = await page.evaluate(() => ({ story: document.getElementById('btn-new').textContent, voices: document.getElementById('btn-voices').textContent }));
check(labels.story === 'Story Mode' && labels.voices === 'Voices: On', `title has "${labels.story}" and "${labels.voices}" buttons`);
await shot('40-title-story-mode');

await page.click('#btn-new');
await page.evaluate(() => { window.__game.manualStep = true; });
await page.evaluate(() => window.__game.advance(0.2));
let sp = await spoken();
check(sp.length >= 1 && sp[0].text.startsWith('Chapter 1'), 'the narrator reads the chapter story card aloud');
await shot('41-story-card');
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await page.evaluate(() => window.__game.advance(0.1));
await page.evaluate(() => window.__game.advance(0.1));
check(await page.evaluate(() => window.__game.state) === 'cutscene', 'chapter 1 cutscene starts');

// let the scene play itself: voices finish, lines auto-advance
let shots = 0;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__game.advance(0.6));
  const st = await page.evaluate(() => window.__game.state);
  if (st !== 'cutscene') break;
  if ((i === 3 || i === 9) && shots < 2) await shot(`42-cutscene-${++shots}`);
}
const end = await page.evaluate(() => window.__game.state);
sp = await spoken();
const lines = sp.slice(1);
const pitches = new Set(lines.map((l) => l.pitch));
console.log(lines.map((l) => `  [pitch ${l.pitch} rate ${l.rate} ${l.voice}] ${l.text}`).join('\n'));
check(end === 'playing', 'the cutscene auto-advanced to the end with no key presses');
check(lines.length >= 8, `every dialogue line was voiced (${lines.length} lines)`);
check(pitches.size >= 3, `narrator, Peter and Uncle Ben sound different (${pitches.size} distinct voices)`);

// voices can be switched off from the pause menu
await page.evaluate(() => window.__game.pause());
await page.click('#btn-voices-pause');
const off = await page.evaluate(() => document.getElementById('btn-voices-pause').textContent);
const before = (await spoken()).length;
await page.evaluate(() => window.__game.hud.say('Green Goblin', 'Testing, testing!'));
check(off === 'Voices: Off' && (await spoken()).length === before, 'turning voices off silences dialogue');

await browser.close();
server.close();
if (errors.length) console.error(`\nruntime errors:\n${errors.join('\n')}`);
if (failures.length) console.error(`\nfailed: ${failures.join(', ')}`);
if (errors.length || failures.length) process.exit(1);
console.log('\nStory Mode + voices test passed.');
