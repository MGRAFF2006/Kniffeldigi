// Browser-Smoke-Test: echter Chromium gegen einen selbst gestarteten `wrangler dev`
// mit leerer, temporärer D1-Datenbank. Prüft den Hauptablauf eines analogen
// Kniffel-Abends aus Sicht zweier Spieler und eines Zuschauers.
//
// Ausführen: npm run test:browser
// Einmalig vorher: npx playwright install --only-shell chromium

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

// Polling läuft alle 1,5 s; ein Update beim anderen Spieler braucht also höchstens
// zwei Intervalle. Großzügig genug für langsame Runner, ohne echte Hänger zu verstecken.
const UPDATE_TIMEOUT = 8000;
const SERVER_START_TIMEOUT = 60_000;

let server;
let base;
let browser;
const browserErrors = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const dir = await mkdtemp(join(tmpdir(), 'wuerfelblock-browser-'));
  const port = await freePort();
  const inspectorPort = await freePort();
  const log = [];
  // Eigene Prozessgruppe, damit beim Aufräumen auch workerd sicher mit beendet wird.
  const proc = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js', 'dev', '--local',
      '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspectorPort),
      '--persist-to', join(dir, 'state'), '--show-interactive-dev-session=false',
    ],
    { cwd: new URL('..', import.meta.url), detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }
  );
  proc.stdout.on('data', (chunk) => log.push(chunk));
  proc.stderr.on('data', (chunk) => log.push(chunk));
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  const handle = { proc, dir, exited, log: () => Buffer.concat(log).toString() };
  server = handle;

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + SERVER_START_TIMEOUT;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`wrangler dev beendet (Code ${proc.exitCode}):\n${handle.log()}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return url;
    } catch {
      /* noch nicht bereit */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`wrangler dev nach ${SERVER_START_TIMEOUT / 1000} s nicht erreichbar:\n${handle.log()}`);
}

function killServerGroup(signal) {
  try {
    process.kill(-server.proc.pid, signal);
  } catch {
    /* Prozessgruppe existiert nicht mehr */
  }
}

async function stopServer() {
  if (!server) return;
  if (server.proc.exitCode === null && server.proc.signalCode === null) {
    killServerGroup('SIGTERM');
    const timer = setTimeout(() => killServerGroup('SIGKILL'), 5000);
    await server.exited;
    clearTimeout(timer);
  }
  await rm(server.dir, { recursive: true, force: true });
  server = null;
}

// Letzte Absicherung, falls der Test-Prozess abbricht, bevor `after` läuft
// (der Server liegt in eigener Prozessgruppe und bekommt Strg+C sonst nicht mit).
process.on('exit', () => {
  if (!server) return;
  killServerGroup('SIGKILL');
  rmSync(server.dir, { recursive: true, force: true });
});
process.once('SIGINT', () => process.exit(130));
process.once('SIGTERM', () => process.exit(143));

async function newPlayer(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Externe Ressourcen (Google Fonts) leer beantworten: Der Test bleibt offline-fähig
  // und ein langsamer CDN-Abruf kann ihn nicht ausbremsen.
  await context.route((url) => !url.href.startsWith(base), (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await context.addInitScript({ content: `window.readCell = ${readCell.toString()};` });
  const page = await context.newPage();
  // Fehlende Elemente sollen schnell und mit klarer Meldung scheitern, nicht nach 30 s.
  page.setDefaultTimeout(UPDATE_TIMEOUT);
  page.setDefaultNavigationTimeout(30_000);
  page.on('pageerror', (err) => browserErrors.push(`[${label}] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') browserErrors.push(`[${label}] console.error: ${msg.text()}`);
  });
  return page;
}

