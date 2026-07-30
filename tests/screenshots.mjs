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
await shot('01-landing');

// 2. Spiel erstellen (Kniffel) → Lobby
await page.fill('#create-name', 'Melanie');
await page.click('#btn-create');
await page.waitForSelector('#btn-start');
await shot('02-lobby');
const code = new URL(page.url()).hash.match(/game\/(\w+)/)[1];
console.log('Spielcode:', code);

// 3. Zweiter Spieler tritt in eigenem Kontext bei
const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page2.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
await page2.fill('#join-code', code);
await page2.fill('#join-name', 'Peter');
await page2.click('#btn-join');
await page2.waitForSelector('.player-list');

// 4. Starten, würfeln, festhalten
await page.click('#btn-start');
await page.waitForSelector('#btn-roll');
await page.click('#btn-roll');
await page.waitForTimeout(600);
await page.click('.dice-tray button.die >> nth=1');
await page.waitForTimeout(300);
await shot('03-spiel');

// 5. Punkte eintragen → Peter ist dran
await page.click('td.val.pick >> nth=0');
await page.waitForTimeout(400);

// 6. Zuschaueransicht
const page3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page3.goto(`${BASE}/#/watch/${code}`, { waitUntil: 'networkidle' });
await page3.waitForSelector('.scoresheet');
await page3.screenshot({ path: `${OUT}/04-zuschauer.png`, fullPage: true });

// 7. Registrierung + Einstellungen
await page.goto(`${BASE}/#/register`, { waitUntil: 'networkidle' });
await page.fill('#rg-user', `shot_${Date.now().toString(36)}`);
await page.fill('#rg-display', 'Melanie');
await page.fill('#rg-pass', 'geheim123');
await page.click('#reg-form button[type=submit]');
await page.waitForSelector('.userchip');
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
await page.waitForSelector('.history');
await shot('05-einstellungen');

// 8. Login-Seite
await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
await shot('06-login');

// Mobile Landing
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
await shot('07-mobil');

await browser.close();
if (errors.length) {
  console.error('Browserfehler gefunden:');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log(`✔ Screenshots in ${OUT} erstellt, keine Browserfehler.`);
