// Macht Screenshots der wichtigsten Ansichten mit Playwright (manuelles Hilfsskript).
// Voraussetzung: npm run dev läuft. Ausführen: node tests/screenshots.mjs [zielordner]

import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8788';
const OUT = process.argv[2] || '/tmp/wb-shots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

// 1. Landing
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
await page.click('#landing-dice');
await page.waitForSelector('#landing-dice.is-rolling');
await page.waitForTimeout(800);
if (await page.locator('#landing-dice').evaluate((el) => el.classList.contains('is-rolling'))) {
  throw new Error('Landing-Würfel stoppen nicht.');
}
const landingFaces = await page.locator('#landing-dice .die').evaluateAll((dice) => dice.map((d) => Number(d.dataset.face)));
if (landingFaces.length !== 5 || landingFaces.some((face) => face < 1 || face > 6)) {
  throw new Error(`Ungültige Landing-Würfel: ${landingFaces.join(',')}`);
}
await shot('01-landing');

// 2. Analoges Spiel erstellen (Standard) → läuft sofort
await page.fill('#create-name', 'Melanie');
await page.click('#btn-create');
await page.waitForSelector('td.val.pick.manual');
const code = new URL(page.url()).hash.match(/game\/(\w+)/)[1];
console.log('Analog-Spielcode:', code);

// 3. Peter tritt dem laufenden Analogspiel bei und trägt etwas ein
const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page2.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
await page2.fill('#join-code', code);
await page2.fill('#join-name', 'Peter');
await page2.click('#btn-join');
await page2.waitForSelector('td.val.pick.manual');
await page2.click('td.val.pick.manual >> nth=0'); // Einser
await page2.waitForSelector('.chip-grid');
await page2.click('.chip >> nth=3'); // 3 Einser
await page2.waitForTimeout(400);

// 4. Melanie: Eingabe-Dialog zeigen
await page.waitForTimeout(1800); // Poll aufnehmen
await page.click('td.val.pick.manual >> nth=1'); // Zweier
await page.waitForSelector('.chip-grid');
await shot('02-analog-eintragen');
await page.click('.chip >> nth=2'); // 4 Punkte
await page.waitForTimeout(400);
await shot('03-analog-spiel');

// 5. Ausgefülltes Feld korrigieren / rückgängig machen
await page.click('td.val.own-edit[data-current="4"]');
await page.waitForSelector('#entry-clear');
await page.waitForTimeout(250);
await shot('03-korrektur');
await page.click('#entry-clear');
await page.waitForSelector('td.val.pick.manual[data-cat="twos"]');
await page.click('td.val.pick.manual[data-cat="twos"]');
await page.click('.chip[data-value="4"]');
await page.waitForSelector('td.val.own-edit[data-current="4"]');

// 6. Zuschaueransicht
const page3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page3.goto(`${BASE}/#/watch/${code}`, { waitUntil: 'networkidle' });
await page3.waitForSelector('.scoresheet');
await page3.screenshot({ path: `${OUT}/04-zuschauer.png`, fullPage: true });

// 7. Digitales Spiel (optionaler Modus): Lobby → Start → Würfeln
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
await page.click('.style-card[data-entry="digital"]');
await page.fill('#create-name', 'Melanie');
await page.click('#btn-create');
await page.waitForSelector('#btn-start');
await page.click('#btn-start');
await page.waitForSelector('#btn-roll');
await page.click('#btn-roll');
await page.waitForTimeout(700);
await shot('05-digital-spiel');

// 8. Registrierung + Einstellungen
await page.goto(`${BASE}/#/register`, { waitUntil: 'networkidle' });
await page.fill('#rg-user', `shot_${Date.now().toString(36)}`);
await page.fill('#rg-display', 'Melanie');
await page.fill('#rg-pass', 'geheim123');
await page.click('#reg-form button[type=submit]');
await page.waitForSelector('.userchip');
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
await page.waitForSelector('.history');
await shot('06-einstellungen');

// Mobile Landing + Analogspiel
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
await shot('07-mobil');
await page.goto(`${BASE}/#/game/${code}`, { waitUntil: 'networkidle' });
await page.waitForSelector('.scoresheet');
await shot('08-mobil-spiel');

await browser.close();
if (errors.length) {
  console.error('Browserfehler gefunden:');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log(`✔ Screenshots in ${OUT} erstellt, keine Browserfehler.`);