function codeFromUrl(page) {
  const match = new URL(page.url()).hash.match(/^#\/game\/([A-Z0-9]+)$/);
  assert.ok(match, `Keine Spiel-URL: ${page.url()}`);
  return match[1];
}

async function createGame(page, name, mode = 'kniffel') {
  await page.goto(`${base}/#/`);
  await page.click(`.mode-card[data-mode="${mode}"]`);
  await page.fill('#create-name', name);
  await page.click('#btn-create');
  await page.waitForSelector('td.val.pick.manual');
  return codeFromUrl(page);
}

async function joinGame(page, code, name) {
  await page.goto(`${base}/#/`);
  await page.fill('#join-code', code);
  await page.fill('#join-name', name);
  await page.click('#btn-join');
  await page.waitForSelector('td.val.pick.manual');
  assert.equal(codeFromUrl(page), code, 'Beitritt landet im richtigen Spiel');
}

/** Eigenes Feld über den Eingabe-Dialog füllen; wartet auf die gespeicherte Antwort. */
async function enter(page, cat, value) {
  await page.click(`td.val.pick.manual[data-cat="${cat}"]`);
  await page.click(`#entry-modal .chip[data-value="${value}"]`);
  await page.waitForSelector(`td.val.own-edit[data-cat="${cat}"][data-current="${value}"]`);
}

async function overwrite(page, cat, from, to) {
  await page.click(`td.val.own-edit[data-cat="${cat}"][data-current="${from}"]`);
  await page.click(`#entry-modal .chip[data-value="${to}"]`);
  await page.waitForSelector(`td.val.own-edit[data-cat="${cat}"][data-current="${to}"]`);
}

async function clear(page, cat, from) {
  await page.click(`td.val.own-edit[data-cat="${cat}"][data-current="${from}"]`);
  await page.click('#entry-clear');
  await page.waitForSelector(`td.val.pick.manual[data-cat="${cat}"]`);
}

/** Läuft im Browser (per addInitScript): liest die Zelle Spieler × Zeile so, wie sie angezeigt wird. */
function readCell({ player, row }) {
  const names = [...document.querySelectorAll('.scoresheet thead .player-name')].map((el) =>
    el.textContent.replace(/ \(du\)$/, '')
  );
  const col = names.indexOf(player);
  if (col < 0) return { error: `Spieler ${player} fehlt (Spalten: ${names.join(', ') || 'keine'})` };
  const tr = [...document.querySelectorAll('.scoresheet tbody tr')].find(
    (r) => r.querySelector('.catname')?.textContent === row
  );
  if (!tr) return { error: `Zeile ${row} fehlt` };
  const cell = tr.querySelectorAll('td.val')[col];
  // Nur der erste Textknoten zählt: Summenzellen können noch ±50-Knöpfe enthalten.
  const text = cell.classList.contains('pick') ? '' : (cell.firstChild?.textContent ?? '').trim();
  return { text };
}

/**
 * Wartet, bis der angezeigte Block die erwarteten Werte zeigt (z. B. nach dem
 * nächsten Poll). `expected` ordnet "Spieler/Zeile" dem angezeigten Text zu; '' = leer.
 */
async function expectSheet(page, label, expected) {
  const checks = Object.entries(expected).map(([key, want]) => {
    const [player, row] = key.split('/');
    return { player, row, want: String(want) };
  });
  try {
    await page.waitForFunction(
      (checks) => checks.every((c) => window.readCell(c).text === c.want),
      checks,
      { timeout: UPDATE_TIMEOUT }
    );
  } catch {
    const actual = await page.evaluate(
      (checks) => checks.map((c) => ({ ...c, got: window.readCell(c) })),
      checks
    );
    const diff = actual
      .filter((c) => c.got.text !== c.want)
      .map((c) => `${c.player}/${c.row}: erwartet "${c.want}", angezeigt ${c.got.error ?? `"${c.got.text}"`}`)
      .join('; ');
    assert.fail(`[${label}] Block zeigt nach ${UPDATE_TIMEOUT / 1000} s nicht den erwarteten Stand: ${diff}`);
  }
}

async function expectShownGame(page, label, code, heading) {
  await page.waitForFunction(
    ({ code }) => document.querySelector('.codebadge .code')?.textContent === code,
    { code },
    { timeout: UPDATE_TIMEOUT }
  ).catch(() => {});
  const shown = await page.evaluate(() => ({
    code: document.querySelector('.codebadge .code')?.textContent,
    heading: document.querySelector('.game-top h1')?.textContent.trim(),
  }));
  assert.equal(shown.code, code, `[${label}] zeigt den Spielcode des falschen Spiels`);
  assert.match(shown.heading, heading, `[${label}] Überschrift passt nicht zum Spiel`);
}

/** Wartet auf zwei weitere abgeschlossene Polls dieses Spiels. */
async function waitForPolls(page, code, count = 2) {
  for (let i = 0; i < count; i++) {
    await page.waitForResponse((res) => res.url().includes(`/api/games/${code}/state?since=`), { timeout: UPDATE_TIMEOUT });
  }
}

before(async () => {
  base = await startServer();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await stopServer();
});

test('analoger Kniffel-Abend: zwei Spieler, Korrektur, Zuschauer, Spielwechsel', { timeout: 90_000 }, async () => {
  const melanie = await newPlayer('Melanie');
  const peter = await newPlayer('Peter');

  // Spiel anlegen und mit Code beitreten (getrennte Browser-Kontexte = getrennte Geräte).
  const code = await createGame(melanie, 'Melanie');
  await joinGame(peter, code, 'Peter');
  await expectSheet(melanie, 'Melanie sieht Peters Beitritt', { 'Peter/Endsumme': '0' });

  // Beide tragen ein; der jeweils andere sieht es per Polling samt Summen.
  await enter(peter, 'ones', 3);
  await enter(melanie, 'twos', 4);
  await expectSheet(melanie, 'Melanie sieht Peters Eintrag', {
    'Peter/Einser': 3, 'Peter/Summe oben': 3, 'Peter/Endsumme': 3, 'Melanie/Zweier': 4, 'Melanie/Endsumme': 4,
  });
  await expectSheet(peter, 'Peter sieht Melanies Eintrag', {
    'Melanie/Zweier': 4, 'Melanie/Summe oben': 4, 'Melanie/Endsumme': 4, 'Peter/Einser': 3,
  });

  // Korrektur: überschreiben und Feld wieder leeren; Peter sieht beides.
  await overwrite(melanie, 'twos', 4, 8);
  await expectSheet(peter, 'Peter sieht Melanies Korrektur', { 'Melanie/Zweier': 8, 'Melanie/Endsumme': 8 });
  await clear(melanie, 'twos', 8);
  await expectSheet(peter, 'Peter sieht geleertes Feld', { 'Melanie/Zweier': '', 'Melanie/Endsumme': 0 });
  // Unterer Teil, damit Endsumme ≠ Summe oben und beide Summen getrennt geprüft werden.
  await enter(melanie, 'fullHouse', 25);

  // Zuschauer: sieht den Stand ohne Eingabefelder und bekommt neue Einträge per Polling.
  const watcher = await newPlayer('Zuschauer');
  await watcher.goto(`${base}/#/watch/${code}`);
  await expectShownGame(watcher, 'Zuschauer', code, /Zuschauermodus/);
  await expectSheet(watcher, 'Zuschauer sieht den Spielstand', {
    'Melanie/Full House': 25, 'Melanie/Zweier': '', 'Melanie/Summe oben': 0, 'Melanie/Summe unterer Teil': 25,
    'Melanie/Endsumme': 25, 'Peter/Einser': 3, 'Peter/Endsumme': 3,
  });
  assert.equal(await watcher.locator('td.val.pick, td.val.own-edit').count(), 0, 'Zuschauer kann nichts eintragen');
  await enter(peter, 'sixes', 18);
  await expectSheet(watcher, 'Zuschauer sieht neuen Eintrag', { 'Peter/Sechser': 18, 'Peter/Endsumme': 21 });

  // Spielwechsel: Melanie legt ein zweites Spiel an. Während sie dort ist, ändert Peter
  // das erste Spiel – das darf nicht in Melanies Ansicht des zweiten Spiels auftauchen.
  const secondCode = await createGame(melanie, 'Melanie', 'yatzy');
  assert.notEqual(secondCode, code, 'Zweites Spiel hat eigenen Code');
  await melanie.goto(`${base}/#/game/${code}`);
  await expectShownGame(melanie, 'Melanie zurück im ersten Spiel', code, /^Kniffel/);
  await expectSheet(melanie, 'Melanie sieht erstes Spiel', { 'Peter/Sechser': 18, 'Melanie/Full House': 25 });
  await melanie.goto(`${base}/#/game/${secondCode}`);
  await expectShownGame(melanie, 'Melanie im zweiten Spiel', secondCode, /^Yatzy/);
  await enter(peter, 'fives', 15);
  await waitForPolls(melanie, secondCode);
  await expectShownGame(melanie, 'Melanie bleibt im zweiten Spiel', secondCode, /^Yatzy/);
  const columns = await melanie.locator('.scoresheet thead .player-name').allTextContents();
  assert.deepEqual(columns, ['Melanie (du)'], 'Zweites Spiel zeigt nur seine eigenen Spieler');
  await expectSheet(melanie, 'Zweites Spiel ist leer', { 'Melanie/Endsumme': 0 });

  // Zurück (Browser-Verlauf) zeigt wieder das erste Spiel mit Peters neuem Eintrag.
  await melanie.goBack();
  await expectShownGame(melanie, 'Melanie per Zurück im ersten Spiel', code, /^Kniffel/);
  await expectSheet(melanie, 'Erstes Spiel aktuell', { 'Peter/Fünfer': 15, 'Peter/Endsumme': 36 });

  assert.deepEqual(browserErrors, [], `Browserfehler:\n${browserErrors.join('\n')}`);
});
