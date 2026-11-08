const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const G = {
  DEX_BY: {
    1: { dex: 1, name: 'Bulbasaur', types: ['grass'], hp: 90, spd: 97, atk: 1 },
    2: { dex: 2, name: 'Ivysaur', types: ['grass'], hp: 110, spd: 120, atk: 1.4 }
  },
  T: s => s,
  U: {
    TYPE_COLOR: { grass: '#5f8' },
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    pickN: (list, n) => list.slice(0, n)
  },
  Stats: { fit: () => 1, sideOf: () => 'physical', NAME: {} },
  Moves: { poolFor: () => [], BY_ID: {}, evoInfo: () => null, nextUpText: () => null },
  Mons: { monFor: dex => G.DEX_BY[dex] },
  DB: { save: {} },
  Skins: { worn: () => '' },
  Game: { player: null },
  AbilityFX: { of: () => ({}) },
  Sprites: {
    playerScale: () => 1, playerRadius: () => 10, bodyHeight: () => 20,
    Animator: class { constructor(dex) { this.dex = dex; this.dir = 0; } loop(name) { this.animation = name; } }
  },
  FX: { ring() {}, burst() {} },
  Audio: { sfx() {} },
  Coop: { active: false }
};

new Function('G', source('js/data/evolutions.js'))(G);
new Function('G', source('js/data/natures.js'))(G);
new Function('G', source('js/entities/player.js'))(G);
new Function('G', source('js/systems/levelup.js'))(G);

function player(level) {
  return Object.assign(Object.create(G.Player.prototype), {
    mon: G.DEX_BY[1], dex: 1, level, moves: [], slots: [], maxMoves: 4,
    statsTaken: {}, banned: new Set(), hp: 70, maxHp: 120,
    baseAtk: 1, baseSpd: 97, shiny: false, walking: false, abilId: '',
    anim: { dir: 3 }, x: 0, y: 0, bodyH: 20,
    hasMove: () => false
  });
}

test('PokeAPI evolution appears at its required level and updates the player in-run', () => {
  const before = player(15);
  assert.equal(G.LevelUp.offer(before).some(card => card.type === 'mon-evo'), false);

  const ready = player(16);
  G.Game.player = ready;
  const card = G.LevelUp.offer(ready).find(choice => choice.type === 'mon-evo');
  assert.ok(card, 'Bulbasaur can evolve at level 16');
  card.apply(ready);

  assert.equal(ready.dex, 2);
  assert.equal(ready.hp, 90);
  assert.equal(ready.maxHp, 140);
  assert.equal(ready.baseAtk, 1.4);
  assert.equal(ready.baseSpd, 120);
  assert.equal(ready.anim.dex, 2);
  assert.equal(ready.anim.dir, 3);
});

test('regional-form-only branches are excluded while standard branches remain', () => {
  assert.deepEqual(G.POKEMON_EVO[1], [{ dex: 2, level: 16 }]);
  assert.equal((G.POKEMON_EVO[52] || []).some(edge => edge.dex === 863), false);
  assert.equal(G.POKEMON_EVO[133].length, 8);
});