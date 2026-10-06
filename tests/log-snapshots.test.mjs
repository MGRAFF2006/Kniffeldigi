import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameError, addPlayer, applyAction, newGameState, publicState } from '../functions/api/_lib/game.js';
import { allCategories } from '../functions/api/_lib/rules.js';

function digitalGame(mode = 'kniffel', count = 2) {
  const state = newGameState(mode, 'digital');
  const players = ['Alice', 'Bob'].slice(0, count).map((name) => addPlayer(state, name));
  applyAction(state, players[0].token, { type: 'start' });
  return { state, players };
}

function scoreSixes(state, token, category = 'chance') {
  state.turn.dice = [6, 6, 6, 6, 6];
  state.turn.held = [true, true, true, true, true];
  state.turn.rolls = 3;
  const start = state.log.length;
  applyAction(state, token, { type: 'score', category });
  return state.log.slice(start);
}

function assertFreshTurn(state, player) {
  assert.deepEqual(state.turn, {
    player, rolls: 0, dice: [0, 0, 0, 0, 0], held: [false, false, false, false, false],
  });
}

function restore(state, token, entry) {
  applyAction(state, token, { type: 'revertLog', logId: entry.id });
}

test('two-player scoring restores the next turn and cannot reuse spent dice', () => {
  for (const mode of ['kniffel', 'yatzy']) {
    const { state, players: [alice, bob] } = digitalGame(mode);
    const [entry] = scoreSixes(state, alice.token);
    for (let attempt = 0; attempt < 2; attempt++) {
      restore(state, bob.token, entry);
      assert.equal(alice.scores.chance, 30);
      assertFreshTurn(state, 1);
      assert.throws(() => applyAction(state, alice.token, { type: 'score', category: 'sixes' }), /nicht an der Reihe/);
      assert.throws(() => applyAction(state, bob.token, { type: 'score', category: 'sixes' }), /Erst würfeln/);
    }
    // A restore log must itself preserve the completed state.
    const restoredEntry = state.log.at(-1);
    scoreSixes(state, bob.token);
    restore(state, alice.token, restoredEntry);
    assert.equal(bob.scores.chance, null);
    assertFreshTurn(state, 1);
    scoreSixes(state, bob.token);
    assertFreshTurn(state, 0);
    applyAction(state, alice.token, { type: 'roll' });
    applyAction(state, alice.token, { type: 'score', category: 'sixes' });
    assert.notEqual(alice.scores.sixes, null);
  }
});

test('solo score and new-round logs both restore a fresh turn', () => {
  const { state, players: [alice] } = digitalGame('kniffel', 1);
  const entries = scoreSixes(state, alice.token);
  assert.equal(entries.length, 2);
  assert.match(entries[1].text, /Runde 2 beginnt/);
  for (const entry of entries) {
    restore(state, alice.token, entry);
    assert.equal(alice.scores.chance, 30);
    assert.equal(state.round, 2);
    assertFreshTurn(state, 0);
    assert.throws(() => applyAction(state, alice.token, { type: 'score', category: 'sixes' }), /Erst würfeln/);
  }
});

test('joker bonus and score logs never restore a partial or replayable bonus', () => {
  const { state, players: [alice, bob] } = digitalGame();
  alice.scores.kniffel = 50;
  const entries = scoreSixes(state, alice.token, 'fullHouse');
  assert.equal(entries.length, 2);
  assert.match(entries[0].text, /\+50 Bonuspunkte/);
  for (const entry of entries) {
    restore(state, bob.token, entry);
    assert.equal(alice.extraYahtzees, 1);
    assert.equal(alice.scores.fullHouse, 25);
    assertFreshTurn(state, 1);
    assert.throws(() => applyAction(state, alice.token, { type: 'score', category: 'largeStraight' }), /nicht an der Reihe/);
  }
});

