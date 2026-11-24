// End-to-End-Test gegen einen Dev-Server.
// Ausführen: npm run test:api (startet eigenen Server) oder BASE=… node tests/api.test.mjs

import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8788';

async function call(method, path, { body, rawBody, session, playerToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) headers.Authorization = `Bearer ${session}`;
  if (playerToken) headers['X-Player-Token'] = playerToken;
  const res = await fetch(`${BASE}/api${path}`, {
    method, headers, body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(10000),
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data, cacheControl: res.headers.get('Cache-Control') };
}

// Server erreichbar?
try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
  assert.equal(res.status, 200, 'Dev-Server liefert Startseite');
} catch {
  console.error(`api.test: kein funktionierender Dev-Server unter ${BASE}. Mit "npm run test:api" starten.`);
  process.exit(1);
}

for (const mode of ['constructor', '__proto__', 'toString']) {
  const res = await call('POST', '/games', { body: { mode, name: 'Testerin' } });
  assert.equal(res.status, 400, `Ungültiger Spielmodus ${mode} wird abgelehnt`);
}
assert.equal((await call('GET', '/games/%ZZ/state')).status, 400, 'Ungültiges URL-Encoding ist kein Serverfehler');

const stamp = Date.now().toString(36);

// --- Konto anlegen & Login-Zyklus ---
let res = await call('POST', '/auth/register', { body: { username: `tester_${stamp}`, displayName: 'Testerin', password: 'geheim123' } });
assert.equal(res.status, 201, `Registrierung: ${JSON.stringify(res.data)}`);
const session = res.data.token;

res = await call('POST', '/auth/register', { body: { username: `tester_${stamp}`, displayName: 'Doppelt', password: 'geheim123' } });
assert.equal(res.status, 409, 'Doppelter Benutzername abgelehnt');

res = await call('GET', '/auth/me', { session });
assert.equal(res.data.user.displayName, 'Testerin', 'me liefert Profil');

res = await call('POST', '/auth/login', { body: { username: `tester_${stamp}`, password: 'falsch123' } });
assert.equal(res.status, 401, 'Falsches Passwort abgelehnt');

// --- Digitales Spiel anlegen (eingeloggt) + zweiter Spieler (anonym) ---
res = await call('POST', '/games', { body: { mode: 'yatzy', entry: 'digital' }, session });
assert.equal(res.status, 201, `Spiel anlegen: ${JSON.stringify(res.data)}`);
const code = res.data.code;
const hostToken = res.data.playerToken;
assert.match(code, /^[A-Z0-9]{5}$/, 'Spielcode-Format');
assert.equal(res.data.state.players[0].hasAccount, true, 'Host mit Konto markiert');

res = await call('POST', `/games/${code}/join`, { body: { name: 'Gast' } });
assert.equal(res.status, 200, 'Beitritt');
const guestToken = res.data.playerToken;

res = await call('POST', `/games/${code}/join`, { body: { name: 'Gast' } });
assert.equal(res.status, 400, 'Doppelter Name im Spiel abgelehnt');

// Zuschauer sehen den Zustand ohne Token, aber keine Spieler-Tokens.
res = await call('GET', `/games/${code}/state`);
assert.equal(res.status, 200, 'Zuschauer-Zugriff');
assert.equal(res.data.state.you, null, 'Zuschauer ist kein Spieler');
assert.equal(JSON.stringify(res.data.state).includes(hostToken), false, 'Kein Token-Leak im Zustand');

// Nur der Host darf starten.
res = await call('POST', `/games/${code}/action`, { body: { type: 'start' }, playerToken: guestToken });
assert.equal(res.status, 400, 'Gast darf nicht starten');
res = await call('POST', `/games/${code}/action`, { body: { type: 'start' }, playerToken: hostToken });
assert.equal(res.status, 200, 'Host startet');
assert.equal(res.data.state.status, 'playing');

// --- Zugregeln ---
res = await call('POST', `/games/${code}/action`, { body: { type: 'roll' }, playerToken: guestToken });
assert.equal(res.status, 400, 'Nicht am Zug → abgelehnt');

res = await call('POST', `/games/${code}/action`, { body: { type: 'score', category: 'chance' }, playerToken: hostToken });
assert.equal(res.status, 400, 'Eintragen ohne Wurf abgelehnt');

