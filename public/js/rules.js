// Wertungs- und Validierungslogik für Kniffel & Yatzy.
// Eine Quelle für Client (UI-Vorschau) und Server (maßgebliche Prüfung).
// Server-Einstieg: functions/api/_lib/rules.js re-exportiert diese Datei.

export const MODES = {
  kniffel: {
    name: 'Kniffel',
    upper: ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'],
    lower: ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'kniffel', 'chance'],
    upperBonus: { threshold: 63, points: 35 },
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

/** Deutsche Beschriftungen für die UI: [Name, Regelhinweis]. */
export const LABELS = {
  kniffel: {
    ones: ['Einser', 'Nur Einser zählen'],
    twos: ['Zweier', 'Nur Zweier zählen'],
    threes: ['Dreier', 'Nur Dreier zählen'],
    fours: ['Vierer', 'Nur Vierer zählen'],
    fives: ['Fünfer', 'Nur Fünfer zählen'],
    sixes: ['Sechser', 'Nur Sechser zählen'],
    threeKind: ['Dreierpasch', '3 gleiche · Summe aller Würfel'],
    fourKind: ['Viererpasch', '4 gleiche · Summe aller Würfel'],
    fullHouse: ['Full House', '3 + 2 gleiche · 25 Punkte'],
    smallStraight: ['Kleine Straße', '4 in Folge · 30 Punkte'],
    largeStraight: ['Große Straße', '5 in Folge · 40 Punkte'],
    kniffel: ['Kniffel', '5 gleiche · 50 Punkte'],
    chance: ['Chance', 'Summe aller Würfel'],
  },
  yatzy: {
    ones: ['Einser', 'Nur Einser zählen'],
    twos: ['Zweier', 'Nur Zweier zählen'],
    threes: ['Dreier', 'Nur Dreier zählen'],
    fours: ['Vierer', 'Nur Vierer zählen'],
    fives: ['Fünfer', 'Nur Fünfer zählen'],
    sixes: ['Sechser', 'Nur Sechser zählen'],
    onePair: ['Ein Paar', '2 gleiche · Summe des Paars'],
    twoPairs: ['Zwei Paare', '2 verschiedene Paare · Summe'],
    threeKind: ['Drei Gleiche', 'Summe der drei Würfel'],
    fourKind: ['Vier Gleiche', 'Summe der vier Würfel'],
    smallStraight: ['Kleine Straße', '1-2-3-4-5 · 15 Punkte'],
    largeStraight: ['Große Straße', '2-3-4-5-6 · 20 Punkte'],
    fullHouse: ['Full House', '3 + 2 gleiche · Summe aller'],
    chance: ['Chance', 'Summe aller Würfel'],
    yatzy: ['Yatzy', '5 gleiche · 50 Punkte'],
  },
};

/** Kurze Feldnamen für das Spielprotokoll. */
export const CAT_NAMES = Object.fromEntries(
  Object.entries(LABELS).map(([mode, cats]) => [
    mode,
    Object.fromEntries(Object.entries(cats).map(([key, [name]]) => [key, name])),
  ])
);

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
 * Punkte, die ein Wurf in einer Kategorie bringen würde.
 * @param {string} mode 'kniffel' | 'yatzy'
 * @param {string} cat Kategorie-Schlüssel
 * @param {number[]} dice 5 Würfel (1–6)
 * @param {boolean} joker Kniffel-Jokerregel aktiv
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
      for (let f = 6; f >= 1; f--) if (c[f] >= 3) return mode === 'kniffel' ? sum(dice) : f * 3;
      return 0;
    }
    case 'fourKind': {
      for (let f = 6; f >= 1; f--) if (c[f] >= 4) return mode === 'kniffel' ? sum(dice) : f * 4;
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
      return [1, 2, 3, 4, 5].every((f) => c[f] === 1) ? 15 : 0;
    }
    case 'largeStraight': {
      if (mode === 'kniffel') {
        if (joker) return 40;
        const runs = [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]];
        return runs.some((r) => r.every((f) => c[f] === 1)) ? 40 : 0;
      }
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

/** Summen und Boni für einen Wertungsbogen. */
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

// ===== Analogmodus: mögliche Werte je Feld =====

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
