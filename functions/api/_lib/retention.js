// Datenaufbewahrung: löscht täglich (Cron Trigger, siehe src/worker.js)
// abgelaufene Sitzungen und verwaiste, nie beendete Spiele.
// users und game_results werden nie angefasst.

import { SCHEMA } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Nicht beendete Spiele (lobby/playing) ohne jede Änderung seit 90 Tagen gelten
// als aufgegeben. Laufende Partien und Analogblöcke werden bei jeder Eingabe
// gespeichert (updated_at), drei Monate Stillstand bedeuten also, dass niemand
// mehr spielt. Beendete Spiele bleiben dauerhaft: Verlauf (game_results) und
// geteilte Zuschauer-Links verweisen auf sie.
export const ABANDONED_GAME_AGE_DAYS = 90;

// Löschungen laufen in begrenzten Häppchen, damit ein Lauf weder D1-Limits
// sprengt noch bei einem Fehler unbegrenzt Daten entfernt. Was übrig bleibt,
// räumt der nächste tägliche Lauf auf.
export const DELETE_BATCH_SIZE = 500;
export const MAX_BATCHES_PER_RUN = 10;

// Nur Zeilen mit regulärem Ablaufzeitpunkt in der Vergangenheit.
const DELETE_EXPIRED_SESSIONS = `
  DELETE FROM sessions WHERE rowid IN (
    SELECT rowid FROM sessions
     WHERE typeof(expires_at) = 'integer' AND expires_at < ?
     LIMIT ${DELETE_BATCH_SIZE}
  )`;

// Nur ausdrücklich nicht beendete Status; unbekannte Status und Zeilen mit
// fehlendem oder nicht ganzzahligem updated_at bleiben unangetastet.
const DELETE_ABANDONED_GAMES = `
  DELETE FROM games WHERE rowid IN (
    SELECT rowid FROM games
     WHERE status IN ('lobby', 'playing')
       AND typeof(updated_at) = 'integer' AND updated_at < ?
     LIMIT ${DELETE_BATCH_SIZE}
  )`;

async function ensureSchema(env) {
  // Der Cron kann vor dem ersten API-Request laufen; CREATE ... IF NOT EXISTS ist idempotent.
  const stmts = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
}

async function deleteInBatches(env, sql, threshold) {
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const result = await env.DB.prepare(sql).bind(threshold).run();
    const changes = result.meta.changes;
    deleted += changes;
    if (changes < DELETE_BATCH_SIZE) return { deleted, complete: true };
  }
  return { deleted, complete: false };
}

/**
 * Löscht abgelaufene Sitzungen und aufgegebene, nicht beendete Spiele.
 * @param {{ DB: D1Database }} env
 * @param {number} now Zeitpunkt in ms seit Epoche (wie Date.now()).
 */
export async function runRetentionCleanup(env, now) {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error(`Ungültiger Zeitpunkt für die Datenbereinigung: ${now}`);
  }
  await ensureSchema(env);

  const gameCutoff = now - ABANDONED_GAME_AGE_DAYS * DAY_MS;
  const sessions = await deleteInBatches(env, DELETE_EXPIRED_SESSIONS, now);
  const games = await deleteInBatches(env, DELETE_ABANDONED_GAMES, gameCutoff);

  const summary = {
    now: new Date(now).toISOString(),
    gameCutoff: new Date(gameCutoff).toISOString(),
    expiredSessionsDeleted: sessions.deleted,
    abandonedGamesDeleted: games.deleted,
    // false = Batch-Limit erreicht, der Rest folgt beim nächsten Lauf.
    sessionsComplete: sessions.complete,
    gamesComplete: games.complete,
  };
  console.log('Datenbereinigung:', JSON.stringify(summary));
  return summary;
}
