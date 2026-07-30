// Spiel-Engine: Zustandsverwaltung, Zugvalidierung und Persistenz in D1.

import {
  CAT_NAMES,
  MODES,
  allCategories,
  emptyScores,
  jokerApplies,
  scoreCategory,
  sheetComplete,
  totals,
  validManualScore,
} from './rules.js';
import { normalizeCode, randomDie, randomGameCode, randomToken } from './util.js';

export const MAX_PLAYERS = 8;
export const MAX_ROLLS = 3;

export function newGameState(mode, entry = 'manual') {
  const manual = entry === 'manual';
  return {
    mode,
    // 'manual' = analog spielen, Punkte digital eintragen; 'digital' = komplett digital würfeln
    entry: manual ? 'manual' : 'digital',
    // Analogspiele laufen sofort – Mitspieler können jederzeit dazukommen.
    status: manual ? 'playing' : 'lobby', // lobby | playing | finished
    players: [], // { token, name, userId, scores, extraYahtzees }
    turn: null, // nur digital: { player, rolls, dice[5], held[5] }
    round: 0,
    results: null,
    log: [],
    createdAt: Date.now(),
    startedAt: manual ? Date.now() : null,
    finishedAt: null,
  };
}

export function addPlayer(state, name, userId) {
  const joinable = state.status === 'lobby' || (state.entry === 'manual' && state.status === 'playing');
  if (!joinable) throw new GameError(state.status === 'finished' ? 'Das Spiel ist schon beendet.' : 'Das Spiel läuft bereits.');
  if (state.players.length >= MAX_PLAYERS) throw new GameError('Das Spiel ist voll (max. 8 Spieler).');
  if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new GameError('Dieser Name ist in diesem Spiel schon vergeben.');
  }
  const player = {
    token: randomToken(),
    name,
    userId: userId || null,
    scores: emptyScores(state.mode),
    extraYahtzees: 0,
  };
  state.players.push(player);
  pushLog(state, `${name} ist dem Spiel beigetreten.`);
  return player;
}

export class GameError extends Error {}

function pushLog(state, text) {
  state.log.push({ t: Date.now(), text });
  if (state.log.length > 50) state.log.splice(0, state.log.length - 50);
}

function requirePlayer(state, token) {
  const index = state.players.findIndex((p) => p.token === token);
  if (index < 0) throw new GameError('Du bist kein Spieler in diesem Spiel.');
  return index;
}

function requireCurrentPlayer(state, token) {
  const index = requirePlayer(state, token);
  if (state.entry !== 'digital') throw new GameError('In diesem Spiel wird analog gewürfelt – trage deine Punkte direkt ein.');
  if (state.status !== 'playing') throw new GameError('Das Spiel läuft gerade nicht.');
  if (state.turn.player !== index) throw new GameError('Du bist nicht an der Reihe.');
  return index;
}

/** Analogspiel beenden, sobald alle Bögen voll sind. */
function maybeFinishManual(state) {
  if (state.status !== 'playing' || state.players.length === 0) return;
  if (state.players.every((p) => sheetComplete(state.mode, p.scores))) finishGame(state);
}

/** Beendetes Analogspiel für eine Korrektur wieder öffnen. */
function reopenManual(state) {
  if (state.entry !== 'manual' || state.status !== 'finished') return;
  state.status = 'playing';
  state.results = null;
  state.finishedAt = null;
}

function freshTurn(playerIndex) {
  return { player: playerIndex, rolls: 0, dice: [0, 0, 0, 0, 0], held: [false, false, false, false, false] };
}