res = await call('POST', `/games/${code}/action`, { body: { type: 'roll' }, playerToken: hostToken });
assert.equal(res.status, 200, 'Host würfelt');
assert.equal(res.data.state.turn.rolls, 1);
assert.ok(res.data.state.turn.dice.every((d) => d >= 1 && d <= 6), 'Würfel 1-6');

res = await call('POST', `/games/${code}/action`, { body: { type: 'hold', die: 2 }, playerToken: hostToken });
assert.equal(res.data.state.turn.held[2], true, 'Würfel festgehalten');

res = await call('POST', `/games/${code}/action`, { body: { type: 'roll' }, playerToken: hostToken });
res = await call('POST', `/games/${code}/action`, { body: { type: 'roll' }, playerToken: hostToken });
assert.equal(res.data.state.turn.rolls, 3);
res = await call('POST', `/games/${code}/action`, { body: { type: 'roll' }, playerToken: hostToken });
assert.equal(res.status, 400, 'Vierter Wurf abgelehnt');

res = await call('POST', `/games/${code}/action`, { body: { type: 'score', category: 'chance' }, playerToken: hostToken });
assert.equal(res.status, 200, 'Eintragen ok');
assert.equal(res.data.state.turn.player, 1, 'Gast ist jetzt dran');
assert.equal(typeof res.data.state.players[0].scores.chance, 'number', 'Punkte eingetragen');

res = await call('POST', `/games/${code}/action`, { body: { type: 'score', category: 'chance' }, playerToken: hostToken });
assert.equal(res.status, 400, 'Host nicht mehr am Zug');

// ?since-Polling: 204 solange nichts passiert.
res = await call('GET', `/games/${code}/state`);
const version = res.data.version;
res = await call('GET', `/games/${code}/state?since=${version}`);
assert.equal(res.status, 204, 'Polling liefert 204 ohne Änderung');
assert.equal(res.cacheControl, 'no-store', 'Polling wird nicht gecacht');

// --- Komplettes Spiel zu Ende spielen (beide Spieler, alle Felder) ---
const cats = res2catList();
function res2catList() {
  return ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'onePair', 'twoPairs', 'threeKind', 'fourKind', 'smallStraight', 'largeStraight', 'fullHouse', 'chance', 'yatzy'];
}

let state = (await call('GET', `/games/${code}/state`, { playerToken: hostToken })).data.state;
let guard = 0;
while (state.status === 'playing') {
  if (++guard > 100) throw new Error('Spiel endet nicht – Abbruch');
  const tokens = [hostToken, guestToken];
  const token = tokens[state.turn.player];
  await call('POST', `/games/${code}/action`, { body: { type: 'roll' }, playerToken: token });
  const open = cats.find((c) => state.players[state.turn.player].scores[c] === null);
  const r = await call('POST', `/games/${code}/action`, { body: { type: 'score', category: open }, playerToken: token });
  assert.equal(r.status, 200, `Eintrag ${open}: ${JSON.stringify(r.data)}`);
  state = r.data.state;
}
assert.equal(state.status, 'finished', 'Spiel beendet');
assert.equal(state.results.length, 2, 'Ergebnisliste');
assert.ok(state.results[0].total >= state.results[1].total, 'Sortierung nach Punkten');

// --- Historie des eingeloggten Hosts ---
res = await call('GET', '/history', { session });
assert.equal(res.status, 200, 'Historie abrufbar');
assert.equal(res.data.games.length, 1, 'Ein protokolliertes Spiel');
assert.equal(res.data.games[0].game_code, code);
assert.equal(res.data.stats[0].mode, 'yatzy');

// --- Kniffel-Modus kurz gegenprüfen (13 Felder) ---
res = await call('POST', '/games', { body: { mode: 'kniffel', name: 'Solo', entry: 'digital' } });
assert.equal(res.status, 201);
assert.equal(Object.keys(res.data.state.players[0].scores).length, 13, 'Kniffel-Bogen: 13 Felder');

// ===== Analogmodus (Hauptnutzung): analog würfeln, digital eintragen =====

res = await call('POST', '/games', { body: { mode: 'kniffel', name: 'Melanie' }, session });
assert.equal(res.status, 201, 'Analogspiel anlegen');
const mCode = res.data.code;
const mHost = res.data.playerToken;
assert.equal(res.data.state.entry, 'manual', 'Standard ist Analogmodus');
assert.equal(res.data.state.status, 'playing', 'Analogspiel läuft sofort');

