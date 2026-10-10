# Spider-Man: Block City

A browser-based open-world Spider-Man prototype with **voxel (Minecraft-style) graphics**, modelled on the PS5 *Marvel's Spider-Man* gameplay loop and telling the story of the **2002 *Spider-Man* film**.

Everything is built in code: the city, the pixel-art textures, the character skins, the music and the sound effects. There are no external art or audio assets, and the only dependency is three.js (MIT, vendored in `vendor/`).

## Running it

Any static file server works. Serve the repo root and open `index.html`:

```bash
npm start                # npx serve on http://localhost:5173
# or
python3 -m http.server 5173
```

Opening `index.html` straight from disk (`file://`) won't work, because browsers block ES modules there.

Add `?debug` to the URL to get an FPS counter, mission skip (keys `1`–`6`) and god mode (`G`).

## What's in the prototype

| PS5 Spider-Man pillar | Block City implementation |
| --- | --- |
| Web-swinging | Real pendulum physics on a rope constraint. Anchors come from nearby buildings, and holding swing chains swings automatically. Speed-based FOV, speed lines and wind audio. |
| Parkour / wall-run | Sprinting into any wall sticks you to it. Hold swing to wall-run, and you vault onto the roof at the top. Wall jumps. |
| Point launch / web zip | Aim at a ledge (a white diamond appears) and zip to it, then launch off. Tap jump in mid-air for a web-zip boost. |
| Free-flow combat | Lunge strikes onto distant targets, a combo counter, heavy finisher every 5th hit, web shooter (3 webs = webbed up), and air-juggle hang time. |
| Spider-sense | Enemy wind-ups trigger a directional HUD warning. A dodge during the warning is a **perfect dodge** (slow-mo + focus). |
| Focus | Hits fill the focus bar. Spend it to heal (1/3 bar) or on a finisher (1/2 bar). |
| Enemy design | Brawlers, gunners, brutes and the Carjacker. Only two can attack at once (token system), as in the PS5 game. |
| Boss fight | The Green Goblin flies a glider and uses pumpkin bombs, razor bats and dash attacks. He has three phases, and you jam his glider with webs or perfect-dodge his dash to ground him. |
| Open world | A 12×12-block Manhattan with a park, festival plaza, Oscorp Tower, Daily Bugle, a warehouse district, the river, a suspension bridge and Queens. Traffic and pedestrians are instanced. |
| Side activities | Random police-scanner crimes (from Chapter 3 on) and 12 hidden backpacks, each with a memory of Peter's. |
| Suits | Classic, Homemade (wrestling outfit) and Battle-Damaged, unlocked through the story. |
| Presentation | Minimap, full map, waypoint arrow, objective tracker, boss bar, subtitles, story cards, pause menu with chapter select, gamepad support. |

### Story (Spider-Man, 2002)

1. **With Great Power** – tutorial: swinging rings, wall-crawl, point launch, first mugging.
2. **The Carjacker** – chase the getaway car with webs, then beat the carjacker's crew at the warehouses.
3. **Crime Wave** – three crimes across the city, then the Daily Bugle headline.
4. **Unity Day** – defuse the Goblin's pumpkin bombs at the festival, then drive him off.
5. **Up In Flames** – rescue civilians from a burning building before the timer runs out.
6. **The Bridge** – catch Mary Jane, save the tram, and take on the Green Goblin in the final fight.

Story beats follow the film. All dialogue and text is original writing; no lines are quoted from the movie.

## Controls

| Action | Keyboard + mouse | Gamepad (PlayStation layout) |
| --- | --- | --- |
| Move / camera | WASD / mouse | Left / right stick |
| Swing (air), sprint & wall-run (ground) | Hold **Shift** | Hold **R2** |
| Jump · web-zip boost · swing launch | **Space** | **✕** |
| Point launch | **Q** | **R1** |
| Attack | Left click / J | **□** |
| Web shooter | Right click / K | **△** |
| Dodge | C / L | **○** |
| Heal · finisher | F · V | D-pad ↓ · L1 |
| Interact / rescue | E | L2 |
| Map · pause | M · Esc | Create · Options |

## Project layout

```
index.html        DOM for HUD and menus, import map for three.js
styles.css        Pixel-art UI
src/
  main.js         Game bootstrap, render loop, menus, time control (slow-mo / hit-stop)
  world.js        Procedural city, merged geometry per material, AABB colliders + spatial hash,
                  ray casts, swing-anchor search
  textures.js     Procedural 16px-per-block textures and the bitmap sign font
  skins.js        Face-by-face character skins (Spider-Man suits, Goblin, civilians, thugs)
  models.js       Blocky character rigs + pose animator, Goblin glider
  player.js       Traversal state machine (ground/air/swing/wall/zip/lunge) and combat
  camera.js       Third-person camera with collision and auto-follow while swinging
  enemies.js      Thug AI with attack tokens
  goblin.js       Boss AI
  combat.js       Targeting, webs, bullets, pumpkin bombs, razor bats
  npcs.js         Instanced traffic and pedestrians, scripted actors
  missions.js     Mission runtime, the six chapters, street crimes, backpacks
  hud.js          HUD, minimap, story cards
  audio.js        Synthesized SFX and an original music loop
  input.js        Keyboard/mouse/gamepad action mapping
  save.js         localStorage progress
tests/smoke.mjs   Headless Playwright gameplay test
docs/DESIGN.md    Design notes and roadmap
```

## Testing

```bash
npm install
npx playwright install chromium
npm test
```

The smoke test boots the game in headless Chromium and drives the simulation at a fixed 60 Hz step. It checks walking, web-swinging, wall-crawling, combat KOs, every mission booting and the Goblin's stun mechanic, and it fails on any runtime error. Screenshots are written to `tests/output/`.

## Legal / IP

Spider-Man, Mary Jane, the Green Goblin, Oscorp and the Daily Bugle are Marvel properties. The film is owned by Sony/Columbia, and "Minecraft" is a Mojang/Microsoft trademark. This repo contains **only original code and art**: no ripped assets, no film audio, no actor likenesses, and no Minecraft textures (the voxel look is just an art style). Even so, a **licence from Marvel/Sony is required** before any public or commercial release. Until then, treat this as an internal pitch/prototype.
