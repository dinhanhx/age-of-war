// Game tables ported from the original Flash game (decompiled scripts/frame_13/DoAction.as).
// Frame counts are original ticks at 40 fps; the simulation also runs at 40 Hz.

export const FPS = 40;

// [name, gold cost, train time (frames)]
export const EN = [null,
  ['Club man', 15, 40], ['Slingshot man', 25, 40], ['Dino rider', 100, 100],
  ['Sword man', 50, 70], ['Archer', 75, 50], ['Knight', 500, 100],
  ['Dueler', 200, 100], ['Mousquettere', 400, 100], ['Canoneer', 1000, 200],
  ['Melee Infantry', 1500, 100], ['Infantry', 2000, 100], ['Tank', 7000, 300],
  ["God's Blade", 5000, 100], ['Blaster', 6000, 100], ['War machine', 20000, 300],
  ['Super Soldier', 150000, 100]];

// [name, cost]
export const TU = [null,
  ['Rock slingshot', 100], ['Egg automatic', 200], ['Primitive Catapult', 500],
  ['Catapult', 500], ['Fire Catapult', 750], ['Oil', 1000],
  ['Small Cannon', 1500], ['Large Cannon', 3000], ['Explosives Cannon', 6000],
  ['Single Turret', 7000], ['Rocket Turret', 9000], ['Double Turret', 14000],
  ['Titanium Shooter', 24000], ['LazerCannon', 40000], ['IonRay', 100000]];

// [fire interval (frames), bullet id, damage, range]
export const TS = [null,
  [30, 1, 12, 350], [11, 2, 5, 300], [70, 3, 25, 400], [70, 3, 40, 400], [70, 4, 50, 400],
  [100, 5, 4, 300], [70, 6, 30, 500], [70, 6, 70, 500], [70, 7, 100, 500],
  [40, 8, 70, 500], [50, 9, 100, 500], [22, 8, 60, 500], [40, 12, 100, 400],
  [10, 10, 40, 500], [10, 11, 60, 500]];

// turret firing animation: total frames, and the frames at which it calls shoot()
export const TURRET_ANIM = [null,
  { len: 32, fire: [6] }, { len: 10, fire: [6] }, { len: 55, fire: [8] },
  { len: 99, fire: [20] }, { len: 99, fire: [20] }, { len: 77, fire: [21] },
  { len: 45, fire: [2] }, { len: 80, fire: [2] }, { len: 80, fire: [2] },
  { len: 45, fire: [3] }, { len: 40, fire: [2] }, { len: 40, fire: [2, 21] },
  { len: 40, fire: [2] }, { len: 3, fire: [2] }, { len: 3, fire: [2] }];

// [hp, melee damage, ranged damage, melee range, shoot range]
export const ES = [null,
  [55, 16, 0, 20, 0], [42, 10, 8, 20, 100], [160, 40, 0, 45, 0],
  [100, 35, 0, 20, 0], [80, 20, 9, 20, 130], [300, 60, 0, 60, 0],
  [200, 79, 0, 25, 0], [160, 40, 20, 25, 130], [600, 120, 0, 25, 0],
  [350, 100, 0, 25, 0], [300, 60, 30, 25, 130], [1200, 300, 0, 100, 0],
  [1000, 250, 0, 40, 0], [800, 130, 80, 40, 130], [3000, 600, 0, 100, 0],
  [4000, 400, 400, 40, 150]];

// XP needed to evolve from age 1, 2, 3, 4
export const EV = [4000, 14000, 45000, 200000];

// The decompiled code has no age names; these are my labels (inferred from the unit names).
export const AGE_NAMES = ['Stone Age', 'Castle Age', 'Renaissance', 'Modern Age', 'Future'];

// units / turrets offered per age
export const AGE_UNITS = [null, [1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15, 16]];
export const AGE_TURRETS = [null, [1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15]];

// cost of buying the 2nd, 3rd and 4th turret slot
export const ADDON_COST = [1000, 3000, 7500];

export const SPECIAL_COOLDOWN = 2000;
export const SPECIAL_NAMES = ['Meteor shower', 'Meteor storm', 'Healing aura', 'Bomber run', 'Orbital strike'];

export const WORLD = {
  groundY: 425,
  viewW: 650, viewH: 450,
  camMax: 350,
  base1X: 150, base2X: 860,        // unit spawn points
  turretX: 52,                     // turret x offset from base (player: +, enemy: -)
  base2Origin: 1000,               // enemy base clip x
  slotY: [-80, -125, -172, -220],
  baseHp: 500,
  startCash: 175,
  // hitzones of the two bases: x, left offset, width, height
  baseHit: [null, { x: 50, w: 187 }, { x: 950, w: 202 }],
};

// Enemy turret build schedule: techTimer -> actions. Actions: [spot,id] creates (only if empty),
// 's' + spot sells, 'a' + n sets the add-on count. Straight port of base_comp/DoAction.as.
export const ENEMY_TURRETS = {
  1: { 1000: [['c', 1, 1]], 4000: [['s', 1], ['c', 1, 2]], 6000: [['s', 1], ['c', 1, 3]] },
  2: { 1000: [['s', 1], ['c', 1, 4]], 4000: [['a', 1], ['s', 1], ['c', 1, 6]], 6000: [['c', 2, 5]] },
  3: { 1000: [['s', 1], ['c', 1, 7]], 4000: [['a', 2], ['s', 2], ['c', 2, 7]], 6000: [['s', 2], ['s', 1], ['c', 3, 9]] },
  4: { 5000: [['c', 1, 10]], 7000: [['a', 2], ['s', 3], ['s', 1], ['c', 2, 11]] },
  5: { 5000: [['c', 1, 13]], 12000: [['s', 2], ['s', 1], ['s', 3], ['c', 2, 14]], 20000: [['a', 3], ['s', 2], ['s', 1], ['s', 3], ['c', 4, 15]] },
};