for (const [method, path] of [
  ['POST', '/auth/register'], ['POST', '/auth/login'], ['POST', '/auth/password'],
  ['PATCH', '/auth/me'], ['POST', '/games'],
  ['POST', `/games/${mCode}/join`], ['POST', `/games/${mCode}/action`],
]) {
  for (const rawBody of ['null', '[]', '42', '"text"', '{']) {
    const invalid = await call(method, path, { rawBody, session, playerToken: mHost });
    assert.equal(invalid.status, 400, `${method} ${path}: ${rawBody} wird abgelehnt`);
    assert.equal(invalid.data.error, 'Der Request muss ein gültiges JSON-Objekt enthalten.',
      `${method} ${path}: ${rawBody} scheitert an der Body-Prüfung`);
    assert.equal(invalid.cacheControl, 'no-store', 'Fehler wird nicht gecacht');
  }
}

// Beitritt jederzeit möglich (kein Lobby-Zwang).
res = await call('POST', `/games/${mCode}/join`, { body: { name: 'Peter' } });
assert.equal(res.status, 200, 'Beitritt ins laufende Analogspiel');
const mGuest = res.data.playerToken;

// Digitale Aktionen sind gesperrt.
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'roll' }, playerToken: mHost });
assert.equal(res.status, 400, 'Analog: Würfeln gesperrt');
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'start' }, playerToken: mHost });
assert.equal(res.status, 400, 'Analog: kein Start nötig');

// Unmögliche Werte werden abgelehnt.
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'enter', category: 'ones', value: 7 }, playerToken: mHost });
assert.equal(res.status, 400, 'Analog: 7 Einser unmöglich');
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'enter', category: 'fullHouse', value: 24 }, playerToken: mHost });
assert.equal(res.status, 400, 'Analog: Full House 24 unmöglich');

// Gültige Einträge, ohne Zugreihenfolge – auch der Gast darf sofort.
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'enter', category: 'ones', value: 3 }, playerToken: mHost });
assert.equal(res.status, 200, 'Analog: Eintrag ok');
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'enter', category: 'chance', value: 23 }, playerToken: mGuest });
assert.equal(res.status, 200, 'Analog: Gast trägt ohne Reihenfolge ein');
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'enter', category: 'ones', value: 2 }, playerToken: mHost });
assert.equal(res.status, 400, 'Analog: Feld schon ausgefüllt');

// Eigene Einträge können korrigiert oder vollständig rückgängig gemacht werden.
res = await call('POST', `/games/${mCode}/action`, {
  body: { type: 'enter', category: 'ones', value: 4, overwrite: true },
  playerToken: mHost,
});
assert.equal(res.status, 200, 'Analog: bestehenden Eintrag korrigieren');
assert.equal(res.data.state.players[0].scores.ones, 4, 'Analog: korrigierter Wert gespeichert');
res = await call('POST', `/games/${mCode}/action`, {
  body: { type: 'clear', category: 'ones' },
  playerToken: mHost,
});
assert.equal(res.status, 200, 'Analog: Eintrag rückgängig machen');
assert.equal(res.data.state.players[0].scores.ones, null, 'Analog: Feld wieder leer');
res = await call('POST', `/games/${mCode}/action`, {
  body: { type: 'enter', category: 'ones', value: 3 },
  playerToken: mHost,
});
assert.equal(res.status, 200, 'Analog: geleertes Feld erneut ausfüllen');

// Kniffel-Bonus erst nach eingetragenem Kniffel (50).
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'extraBonus' }, playerToken: mHost });
assert.equal(res.status, 400, 'Analog: Bonus ohne Kniffel gesperrt');
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'enter', category: 'kniffel', value: 50 }, playerToken: mHost });
assert.equal(res.status, 200);
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'extraBonus' }, playerToken: mHost });
assert.equal(res.status, 200, 'Analog: Bonus nach Kniffel ok');
assert.equal(res.data.state.players[0].totals.extraBonus, 50, 'Analog: +50 verbucht');
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'extraBonus', remove: true }, playerToken: mHost });
assert.equal(res.status, 200, 'Analog: Kniffel-Bonus zurücknehmen');
assert.equal(res.data.state.players[0].totals.extraBonus, 0, 'Analog: +50 zurückgenommen');
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'extraBonus' }, playerToken: mHost });
assert.equal(res.status, 200, 'Analog: Kniffel-Bonus erneut verbuchen');