export function applyAction(state, token, action) {
  switch (action.type) {
    case 'start': {
      const index = requirePlayer(state, token);
      if (state.entry !== 'digital') throw new GameError('Analogspiele laufen sofort – kein Start nötig.');
      if (index !== 0) throw new GameError('Nur wer das Spiel erstellt hat, kann es starten.');
      if (state.status !== 'lobby') throw new GameError('Das Spiel läuft bereits.');
      if (state.players.length < 1) throw new GameError('Es ist noch niemand beigetreten.');
      state.status = 'playing';
      state.startedAt = Date.now();
      state.round = 1;
      state.turn = freshTurn(0);
      pushLog(state, `Runde 1 beginnt – ${state.players[0].name} ist am Zug.`);
      return;
    }

    case 'leave': {
      const index = requirePlayer(state, token);
      const canLeave = state.status === 'lobby' || (state.entry === 'manual' && state.status === 'playing');
      if (!canLeave) throw new GameError('Während des Spiels kann man nicht austreten.');
      const [player] = state.players.splice(index, 1);
      pushLog(state, `${player.name} hat das Spiel verlassen.`);
      if (state.entry === 'manual') maybeFinishManual(state);
      return;
    }

    // --- Analogmodus: Ergebnis eines echten Wurfs eintragen (oder korrigieren) ---
    case 'enter': {
      const index = requirePlayer(state, token);
      if (state.entry !== 'manual') throw new GameError('In diesem Spiel wird digital gewürfelt.');
      const overwrite = action.overwrite === true;
      if (overwrite) reopenManual(state);
      if (state.status !== 'playing') throw new GameError('Das Spiel läuft gerade nicht.');
      const cat = String(action.category);
      if (!allCategories(state.mode).includes(cat)) throw new GameError('Unbekanntes Feld.');
      const player = state.players[index];
      const previous = player.scores[cat];
      if (previous !== null && !overwrite) throw new GameError('Dieses Feld ist schon ausgefüllt.');
      const value = Number(action.value);
      if (!validManualScore(state.mode, cat, value)) {
        throw new GameError(`${value} ist bei „${CAT_NAMES[state.mode][cat]}“ nicht möglich.`);
      }
      player.scores[cat] = value;
      pushLog(
        state,
        previous !== null
          ? `${player.name} korrigiert „${CAT_NAMES[state.mode][cat]}“ von ${previous} auf ${value} Punkte.`
          : value === 0
            ? `${player.name} streicht „${CAT_NAMES[state.mode][cat]}“.`
            : `${player.name} trägt ${value} Punkte bei „${CAT_NAMES[state.mode][cat]}“ ein.`
      );
      maybeFinishManual(state);
      return;
    }

    // --- Analogmodus: Eintrag rückgängig machen (Feld wieder leeren) ---
    case 'clear': {
      const index = requirePlayer(state, token);
      if (state.entry !== 'manual') throw new GameError('In diesem Spiel wird digital gewürfelt.');
      reopenManual(state);
      if (state.status !== 'playing') throw new GameError('Das Spiel läuft gerade nicht.');
      const cat = String(action.category);
      if (!allCategories(state.mode).includes(cat)) throw new GameError('Unbekanntes Feld.');
      const player = state.players[index];
      if (player.scores[cat] === null) throw new GameError('Dieses Feld ist noch leer.');
      player.scores[cat] = null;
      pushLog(state, `${player.name} macht den Eintrag bei „${CAT_NAMES[state.mode][cat]}“ rückgängig.`);
      return;
    }

    // --- Analogmodus (nur Kniffel): weiteren Kniffel als +50-Bonus verbuchen / zurücknehmen ---
    case 'extraBonus': {
      const index = requirePlayer(state, token);
      if (state.entry !== 'manual' || state.mode !== 'kniffel') throw new GameError('Der Kniffel-Bonus ist hier nicht verfügbar.');
      reopenManual(state);
      if (state.status !== 'playing') throw new GameError('Das Spiel läuft gerade nicht.');
      const player = state.players[index];
      if (action.remove === true) {
        if (player.extraYahtzees < 1) throw new GameError('Es ist kein Kniffel-Bonus verbucht.');
        player.extraYahtzees--;
        pushLog(state, `${player.name} nimmt einen Kniffel-Bonus (+50) zurück.`);
      } else {
        if (player.scores.kniffel !== 50) throw new GameError('Erst mit einem eingetragenen Kniffel (50) gibt es Bonuspunkte.');
        player.extraYahtzees++;
        pushLog(state, `${player.name} würfelt einen weiteren Kniffel! +50 Bonuspunkte.`);
      }
      maybeFinishManual(state);
      return;
    }

    case 'roll': {
      const index = requireCurrentPlayer(state, token);
      const turn = state.turn;
      if (turn.rolls >= MAX_ROLLS) throw new GameError('Du hast schon dreimal gewürfelt.');
      for (let i = 0; i < 5; i++) {
        if (turn.rolls === 0 || !turn.held[i]) turn.dice[i] = randomDie();
      }
      turn.rolls++;
      if (turn.rolls === 1) turn.held = [false, false, false, false, false];
      return;
    }

    case 'hold': {
      requireCurrentPlayer(state, token);
      const turn = state.turn;
      const i = Number(action.die);
      if (!Number.isInteger(i) || i < 0 || i > 4) throw new GameError('Ungültiger Würfel.');
      if (turn.rolls === 0) throw new GameError('Erst würfeln, dann Würfel festhalten.');
      if (turn.rolls >= MAX_ROLLS) throw new GameError('Keine Würfe mehr übrig.');
      turn.held[i] = !turn.held[i];
      return;
    }

    case 'score': {
      const index = requireCurrentPlayer(state, token);
      const turn = state.turn;
      if (turn.rolls === 0) throw new GameError('Erst würfeln, dann eintragen.');
      const cat = String(action.category);
      if (!allCategories(state.mode).includes(cat)) throw new GameError('Unbekanntes Feld.');
      const player = state.players[index];
      if (player.scores[cat] !== null) throw new GameError('Dieses Feld ist schon ausgefüllt.');

      const joker = jokerApplies(state.mode, turn.dice, player.scores);
      if (joker) {
        player.extraYahtzees++;
        pushLog(state, `${player.name} würfelt einen weiteren Kniffel! +50 Bonuspunkte.`);
      }
      const points = scoreCategory(state.mode, cat, turn.dice, joker);
      player.scores[cat] = points;
      pushLog(state, `${player.name} trägt ${points} Punkte bei „${CAT_NAMES[state.mode][cat]}“ ein.`);

      advanceTurn(state, index);
      return;
    }

    default:
      throw new GameError('Unbekannte Aktion.');
  }
}

