// Story Mode cutscenes: one on-location scene per chapter plus the ending.
// The beats follow the 2002 film; every line of dialogue is original.
import * as THREE from '../vendor/three.module.min.js';
import { twoShot, closeUp, yawTo } from './cutscene.js';
import { SIDEWALK_H } from './world.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function policeCar() {
  const g = new THREE.Group();
  const box = (w, h, d, x, y, z, color, basic = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  box(2.1, 1.1, 4.6, 0, 0.85, 0, 0xf2f2f2);
  box(2.12, 0.5, 2.0, 0, 0.75, 0, 0x1a1a1a);
  box(1.9, 0.85, 2.4, 0, 1.8, -0.2, 0x1a222c);
  box(0.8, 0.25, 0.5, -0.45, 2.35, -0.2, 0xff2a2a, true);
  box(0.8, 0.25, 0.5, 0.45, 2.35, -0.2, 0x2a6aff, true);
  for (const x of [-1.05, 1.05]) for (const z of [-1.5, 1.5]) box(0.3, 0.8, 0.8, x, 0.4, z, 0x111111);
  return g;
}

// Each entry: (game, ctx) => scene definition for Cutscenes.play().
export const SCENES = {
  ch1(g) {
    const R = g.world.landmarks.start;
    const peter = R.clone().add(V(-1.3, 0, 0.5));
    const ben = R.clone().add(V(1.3, 0, 0.5));
    return {
      setup(api) {
        api.hidePlayer();
        api.actor('peter', 'Peter', 'peter', peter, yawTo(peter, ben));
        api.actor('ben', 'Uncle Ben', 'ben', ben, yawTo(ben, peter));
      },
      shots: [
        {
          cam: R.clone().add(V(-9, 5, 11)), look: R.clone().add(V(0, 1.5, 0)), drift: [0.35, -0.08, -0.2],
          lines: [
            [null, 'Forest Hills, Queens. The roof of the Parker house, just after school.'],
            ['ben', 'Your aunt says you\'ve been climbing out the window again.'],
            ['peter', 'I\'ve been... getting some air. A lot of air, actually.'],
          ],
        },
        {
          ...closeUp(ben, peter),
          lines: [
            ['ben', 'You\'re changing, Pete. That\'s fine. That\'s what being eighteen is for.'],
            ['ben', 'Just remember: the stronger you get, the more you owe the people around you.'],
          ],
        },
        {
          ...closeUp(peter, ben),
          lines: [
            ['peter', 'I know, Uncle Ben. I won\'t let you down.'],
            ['ben', 'Dinner\'s at six. Use the stairs this time.'],
          ],
        },
        {
          ...twoShot(peter, ben, { dist: 9, height: 3 }), drift: [0, 0.4, 0],
          lines: [[null, 'Later that night, Peter pulls on a costume he stitched together himself...']],
        },
      ],
    };
  },

  ch2(g) {
    const C = g.world.intersection(3, 4);
    const peter = C.clone().add(V(-1, 0, 4));
    const cop = C.clone().add(V(1.4, 0, 4));
    const car = C.clone().add(V(3.5, 0, 0.5));
    return {
      setup(api) {
        api.hidePlayer();
        api.actor('peter', 'Peter', 'peter', peter, yawTo(peter, cop));
        api.actor('cop', 'Officer', 'officer', cop, yawTo(cop, peter));
        const c = api.prop(policeCar());
        c.position.copy(car);
        c.rotation.y = 0.4;
      },
      shots: [
        {
          cam: C.clone().add(V(-6, 3, 13)), look: C.clone().add(V(1, 1.2, 2)), drift: [0.3, 0, -0.25],
          lines: [
            [null, 'A street corner in Queens. Red and blue lights on wet asphalt.'],
            ['cop', 'You\'re the nephew? I\'m sorry, son. We did everything we could.'],
          ],
        },
        {
          ...closeUp(peter, cop),
          lines: [['peter', 'Who did this?']],
        },
        {
          ...closeUp(cop, peter),
          lines: [
            ['cop', 'A carjacker. He took a car and headed east, toward the old warehouses by the river.'],
            ['cop', 'Go home, kid. Let us handle it.'],
          ],
        },
        {
          ...closeUp(peter, cop, { dist: 2.1, off: 0.3 }),
          lines: [['peter', 'No. Not this time.']],
        },
      ],
    };
  },

  ch3(g) {
    const R = g.world.roofPoint(g.world.landmarks.bugle);
    const jj = R.clone().add(V(-1.4, 0, 3));
    const peter = R.clone().add(V(1.4, 0, 3));
    return {
      setup(api) {
        api.hidePlayer();
        api.actor('jj', 'J. Jonah Jameson', 'jameson', jj, yawTo(jj, peter));
        api.actor('peter', 'Peter', 'peter', peter, yawTo(peter, jj));
      },
      shots: [
        {
          cam: R.clone().add(V(0, 4, 13)), look: R.clone().add(V(0, 3.5, 0)), drift: [0, -0.25, -0.3],
          lines: [[null, 'The roof of the Daily Bugle. Its editor-in-chief takes his cigar breaks up here.']],
        },
        {
          ...closeUp(jj, peter),
          lines: [
            ['jj', 'Parker! Your pictures of the wall-crawler are blurry, crooked and badly lit.'],
            ['jj', 'Front page. Two hundred bucks. Don\'t let it go to your head.'],
          ],
        },
        {
          ...closeUp(peter, jj),
          lines: [['peter', 'Three hundred, and I\'ll get you better ones.']],
        },
        {
          ...twoShot(jj, peter),
          lines: [
            ['jj', 'Two-fifty, and you\'re lucky I\'m in a good mood. Now get out there. The police scanner is going crazy.'],
            ['peter', 'Guess Spider-Man\'s working overtime tonight.'],
          ],
        },
      ],
    };
  },

  ch4(g) {
    const P = g.world.landmarks.plaza.clone();
    const norman = P.clone().add(V(-5, 0, 6));
    const harry = P.clone().add(V(-3.2, 0, 7));
    const mj = P.clone().add(V(4, 0, 8));
    const peter = P.clone().add(V(5.8, 0, 7.4));
    return {
      setup(api) {
        api.hidePlayer();
        api.actor('norman', 'Norman Osborn', 'norman', norman, yawTo(norman, harry));
        api.actor('harry', 'Harry Osborn', 'harry', harry, yawTo(harry, norman));
        api.actor('mj', 'Mary Jane', 'mj', mj, yawTo(mj, peter));
        api.actor('peter', 'Peter', 'peter', peter, yawTo(peter, mj));
      },
      shots: [
        {
          cam: P.clone().add(V(0, 9, 26)), look: P.clone().add(V(0, 6, 0)), drift: [0, -0.5, -0.8],
          lines: [[null, 'The Unity Festival. Balloons, a brass band, and the new owners of Oscorp on stage.']],
        },
        {
          ...twoShot(norman, harry),
          lines: [
            ['harry', 'Dad, smile. It\'s a festival, not a funeral.'],
            ['norman', 'They sold my company out from under me, Harry. Smiling is for the board.'],
          ],
        },
        {
          ...twoShot(mj, peter),
          lines: [
            ['mj', 'Peter! You actually came. Want to go look at the balloons?'],
            ['peter', 'Yeah, just... give me a second. My ears are ringing.'],
          ],
        },
        {
          cam: P.clone().add(V(0, 2.5, 10)), look: P.clone().add(V(0, 40, -40)), drift: [0, 0.2, 0],
          lines: [[null, 'A laugh rolls across the plaza, high and cracked, from somewhere up in the sky.']],
        },
      ],
    };
  },

  ch5(g) {
    const b = g.world.landmarks.burning;
    const S = V((b.x0 + b.x1) / 2, SIDEWALK_H, b.z1 + 9);
    const chief = S.clone().add(V(1.3, 0, 0));
    const spidey = S.clone().add(V(-1.3, 0, 0));
    const fireLook = V((b.x0 + b.x1) / 2, b.top * 0.6, b.z1);
    return {
      setup(api) {
        api.actor('chief', 'Fire Chief', 'chief', chief, yawTo(chief, spidey));
        api.spidey(spidey, yawTo(spidey, chief));
      },
      shots: [
        {
          cam: S.clone().add(V(-4, 1.2, 9)), look: fireLook, drift: [0.3, 0.2, 0],
          lines: [[null, 'Hell\'s Kitchen, at sundown. Smoke pours out of the windows twenty floors up.']],
        },
        {
          ...closeUp(chief, spidey),
          lines: [
            ['chief', 'We\'ve got people on the balconies and the roof. Our ladders won\'t reach!'],
          ],
        },
        {
          ...closeUp(spidey, chief),
          lines: [['spidey', 'Then I\'ll go up. Keep the street clear.']],
        },
        {
          ...twoShot(chief, spidey, { dist: 7, height: 1 }),
          lines: [['chief', 'Move fast. That roof won\'t hold much longer.']],
        },
      ],
    };
  },

  ch6(g, ctx) {
    const gob = g.goblin;
    const mj = ctx.data.mj;
    const p = g.player.pos.clone();
    const spidey = V(p.x, g.world.groundHeight(p.x, p.z, p.y + 0.5), p.z);
    return {
      setup(api) {
        api.spidey(spidey, yawTo(spidey, gob.pos));
        api.cast('goblin', 'Green Goblin', 'goblin', gob.rig, gob.obj, 'fly');
        api.cast('mj', 'Mary Jane', 'mj', mj.rig, mj.root, 'carried');
      },
      shots: [
        {
          cam: spidey.clone().add(V(-5, 2, 6)), look: gob.pos.clone(), drift: [0, 0.3, 0],
          lines: [['goblin', 'Spider-Man! So glad you could join us.']],
        },
        {
          ...closeUp(mj.pos.clone(), spidey, { dist: 3.2, height: 1.2 }),
          lines: [['mj', 'Help! Please!']],
        },
        {
          ...closeUp(gob.pos.clone(), spidey, { dist: 4, height: 2 }),
          lines: [
            ['goblin', 'Every hero tells himself he\'ll never have to choose. Tonight, you choose.'],
            ['goblin', 'The girl... or a tram full of strangers. Let\'s see what you\'re made of!'],
          ],
        },
        {
          ...closeUp(spidey, gob.pos.clone(), { height: 1.4 }),
          lines: [['spidey', 'I\'m not choosing. I\'m saving all of them.']],
        },
      ],
    };
  },

  ending(g) {
    const B = g.world.blockRect(4, 2);
    const mj = V(B.cx + 15, SIDEWALK_H, B.cz - 1);
    const peter = V(B.cx + 15, SIDEWALK_H, B.cz + 1.6);
    g.setTimeOfDay('day', true);
    return {
      setup(api) {
        api.hidePlayer();
        api.actor('mj', 'Mary Jane', 'mj', mj, yawTo(mj, peter));
        api.actor('peter', 'Peter', 'peter', peter, yawTo(peter, mj));
      },
      shots: [
        {
          cam: mj.clone().add(V(-12, 4, 9)), look: mj.clone().add(V(0, 1.5, 1)), drift: [0.4, -0.1, 0],
          lines: [[null, 'Some days later, in the park.']],
        },
        {
          ...closeUp(mj, peter),
          lines: [
            ['mj', 'Peter... there\'s something I need to say.'],
            ['mj', 'Whenever things went wrong, the one person who was always there was you.'],
          ],
        },
        {
          ...closeUp(peter, mj),
          lines: [
            ['peter', 'MJ, I\'ll always be there for you. Always.'],
            ['peter', 'But I can only be your friend.'],
          ],
        },
        {
          ...twoShot(mj, peter, { dist: 10, height: 3 }), drift: [0, 0.6, 0.3],
          lines: [
            [null, 'He walks away before she can see his face. Some secrets are a weight you carry alone.'],
            ['peter', 'Uncle Ben was right. The more you can do, the more you owe. So I\'ll keep showing up.'],
            ['peter', 'The city has a friendly neighborhood Spider-Man. That\'s who I am now.'],
          ],
        },
      ],
    };
  },
};