// Beide Bögen komplett füllen → Spiel endet automatisch.
const kniffelCats = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'kniffel', 'chance'];
let mState = res.data.state;
for (const [playerIndex, token] of [[0, mHost], [1, mGuest]].map((x) => x)) {
  for (const cat of kniffelCats) {
    if (mState.players[playerIndex].scores[cat] !== null) continue;
    const r = await call('POST', `/games/${mCode}/action`, { body: { type: 'enter', category: cat, value: 0 }, playerToken: token });
    assert.equal(r.status, 200, `Analog: ${cat} streichen (${JSON.stringify(r.data)})`);
    mState = r.data.state;
  }
}
assert.equal(mState.status, 'finished', 'Analogspiel automatisch beendet');
assert.equal(mState.results.length, 2, 'Analog: Ergebnisliste');
assert.equal(mState.results[0].name, 'Melanie', 'Analog: Melanie gewinnt (53+35+50... > 23)');
res = await call('GET', '/history', { session });
assert.equal(res.data.games.filter((g) => g.game_code === mCode).length, 1, 'Analog: genau ein protokolliertes Ergebnis');

// Auch nach dem automatischen Ende kann ein Fehler rückgängig gemacht werden.
res = await call('POST', `/games/${mCode}/action`, {
  body: { type: 'clear', category: 'ones' },
  playerToken: mHost,
});
assert.equal(res.status, 200, 'Analog: Eintrag nach Spielende rückgängig machen');
assert.equal(res.data.state.status, 'playing', 'Analog: Spiel für Korrektur wieder geöffnet');
assert.equal(res.data.state.players[0].scores.ones, null, 'Analog: Feld nach Ende wieder leer');
res = await call('GET', '/history', { session });
assert.equal(res.data.games.some((g) => g.game_code === mCode), false, 'Analog: Ergebnis nach Wiederöffnung entfernt');
res = await call('POST', `/games/${mCode}/action`, {
  body: { type: 'enter', category: 'ones', value: 3 },
  playerToken: mHost,
});
assert.equal(res.status, 200, 'Analog: Korrektur nach Spielende neu eintragen');
assert.equal(res.data.state.status, 'finished', 'Analog: Spiel nach Korrektur wieder beendet');
res = await call('GET', '/history', { session });
assert.equal(res.data.games.filter((g) => g.game_code === mCode).length, 1, 'Analog: neu beendet ohne doppelte Historie');

// Nach Spielende kein Beitritt mehr.
res = await call('POST', `/games/${mCode}/join`, { body: { name: 'Spät' } });
assert.equal(res.status, 400, 'Analog: kein Beitritt nach Spielende');

// Host kann ohne Neueinladung zurücksetzen – Mitspieler bleiben.
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'reset' }, playerToken: mGuest });
assert.equal(res.status, 400, 'Analog: nur Host darf resetten');
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'reset' }, playerToken: mHost });
assert.equal(res.status, 200, 'Analog: Reset durch Host');
assert.equal(res.data.state.status, 'playing', 'Analog: nach Reset wieder laufend');
assert.equal(res.data.state.players.length, 2, 'Analog: Mitspieler bleiben nach Reset');
assert.equal(res.data.state.players[0].scores.ones, null, 'Analog: Punkte geleert');
assert.ok(res.data.state.log.length > 12, 'Analog: Protokoll unbegrenzt (nicht auf 12 gekürzt)');
assert.ok(res.data.state.log.every((e) => e.id != null && e.canRevert), 'Analog: Log-Einträge sind revertiertbar');

// Revert auf einen früheren Protokolleintrag.
const joinLog = res.data.state.log.find((e) => e.text.includes('Peter ist dem Spiel beigetreten'));
const historyAfterReset = await call('GET', '/history', { session });
assert.equal(historyAfterReset.data.games.some((g) => g.game_code === mCode), false, 'Analog: Reset entfernt Ergebnis');
assert.ok(joinLog, 'Analog: Beitritts-Log gefunden');
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'enter', category: 'ones', value: 5 }, playerToken: mHost });
assert.equal(res.data.state.players[0].scores.ones, 5);
res = await call('POST', `/games/${mCode}/action`, { body: { type: 'revertLog', logId: joinLog.id }, playerToken: mHost });
assert.equal(res.status, 200, 'Analog: Revert über Protokoll');
assert.equal(res.data.state.players[0].scores.ones, null, 'Analog: Stand nach Revert wieder leer');

