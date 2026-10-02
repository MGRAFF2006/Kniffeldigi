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

export function newGameState(mode, entry = 'manual', options = {}) {
  const manual = entry === 'manual';
  return {
    mode,
    // 'manual' = analog spielen, Punkte digital eintragen; 'digital' = komplett digital würfeln
    entry: manual ? 'manual' : 'digital',
    // Optional: Host führt den Block wie Papier (für alle eintragen + Plätze hinzufügen).
    hostPaper: manual && options.hostPaper === true,
    // Analogspiele laufen sofort – Mitspieler können jederzeit dazukommen.
    status: manual ? 'playing' : 'lobby', // lobby | playing | finished
    players: [], // { token, name, userId, scores, extraYahtzees }
    turn: null, // nur digital: { player, rolls, dice[5], held[5] }
    round: 0,
    results: null,
    log: [],
    logSeq: 0,
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

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/** Punktestand + Spielstatus für späteren Revert im Protokoll. */
function captureSnapshot(state) {
  return {
    players: state.players.map((p) => ({
      token: p.token,
      scores: { ...p.scores },
      extraYahtzees: p.extraYahtzees,
    })),
    status: state.status,
    results: cloneJson(state.results),
    finishedAt: state.finishedAt,
    startedAt: state.startedAt,
    turn: cloneJson(state.turn),
    round: state.round,
  };
}

function applySnapshot(state, snap) {
  const byToken = new Map(snap.players.map((p) => [p.token, p]));
  for (const player of state.players) {
    const saved = byToken.get(player.token);
    if (saved) {
      player.scores = { ...emptyScores(state.mode), ...saved.scores };
      player.extraYahtzees = saved.extraYahtzees || 0;
    } else {
      // Spieler kam erst nach diesem Stand dazu – leerer Bogen.
      player.scores = emptyScores(state.mode);
      player.extraYahtzees = 0;
    }
  }
  state.status = snap.status;
  state.results = cloneJson(snap.results);
  state.finishedAt = snap.finishedAt;
  state.startedAt = snap.startedAt;
  state.turn = cloneJson(snap.turn);
  state.round = snap.round ?? 0;

  // Zug-Index absichern, falls Spieler zwischenzeitlich die Liste verlassen haben.
  if (state.entry === 'digital' && state.status === 'playing') {
    if (!state.turn || state.turn.player < 0 || state.turn.player >= state.players.length) {
      state.turn = freshTurn(0);
    }
  } else if (state.entry === 'manual' && state.status === 'playing') {
    state.turn = null;
  }
}

function pushLog(state, text) {
  state.logSeq = (state.logSeq || 0) + 1;
  state.log.push({
    id: state.logSeq,
    t: Date.now(),
    text,
    snap: captureSnapshot(state),
  });
}

function requirePlayer(state, token) {
  const index = state.players.findIndex((p) => p.token === token);
  if (index < 0) throw new GameError('Du bist kein Spieler in diesem Spiel.');
  return index;
}

function requireHost(state, token) {
  const index = requirePlayer(state, token);
  if (index !== 0) throw new GameError('Nur der Host darf das.');
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

function resolveManualTarget(state, actorIndex, action) {
  if (action.forPlayer == null || action.forPlayer === '') return actorIndex;
  if (!state.hostPaper || actorIndex !== 0) {
    throw new GameError('Für andere eintragen geht nur im Papierblock-Modus (Host).');
  }
  const target = Number(action.forPlayer);
  if (!Number.isInteger(target) || target < 0 || target >= state.players.length) {
    throw new GameError('Unbekannter Spieler.');
  }
  return target;
}

function resetScores(state) {
  for (const player of state.players) {
    player.scores = emptyScores(state.mode);
    player.extraYahtzees = 0;
  }
  state.results = null;
  state.finishedAt = null;
  state.round = 0;
  if (state.entry === 'digital') {
    state.status = 'lobby';
    state.turn = null;
    state.startedAt = null;
  } else {
    state.status = 'playing';
    state.turn = null;
    state.startedAt = Date.now();
  }
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

    case 'reset': {
      requireHost(state, token);
      if (state.players.length === 0) throw new GameError('Keine Spieler vorhanden.');
      resetScores(state);
      pushLog(state, 'Neues Spiel – der Block wurde zurückgesetzt (Mitspieler bleiben).');
      return;
    }

    case 'addSeat': {
      requireHost(state, token);
      if (!state.hostPaper) throw new GameError('Mitspieler hinzufügen geht nur im Papierblock-Modus.');
      const name = String(action.name || '').trim();
      if (name.length < 2 || name.length > 20) throw new GameError('Spielername: 2–20 Zeichen.');
      addPlayer(state, name, null);
      return;
    }

    case 'revertLog': {
      const actor = requirePlayer(state, token);
      const logId = Number(action.logId);
      const entry = state.log.find((e) => e.id === logId);
      if (!entry || !entry.snap) throw new GameError('Dieser Protokolleintrag kann nicht wiederhergestellt werden.');
      applySnapshot(state, entry.snap);
      pushLog(state, `${state.players[actor].name} stellt den Spielstand von „${entry.text}“ wieder her.`);
      if (state.entry === 'manual' && state.status === 'playing') maybeFinishManual(state);
      return;
    }

    // --- Analogmodus: Ergebnis eines echten Wurfs eintragen (oder korrigieren) ---
    case 'enter': {
      const actor = requirePlayer(state, token);
      if (state.entry !== 'manual') throw new GameError('In diesem Spiel wird digital gewürfelt.');
      const index = resolveManualTarget(state, actor, action);
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
      const byHost = index !== actor;
      pushLog(
        state,
        previous !== null
          ? byHost
            ? `${state.players[actor].name} korrigiert für ${player.name} „${CAT_NAMES[state.mode][cat]}“ von ${previous} auf ${value} Punkte.`
            : `${player.name} korrigiert „${CAT_NAMES[state.mode][cat]}“ von ${previous} auf ${value} Punkte.`
          : value === 0
            ? byHost
              ? `${state.players[actor].name} streicht für ${player.name} „${CAT_NAMES[state.mode][cat]}“.`
              : `${player.name} streicht „${CAT_NAMES[state.mode][cat]}“.`
            : byHost
              ? `${state.players[actor].name} trägt für ${player.name} ${value} Punkte bei „${CAT_NAMES[state.mode][cat]}“ ein.`
              : `${player.name} trägt ${value} Punkte bei „${CAT_NAMES[state.mode][cat]}“ ein.`
      );
      maybeFinishManual(state);
      return;
    }

    // --- Analogmodus: Eintrag rückgängig machen (Feld wieder leeren) ---
    case 'clear': {
      const actor = requirePlayer(state, token);
      if (state.entry !== 'manual') throw new GameError('In diesem Spiel wird digital gewürfelt.');
      const index = resolveManualTarget(state, actor, action);
      reopenManual(state);
      if (state.status !== 'playing') throw new GameError('Das Spiel läuft gerade nicht.');
      const cat = String(action.category);
      if (!allCategories(state.mode).includes(cat)) throw new GameError('Unbekanntes Feld.');
      const player = state.players[index];
      if (player.scores[cat] === null) throw new GameError('Dieses Feld ist noch leer.');
      player.scores[cat] = null;
      const byHost = index !== actor;
      pushLog(
        state,
        byHost
          ? `${state.players[actor].name} macht für ${player.name} den Eintrag bei „${CAT_NAMES[state.mode][cat]}“ rückgängig.`
          : `${player.name} macht den Eintrag bei „${CAT_NAMES[state.mode][cat]}“ rückgängig.`
      );
      return;
    }

    // --- Analogmodus (nur Kniffel): weiteren Kniffel als +50-Bonus verbuchen / zurücknehmen ---
    case 'extraBonus': {
      const actor = requirePlayer(state, token);
      if (state.entry !== 'manual' || state.mode !== 'kniffel') throw new GameError('Der Kniffel-Bonus ist hier nicht verfügbar.');
      const index = resolveManualTarget(state, actor, action);
      reopenManual(state);
      if (state.status !== 'playing') throw new GameError('Das Spiel läuft gerade nicht.');
      const player = state.players[index];
      const byHost = index !== actor;
      if (action.remove === true) {
        if (player.extraYahtzees < 1) throw new GameError('Es ist kein Kniffel-Bonus verbucht.');
        player.extraYahtzees--;
        pushLog(
          state,
          byHost
            ? `${state.players[actor].name} nimmt für ${player.name} einen Kniffel-Bonus (+50) zurück.`
            : `${player.name} nimmt einen Kniffel-Bonus (+50) zurück.`
        );
      } else {
        if (player.scores.kniffel !== 50) throw new GameError('Erst mit einem eingetragenen Kniffel (50) gibt es Bonuspunkte.');
        player.extraYahtzees++;
        pushLog(
          state,
          byHost
            ? `${state.players[actor].name} verbucht für ${player.name} einen weiteren Kniffel! +50 Bonuspunkte.`
            : `${player.name} würfelt einen weiteren Kniffel! +50 Bonuspunkte.`
        );
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
    hostPaper: !!state.hostPaper,
    status: state.status,
    round: state.round,
    turn: state.turn,
    results: state.results,
    // Vollständiges Protokoll (ohne Snapshots) – Revert läuft serverseitig über die Log-ID.
    log: (state.log || []).map(({ id, t, text }) => ({
      id: id ?? null,
      t,
      text,
      canRevert: id != null,
    })),
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    you: you >= 0 ? you : null,
    isHost: you === 0,
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

export async function createGame(env, mode, entry, options = {}) {
  const state = newGameState(mode, entry, options);
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
