// Unit-Tests für die Wertungslogik (Server) + Abgleich mit der Client-Kopie.
// Ausführen: node tests/rules.test.mjs

import assert from 'node:assert/strict';
import * as server from '../functions/api/_lib/rules.js';
import * as client from '../public/js/rules.js';

let passed = 0;
function eq(actual, expected, label) {
  assert.equal(actual, expected, `${label}: erwartet ${expected}, bekommen ${actual}`);
  passed++;
}

const s = server.scoreCategory;

// --- Oberer Teil (beide Spiele identisch) ---
eq(s('kniffel', 'ones', [1, 1, 3, 4, 1]), 3, 'Kniffel Einser');
eq(s('yatzy', 'sixes', [6, 6, 6, 2, 1]), 18, 'Yatzy Sechser');
eq(s('kniffel', 'fives', [1, 2, 3, 4, 6]), 0, 'Kniffel Fünfer leer');

// --- Kniffel unterer Teil ---
eq(s('kniffel', 'threeKind', [3, 3, 3, 4, 5]), 18, 'Kniffel Dreierpasch = Summe aller');
eq(s('kniffel', 'threeKind', [3, 3, 4, 4, 5]), 0, 'Kniffel Dreierpasch nicht erfüllt');
eq(s('kniffel', 'fourKind', [2, 2, 2, 2, 6]), 14, 'Kniffel Viererpasch = Summe aller');
eq(s('kniffel', 'fullHouse', [2, 2, 3, 3, 3]), 25, 'Kniffel Full House 25');
eq(s('kniffel', 'fullHouse', [2, 2, 2, 2, 3]), 0, 'Kniffel Full House 4+1 ungültig');
eq(s('kniffel', 'smallStraight', [1, 2, 3, 4, 6]), 30, 'Kniffel kleine Straße 30');
eq(s('kniffel', 'smallStraight', [2, 2, 3, 4, 5]), 30, 'Kniffel kleine Straße mit Paar');
eq(s('kniffel', 'smallStraight', [1, 2, 3, 5, 6]), 0, 'Kniffel kleine Straße Lücke');
eq(s('kniffel', 'largeStraight', [2, 3, 4, 5, 6]), 40, 'Kniffel große Straße 40');
eq(s('kniffel', 'largeStraight', [1, 2, 3, 4, 6]), 0, 'Kniffel große Straße nicht erfüllt');
eq(s('kniffel', 'kniffel', [4, 4, 4, 4, 4]), 50, 'Kniffel 50');
eq(s('kniffel', 'chance', [1, 2, 3, 4, 5]), 15, 'Kniffel Chance');

// --- Yatzy unterer Teil (abweichende Wertung!) ---
eq(s('yatzy', 'onePair', [3, 3, 5, 5, 1]), 10, 'Yatzy ein Paar = höchstes Paar');
eq(s('yatzy', 'onePair', [1, 2, 3, 4, 6]), 0, 'Yatzy ein Paar leer');
eq(s('yatzy', 'twoPairs', [3, 3, 5, 5, 1]), 16, 'Yatzy zwei Paare = Summe beider');
eq(s('yatzy', 'twoPairs', [3, 3, 3, 5, 1]), 0, 'Yatzy zwei Paare nur ein Paar');
eq(s('yatzy', 'threeKind', [3, 3, 3, 4, 5]), 9, 'Yatzy drei Gleiche = nur Drilling');
eq(s('yatzy', 'fourKind', [2, 2, 2, 2, 6]), 8, 'Yatzy vier Gleiche = nur Vierling');
eq(s('yatzy', 'smallStraight', [1, 2, 3, 4, 5]), 15, 'Yatzy kleine Straße = 15 fest');
eq(s('yatzy', 'smallStraight', [2, 3, 4, 5, 6]), 0, 'Yatzy kleine Straße nur 1-5');
eq(s('yatzy', 'largeStraight', [2, 3, 4, 5, 6]), 20, 'Yatzy große Straße = 20 fest');
eq(s('yatzy', 'fullHouse', [2, 2, 3, 3, 3]), 13, 'Yatzy Full House = Summe aller');
eq(s('yatzy', 'yatzy', [6, 6, 6, 6, 6]), 50, 'Yatzy 50');

// --- Kniffel-Jokerregel ---
eq(s('kniffel', 'fullHouse', [5, 5, 5, 5, 5], true), 25, 'Joker Full House');
eq(s('kniffel', 'largeStraight', [5, 5, 5, 5, 5], true), 40, 'Joker große Straße');
assert.equal(server.jokerApplies('kniffel', [5, 5, 5, 5, 5], { kniffel: 50 }), true, 'Joker greift');
assert.equal(server.jokerApplies('kniffel', [5, 5, 5, 5, 5], { kniffel: null }), false, 'Joker greift nicht ohne Kniffel-Eintrag');
assert.equal(server.jokerApplies('yatzy', [5, 5, 5, 5, 5], { yatzy: 50 }), false, 'Yatzy kennt keinen Joker');
passed += 3;