function advanceTurn(state, lastIndex) {
  if (state.players.every((p) => sheetComplete(state.mode, p.scores))) {
    finishGame(state);
    return;
  }
  let next = lastIndex;
  for (let i = 0; i < state.players.length; i++) {
    next = (next + 1) % state.players.length;
    if (!sheetComplete(state.mode, state.players[next].scores)) break;
  }
  if (next <= lastIndex) {
    state.round++;
    pushLog(state, `Runde ${state.round} beginnt.`);
  }
  state.turn = freshTurn(next);
}

function finishGame(state) {
  state.status = 'finished';
  state.finishedAt = Date.now();
  state.turn = null;
  const scored = state.players
    .map((p, i) => ({ index: i, name: p.name, userId: p.userId, total: totals(state.mode, p.scores, p.extraYahtzees).grandTotal }))
    .sort((a, b) => b.total - a.total);
  let place = 0;
  let lastTotal = null;
  state.results = scored.map((entry, i) => {
    if (entry.total !== lastTotal) {
      place = i + 1;
      lastTotal = entry.total;
    }
    return { ...entry, place };
  });
  const winners = state.results.filter((r) => r.place === 1).map((r) => r.name);
  pushLog(state, `Spiel beendet! ${winners.join(' & ')} gewinnt mit ${state.results[0].total} Punkten.`);
}

/** Öffentliche Sicht auf den Zustand: keine Spieler-Tokens, aber "you"-Index für den Anfragenden. */
export function publicState(state, requesterToken) {
  const you = requesterToken ? state.players.findIndex((p) => p.token === requesterToken) : -1;
  return {
    mode: state.mode,
    modeName: MODES[state.mode].name,
    entry: state.entry || 'digital',
    status: state.status,
    round: state.round,
    turn: state.turn,
    results: state.results,
    log: state.log.slice(-12),
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    you: you >= 0 ? you : null,
    players: state.players.map((p) => ({
      name: p.name,
      hasAccount: !!p.userId,
      scores: p.scores,
      extraYahtzees: p.extraYahtzees,
      totals: totals(state.mode, p.scores, p.extraYahtzees),
    })),
  };
}

// --- Persistenz ---

export async function loadGame(env, code) {
  const row = await env.DB.prepare('SELECT code, mode, status, state, version FROM games WHERE code = ?')
    .bind(normalizeCode(code))
    .first();
  if (!row) return null;
  return { code: row.code, version: row.version, state: JSON.parse(row.state) };
}

export async function createGame(env, mode, entry) {
  const state = newGameState(mode, entry);
  // Bei Kollision des Codes einfach neu versuchen.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomGameCode();
    try {
      await env.DB.prepare(
        'INSERT INTO games (code, mode, status, state, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
      )
        .bind(code, mode, state.status, JSON.stringify(state), Date.now(), Date.now())
        .run();
      return { code, version: 1, state };
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
}

/** Optimistisches Speichern; wirft bei Versionskonflikt. */
export async function saveGame(env, game) {
  const result = await env.DB.prepare(
    'UPDATE games SET state = ?, status = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?'
  )
    .bind(JSON.stringify(game.state), game.state.status, Date.now(), game.code, game.version)
    .run();
  if (!result.meta.changes) throw new GameError('Konflikt – bitte noch einmal versuchen.');
  game.version++;
}

/** Ergebnisse nach Spielende für eingeloggte Spieler protokollieren. */
export async function recordResults(env, code, state) {
  if (!state.results) return;
  const stmts = state.results.map((r) =>
    env.DB.prepare(
      'INSERT INTO game_results (game_code, mode, user_id, player_name, score, placement, player_count, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(code, state.mode, r.userId, r.name, r.total, r.place, state.players.length, state.finishedAt)
  );
  if (stmts.length) await env.DB.batch(stmts);
}
