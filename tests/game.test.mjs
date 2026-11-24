import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { addPlayer, applyAction, createGame, loadGame, saveGame } from '../functions/api/_lib/game.js';
import { allCategories } from '../functions/api/_lib/rules.js';

// D1-compatible adapter backed by real SQLite transactions, without a test dependency.
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const env = { DB: {
  prepare(sql) {
    return {
      sql, args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return db.prepare(sql).get(...this.args); },
      async run() { return { meta: db.prepare(sql).run(...this.args) }; },
    };
  },
  async batch(stmts) {
    db.exec('BEGIN');
    try {
      const results = [];
      for (const stmt of stmts) results.push(await stmt.run());
      db.exec('COMMIT');
      return results;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },
} };

try {
  const game = await createGame(env, 'kniffel', 'manual');
  const player = addPlayer(game.state, 'Testerin', 1);
  const act = (action) => applyAction(game.state, player.token, action);
  act({ type: 'enter', category: 'kniffel', value: 50 });
  act({ type: 'extraBonus' });
  act({ type: 'enter', category: 'kniffel', value: 0, overwrite: true });
  assert.equal(player.extraYahtzees, 0, 'Korrektur auf 0 entfernt Kniffel-Boni');
  act({ type: 'enter', category: 'kniffel', value: 50, overwrite: true });
  act({ type: 'extraBonus' });
  act({ type: 'clear', category: 'kniffel' });
  assert.equal(player.extraYahtzees, 0, 'Kniffel leeren entfernt Boni');
  act({ type: 'enter', category: 'kniffel', value: 50 });
  for (const category of allCategories('kniffel').filter((cat) => cat !== 'kniffel')) {
    act({ type: 'enter', category, value: 0 });
  }
  assert.equal(game.state.status, 'finished');
  await saveGame(env, game, { syncResults: true });
  const history = () => db.prepare('SELECT score FROM game_results WHERE game_code = ?').all(game.code);
  assert.deepEqual(history().map((row) => row.score), [50]);

  const stale = await loadGame(env, game.code);
  act({ type: 'enter', category: 'kniffel', value: 0, overwrite: true });
  await saveGame(env, game, { syncResults: true });
  assert.deepEqual(history().map((row) => row.score), [0], 'Korrektur ersetzt Ergebnis ohne Duplikat');

  applyAction(stale.state, player.token, { type: 'enter', category: 'chance', value: 30, overwrite: true });
  await assert.rejects(saveGame(env, stale, { syncResults: true }), (err) => err.status === 409);
  assert.deepEqual(history().map((row) => row.score), [0], 'Veralteter Save verändert Historie nicht');
  assert.equal((await loadGame(env, game.code)).version, game.version);

  // An actual SQLite insert failure must roll back both history replacement and state.
  db.exec(`CREATE TRIGGER reject_test_result BEFORE INSERT ON game_results
    WHEN NEW.score = 10 BEGIN SELECT RAISE(ABORT, 'test write failure'); END`);
  act({ type: 'enter', category: 'chance', value: 10, overwrite: true });
  await assert.rejects(saveGame(env, game, { syncResults: true }), /test write failure/);
  const saved = await loadGame(env, game.code);
  assert.equal(saved.version, game.version, 'Fehlgeschlagene Transaktion erhöht Version nicht');
  assert.equal(saved.state.players[0].scores.chance, 0, 'Spielstand zurückgerollt');
  assert.deepEqual(history().map((row) => row.score), [0], 'Historie zurückgerollt');
  db.exec('DROP TRIGGER reject_test_result');

  act({ type: 'clear', category: 'chance' });
  await saveGame(env, game, { syncResults: true });
  assert.equal((await loadGame(env, game.code)).state.status, 'playing');
  assert.equal(history().length, 0, 'Wieder geöffnetes Spiel hat kein altes Ergebnis');
} finally {
  db.close();
}

console.log('✔ game.test: Bonuskorrektur, Versionskonflikte und atomare Historie geprüft.');
