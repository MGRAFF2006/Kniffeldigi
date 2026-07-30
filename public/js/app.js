// Würfelblock – SPA mit Hash-Routing.

import { api, getSession, getStoredUser, playerTokenFor, setPlayerToken, setSession } from './api.js';
import { LABELS, MODES, jokerApplies, scoreCategory } from './rules.js';

const app = document.getElementById('app');
const topnav = document.getElementById('topnav');

// ===== Hilfsfunktionen =====

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function defaultName() {
  const user = getStoredUser();
  return (user && user.displayName) || localStorage.getItem('wb_name') || '';
}

function rememberName(name) {
  localStorage.setItem('wb_name', name);
}

const INK_COLORS = { blau: '#1d3fbd', schwarz: '#22242a', gruen: '#0e7a3d', lila: '#7027b8' };

function applyInk() {
  const key = localStorage.getItem('wb_ink') || 'blau';
  document.documentElement.style.setProperty('--ink', INK_COLORS[key] || INK_COLORS.blau);
}

function dieHTML(face, { held = false, index = null, clickable = false, blank = false } = {}) {
  const pipLayouts = {
    1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9],
  };
  const areas = { 1: '1/1', 3: '1/3', 4: '2/1', 5: '2/2', 6: '2/3', 7: '3/1', 9: '3/3' };
  const pips = blank ? '' : (pipLayouts[face] || [])
    .map((p) => `<span class="pip" style="grid-area:${areas[p]}"></span>`)
    .join('');
  const cls = `die${held ? ' held' : ''}${blank ? ' blank' : ''}`;
  if (clickable) {
    return `<button type="button" class="${cls}" data-die="${index}" data-face="${face}" aria-label="Würfel ${face}${held ? ', festgehalten' : ''}">${pips}</button>`;
  }
  return `<span class="${cls}" data-face="${face}">${pips}</span>`;
}

// ===== Navigation =====

function renderNav() {
  const user = getStoredUser();
  topnav.innerHTML = user
    ? `<span class="userchip">✎ ${esc(user.displayName)}</span>
       <a href="#/settings">Einstellungen</a>
       <a href="#/" id="nav-logout">Abmelden</a>`
    : `<a href="#/settings">Einstellungen</a>
       <a href="#/login" class="accent">Anmelden</a>`;
  const logout = document.getElementById('nav-logout');
  if (logout) {
    logout.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await api.logout(); } catch {}
      setSession(null);
      renderNav();
      location.hash = '#/';
      route();
      toast('Abgemeldet. Bis zum nächsten Wurf!');
    });
  }
}

// ===== Landing =====

