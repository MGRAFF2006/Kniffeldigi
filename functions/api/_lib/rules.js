// Regel- und Wertungslogik für Kniffel und Yatzy.
// Diese Datei ist die "Single Source of Truth" für den Server.
// Eine Kopie für die Client-Vorschau liegt in public/js/rules.js –
// bei Änderungen beide Dateien synchron halten!

export const MODES = {
  kniffel: {
    name: 'Kniffel',
    upper: ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'],
    lower: ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'kniffel', 'chance'],
    upperBonus: { threshold: 63, points: 35 },
    // Jeder weitere Kniffel (wenn das Kniffel-Feld bereits 50 zeigt) gibt 50 Bonuspunkte.
    extraYahtzeeBonus: 50,
    yahtzeeCategory: 'kniffel',
  },
  yatzy: {
    name: 'Yatzy',
    upper: ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'],
    lower: ['onePair', 'twoPairs', 'threeKind', 'fourKind', 'smallStraight', 'largeStraight', 'fullHouse', 'chance', 'yatzy'],
    upperBonus: { threshold: 63, points: 50 },
    extraYahtzeeBonus: 0,
    yahtzeeCategory: 'yatzy',
  },
};

// Kurze deutsche Feldnamen für das Spielprotokoll.
export const CAT_NAMES = {
  kniffel: {
    ones: 'Einser', twos: 'Zweier', threes: 'Dreier', fours: 'Vierer', fives: 'Fünfer', sixes: 'Sechser',
    threeKind: 'Dreierpasch', fourKind: 'Viererpasch', fullHouse: 'Full House',
    smallStraight: 'Kleine Straße', largeStraight: 'Große Straße', kniffel: 'Kniffel', chance: 'Chance',
  },
  yatzy: {
    ones: 'Einser', twos: 'Zweier', threes: 'Dreier', fours: 'Vierer', fives: 'Fünfer', sixes: 'Sechser',
    onePair: 'Ein Paar', twoPairs: 'Zwei Paare', threeKind: 'Drei Gleiche', fourKind: 'Vier Gleiche',
    smallStraight: 'Kleine Straße', largeStraight: 'Große Straße', fullHouse: 'Full House',
    chance: 'Chance', yatzy: 'Yatzy',
  },
};

export function allCategories(mode) {
  const m = MODES[mode];
  return [...m.upper, ...m.lower];
}

function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}

function sum(dice) {
  return dice.reduce((a, b) => a + b, 0);
}

function isYahtzee(dice) {
  return dice.every((d) => d === dice[0]);
}

/**
 * Berechnet die Punkte, die ein Wurf in einer Kategorie bringen würde.
 * @param {string} mode 'kniffel' | 'yatzy'
 * @param {string} cat  Kategorie-Schlüssel
 * @param {number[]} dice 5 Würfel (1-6)
 * @param {boolean} joker Kniffel-Jokerregel aktiv (weiterer Kniffel, Kniffel-Feld schon mit 50 belegt)
 */
export function scoreCategory(mode, cat, dice, joker = false) {
  const c = counts(dice);
  const upperIndex = MODES[mode].upper.indexOf(cat);
  if (upperIndex >= 0) {
    const face = upperIndex + 1;
    return c[face] * face;
  }

  switch (cat) {
    case 'onePair': {
      for (let f = 6; f >= 1; f--) if (c[f] >= 2) return f * 2;
      return 0;
    }
    case 'twoPairs': {
      const pairs = [];
      for (let f = 6; f >= 1; f--) if (c[f] >= 2) pairs.push(f);
      return pairs.length >= 2 ? pairs[0] * 2 + pairs[1] * 2 : 0;
    }
    case 'threeKind': {
      for (let f = 6; f >= 1; f--) {
        if (c[f] >= 3) return mode === 'kniffel' ? sum(dice) : f * 3;
      }
      return 0;
    }
    case 'fourKind': {
      for (let f = 6; f >= 1; f--) {
        if (c[f] >= 4) return mode === 'kniffel' ? sum(dice) : f * 4;
      }
      return 0;
    }
    case 'fullHouse': {
      if (mode === 'kniffel' && joker) return 25;
      let three = 0;
      let two = 0;
      for (let f = 6; f >= 1; f--) {
        if (c[f] === 3) three = f;
        else if (c[f] === 2) two = f;
      }
      if (three && two) return mode === 'kniffel' ? 25 : sum(dice);
      return 0;
    }
    case 'smallStraight': {
      if (mode === 'kniffel') {
        if (joker) return 30;
        const has = (f) => c[f] > 0;
        const runs = [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]];
        return runs.some((r) => r.every(has)) ? 30 : 0;
      }
      // Yatzy: exakt 1-2-3-4-5
      return [1, 2, 3, 4, 5].every((f) => c[f] === 1) ? 15 : 0;
    }
    case 'largeStraight': {
      if (mode === 'kniffel') {
        if (joker) return 40;
        const runs = [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]];
        return runs.some((r) => r.every((f) => c[f] === 1)) ? 40 : 0;
      }
      // Yatzy: exakt 2-3-4-5-6
      return [2, 3, 4, 5, 6].every((f) => c[f] === 1) ? 20 : 0;
    }
    case 'kniffel':
    case 'yatzy':
      return isYahtzee(dice) ? 50 : 0;
    case 'chance':
      return sum(dice);
    default:
      throw new Error(`Unbekannte Kategorie: ${cat}`);
  }
}

/** Prüft, ob die Kniffel-Jokerregel für diesen Wurf greift. */
export function jokerApplies(mode, dice, scores) {
  if (mode !== 'kniffel') return false;
  return isYahtzee(dice) && scores[MODES[mode].yahtzeeCategory] === 50;
}

/** Summen und Boni für einen Wertungsbogen berechnen. */
export function totals(mode, scores, extraYahtzees = 0) {
  const m = MODES[mode];
  const val = (cat) => (typeof scores[cat] === 'number' ? scores[cat] : 0);
  const upperSum = m.upper.reduce((a, cat) => a + val(cat), 0);
  const bonus = upperSum >= m.upperBonus.threshold ? m.upperBonus.points : 0;
  const lowerSum = m.lower.reduce((a, cat) => a + val(cat), 0);
  const extraBonus = (m.extraYahtzeeBonus || 0) * extraYahtzees;
  return {
    upperSum,
    bonus,
    upperTotal: upperSum + bonus,
    lowerSum,
    extraBonus,
    grandTotal: upperSum + bonus + lowerSum + extraBonus,
  };
}

/** Sind alle Felder eines Spielers ausgefüllt? */
export function sheetComplete(mode, scores) {
  return allCategories(mode).every((cat) => typeof scores[cat] === 'number');
}

export function emptyScores(mode) {
  const scores = {};
  for (const cat of allCategories(mode)) scores[cat] = null;
  return scores;
}
