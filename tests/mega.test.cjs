const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const data = { G: {} };
new Function('G', source('js/data/mega.js'))(data.G);

test('Mega cards are rare, locked until 30 minutes, and unique per run', () => {
  const game = { st: { time: 1799 } };
  const random = Object.create(Math);
  random.random = () => 0;
  const G = {
    MEGA_FORMS: data.G.MEGA_FORMS,
    Game: game,
    T: value => value,
    U: { pick: list => list[0], pickN: (list, count) => list.slice(0, count) },
    Moves: { poolFor: () => [], evoInfo: () => null, nextUpText: () => null },
    Stats: { fit: () => 1, sideOf: () => 'physical', NAME: {} },
    Coop: { active: false }
  };
  new Function('G', 'Math', source('js/systems/levelup.js'))(G, random);
  const pl = {
    dex: 6, mon: { name: 'Charizard' }, megaForm: '', slots: [1, 2, 3, 4], maxMoves: 4,
    moves: [], statsTaken: {}, banned: new Set(), hasMove: () => false
  };

  assert.equal(G.LevelUp.offer(pl).some(card => card.type === 'mega'), false);
  game.st.time = 1800;
  assert.equal(G.LevelUp.offer(pl).find(card => card.type === 'mega').tag, 'ÚNICA');

  random.random = () => 0.02;
  assert.equal(G.LevelUp.offer(pl).some(card => card.type === 'mega'), false);
  random.random = () => 0;
  pl.megaForm = 'mega-x';
  assert.equal(G.LevelUp.offer(pl).some(card => card.type === 'mega'), false);
});

test('Mega Evolution applies its form stats and HP bonus once, without changing the Pokédex species', () => {
  const base = { dex: 6, name: 'Charizard', types: ['fire', 'flying'], hp: 105, spd: 120, atk: 1.3, pa: 1.16, sa: 1.3 };
  const G = {
    DEX_BY: { 6: base },
    MEGA_FORMS: data.G.MEGA_FORMS,
    Game: { st: { time: 1800 } },
    Sprites: {
      playerScale: () => 1, playerRadius: () => 12, bodyHeight: () => 40, preload() {},
      Animator: class { constructor(dex, scale, shiny, form) { this.dex = dex; this.form = form; this.dir = 0; } loop(name) { this.animation = name; } }
    },
    AbilityFX: { of: () => ({}) },
    NATURE_BY: {}
  };
  new Function('G', source('js/entities/player.js'))(G);
  const pl = Object.assign(Object.create(G.Player.prototype), {
    mon: { ...base }, dex: 6, baseAtk: base.atk, baseSpd: base.spd,
    maxHp: 200, hp: 100, megaForm: '', megaHpMul: 1, anim: { dir: 3 },
    shiny: false, abilId: '', walking: false
  });

  assert.equal(pl.megaEvolve('mega-x'), true);
  assert.equal(pl.dex, 6);
  assert.equal(pl.megaForm, 'mega-x');
  assert.ok(pl.mon.types.includes('dragon'));
  assert.ok(pl.baseAtk >= base.atk * 1.2);
  assert.equal(pl.maxHp, 240);
  assert.equal(pl.hp, 140);
  assert.equal(pl.anim.form, 'mega-x');
  assert.equal(pl.anim.dir, 3);
  assert.equal(pl.megaEvolve('mega-x'), false);
  pl.addMaxHp(10);
  assert.equal(pl.maxHp, 252);
  assert.equal(pl.hp, 152);
});

test('Mega sprite loader selects the offline form-specific animation path', () => {
  class FakeImage { set src(value) { this.url = value; } }
  const G = {
    SPRITE_META: { 6: { a: { Idle: { w: 1, h: 1, n: 1, r: 1, d: [1], ax: 0, ay: 1 } } } },
    MEGA_SPRITE_META: data.G.MEGA_SPRITE_META,
    U: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) }
  };
  const document = { createElement: () => ({ getContext: () => ({}) }) };
  new Function('G', 'Image', 'document', 'performance', source('js/core/sprites.js'))(G, FakeImage, document, { now: () => 0 });

  const mega = G.Sprites.sheet(6, 'Idle', false, '', 'mega-x');
  const base = G.Sprites.sheet(6, 'Idle');
  assert.equal(mega.src, 'assets/pokemon/6/f-mega-x/Idle.png');
  assert.equal(base.src, 'assets/pokemon/6/Idle.png');
  assert.equal(Object.values(data.G.MEGA_FORMS).flat().length, 41);
});