function viewLanding() {
  document.title = 'Würfelblock – Kniffel & Yatzy online';
  const name = defaultName();
  app.innerHTML = `
    <section class="hero">
      <div class="hero-dice">
        ${[2, 6, 5, 3, 4].map((f) => dieHTML(f)).join('')}
      </div>
      <h1>Der digitale<br /><span class="stroke">Würfelblock</span></h1>
      <p class="tagline"><strong>Kniffel</strong> und <strong>Yatzy</strong> mit Freunden spielen – egal wo ihr seid.
      Spiel erstellen, Code teilen, loswürfeln. Wer nicht mitspielt, schaut live zu.</p>
      <span class="scribble">Kein Download, kein Schnickschnack – einfach würfeln! ✎</span>
    </section>

    <div class="landing-grid">
      <section class="sheet" aria-labelledby="join-title">
        <div class="sheet-head"><h2 id="join-title">Spiel beitreten</h2><span class="sub">Code eingeben &amp; loslegen</span></div>
        <div class="sheet-body">
          <div class="name-line">
            <label for="join-code">Spielcode:</label>
            <input id="join-code" class="code-input" maxlength="5" placeholder="ABC12" autocomplete="off" spellcheck="false" />
          </div>
          <div class="name-line" style="margin-top:1.1rem">
            <label for="join-name">Dein Name:</label>
            <input id="join-name" class="hand-input" maxlength="20" placeholder="z. B. Melanie" value="${esc(name)}" />
          </div>
          <div class="btn-row">
            <button class="btn red big" id="btn-join">Mitspielen</button>
            <button class="btn ghost" id="btn-watch">👁 Live zuschauen</button>
          </div>
          <p class="error-text" id="join-error"></p>
        </div>
      </section>

      <section class="sheet" aria-labelledby="create-title">
        <div class="sheet-head"><h2 id="create-title">Neuen Block anlegen</h2><span class="sub">Du bekommst einen Code zum Teilen</span></div>
        <div class="sheet-body">
          <div class="mode-cards" role="radiogroup" aria-label="Spielmodus">
            <button type="button" class="mode-card selected" data-mode="kniffel" role="radio" aria-checked="true">
              <h3>Kniffel</h3>
              <ul>
                <li>Dreier- &amp; Viererpasch</li>
                <li>Straßen: 30 / 40 Punkte</li>
                <li>Bonus +35 ab 63 oben</li>
              </ul>
            </button>
            <button type="button" class="mode-card" data-mode="yatzy" role="radio" aria-checked="false">
              <h3>Yatzy</h3>
              <ul>
                <li>Ein Paar &amp; zwei Paare</li>
                <li>Straßen: 15 / 20 Punkte</li>
                <li>Bonus +50 ab 63 oben</li>
              </ul>
            </button>
          </div>
          <div class="name-line">
            <label for="create-name">Dein Name:</label>
            <input id="create-name" class="hand-input" maxlength="20" placeholder="z. B. Peter" value="${esc(name)}" />
          </div>
          <div class="btn-row">
            <button class="btn big" id="btn-create">Block anlegen</button>
          </div>
          <p class="error-text" id="create-error"></p>
        </div>
      </section>
    </div>

    <div class="features">
      <div class="feature"><h3>📺 Live zuschauen</h3><p>Jedes Spiel hat einen Zuschauer-Link. Familie &amp; Freunde verfolgen den Spielbogen in Echtzeit – ganz ohne Anmeldung.</p></div>
      <div class="feature"><h3>📒 Spiele protokollieren</h3><p>Mit einem kostenlosen Konto werden deine Ergebnisse gespeichert: Siege, Bestwerte und die komplette Historie.</p></div>
      <div class="feature"><h3>🎲 Zwei echte Blöcke</h3><p>Kniffel und Yatzy mit ihren originalen, unterschiedlichen Spielbögen und Wertungsregeln.</p></div>
    </div>
  `;

  const codeInput = document.getElementById('join-code');
  codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));

  let selectedMode = 'kniffel';
  app.querySelectorAll('.mode-card').forEach((card) => {
    card.addEventListener('click', () => {
      app.querySelectorAll('.mode-card').forEach((c) => {
        c.classList.toggle('selected', c === card);
        c.setAttribute('aria-checked', c === card ? 'true' : 'false');
      });
      selectedMode = card.dataset.mode;
    });
  });

  document.getElementById('btn-join').addEventListener('click', async () => {
    const code = codeInput.value.trim();
    const playerName = document.getElementById('join-name').value.trim();
    const errEl = document.getElementById('join-error');
    errEl.textContent = '';
    if (code.length < 4) { errEl.textContent = 'Bitte gib den 5-stelligen Spielcode ein.'; return; }
    if (playerTokenFor(code)) { location.hash = `#/game/${code}`; return; }
    if (playerName.length < 2) { errEl.textContent = 'Bitte gib deinen Namen ein (mind. 2 Zeichen).'; return; }
    try {
      rememberName(playerName);
      const data = await api.joinGame(code, playerName);
      setPlayerToken(data.code, data.playerToken);
      location.hash = `#/game/${data.code}`;
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById('btn-watch').addEventListener('click', async () => {
    const code = codeInput.value.trim();
    const errEl = document.getElementById('join-error');
    errEl.textContent = '';
    if (code.length < 4) { errEl.textContent = 'Bitte gib den 5-stelligen Spielcode ein.'; return; }
    try {
      await api.gameState(code);
      location.hash = `#/watch/${code}`;
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById('btn-create').addEventListener('click', async () => {
    const playerName = document.getElementById('create-name').value.trim();
    const errEl = document.getElementById('create-error');
    errEl.textContent = '';
    if (playerName.length < 2) { errEl.textContent = 'Bitte gib deinen Namen ein (mind. 2 Zeichen).'; return; }
    try {
      rememberName(playerName);
      const data = await api.createGame(selectedMode, playerName);
      setPlayerToken(data.code, data.playerToken);
      location.hash = `#/game/${data.code}`;
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

// ===== Spielansicht (Spieler + Zuschauer) =====

let poller = null;
let currentGame = null;
let rollAnimating = false;

function stopPolling() {
  if (poller) { clearInterval(poller); poller = null; }
  currentGame = null;
}

async function viewGame(code, spectator) {
  document.title = `Spiel ${code} – Würfelblock`;
  app.innerHTML = '<p class="muted" style="margin-top:3rem;text-align:center"><span class="spin">🎲</span> Spiel wird geladen …</p>';
  try {
    const data = await api.gameState(code);
    currentGame = { code: data.code, version: data.version, spectator };
    renderGame(data.state);
    poller = setInterval(pollGame, 1500);
  } catch (err) {
    app.innerHTML = `
      <section class="sheet auth-wrap"><div class="sheet-head"><h2>Hoppla</h2></div>
      <div class="sheet-body"><p>${esc(err.message)}</p>
      <div class="btn-row"><a class="btn" href="#/">Zur Startseite</a></div></div></section>`;
  }
}

async function pollGame() {
  if (!currentGame || rollAnimating) return;
  try {
    const data = await api.gameState(currentGame.code, currentGame.version);
    if (data && currentGame) {
      currentGame.version = data.version;
      renderGame(data.state);
    }
  } catch {
    /* Netzwerk-Aussetzer beim Pollen still ignorieren */
  }
}

async function doAction(action, { animateRoll = false } = {}) {
  if (!currentGame) return;
  try {
    const data = await api.gameAction(currentGame.code, action);
    currentGame.version = data.version;
    if (animateRoll) {
      rollAnimating = true;
      app.querySelectorAll('.dice-tray .die').forEach((d) => d.classList.add('rolling'));
      setTimeout(() => {
        rollAnimating = false;
        if (currentGame) renderGame(data.state);
      }, 420);
    } else {
      renderGame(data.state);
    }
  } catch (err) {
    toast(err.message, true);
  }
}

function sheetRowsFor(mode) {
  const m = MODES[mode];
  const rows = [{ type: 'section', label: 'Oberer Teil' }];
  for (const cat of m.upper) rows.push({ type: 'cat', cat });
  rows.push(
    { type: 'calc', key: 'upperSum', label: 'Summe oben' },
    { type: 'calc', key: 'bonus', label: `Bonus (+${m.upperBonus.points} ab ${m.upperBonus.threshold})` },
    { type: 'calc', key: 'upperTotal', label: 'Gesamt oberer Teil' },
    { type: 'section', label: 'Unterer Teil' }
  );
  for (const cat of m.lower) rows.push({ type: 'cat', cat });
  rows.push({ type: 'calc', key: 'lowerSum', label: 'Summe unterer Teil' });
  if (m.extraYahtzeeBonus) rows.push({ type: 'calc', key: 'extraBonus', label: 'Kniffel-Bonus (+50 je Extra)' });
  rows.push({ type: 'calc', key: 'grandTotal', label: 'Endsumme', grand: true });
  return rows;
}

function renderScoresheet(state, canPick) {
  const mode = state.mode;
  const labels = LABELS[mode];
  const rows = sheetRowsFor(mode);
  const turnIndex = state.turn ? state.turn.player : -1;
  const dice = state.turn ? state.turn.dice : null;
  const me = state.you;

  const colgroup = `<colgroup><col />${state.players
    .map((_, i) => `<col ${i === turnIndex && state.status === 'playing' ? 'class="turncol"' : ''} />`)
    .join('')}</colgroup>`;

  const header = `<thead><tr>
    <th class="catcol">Feld</th>
    ${state.players.map((p, i) => `<th class="${i === me ? 'me' : ''}" title="${esc(p.name)}">${esc(p.name)}${i === me ? ' (du)' : ''}</th>`).join('')}
  </tr></thead>`;

  const bodyRows = rows.map((row) => {
    if (row.type === 'section') {
      return `<tr class="section"><th colspan="${state.players.length + 1}">${row.label}</th></tr>`;
    }
    if (row.type === 'calc') {
      const cells = state.players
        .map((p) => `<td class="val">${p.totals[row.key]}</td>`)
        .join('');
      return `<tr class="totals${row.grand ? ' grand' : ''}"><th class="cat"><span class="catname">${row.label}</span></th>${cells}</tr>`;
    }
    // Kategorie-Zeile
    const [catName, catHint] = labels[row.cat];
    const cells = state.players
      .map((p, i) => {
        const score = p.scores[row.cat];
        if (typeof score === 'number') {
          return `<td class="val${score === 0 ? ' zero' : ''}">${score === 0 ? '<span class="strike">0</span>' : score}</td>`;
        }
        if (canPick && i === me && dice) {
          const joker = jokerApplies(mode, dice, state.players[me].scores);
          const preview = scoreCategory(mode, row.cat, dice, joker);
          return `<td class="val pick" data-cat="${row.cat}" role="button" tabindex="0" title="Hier eintragen: ${preview} Punkte">${preview}</td>`;
        }
        return `<td class="val"></td>`;
      })
      .join('');
    return `<tr><th class="cat"><span class="catname">${catName}</span><span class="cathint">${catHint}</span></th>${cells}</tr>`;
  });

  return `<div class="score-wrap"><table class="scoresheet">${colgroup}${header}<tbody>${bodyRows.join('')}</tbody></table></div>`;
}

function renderGame(state) {
  if (!currentGame) return;
  const { code, spectator } = currentGame;
  const me = state.you;
  const isPlayer = !spectator && me !== null;
  const turn = state.turn;
  const myTurn = isPlayer && state.status === 'playing' && turn && turn.player === me;
  const canPick = myTurn && turn.rolls > 0;

  const statusPill =
    state.status === 'lobby'
      ? '<span class="statuspill lobby">Lobby</span>'
      : state.status === 'playing'
        ? '<span class="statuspill live">● Live</span>'
        : '<span class="statuspill done">Beendet</span>';

  // --- Würfelbereich ---
  let trayHTML = '';
  if (state.status === 'playing' && turn) {
    const current = state.players[turn.player];
    const rolled = turn.rolls > 0;
    const diceHTML = turn.dice
      .map((face, i) =>
        dieHTML(face, {
          held: turn.held[i],
          index: i,
          clickable: myTurn && rolled && turn.rolls < 3,
          blank: !rolled,
        })
      )
      .join('');
    const info = myTurn
      ? `<span class="turnname">Du bist dran!</span> · Wurf ${turn.rolls}/3`
      : `<span class="turnname">${esc(current.name)}</span> ist am Zug · Wurf ${turn.rolls}/3`;
    trayHTML = `
      <section class="sheet">
        <div class="sheet-head"><h2>Runde ${state.round}</h2><span class="sub">${state.modeName}-Block</span></div>
        <div class="sheet-body" style="padding-bottom:0.4rem">
          <p class="tray-info">${info}</p>
          <div class="dice-tray">${diceHTML}</div>
          ${myTurn && turn.rolls > 0 && turn.rolls < 3 ? '<p class="hold-hint">Tipp: Würfel anklicken, um sie festzuhalten.</p>' : ''}
          ${
            myTurn
              ? `<div class="tray-actions">
                   <button class="btn red big" id="btn-roll" ${turn.rolls >= 3 ? 'disabled' : ''}>🎲 ${turn.rolls === 0 ? 'Würfeln' : `Nochmal (${3 - turn.rolls} übrig)`}</button>
                 </div>
                 ${canPick ? '<p class="hold-hint">…oder trage dein Ergebnis unten im Block ein.</p>' : ''}`
              : '<div class="tray-actions"></div>'
          }
        </div>
      </section>`;
  } else if (state.status === 'lobby') {
    const shareURL = `${location.origin}${location.pathname}#/game/${code}`;
    trayHTML = `
      <section class="sheet">
        <div class="sheet-head"><h2>Warten auf Mitspieler</h2><span class="sub">${state.modeName}-Block</span></div>
        <div class="sheet-body">
          <p>Teile den Spielcode <strong style="font-family:var(--font-hand);font-size:1.5rem;color:var(--ink);letter-spacing:0.2em">${esc(code)}</strong>
          oder den Link – Mitspieler treten über die Startseite bei.</p>
          <div class="btn-row">
            <button class="btn ghost small" id="btn-copycode">Code kopieren</button>
            <button class="btn ghost small" id="btn-copylink">Einladungslink kopieren</button>
            <button class="btn ghost small" id="btn-copywatch">Zuschauer-Link kopieren</button>
          </div>
          ${
            isPlayer && me === 0
              ? `<div class="btn-row"><button class="btn red big" id="btn-start">Spiel starten (${state.players.length} ${state.players.length === 1 ? 'Spieler' : 'Spieler'})</button></div>
                 ${state.players.length === 1 ? '<p class="muted">Du kannst auch alleine trainieren – oder warte, bis alle da sind.</p>' : ''}`
              : isPlayer
                ? '<p class="muted">Warte, bis der Spielleiter das Spiel startet …</p>'
                : '<p class="muted">Das Spiel hat noch nicht begonnen.</p>'
          }
        </div>
      </section>`;  
  } else if (state.status === 'finished' && state.results) {
    const winner = state.results[0];
    trayHTML = `
      <section class="sheet">
        <div class="result-banner">
          <div class="trophy">🏆</div>
          <h2>${esc(state.results.filter((r) => r.place === 1).map((r) => r.name).join(' & '))} gewinnt!</h2>
          <p class="muted">${state.modeName} · ${state.players.length} Spieler · Endstand ${winner.total} Punkte</p>
          <ol class="result-list">
            ${state.results
              .map((r) => `<li class="${r.place === 1 ? 'first' : ''}"><span class="place">${r.place}.</span><span class="rname">${esc(r.name)}</span><span class="rscore">${r.total} Pkt.</span></li>`)
              .join('')}
          </ol>
          <div class="btn-row" style="justify-content:center">
            <a class="btn red" href="#/">Neues Spiel</a>
          </div>
        </div>
      </section>`;
  }

  // --- Seitenleiste ---
  const playersHTML = state.players
    .map((p, i) => {
      const tags = [];
      if (i === 0) tags.push('<span class="tag">Host</span>');
      if (state.status === 'playing' && turn && turn.player === i) tags.push('<span class="tag turn">am Zug</span>');
      if (p.hasAccount) tags.push('<span class="tag" title="Ergebnis wird im Konto gespeichert">📒</span>');
      return `<li><span class="pname">${esc(p.name)}${i === me ? ' (du)' : ''}</span>${tags.join('')}</li>`;
    })
    .join('');

  const logHTML = [...state.log]
    .reverse()
    .map((entry) => `<li>${esc(entry.text)}</li>`)
    .join('');

  app.innerHTML = `
    <div class="game-top">
      <h1>${state.modeName} ${spectator ? '· Zuschauermodus' : ''}</h1>
      <div style="display:flex;gap:0.8rem;align-items:center;flex-wrap:wrap">
        ${statusPill}
        <span class="codebadge" title="Spielcode">Code <span class="code">${esc(code)}</span></span>
      </div>
    </div>
    <div class="game-layout">
      <div>
        ${trayHTML}
        <h2 class="section-title">Spielbogen</h2>
        ${renderScoresheet(state, canPick)}
      </div>
      <aside class="side-panel">
        <section class="sheet">
          <div class="sheet-head"><h2>Spieler</h2><span class="sub">${state.players.length}/8</span></div>
          <div class="sheet-body"><ul class="player-list">${playersHTML || '<li class="muted">Noch niemand da.</li>'}</ul></div>
        </section>
        <section class="sheet">
          <div class="sheet-head"><h2>Protokoll</h2></div>
          <div class="sheet-body"><ul class="gamelog">${logHTML || '<li>Noch nichts passiert.</li>'}</ul></div>
        </section>
      </aside>
    </div>
  `;

  // --- Events ---
  const startBtn = document.getElementById('btn-start');
  if (startBtn) startBtn.addEventListener('click', () => doAction({ type: 'start' }));

  const rollBtn = document.getElementById('btn-roll');
  if (rollBtn) rollBtn.addEventListener('click', () => doAction({ type: 'roll' }, { animateRoll: true }));

  const copyBtn = (id, text, msg) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast(msg);
      } catch {
        toast(text);
      }
    });
  };
  const base = `${location.origin}${location.pathname}`;
  copyBtn('btn-copycode', code, 'Spielcode kopiert!');
  copyBtn('btn-copylink', `${base}#/game/${code}`, 'Einladungslink kopiert!');
  copyBtn('btn-copywatch', `${base}#/watch/${code}`, 'Zuschauer-Link kopiert!');

  app.querySelectorAll('button.die[data-die]').forEach((el) => {
    el.addEventListener('click', () => doAction({ type: 'hold', die: Number(el.dataset.die) }));
  });

  app.querySelectorAll('td.val.pick').forEach((el) => {
    const pick = () => doAction({ type: 'score', category: el.dataset.cat });
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
}

// ===== Auth =====

function viewLogin() {
  document.title = 'Anmelden – Würfelblock';
  app.innerHTML = `
    <section class="sheet auth-wrap">
      <div class="sheet-head"><h2>Anmelden</h2><span class="sub">Willkommen zurück!</span></div>
      <div class="sheet-body">
        <form id="login-form">
          <div class="field"><label for="lg-user">Benutzername</label><input type="text" id="lg-user" autocomplete="username" required /></div>
          <div class="field"><label for="lg-pass">Passwort</label><input type="password" id="lg-pass" autocomplete="current-password" required /></div>
          <div class="btn-row"><button class="btn red big" type="submit">Anmelden</button></div>
          <p class="error-text" id="lg-error"></p>
        </form>
        <p class="auth-alt">Noch kein Konto? <a href="#/register">Jetzt registrieren</a> – dann werden deine Spiele protokolliert.</p>
      </div>
    </section>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('lg-error');
    errEl.textContent = '';
    try {
      const data = await api.login(document.getElementById('lg-user').value.trim(), document.getElementById('lg-pass').value);
      setSession(data.token, data.user);
      renderNav();
      toast(`Hallo, ${data.user.displayName}!`);
      location.hash = '#/';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function viewRegister() {
  document.title = 'Registrieren – Würfelblock';
  app.innerHTML = `
    <section class="sheet auth-wrap">
      <div class="sheet-head"><h2>Konto erstellen</h2><span class="sub">Kostenlos · Spiele werden protokolliert</span></div>
      <div class="sheet-body">
        <form id="reg-form">
          <div class="field"><label for="rg-user">Benutzername</label><input type="text" id="rg-user" autocomplete="username" required minlength="3" maxlength="20" /></div>
          <div class="field"><label for="rg-display">Anzeigename (steht auf dem Spielbogen)</label><input type="text" id="rg-display" maxlength="20" value="${esc(defaultName())}" /></div>
          <div class="field"><label for="rg-pass">Passwort (mind. 8 Zeichen)</label><input type="password" id="rg-pass" autocomplete="new-password" required minlength="8" /></div>
          <div class="btn-row"><button class="btn red big" type="submit">Registrieren</button></div>
          <p class="error-text" id="rg-error"></p>
        </form>
        <p class="auth-alt">Schon ein Konto? <a href="#/login">Anmelden</a></p>
      </div>
    </section>`;
  document.getElementById('reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('rg-error');
    errEl.textContent = '';
    const username = document.getElementById('rg-user').value.trim();
    const display = document.getElementById('rg-display').value.trim() || username;
    try {
      const data = await api.register(username, display, document.getElementById('rg-pass').value);
      setSession(data.token, data.user);
      renderNav();
      toast(`Willkommen, ${data.user.displayName}! Dein Konto ist bereit.`);
      location.hash = '#/';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

// ===== Einstellungen =====

async function viewSettings() {
  document.title = 'Einstellungen – Würfelblock';
  const user = getStoredUser();
  const inkKey = localStorage.getItem('wb_ink') || 'blau';

  const accountHTML = user
    ? `
      <section class="sheet">
        <div class="sheet-head"><h2>Konto</h2><span class="sub">@${esc(user.username)}</span></div>
        <div class="sheet-body">
          <form id="profile-form">
            <div class="field"><label for="st-display">Anzeigename</label><input type="text" id="st-display" maxlength="20" value="${esc(user.displayName)}" /></div>
            <div class="btn-row"><button class="btn small" type="submit">Speichern</button></div>
          </form>
          <hr style="border:none;border-top:2px dashed rgba(27,28,32,0.25);margin:1.2rem 0" />
          <form id="pass-form">
            <div class="field"><label for="st-oldpass">Aktuelles Passwort</label><input type="password" id="st-oldpass" autocomplete="current-password" required /></div>
            <div class="field"><label for="st-newpass">Neues Passwort (mind. 8 Zeichen)</label><input type="password" id="st-newpass" autocomplete="new-password" required minlength="8" /></div>
            <div class="btn-row"><button class="btn small" type="submit">Passwort ändern</button></div>
          </form>
          <p class="error-text" id="st-error"></p>
        </div>
      </section>`
    : `
      <section class="sheet">
        <div class="sheet-head"><h2>Konto</h2></div>
        <div class="sheet-body">
          <p>Du bist nicht angemeldet. Mit einem kostenlosen Konto werden deine Spielergebnisse gespeichert und du siehst deine Statistiken.</p>
          <div class="btn-row"><a class="btn red" href="#/login">Anmelden</a><a class="btn ghost" href="#/register">Registrieren</a></div>
        </div>
      </section>`;

  app.innerHTML = `
    <h1 class="section-title" style="margin-top:2rem">Einstellungen</h1>
    <div class="settings-grid">
      <div>
        ${accountHTML}
      </div>
      <div>
        <section class="sheet">
          <div class="sheet-head"><h2>Darstellung</h2><span class="sub">Dein Stift</span></div>
          <div class="sheet-body">
            <p class="muted" style="margin-top:0">Tintenfarbe für Einträge auf dem Spielbogen:</p>
            <div class="ink-swatches">
              ${Object.entries(INK_COLORS)
                .map(([key, color]) => `<button type="button" class="ink-swatch${key === inkKey ? ' selected' : ''}" data-ink="${key}" style="background:${color}" aria-label="Tinte ${key}"></button>`)
                .join('')}
            </div>
            <p class="scribble" style="margin-top:1rem">So sieht deine Handschrift aus ✎</p>
          </div>
        </section>
      </div>
    </div>
    <div id="history-area"></div>
  `;

  app.querySelectorAll('.ink-swatch').forEach((el) => {
    el.addEventListener('click', () => {
      localStorage.setItem('wb_ink', el.dataset.ink);
      applyInk();
      app.querySelectorAll('.ink-swatch').forEach((s) => s.classList.toggle('selected', s === el));
      toast('Tintenfarbe gespeichert!');
    });
  });

  if (user) {
    document.getElementById('profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('st-error');
      errEl.textContent = '';
      try {
        const data = await api.updateProfile(document.getElementById('st-display').value.trim());
        setSession(getSession(), data.user);
        renderNav();
        toast('Anzeigename gespeichert!');
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    document.getElementById('pass-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('st-error');
      errEl.textContent = '';
      try {
        await api.changePassword(document.getElementById('st-oldpass').value, document.getElementById('st-newpass').value);
        document.getElementById('pass-form').reset();
        toast('Passwort geändert!');
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    // Historie & Statistik laden
    try {
      const { games, stats } = await api.history();
      const statHTML = stats.length
        ? `<div class="stats-row">${stats
            .map(
              (s) => `
              <div class="stat"><div class="num">${s.games}</div><div class="lbl">${esc(s.mode)}-Spiele</div></div>
              <div class="stat"><div class="num">${s.wins}</div><div class="lbl">${esc(s.mode)}-Siege</div></div>
              <div class="stat"><div class="num">${s.best}</div><div class="lbl">${esc(s.mode)}-Bestwert</div></div>
              <div class="stat"><div class="num">${s.avg}</div><div class="lbl">${esc(s.mode)}-Schnitt</div></div>`
            )
            .join('')}</div>`
        : '';
      const rowsHTML = games.length
        ? games
            .map((g) => {
              const date = new Date(g.finished_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
              return `<tr>
                <td>${date}</td>
                <td>${esc(g.mode === 'kniffel' ? 'Kniffel' : 'Yatzy')}</td>
                <td class="score">${g.score}</td>
                <td>${g.placement}. von ${g.player_count}</td>
                <td>${g.placement === 1 ? '🏆' : ''}</td>
              </tr>`;
            })
            .join('')
        : '<tr><td colspan="5" class="muted">Noch keine protokollierten Spiele – spiel eine Runde!</td></tr>';
      document.getElementById('history-area').innerHTML = `
        <h2 class="section-title">Deine Spiele</h2>
        ${statHTML}
        <section class="sheet"><div class="sheet-body">
          <table class="history">
            <thead><tr><th>Datum</th><th>Spiel</th><th>Punkte</th><th>Platz</th><th></th></tr></thead>
            <tbody>${rowsHTML}</tbody>
          </table>
        </div></section>`;
    } catch (err) {
      if (err.status === 401) {
        setSession(null);
        renderNav();
      }
    }
  }
}

// ===== Router =====

function route() {
  stopPolling();
  const hash = location.hash || '#/';
  const gameMatch = hash.match(/^#\/game\/([A-Za-z0-9]+)/);
  const watchMatch = hash.match(/^#\/watch\/([A-Za-z0-9]+)/);

  if (gameMatch) {
    const code = gameMatch[1].toUpperCase();
    // Ohne Spieler-Token ist die Spielansicht automatisch Zuschauermodus.
    viewGame(code, !playerTokenFor(code));
  } else if (watchMatch) {
    viewGame(watchMatch[1].toUpperCase(), true);
  } else if (hash.startsWith('#/login')) {
    viewLogin();
  } else if (hash.startsWith('#/register')) {
    viewRegister();
  } else if (hash.startsWith('#/settings')) {
    viewSettings();
  } else {
    viewLanding();
  }
  window.scrollTo({ top: 0 });
}

// Session beim Start validieren (Token könnte abgelaufen sein).
async function validateSession() {
  if (!getSession()) return;
  try {
    const data = await api.me();
    setSession(getSession(), data.user);
  } catch (err) {
    if (err.status === 401) setSession(null);
  }
  renderNav();
}

applyInk();
renderNav();
route();
validateSession();
window.addEventListener('hashchange', route);