// --- Boni & Summen ---
{
  const scores = server.emptyScores('kniffel');
  ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].forEach((cat, i) => (scores[cat] = (i + 1) * 3)); // 63
  const t = server.totals('kniffel', scores, 1);
  eq(t.bonus, 35, 'Kniffel Bonus bei 63');
  eq(t.extraBonus, 50, 'Kniffel Extra-Bonus');
  eq(t.grandTotal, 63 + 35 + 50, 'Kniffel Endsumme');
}
{
  const scores = server.emptyScores('yatzy');
  scores.sixes = 24; // < 63 gesamt
  const t = server.totals('yatzy', scores, 0);
  eq(t.bonus, 0, 'Yatzy kein Bonus unter 63');
  ['ones', 'twos', 'threes', 'fours', 'fives'].forEach((cat, i) => (scores[cat] = (i + 1) * 4));
  eq(server.totals('yatzy', scores, 0).bonus, 50, 'Yatzy Bonus 50 ab 63');
}

// --- Kategorien-Listen ---
eq(server.allCategories('kniffel').length, 13, 'Kniffel: 13 Felder');
eq(server.allCategories('yatzy').length, 15, 'Yatzy: 15 Felder');

// --- Analogmodus: manuelle Werte-Validierung ---
const v = server.validManualScore;
eq(v('kniffel', 'ones', 3), true, 'Manuell: 3 Einser ok');
eq(v('kniffel', 'ones', 7), false, 'Manuell: 7 Einser unmöglich');
eq(v('kniffel', 'twos', 5), false, 'Manuell: Zweier nur Vielfache von 2');
eq(v('kniffel', 'fullHouse', 25), true, 'Manuell: Full House 25');
eq(v('kniffel', 'fullHouse', 20), false, 'Manuell: Full House nur 0/25');
eq(v('kniffel', 'threeKind', 17), true, 'Manuell: Dreierpasch Summe ok');
eq(v('kniffel', 'threeKind', 31), false, 'Manuell: Dreierpasch max 30');
eq(v('kniffel', 'kniffel', 50), true, 'Manuell: Kniffel 50');
eq(v('kniffel', 'chance', 0), true, 'Manuell: Streichen immer erlaubt');
eq(v('yatzy', 'onePair', 12), true, 'Manuell: Yatzy Paar 12');
eq(v('yatzy', 'onePair', 11), false, 'Manuell: Yatzy Paar nur gerade');
eq(v('yatzy', 'twoPairs', 22), true, 'Manuell: Yatzy zwei Paare max');
eq(v('yatzy', 'threeKind', 10), false, 'Manuell: Yatzy Drilling nur Vielfache von 3');
eq(v('yatzy', 'fullHouse', 7), true, 'Manuell: Yatzy Full House min 7');
eq(v('yatzy', 'fullHouse', 6), false, 'Manuell: Yatzy Full House 6 unmöglich');
eq(v('yatzy', 'largeStraight', 20), true, 'Manuell: Yatzy große Straße 20');
eq(v('yatzy', 'largeStraight', 15), false, 'Manuell: Yatzy große Straße nur 0/20');

// Client-Kopie der manuellen Validierung muss identisch sein.
for (const mode of ['kniffel', 'yatzy']) {
  for (const cat of server.allCategories(mode)) {
    for (let val = 0; val <= 55; val++) {
      assert.equal(
        server.validManualScore(mode, cat, val),
        client.validManualScore(mode, cat, val),
        `Client/Server-Abweichung bei validManualScore: ${mode}/${cat}/${val}`
      );
    }
  }
}
passed++;

// --- Client-Kopie muss identisch werten ---
let random = 42;
const nextDie = () => {
  random = (random * 1103515245 + 12345) % 2 ** 31;
  return (random % 6) + 1;
};
for (let i = 0; i < 2000; i++) {
  const dice = [nextDie(), nextDie(), nextDie(), nextDie(), nextDie()];
  for (const mode of ['kniffel', 'yatzy']) {
    for (const cat of server.allCategories(mode)) {
      const a = server.scoreCategory(mode, cat, dice);
      const b = client.scoreCategory(mode, cat, dice);
      assert.equal(a, b, `Client/Server-Abweichung: ${mode}/${cat} bei [${dice}] (${a} vs. ${b})`);
    }
  }
}
passed++;

console.log(`✔ rules.test: alle ${passed} Prüfungen bestanden (inkl. 2000 Zufallswürfe Client/Server-Abgleich).`);
