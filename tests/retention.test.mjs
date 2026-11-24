// Datenaufbewahrung: führt die echten DELETE-Statements gegen SQLite (node:sqlite)
// aus und prüft, dass genau die vorgesehenen Zeilen verschwinden.
// Ausführen: node --test tests/retention.test.mjs   (Node >= 22.13)

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import {
  DELETE_BATCH_SIZE,
  MAX_BATCHES_PER_RUN,
  runRetentionCleanup,
} from '../functions/api/_lib/retention.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 24, 3, 17);

/** Minimaler D1-Ersatz (prepare/bind/run/first/all/batch) über node:sqlite. */
function d1(db) {
  const statement = (sql, params = []) => ({
    bind: (...args) => statement(sql, args),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (stmts) => {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const s of stmts) results.push(await s.run());
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

function freshEnv() {
  const db = new DatabaseSync(':memory:');
  return { db, env: { DB: d1(db) } };
}

function insertGame(db, code, status, updatedAt) {
  db.prepare(
    'INSERT INTO games (code, mode, status, state, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).run(code, 'kniffel', status, '{}', NOW - 400 * DAY, updatedAt);
}

function insertSession(db, token, expiresAt) {
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, 1, ?, ?)').run(
    token,
    NOW - 30 * DAY,
    expiresAt
  );
}

const column = (db, sql) => db.prepare(sql).all().map((row) => Object.values(row)[0]).sort();

test('creates the schema itself when the cron runs before any API request', async () => {
  const { db, env } = freshEnv();
  const summary = await runRetentionCleanup(env, NOW);
  assert.equal(summary.expiredSessionsDeleted, 0);
  assert.equal(summary.abandonedGamesDeleted, 0);
  assert.deepEqual(column(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"), [
    'game_results',
    'games',
    'sessions',
    'users',
  ]);
});

test('deletes only expired sessions and unfinished games idle for more than 90 days', async () => {
  const { db, env } = freshEnv();
  await runRetentionCleanup(env, NOW); // Schema anlegen

  insertSession(db, 'expired-yesterday', NOW - DAY);
  insertSession(db, 'expired-1ms-ago', NOW - 1);
  insertSession(db, 'expires-now', NOW); // nicht mehr gültig, aber noch nicht „vor jetzt“ abgelaufen
  insertSession(db, 'valid-tomorrow', NOW + DAY);

  for (const status of ['lobby', 'playing', 'finished']) {
    insertGame(db, `${status}-91d`, status, NOW - 91 * DAY);
    insertGame(db, `${status}-90d`, status, NOW - 90 * DAY);
    insertGame(db, `${status}-89d`, status, NOW - 89 * DAY);
  }
  insertGame(db, 'unknown-status-91d', 'archived', NOW - 91 * DAY);
  insertGame(db, 'text-updated-at', 'playing', 'not-a-timestamp');
  insertGame(db, 'real-updated-at', 'lobby', 1.5);

  db.prepare(
    "INSERT INTO users (username, display_name, pass_hash, salt, created_at) VALUES ('anna', 'Anna', 'h', 's', ?)"
  ).run(NOW - 1000 * DAY);
  // Verlaufszeilen, auch zu einem gelöschten Spielcode, bleiben erhalten.
  for (const code of ['finished-91d', 'playing-91d']) {
    db.prepare(
      "INSERT INTO game_results (game_code, mode, user_id, player_name, score, placement, player_count, finished_at) VALUES (?, 'kniffel', 1, 'Anna', 200, 1, 2, ?)"
    ).run(code, NOW - 200 * DAY);
  }

  const summary = await runRetentionCleanup(env, NOW);

  assert.deepEqual(column(db, 'SELECT token FROM sessions'), ['expires-now', 'valid-tomorrow']);
  assert.deepEqual(column(db, 'SELECT code FROM games'), [
    'finished-89d',
    'finished-90d',
    'finished-91d',
    'lobby-89d',
    'lobby-90d',
    'playing-89d',
    'playing-90d',
    'real-updated-at',
    'text-updated-at',
    'unknown-status-91d',
  ]);
  assert.deepEqual(column(db, 'SELECT username FROM users'), ['anna']);
  assert.deepEqual(column(db, 'SELECT game_code FROM game_results'), ['finished-91d', 'playing-91d']);
  assert.equal(summary.expiredSessionsDeleted, 2);
  assert.equal(summary.abandonedGamesDeleted, 2);
  assert.equal(summary.sessionsComplete, true);
  assert.equal(summary.gamesComplete, true);
});

test('deletes at most one bounded batch run per invocation and finishes on the next run', async () => {
  const { db, env } = freshEnv();
  await runRetentionCleanup(env, NOW);
  const perRun = DELETE_BATCH_SIZE * MAX_BATCHES_PER_RUN;
  const insert = db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, 1, 0, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < perRun + 7; i++) insert.run(`old-${i}`, NOW - DAY);
  insertSession(db, 'valid', NOW + DAY);
  db.exec('COMMIT');

  const first = await runRetentionCleanup(env, NOW);
  assert.equal(first.expiredSessionsDeleted, perRun);
  assert.equal(first.sessionsComplete, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 8);

  const second = await runRetentionCleanup(env, NOW);
  assert.equal(second.expiredSessionsDeleted, 7);
  assert.equal(second.sessionsComplete, true);
  assert.deepEqual(column(db, 'SELECT token FROM sessions'), ['valid']);
});

test('refuses to run with an invalid clock value instead of guessing a cutoff', async () => {
  const { env } = freshEnv();
  for (const now of [undefined, 0, Number.NaN, '1764000000000', 1.5]) {
    await assert.rejects(runRetentionCleanup(env, now), /Ungültiger Zeitpunkt/);
  }
});

test('an integer beyond the Date range deletes nothing', async () => {
  const { db, env } = freshEnv();
  await runRetentionCleanup(env, NOW); // legt das Schema an
  insertSession(db, 'valid', NOW + DAY);
  insertGame(db, 'FRESH', 'playing', NOW);
  // Sicherer Integer, aber kein darstellbares Datum: würde sonst alles als „abgelaufen“ sehen.
  await assert.rejects(runRetentionCleanup(env, 8_640_000_000_000_001), /Ungültiger Zeitpunkt/);
  assert.deepEqual(column(db, 'SELECT token FROM sessions'), ['valid']);
  assert.deepEqual(column(db, 'SELECT code FROM games'), ['FRESH']);
});
