// End-to-End-Test gegen einen lokal laufenden Dev-Server (npm run dev).
// Ausführen: node tests/api.test.mjs   (BASE-URL via env BASE überschreibbar)

import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8788';

async function call(method, path, { body, session, playerToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) headers.Authorization = `Bearer ${session}`;
  if (playerToken) headers['X-Player-Token'] = playerToken;
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

// Server erreichbar?
try {
  await fetch(BASE, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log(`⚠ api.test übersprungen: kein Dev-Server unter ${BASE} (mit "npm run dev" starten).`);
  process.exit(0);
}

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

// --- Spiel anlegen (eingeloggt) + zweiter Spieler (anonym) ---
res = await call('POST', '/games', { body: { mode: 'yatzy' }, session });
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
res = await call('POST', '/games', { body: { mode: 'kniffel', name: 'Solo' } });
assert.equal(res.status, 201);
assert.equal(Object.keys(res.data.state.players[0].scores).length, 13, 'Kniffel-Bogen: 13 Felder');

// --- Einstellungen: Name & Passwort ändern ---
res = await call('PATCH', '/auth/me', { body: { displayName: 'Neuer Name' }, session });
assert.equal(res.data.user.displayName, 'Neuer Name', 'Anzeigename geändert');

res = await call('POST', '/auth/password', { body: { oldPassword: 'geheim123', newPassword: 'nochGeheimer1' }, session });
assert.equal(res.status, 200, 'Passwort geändert');
res = await call('POST', '/auth/login', { body: { username: `tester_${stamp}`, password: 'nochGeheimer1' } });
assert.equal(res.status, 200, 'Login mit neuem Passwort');

console.log('✔ api.test: kompletter Spiel- und Kontozyklus erfolgreich durchgespielt.');