// ===== Papierblock-Modus (Host trägt für alle ein) =====
res = await call('POST', '/games', { body: { mode: 'kniffel', name: 'Hostin', hostPaper: true } });
assert.equal(res.status, 201, 'Papierblock anlegen');
assert.equal(res.data.state.hostPaper, true, 'Papierblock-Flag gesetzt');
const pCode = res.data.code;
const pHost = res.data.playerToken;

res = await call('POST', `/games/${pCode}/action`, { body: { type: 'addSeat', name: 'Oma' }, playerToken: pHost });
assert.equal(res.status, 200, 'Papierblock: Platz hinzufügen');
assert.equal(res.data.state.players.length, 2, 'Papierblock: zwei Spieler');
assert.equal(res.data.state.players[1].name, 'Oma');

res = await call('POST', `/games/${pCode}/action`, {
  body: { type: 'enter', category: 'ones', value: 3, forPlayer: 1 },
  playerToken: pHost,
});
assert.equal(res.status, 200, 'Papierblock: Host trägt für anderen ein');
assert.equal(res.data.state.players[1].scores.ones, 3, 'Papierblock: Wert in fremder Spalte');

// Ohne hostPaper darf man nicht für andere eintragen.
res = await call('POST', '/games', { body: { mode: 'kniffel', name: 'Normal' } });
const nHost = res.data.playerToken;
const nCode = res.data.code;
await call('POST', `/games/${nCode}/join`, { body: { name: 'Gast2' } });
res = await call('POST', `/games/${nCode}/action`, {
  body: { type: 'enter', category: 'ones', value: 2, forPlayer: 1 },
  playerToken: nHost,
});
assert.equal(res.status, 400, 'Ohne Papierblock kein Eintrag für andere');
res = await call('POST', `/games/${nCode}/action`, { body: { type: 'addSeat', name: 'X' }, playerToken: nHost });
assert.equal(res.status, 400, 'Ohne Papierblock kein Platz hinzufügen');

// Gleichzeitige Beitritte und unabhängige Einträge dürfen sich nicht überschreiben.
const joined = await Promise.all(['Anna', 'Berta'].map((name) =>
  call('POST', `/games/${nCode}/join`, { body: { name } })
));
assert.ok(joined.every((r) => r.status === 200), 'Gleichzeitige Beitritte werden wiederholt');
const entered = await Promise.all(joined.map((r, i) =>
  call('POST', `/games/${nCode}/action`, {
    body: { type: 'enter', category: 'ones', value: i + 1 }, playerToken: r.data.playerToken,
  })
));
assert.ok(entered.every((r) => r.status === 200), 'Gleichzeitige Einträge werden wiederholt');
res = await call('GET', `/games/${nCode}/state`);
assert.equal(res.data.state.players.find((p) => p.name === 'Anna').scores.ones, 1);
assert.equal(res.data.state.players.find((p) => p.name === 'Berta').scores.ones, 2);

// --- Einstellungen: Name & Passwort ändern ---
res = await call('PATCH', '/auth/me', { body: { displayName: 'Neuer Name' }, session });
assert.equal(res.data.user.displayName, 'Neuer Name', 'Anzeigename geändert');

res = await call('POST', '/auth/password', { body: { oldPassword: 'geheim123', newPassword: 'nochGeheimer1' }, session });
assert.equal(res.status, 200, 'Passwort geändert');
res = await call('POST', '/auth/login', { body: { username: `tester_${stamp}`, password: 'nochGeheimer1' } });
assert.equal(res.status, 200, 'Login mit neuem Passwort');
const secondSession = res.data.token;
await call('POST', '/auth/logout', { session: secondSession });
assert.equal((await call('GET', '/auth/me', { session: secondSession })).status, 401, 'Logout entwertet Sitzung');

console.log('✔ api.test: kompletter Spiel- und Kontozyklus erfolgreich durchgespielt.');
