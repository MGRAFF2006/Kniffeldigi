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

// ===== Analogmodus: manuelle Punkteingabe =====
// Liefert, welche Werte in einem Feld überhaupt möglich sind
// (für die Eingabe-UI und die serverseitige Validierung).
// 0 ist immer erlaubt (= Feld streichen).

function rangeChoices(from, to, step) {
  const out = [0];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

export function manualScoreOptions(mode, cat) {
  const upperIndex = MODES[mode].upper.indexOf(cat);
  if (upperIndex >= 0) {
    const face = upperIndex + 1;
    return { choices: rangeChoices(face, face * 5, face) };
  }
  if (mode === 'kniffel') {
    switch (cat) {
      case 'threeKind':
      case 'fourKind': return { range: [5, 30] };
      case 'fullHouse': return { choices: [0, 25] };
      case 'smallStraight': return { choices: [0, 30] };
      case 'largeStraight': return { choices: [0, 40] };
      case 'kniffel': return { choices: [0, 50] };
      case 'chance': return { range: [5, 30] };
    }
  } else {
    switch (cat) {
      case 'onePair': return { choices: rangeChoices(2, 12, 2) };
      case 'twoPairs': return { choices: rangeChoices(6, 22, 2) };
      case 'threeKind': return { choices: rangeChoices(3, 18, 3) };
      case 'fourKind': return { choices: rangeChoices(4, 24, 4) };
      case 'smallStraight': return { choices: [0, 15] };
      case 'largeStraight': return { choices: [0, 20] };
      case 'fullHouse': {
        const set = new Set([0]);
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a !== b) set.add(a * 3 + b * 2);
        return { set: [...set].sort((x, y) => x - y) };
      }
      case 'chance': return { range: [5, 30] };
      case 'yatzy': return { choices: [0, 50] };
    }
  }
  throw new Error(`Unbekannte Kategorie: ${cat}`);
}

export function validManualScore(mode, cat, value) {
  if (!Number.isInteger(value) || value < 0) return false;
  if (value === 0) return true;
  const options = manualScoreOptions(mode, cat);
  if (options.choices) return options.choices.includes(value);
  if (options.set) return options.set.includes(value);
  return value >= options.range[0] && value <= options.range[1];
}
