# Design notes

## Pillars

1. **Swinging must feel great within seconds.** Hold one button to swing, and the game picks the anchor. Releasing at the bottom of the arc gives speed. Anchors fall back to the sky (arcade-style) so you never fall flat over parks or the river.
2. **Readable free-flow combat.** One attack button that closes distance automatically, a spider-sense warning before every enemy attack, and at most two attackers at once.
3. **The 2002 film as a six-chapter arc,** each chapter teaching or testing one mechanic: traversal, chase, crimes, bombs + boss, rescue, final boss.

## Tuning reference (world units ≈ metres, blocks are 1 unit)

| Parameter | Value | Where |
| --- | --- | --- |
| Gravity | 32 u/s² | `player.js` `G` |
| Walk / sprint | 9 / 17 u/s | `updateGround` |
| Swing pump | 17 u/s² | `updateSwing` |
| Swing speed cap | 62 u/s | `updateSwing` |
| Anchor search | 20 ahead, 22 up, 8–56 rope | `world.findSwingAnchor` |
| Point launch | 58 u/s zip, then 17 up + 11 forward | `updateZip` |
| Lunge strike | 44 u/s, max 0.75 s | `updateLunge` |
| Attack tokens | 2 simultaneous | `EnemyManager.maxTokens` |
| Goblin HP | 320 (phases at 66% / 33%) | `goblin.js` |

## Performance budget

- Static city: one merged `BufferGeometry` per material, so about 25 draw calls for the whole skyline.
- Traffic (64 cars) and pedestrians (110) are instanced: 4 + 6 draw calls in total.
- One 2048² shadow map that follows the player (±110 units).
- Collision: AABB colliders in a 32-unit spatial hash; movement is sub-stepped at 0.4 units.

## Roadmap (next milestones)

1. **Art pass:** texture atlas per character (cuts character draw calls from 36 to 6), night/day cycle with lit windows, more landmark buildings.
2. **Traversal depth:** corner wrapping on walls, swing tricks, air tricks, landing rolls, perch points on water towers.
3. **Combat depth:** gadgets (web bomb, impact web), environmental throws, more enemy archetypes (Goblin hench-bots for chapter 4).
4. **Cinematics:** in-engine cutscenes for the chapter openers instead of story cards, plus VO with a sound-alike cast.
5. **Content:** photo-op landmarks for the Daily Bugle, Harry Osborn side-missions, Thanksgiving dinner interior.
6. **Platform:** pointer-lock-free touch controls, settings menu (FOV, invert Y, sensitivity per device), save slots.
7. **Licensing:** clear the Marvel/Sony licence before any public demo.