test('final-category score, joker and finished logs all restore final results', () => {
  const { state, players: [alice] } = digitalGame('kniffel', 1);
  for (const category of allCategories(state.mode)) alice.scores[category] = 0;
  alice.scores.kniffel = 50;
  alice.scores.chance = null;
  const entries = scoreSixes(state, alice.token);
  assert.equal(entries.length, 3);
  const expectedResults = structuredClone(state.results);
  const expectedFinishedAt = state.finishedAt;
  for (const entry of entries) {
    applyAction(state, alice.token, { type: 'reset' });
    restore(state, alice.token, entry);
    assert.equal(state.status, 'finished');
    assert.equal(state.turn, null);
    assert.equal(state.finishedAt, expectedFinishedAt);
    assert.deepEqual(state.results, expectedResults);
    assert.equal(state.results[0].total, 130);
    assert.equal(alice.scores.chance, 30);
    assert.equal(alice.extraYahtzees, 1);
    assert.throws(() => applyAction(state, alice.token, { type: 'roll' }), /läuft gerade nicht/);
  }
});

test('legacy digital history remains visible but cannot be restored', () => {
  const { state, players: [alice] } = digitalGame('kniffel', 1);
  const [entry] = scoreSixes(state, alice.token);
  delete entry.snap.version;
  // Simulate the original inconsistent score snapshot persisted in D1.
  entry.snap.turn = { player: 0, rolls: 3, dice: [6, 6, 6, 6, 6], held: [true, true, true, true, true] };
  const before = JSON.stringify(state);
  assert.throws(() => restore(state, alice.token, entry), (error) =>
    error instanceof GameError && /älteren Digitalspiel/.test(error.message));
  assert.equal(JSON.stringify(state), before);
  const visible = publicState(state, alice.token).log.find((log) => log.id === entry.id);
  assert.equal(visible.text, entry.text);
  assert.equal(visible.canRevert, false);
  entry.snap.version = 999;
  assert.throws(() => restore(state, alice.token, entry), GameError);
  assert.equal(publicState(state).log.find((log) => log.id === entry.id).canRevert, false);
  delete entry.snap.version;
  const [newEntry] = scoreSixes(state, alice.token, 'sixes');
  restore(state, alice.token, newEntry);
  assert.equal(alice.scores.sixes, 30);
  assertFreshTurn(state, 0);
  assert.throws(() => restore(state, alice.token, entry), GameError);
  assert.equal(publicState(state).log.find((log) => log.id === entry.id).canRevert, false);
});

test('legacy manual snapshots still restore entered scores', () => {
  const state = newGameState('kniffel', 'manual');
  const alice = addPlayer(state, 'Alice');
  applyAction(state, alice.token, { type: 'enter', category: 'chance', value: 30 });
  const entry = state.log.at(-1);
  delete entry.snap.version;
  applyAction(state, alice.token, { type: 'clear', category: 'chance' });
  restore(state, alice.token, entry);
  assert.equal(alice.scores.chance, 30);
  assert.equal(state.status, 'playing');
  assert.equal(state.turn, null);
  assert.equal(publicState(state).log.find((log) => log.id === entry.id).canRevert, true);
});

test('new start and reset entries restore their completed states after persistence', () => {
  let { state, players: [alice] } = digitalGame('kniffel', 1);
  const start = state.log.at(-1);
  applyAction(state, alice.token, { type: 'reset' });
  const reset = state.log.at(-1);
  state = JSON.parse(JSON.stringify(state));
  restore(state, alice.token, start);
  assert.equal(state.status, 'playing');
  assert.equal(state.round, 1);
  assertFreshTurn(state, 0);
  restore(state, alice.token, reset);
  assert.equal(state.status, 'lobby');
  assert.equal(state.turn, null);
  assert.equal(state.round, 0);
  assert.equal(state.players[0].scores.chance, null);
  assert.ok(publicState(state).log.every((entry) => entry.canRevert));
});
