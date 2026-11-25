// Run with node --test tests/navigation.test.mjs; no server or dependencies needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as rules from '../public/js/rules.js';

const apiSource = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const appSource = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');

// Tabs of one browser share localStorage; pass the same storage to model a second tab.
// `storageFull` makes every write throw like a browser whose storage quota is exhausted.
function fixture({ storage = new Map(), storageFull = false } = {}) {
  const elements = new Map();
  class Element {
    value = '';
    textContent = '';
    hidden = false;
    checked = false;
    listeners = {};
    children = [];
    classList = { add() {}, remove() {}, toggle() {} };
    set innerHTML(html) {
      this.html = html;
      for (const id of this.children) elements.delete(id);
      this.children = [];
      for (const match of html.matchAll(/id="([^"]+)"/g)) {
        elements.set(match[1], new Element());
        this.children.push(match[1]);
      }
    }
    get innerHTML() { return this.html; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    querySelectorAll() { return []; }
    querySelector(selector) { return elements.get(selector.slice(1)); }
    remove() { elements.delete(this.id); }
    reset() { this.wasReset = true; }
  }
  for (const id of ['app', 'topnav', 'toast']) elements.set(id, new Element());
  const pending = [];
  const timeouts = new Map();
  const intervals = new Map();
  const renders = [];
  const notices = [];
  const windowListeners = {};
  let timerId = 0;
  const location = { hash: '#/', origin: 'https://example.invalid', pathname: '/' };
  const sandbox = {
    ...rules, location, renders, notices,
    document: {
      getElementById: id => elements.get(id) ?? null,
      createElement: () => new Element(),
      body: { appendChild: element => elements.set(element.id, element) },
      documentElement: { style: { setProperty() {} } },
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (storageFull) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
        storage.set(key, value);
      },
      removeItem: key => storage.delete(key),
    },
    fetch: (url, options) => new Promise((resolve, reject) => pending.push({
      url, options,
      resolve: (data, status = 200) => resolve({ status, ok: status < 400, json: async () => data }),
      reject,
    })),
    setTimeout: callback => { timeouts.set(++timerId, callback); return timerId; },
    clearTimeout: id => timeouts.delete(id),
    setInterval: callback => { intervals.set(++timerId, callback); return timerId; },
    clearInterval: id => intervals.delete(id),
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    window: { scrollTo() {}, addEventListener: (type, callback) => { windowListeners[type] = callback; } },
    console,
  };
  vm.createContext(sandbox);
  // Exercise the real API client and full SPA functions; omit only startup listeners.
  vm.runInContext(apiSource + '\n' + appSource.slice(0, appSource.lastIndexOf('\napplyInk();')) + `
    const originalRenderGame = renderGame;
    renderGame = state => { renders.push(state); originalRenderGame(state); };
    toast = (...args) => notices.push(args);
    this.probe = { viewGame, pollGame, doAction, stopPolling, viewSettings, validateSession,
      route, renderNav, getGame: () => currentGame, getAnimation: () => rollAnimation,
      setSession, getSession, getStoredUser };
  `, sandbox);
  // Register the app's window listeners (other tabs' storage changes) without the startup route/validation.
  const startup = appSource.slice(appSource.lastIndexOf('\napplyInk();'));
  vm.runInContext(startup.replace(/^(applyInk|renderNav|route|validateSession)\(\);$/gm, ''), sandbox);
  const probe = sandbox.probe;
  // Deliver the storage event a browser fires in this tab after another tab wrote `key`.
  const storageEvent = key => windowListeners.storage?.({ key, newValue: storage.get(key) ?? null });
  const take = () => {
    assert.ok(pending.length, 'expected an API request');
    return pending.shift();
  };
  // Let the actual fetch/json continuations of resolved requests run.
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const navigate = hash => { location.hash = hash; probe.route(); };
  async function open(code, version = 1) {
    navigate(`#/watch/${code}`);
    take().resolve(game(code, version));
    await flush();
  }
  const click = (id, type = 'click') => elements.get(id).listeners[type]({ preventDefault() {} });
  return { probe, take, open, navigate, flush, click, location, elements, renders, notices, timeouts, intervals, sandbox, pending, storage, storageEvent };
}

function game(code, version) {
  return { code, version, state: { mode: 'kniffel', modeName: code, entry: 'manual', status: 'lobby', players: [], log: [], you: null } };
}

test('old polls cannot overwrite another game or a reopened instance of the same code', async () => {
  const f = fixture();
  await f.open('AAAAA');
  const oldPoll = f.probe.pollGame();
  const response = f.take();
  await f.open('BBBBB', 9);
  response.resolve(game('AAAAA', 20));
  await oldPoll;
  assert.equal(f.probe.getGame().version, 9);
  assert.equal(f.renders.at(-1).modeName, 'BBBBB');
  const bPoll = f.probe.pollGame();
  const bResponse = f.take();
  await f.open('AAAAA');
  await f.open('BBBBB', 3);
  bResponse.resolve(game('BBBBB', 30));
  await bPoll;
  assert.equal(f.probe.getGame().version, 3);
});

test('pending initial loads and errors cannot replace a newer route or create another poller', async () => {
  const f = fixture();
  f.navigate('#/game/AAAAA');
  const response = f.take();
  await f.open('BBBBB');
  response.resolve(game('AAAAA', 8));
  await f.flush();
  assert.equal(f.renders.length, 1);
  assert.equal(f.intervals.size, 1);
  f.navigate('#/game/CCCCC');
  const failure = f.take();
  f.navigate('#/login');
  const login = f.elements.get('app').innerHTML;
  failure.resolve({ error: 'old load failed' }, 404);
  await f.flush();
  assert.equal(f.elements.get('app').innerHTML, login);
  assert.equal(f.intervals.size, 0);
});

test('active load errors still render and unchanged poll responses remain harmless', async () => {
  const f = fixture();
  f.navigate('#/game/AAAAA');
  f.take().resolve({ error: 'missing game' }, 404);
  await f.flush();
  assert.match(f.elements.get('app').innerHTML, /missing game/);
  await f.open('BBBBB');
  const poll = f.probe.pollGame();
  f.take().resolve(null, 204);
  await poll;
  assert.equal(f.renders.length, 1);
});

test('submitted actions still reach their original game, but stale success/errors have no UI effect', async () => {
  const f = fixture();
  await f.open('AAAAA');
  const action = f.probe.doAction({ type: 'reset' });
  const request = f.take();
  assert.equal(request.url, '/api/games/AAAAA/action');
  assert.equal(JSON.parse(request.options.body).type, 'reset');
  await f.open('BBBBB', 9);
  request.resolve(game('AAAAA', 20));
  await action;
  assert.equal(f.probe.getGame().version, 9);
  const failed = f.probe.doAction({ type: 'reset' });
  const failure = f.take();
  f.navigate('#/login');
  failure.resolve({ error: 'old action failed' }, 409);
  await failed;
  assert.deepEqual(f.notices, []);
});

test('same-game polls/actions update monotonically without dropping submitted mutations', async () => {
  const f = fixture();
  await f.open('AAAAA');
  const poll = f.probe.pollGame();
  const pollResponse = f.take();
  const action = f.probe.doAction({ type: 'reset' });
  f.take().resolve(game('AAAAA', 3));
  await action;
  pollResponse.resolve(game('AAAAA', 2));
  await poll;
  assert.equal(f.probe.getGame().version, 3);
  assert.equal(f.renders.length, 2);
  const first = f.probe.doAction({ type: 'reset' });
  const firstResponse = f.take();
  const second = f.probe.doAction({ type: 'reset' });
  f.take().resolve(game('AAAAA', 5));
  await second;
  firstResponse.resolve(game('AAAAA', 4));
  await first;
  assert.equal(f.probe.getGame().version, 5);
  const latestPoll = f.probe.pollGame();
  f.take().resolve(game('AAAAA', 6));
  await latestPoll;
  assert.equal(f.probe.getGame().version, 6);
  assert.equal(f.renders.length, 4);
});

test('animation callbacks cannot render or clear the animation of a different game', async () => {
  const f = fixture();
  await f.open('AAAAA');
  const oldRoll = f.probe.doAction({ type: 'roll' }, { animateRoll: true });
  f.take().resolve(game('AAAAA', 2));
  await oldRoll;
  const oldTimer = f.timeouts.get(f.probe.getAnimation());
  await f.open('BBBBB');
  assert.equal(f.timeouts.size, 0);
  const newRoll = f.probe.doAction({ type: 'roll' }, { animateRoll: true });
  f.take().resolve(game('BBBBB', 2));
  await newRoll;
  const timerId = f.probe.getAnimation();
  oldTimer(); // Even an already queued callback must be harmless.
  assert.equal(f.probe.getAnimation(), timerId);
  assert.equal(f.renders.at(-1).modeName, 'BBBBB');
  f.timeouts.get(timerId)();
  assert.equal(f.probe.getAnimation(), null);
  assert.equal(f.renders.length, 3);
});

test('a newer active-game response supersedes pending roll animation', async () => {
  const f = fixture();
  await f.open('AAAAA');
  const roll = f.probe.doAction({ type: 'roll' }, { animateRoll: true });
  f.take().resolve(game('AAAAA', 2));
  await roll;
  const oldTimer = f.timeouts.get(f.probe.getAnimation());
  const next = f.probe.doAction({ type: 'reset' });
  f.take().resolve(game('AAAAA', 3));
  await next;
  oldTimer();
  assert.equal(f.probe.getGame().version, 3);
  assert.equal(f.renders.length, 2);
});

test('a queued older roll callback cannot clear a newer roll in the same game', async () => {
  const f = fixture();
  await f.open('AAAAA');
  const first = f.probe.doAction({ type: 'roll' }, { animateRoll: true });
  f.take().resolve(game('AAAAA', 2));
  await first;
  const oldTimer = f.timeouts.get(f.probe.getAnimation());
  const second = f.probe.doAction({ type: 'roll' }, { animateRoll: true });
  f.take().resolve(game('AAAAA', 3));
  await second;
  const timerId = f.probe.getAnimation();
  oldTimer();
  assert.equal(f.probe.getAnimation(), timerId);
  assert.equal(f.renders.length, 1);
  f.timeouts.get(timerId)();
  assert.equal(f.probe.getAnimation(), null);
  assert.equal(f.renders.length, 2);
});

test('settings history cannot write into a reopened settings page or clear a new session', async () => {
  const f = fixture();
  f.probe.setSession('old-session', { username: 'old', displayName: 'Old' });
  f.navigate('#/settings');
  const response = f.take();
  f.navigate('#/login');
  f.navigate('#/settings');
  f.take().resolve({ games: [], stats: [] });
  await Promise.resolve();
  response.resolve({ games: [], stats: [{ mode: 'old-history', games: 3 }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(f.elements.get('history-area').innerHTML ?? '', /old-history/);
  f.navigate('#/settings');
  const failure = f.take();
  f.probe.setSession('new-session', { displayName: 'New' });
  failure.resolve({ error: 'expired' }, 401);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.probe.getSession(), 'new-session');
});

test('active settings history and expired-session cleanup still work', async () => {
  const f = fixture();
  f.probe.setSession('session', { username: 'fixture', displayName: 'Fixture' });
  f.navigate('#/settings');
  f.take().resolve({ games: [], stats: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.elements.get('history-area').innerHTML, /Deine Spiele/);
  f.navigate('#/settings');
  f.take().resolve({ error: 'expired' }, 401);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.probe.getSession(), null);
  // The expired account's controls are replaced by the signed-out settings page.
  assert.equal(f.elements.has('profile-form'), false);
  assert.equal(f.pending.length, 0);
});

test('expired history before startup validation still leaves signed-out settings', async () => {
  const f = fixture();
  f.probe.setSession('expired-session', { username: 'fixture', displayName: 'Fixture' });
  f.navigate('#/settings');
  const history = f.take();
  const validation = f.probe.validateSession();
  const me = f.take();
  history.resolve({ error: 'expired' }, 401);
  await new Promise(resolve => setImmediate(resolve));
  me.resolve({ error: 'expired' }, 401);
  await validation;
  assert.equal(f.probe.getSession(), null);
  assert.equal(f.elements.has('profile-form'), false);
  assert.equal(f.elements.has('nav-logout'), false);
});

test('startup session validation cannot overwrite or remove a replacement session', async () => {
  for (const status of [200, 401]) {
    const f = fixture();
    f.probe.setSession('old-session', { displayName: 'Old' });
    const validation = f.probe.validateSession();
    const response = f.take();
    assert.equal(response.options.headers.Authorization, 'Bearer old-session');
    f.probe.setSession('new-session', { displayName: 'New' });
    response.resolve({ user: { displayName: 'Old response' }, error: 'expired' }, status);
    await validation;
    assert.equal(f.probe.getSession(), 'new-session');
    assert.equal(f.probe.getStoredUser().displayName, 'New');
  }
});

test('account session changes do not freeze a loading or open game', async () => {
  // Game state and actions are authorized by the seat token, so an expired startup session
  // or a sign-out in another tab must not strand the game view.
  const f = fixture();
  f.probe.setSession('expired-session', { displayName: 'Fixture' });
  f.navigate('#/watch/AAAAA');
  const load = f.take();
  const validation = f.probe.validateSession();
  f.take().resolve({ error: 'expired' }, 401);
  await validation;
  assert.equal(f.probe.getSession(), null);
  assert.equal(f.pending.length, 0, 'the game view is not reloaded');
  load.resolve(game('AAAAA', 1));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.renders.length, 1);
  assert.equal(f.intervals.size, 1);

  f.probe.setSession('other-tab', { displayName: 'Other' });
  f.probe.setSession(null);
  const poll = f.probe.pollGame();
  f.take().resolve(game('AAAAA', 2));
  await poll;
  assert.equal(f.probe.getGame().version, 2);
  const action = f.probe.doAction({ type: 'roll' });
  f.take().resolve(game('AAAAA', 3));
  await action;
  assert.equal(f.probe.getGame().version, 3);
  assert.equal(f.renders.length, 3);
});

test('late password and profile saves do not reset new forms or display stale notices', async () => {
  const f = fixture();
  f.probe.setSession('session', { username: 'fixture', displayName: 'Fixture' });
  f.navigate('#/settings');
  f.take().resolve({ games: [], stats: [] });
  await f.flush();
  const password = f.click('pass-form', 'submit');
  const passwordResponse = f.take();
  const profile = f.click('profile-form', 'submit');
  const profileResponse = f.take();
  f.navigate('#/settings');
  f.take().resolve({ games: [], stats: [] });
  passwordResponse.resolve({ success: true });
  profileResponse.resolve({ user: { displayName: 'Saved name' } });
  await Promise.all([password, profile]);
  assert.equal(f.elements.get('pass-form').wasReset, undefined);
  // The server saved the name, so the cached account (and the next settings view) shows it.
  assert.equal(f.probe.getStoredUser().displayName, 'Saved name');
  assert.deepEqual(f.notices, []);
});

test('late login keeps its session without redirecting; it cannot replace a newer sign-in', async () => {
  const f = fixture();
  f.navigate('#/login');
  const lateLogin = f.click('login-form', 'submit');
  const response = f.take();
  f.navigate('#/register');
  response.resolve({ token: 'late-session', user: { displayName: 'Late' } });
  await lateLogin;
  // The server created this session; dropping it would leave the user silently signed out.
  assert.equal(f.probe.getSession(), 'late-session');
  assert.equal(f.location.hash, '#/register');
  assert.deepEqual(f.notices, []);
  f.probe.setSession(null);

  f.navigate('#/login');
  const oldLogin = f.click('login-form', 'submit');
  const oldResponse = f.take();
  f.navigate('#/register');
  const newerRegistration = f.click('reg-form', 'submit');
  f.take().resolve({ token: 'newer-session', user: { displayName: 'Newer' } });
  await newerRegistration;
  oldResponse.resolve({ token: 'old-session', user: { displayName: 'Old' } });
  await oldLogin;
  assert.equal(f.probe.getSession(), 'newer-session');
  assert.equal(f.probe.getStoredUser().displayName, 'Newer');
  f.probe.setSession(null);
  f.notices.length = 0;
  f.navigate('#/login');
  const login = f.click('login-form', 'submit');
  f.take().resolve({ token: 'session', user: { displayName: 'Fixture' } });
  await login;
  assert.equal(f.probe.getSession(), 'session');
  assert.equal(f.location.hash, '#/');
  assert.equal(f.notices.length, 1);
});

test('overlapping sign-ins keep the newest submission in either response order', async () => {
  for (const newerFirst of [false, true]) {
    const f = fixture();
    f.navigate('#/login');
    const login = f.click('login-form', 'submit');
    const loginResponse = f.take();
    f.navigate('#/register');
    const registration = f.click('reg-form', 'submit');
    const registrationResponse = f.take();
    const older = () => loginResponse.resolve({ token: 'session-a', user: { displayName: 'A' } });
    const newer = () => registrationResponse.resolve({ token: 'session-b', user: { displayName: 'B' } }, 201);
    if (newerFirst) { newer(); await registration; older(); await login; }
    else { older(); await login; newer(); await registration; }
    assert.equal(f.probe.getSession(), 'session-b');
    assert.equal(f.location.hash, '#/');
    assert.equal(f.notices.length, 1);
  }
});

test('an earlier logout completing late does not discard a newer login or registration', async () => {
  for (const [hash, form] of [['#/login', 'login-form'], ['#/register', 'reg-form']]) {
    const f = fixture();
    f.probe.setSession('session-a', { username: 'a', displayName: 'A' });
    f.probe.renderNav();
    const logout = f.click('nav-logout');
    const logoutResponse = f.take();
    f.navigate(hash);
    const signIn = f.click(form, 'submit');
    const signInResponse = f.take();
    logoutResponse.resolve({ success: true });
    await logout;
    assert.equal(f.probe.getSession(), null);
    signInResponse.resolve({ token: 'session-b', user: { username: 'b', displayName: 'B' } }, 201);
    await signIn;
    assert.equal(f.probe.getSession(), 'session-b');
    assert.equal(f.location.hash, '#/');
    assert.equal(f.notices.length, 1);
  }
});

test('logout clears only its session and preserves a newer route without stale notices', async () => {
  const f = fixture();
  f.probe.setSession('session', { username: 'fixture', displayName: 'Fixture' });
  f.probe.renderNav();
  const logout = f.click('nav-logout');
  const response = f.take();
  f.navigate('#/login');
  const typed = f.elements.get('lg-user');
  typed.value = 'typed-user';
  response.resolve({ success: true });
  await logout;
  assert.equal(f.probe.getSession(), null);
  assert.equal(f.location.hash, '#/login');
  assert.equal(f.elements.get('lg-user'), typed, 'the login form is not rebuilt');
  assert.equal(typed.value, 'typed-user');
  assert.deepEqual(f.notices, []);
  // The preserved form still works after the session it was opened under has ended.
  const login = f.click('login-form', 'submit');
  f.take().resolve({ token: 'next-session', user: { displayName: 'Next' } });
  await login;
  assert.equal(f.probe.getSession(), 'next-session');
  assert.equal(f.location.hash, '#/');
  f.notices.length = 0;

  f.probe.setSession('old-session', { displayName: 'Old' });
  f.probe.renderNav();
  const oldLogout = f.click('nav-logout');
  const oldResponse = f.take();
  f.probe.setSession('new-session', { displayName: 'New' });
  oldResponse.resolve({ success: true });
  await oldLogout;
  assert.equal(f.probe.getSession(), 'new-session');
  assert.equal(f.probe.getStoredUser().displayName, 'New');
});

test('active logout still returns to landing, even if the network request fails', async () => {
  const f = fixture();
  f.probe.setSession('session', { username: 'fixture', displayName: 'Fixture' });
  f.navigate('#/settings');
  f.take().resolve({ games: [], stats: [] });
  f.probe.renderNav();
  const logout = f.click('nav-logout');
  f.take().reject(new Error('offline'));
  await logout;
  assert.equal(f.probe.getSession(), null);
  assert.equal(f.location.hash, '#/');
  assert.equal(f.notices.length, 1);
  assert.match(f.elements.get('app').innerHTML, /Spiel beitreten/);
});

test('a completed join preserves its player token without redirecting a newer route', async () => {
  const f = fixture();
  f.navigate('#/');
  f.elements.get('join-code').value = 'AAAAA';
  f.elements.get('join-name').value = 'Fixture';
  const join = f.click('btn-join');
  const response = f.take();
  f.navigate('#/login');
  response.resolve({ code: 'AAAAA', playerToken: 'seat-token' });
  await join;
  assert.equal(f.location.hash, '#/login');
  // The intended server mutation succeeded; its seat credentials must not be lost.
  f.navigate('#/');
  f.elements.get('join-code').value = 'AAAAA';
  await f.click('btn-join');
  assert.equal(f.location.hash, '#/game/AAAAA');
});

test('a late login re-renders settings for the new account; old account forms cannot submit', async () => {
  const f = fixture();
  f.probe.setSession('session-a', { username: 'user-a', displayName: 'A' });
  f.navigate('#/login');
  const login = f.click('login-form', 'submit');
  const loginResponse = f.take();
  f.navigate('#/settings');
  const historyA = f.take();
  loginResponse.resolve({ token: 'session-b', user: { username: 'user-b', displayName: 'B' } });
  await login;
  assert.equal(f.probe.getSession(), 'session-b');
  assert.match(f.elements.get('app').innerHTML, /@user-b/);
  assert.equal(f.take().options.headers.Authorization, 'Bearer session-b');
  historyA.resolve({ games: [], stats: [{ mode: 'history-of-a', games: 1 }] });
  await f.flush();
  assert.doesNotMatch(f.elements.get('history-area').innerHTML ?? '', /history-of-a/);
  assert.equal(f.location.hash, '#/settings');
  assert.deepEqual(f.notices, []);

  // Another tab switched accounts without this tab noticing: B's form must not save as C.
  const submitProfile = f.elements.get('profile-form').listeners.submit;
  const submitPassword = f.elements.get('pass-form').listeners.submit;
  f.probe.setSession('session-c', { username: 'user-c', displayName: 'C' });
  await submitProfile({ preventDefault() {} });
  await submitPassword({ preventDefault() {} });
  const requests = f.pending.splice(0);
  assert.ok(requests.every(request => request.url === '/api/history'), 'no profile or password write');
  assert.match(f.elements.get('app').innerHTML, /@user-c/);
});

test('landing actions still navigate after startup clears an expired session', async () => {
  const f = fixture();
  f.probe.setSession('expired-session', { username: 'fixture', displayName: 'Fixture' });
  f.navigate('#/');
  const validation = f.probe.validateSession();
  f.take().resolve({ error: 'expired' }, 401);
  await validation;
  assert.equal(f.probe.getSession(), null);
  f.elements.get('create-name').value = 'Fixture';
  const create = f.click('btn-create');
  f.take().resolve({ code: 'NEWGM', playerToken: 'seat-token' });
  await create;
  assert.equal(f.location.hash, '#/game/NEWGM');
});

test('a late join cannot replace the seat a newer join claimed in the same game', async () => {
  const f = fixture();
  f.navigate('#/');
  f.elements.get('join-code').value = 'AAAAA';
  f.elements.get('join-name').value = 'First Seat';
  const firstJoin = f.click('btn-join');
  const first = f.take();
  f.navigate('#/login');
  f.navigate('#/');
  f.elements.get('join-code').value = 'AAAAA';
  f.elements.get('join-name').value = 'Second Seat';
  const secondJoin = f.click('btn-join');
  f.take().resolve({ code: 'AAAAA', playerToken: 'second-seat' });
  await secondJoin;
  assert.equal(f.location.hash, '#/game/AAAAA');
  first.resolve({ code: 'AAAAA', playerToken: 'first-seat' });
  await firstJoin;
  assert.equal(f.sandbox.localStorage.getItem('wb_player_AAAAA'), 'second-seat');
});

test('game errors after a URL change are not shown on the next page', async () => {
  const f = fixture();
  await f.open('AAAAA');
  const action = f.probe.doAction({ type: 'roll' });
  const response = f.take();
  f.location.hash = '#/settings'; // hashchange still queued
  response.resolve({ error: 'Konflikt' }, 409);
  await action;
  assert.deepEqual(f.notices, []);
});

test('a pending completion cannot override a URL change whose hashchange is still queued', async () => {
  const f = fixture();
  f.navigate('#/');
  f.elements.get('join-code').value = 'AAAAA';
  const watch = f.click('btn-watch');
  const response = f.take();
  // The browser updates location.hash before the queued hashchange event runs the router.
  f.location.hash = '#/settings';
  response.resolve(game('AAAAA', 1));
  await watch;
  assert.equal(f.location.hash, '#/settings');
});

test('navigation removes an old scoring modal, and clipboard notices belong to their game', async () => {
  const f = fixture();
  await f.open('AAAAA');
  let resolveClipboard;
  f.sandbox.navigator.clipboard.writeText = () => new Promise(resolve => { resolveClipboard = resolve; });
  const copy = f.click('btn-copycode');
  f.elements.set('entry-modal', { remove: () => f.elements.delete('entry-modal') });
  f.navigate('#/login');
  resolveClipboard();
  await copy;
  assert.equal(f.elements.has('entry-modal'), false);
  assert.deepEqual(f.notices, []);
});

test('a game keeps acting with its own seat when another tab joins the same game', async () => {
  const storage = new Map();
  const tabA = fixture({ storage });
  const tabB = fixture({ storage });
  for (const [tab, name] of [[tabA, 'Seat A'], [tabB, 'Seat B']]) {
    tab.navigate('#/');
    tab.elements.get('join-code').value = 'AAAAA';
    tab.elements.get('join-name').value = name;
  }
  const joinA = tabA.click('btn-join');
  const joinB = tabB.click('btn-join');
  const responseA = tabA.take();
  const responseB = tabB.take();
  responseA.resolve({ code: 'AAAAA', playerToken: 'seat-a' });
  await joinA;
  assert.equal(tabA.location.hash, '#/game/AAAAA');
  tabA.navigate(tabA.location.hash);
  tabA.take().resolve(game('AAAAA', 1));
  await tabA.flush();
  responseB.resolve({ code: 'AAAAA', playerToken: 'seat-b' });
  await joinB;
  assert.equal(storage.get('wb_player_AAAAA'), 'seat-b');
  tabA.probe.doAction({ type: 'enter', category: 'ones', value: 3 });
  assert.equal(tabA.take().options.headers['X-Player-Token'], 'seat-a', 'tab A still scores for seat A');
  tabA.probe.pollGame();
  assert.equal(tabA.take().options.headers['X-Player-Token'], 'seat-a');
});

test('across tabs the last sign-in response wins, and every successful sign-in completes', async () => {
  // Two tabs sign in concurrently, in either response order. Each tab's own sign-in redirects and greets;
  // the browser keeps the response that arrived last, and the other tab's account display follows it.
  for (const tab1First of [true, false]) {
    const storage = new Map();
    const tab1 = fixture({ storage });
    const tab2 = fixture({ storage });
    tab1.navigate('#/login');
    tab2.navigate('#/login');
    const loginA = tab1.click('login-form', 'submit');
    const responseA = tab1.take();
    const loginB = tab2.click('login-form', 'submit');
    const responseB = tab2.take();
    const a = async () => { responseA.resolve({ token: 'session-a', user: { username: 'a', displayName: 'A' } }); await loginA; };
    const b = async () => { responseB.resolve({ token: 'session-b', user: { username: 'b', displayName: 'B' } }); await loginB; };
    if (tab1First) { await a(); await b(); } else { await b(); await a(); }
    for (const [tab, name] of [[tab1, 'A'], [tab2, 'B']]) {
      assert.equal(tab.location.hash, '#/');
      assert.deepEqual(tab.notices.map(([message]) => message), [`Hallo, ${name}!`]);
      assert.equal(tab.elements.get('lg-error')?.textContent ?? '', '');
    }
    const last = tab1First ? 'B' : 'A';
    assert.equal(storage.has('wb_session'), true);
    assert.equal(tab1.probe.getSession(), `session-${last.toLowerCase()}`);
    const other = tab1First ? tab1 : tab2;
    other.storageEvent('wb_session');
    assert.match(other.elements.get('topnav').innerHTML, new RegExp(`>${last}<`));
  }
});

test('a late storage event for another tab\'s earlier sign-in does not discard a newer local sign-in', async () => {
  // Tab 2 installs B; tab 1 then submits C and receives B's storage event late. C still applies.
  {
    const storage = new Map();
    const tab1 = fixture({ storage });
    const tab2 = fixture({ storage });
    tab2.navigate('#/login');
    const loginB = tab2.click('login-form', 'submit');
    tab2.take().resolve({ token: 'session-b', user: { username: 'b', displayName: 'B' } });
    await loginB;
    tab1.navigate('#/login');
    const loginC = tab1.click('login-form', 'submit');
    const responseC = tab1.take();
    tab1.storageEvent('wb_session');
    responseC.resolve({ token: 'session-c', user: { username: 'c', displayName: 'C' } });
    await loginC;
    assert.equal(tab1.probe.getSession(), 'session-c');
    assert.equal(tab1.location.hash, '#/');
    assert.equal(tab1.notices.length, 1);
  }
});

test('the navbar cannot log out a session it does not show', async () => {
  const storage = new Map();
  const f = fixture({ storage });
  f.probe.setSession('session-a', { username: 'a', displayName: 'A' });
  f.probe.renderNav();
  const staleLogout = f.elements.get('nav-logout').listeners.click;
  // Another tab switched to B; this tab's storage event is still queued.
  f.probe.setSession('session-b', { username: 'b', displayName: 'B' });
  const logout = staleLogout({ preventDefault() {} });
  assert.equal(f.pending.length, 0, 'no logout request is sent with B\'s token');
  await logout;
  assert.equal(f.probe.getSession(), 'session-b');
  assert.match(f.elements.get('topnav').innerHTML, />B</);
});

test('only the newest submission of a sign-in form redirects, greets or shows an error', async () => {
  const user = name => ({ token: `session-${name}`, user: { username: name, displayName: name } });
  {
    const f = fixture();
    f.navigate('#/login');
    const first = f.click('login-form', 'submit');
    const firstResponse = f.take();
    const second = f.click('login-form', 'submit');
    const secondResponse = f.take();
    firstResponse.resolve(user('A'));
    await first;
    assert.equal(f.location.hash, '#/login', 'the superseded submission does not redirect');
    secondResponse.resolve(user('B'));
    await second;
    assert.equal(f.probe.getSession(), 'session-B');
    assert.equal(f.location.hash, '#/');
    assert.deepEqual(f.notices.map(([message]) => message), ['Hallo, B!']);
  }
  {
    const f = fixture();
    f.navigate('#/login');
    const first = f.click('login-form', 'submit');
    const firstResponse = f.take();
    const second = f.click('login-form', 'submit');
    const secondResponse = f.take();
    firstResponse.resolve(user('A'));
    await first;
    secondResponse.resolve({ error: 'Falsches Passwort' }, 401);
    await second;
    assert.equal(f.location.hash, '#/login');
    assert.equal(f.elements.get('lg-error').textContent, 'Falsches Passwort', 'the newer failure is visible');
  }
  {
    const f = fixture();
    f.navigate('#/register');
    const first = f.click('reg-form', 'submit');
    const firstResponse = f.take();
    const second = f.click('reg-form', 'submit');
    f.take().resolve({ error: 'newer error' }, 400);
    await second;
    firstResponse.resolve({ error: 'older error' }, 400);
    await first;
    assert.equal(f.elements.get('rg-error').textContent, 'newer error');
  }
});

test('startup validation cannot revert a display name saved after it was sent', async () => {
  const f = fixture();
  f.probe.setSession('session', { username: 'fixture', displayName: 'Old' });
  const validation = f.probe.validateSession();
  const me = f.take();
  f.navigate('#/settings');
  f.take().resolve({ games: [], stats: [] });
  await f.flush();
  const save = f.click('profile-form', 'submit');
  f.take().resolve({ user: { username: 'fixture', displayName: 'New' } });
  await save;
  me.resolve({ user: { username: 'fixture', displayName: 'Old' } });
  await validation;
  assert.equal(f.probe.getStoredUser().displayName, 'New');
  assert.match(f.elements.get('topnav').innerHTML, />New</);
});

test('a tab sends one profile save and one password change at a time, even across reopened settings', async () => {
  // Two saves in flight could reach the server in the other order and leave the navbar showing a name
  // the server did not keep. While one is pending, its button stays disabled and a submit sends nothing.
  for (const [form, button, response, failure] of [
    ['profile-form', 'st-save', { user: { username: 'fixture', displayName: 'Saved' } }, { error: 'Name ungültig' }],
    ['pass-form', 'st-pass-save', { success: true }, { error: 'Das aktuelle Passwort ist falsch.' }],
  ]) {
    const f = fixture();
    f.probe.setSession('session', { username: 'fixture', displayName: 'Original' });
    f.navigate('#/settings');
    f.take().resolve({ games: [], stats: [] });
    await f.flush();
    const first = f.click(form, 'submit');
    const firstResponse = f.take();
    assert.equal(f.elements.get(button).disabled, true);
    f.click(form, 'submit');
    assert.equal(f.pending.length, 0, 'no second request while the first is pending');
    // Reopening settings does not unlock the form.
    f.navigate('#/settings');
    f.take().resolve({ games: [], stats: [] });
    await f.flush();
    assert.match(f.elements.get('app').innerHTML, new RegExp(`id="${button}" disabled`));
    f.click(form, 'submit');
    assert.equal(f.pending.length, 0);
    firstResponse.resolve(response);
    await first;
    assert.equal(f.elements.get(button).disabled, false, 'the current form is usable again');
    // A failure unlocks too, and the current view shows it.
    const second = f.click(form, 'submit');
    f.take().resolve(failure, 400);
    await second;
    assert.equal(f.elements.get(button).disabled, false);
    assert.equal(f.elements.get('st-error').textContent, failure.error);
  }
});

test('a name saved in another tab updates the navbar without rebuilding open settings', async () => {
  // Same session in two tabs: tab 2 saves a name while tab 1 has a draft and a pending password change.
  const storage = new Map();
  const f = fixture({ storage });
  f.probe.setSession('session', { username: 'fixture', displayName: 'Original' });
  f.navigate('#/settings');
  f.take().resolve({ games: [], stats: [] });
  await f.flush();
  const form = f.elements.get('app').innerHTML;
  f.elements.get('st-display').value = 'Entwurf';
  const change = f.click('pass-form', 'submit');
  const response = f.take();
  storage.set('wb_user', JSON.stringify({ username: 'fixture', displayName: 'Anderer Tab' }));
  f.storageEvent('wb_user');
  assert.match(f.elements.get('topnav').innerHTML, />Anderer Tab</);
  assert.equal(f.pending.length, 0, 'settings were not reloaded');
  assert.equal(f.elements.get('app').innerHTML, form, 'the open form was not rebuilt');
  assert.equal(f.elements.get('st-display').value, 'Entwurf');
  response.resolve({ error: 'Das aktuelle Passwort ist falsch.' }, 401);
  await change;
  assert.equal(f.elements.get('st-error').textContent, 'Das aktuelle Passwort ist falsch.');
});

test('another tab\'s sign-in keeps open settings and their draft; a stale form saves nothing', async () => {
  // Like Chromium, this tab sees the other tab's two writes one at a time, each with its own event.
  // Same account with a new token, or a different account: only the navbar follows, as on main the open
  // form keeps its draft. Submitting that form sends nothing and shows settings for the current account.
  for (const next of [
    { wb_session: 'session-alice-2', wb_user: JSON.stringify({ username: 'alice', displayName: 'Alice' }) },
    { wb_session: 'session-bob', wb_user: JSON.stringify({ username: 'bob', displayName: 'Bob' }) },
  ]) {
    for (const order of [['wb_session', 'wb_user'], ['wb_user', 'wb_session']]) {
      const storage = new Map();
      const f = fixture({ storage });
      f.probe.setSession('session-alice', { username: 'alice', displayName: 'Alice' });
      f.navigate('#/settings');
      f.take().resolve({ games: [], stats: [] });
      await f.flush();
      const form = f.elements.get('app').innerHTML;
      f.elements.get('st-display').value = 'Entwurf';
      for (const key of order) {
        storage.set(key, next[key]);
        f.storageEvent(key);
      }
      const displayName = JSON.parse(next.wb_user).displayName;
      assert.match(f.elements.get('topnav').innerHTML, new RegExp(`>${displayName}<`));
      assert.equal(f.pending.length, 0, 'settings were not reloaded');
      assert.equal(f.elements.get('app').innerHTML, form);
      assert.equal(f.elements.get('st-display').value, 'Entwurf');
      f.click('profile-form', 'submit');
      const history = f.take();
      assert.equal(history.url, '/api/history', 'the stale form re-rendered instead of saving');
      assert.equal(history.options.headers.Authorization, `Bearer ${next.wb_session}`);
      assert.equal(f.pending.length, 0, 'no profile save was sent');
    }
  }
});

test('an expired session found after leaving settings still signs out', async () => {
  const f = fixture();
  f.probe.setSession('expired-session', { username: 'fixture', displayName: 'Fixture' });
  f.probe.renderNav();
  f.navigate('#/settings');
  const history = f.take();
  f.navigate('#/login');
  const typed = f.elements.get('lg-user');
  history.resolve({ error: 'expired' }, 401);
  await f.flush();
  assert.equal(f.probe.getSession(), null);
  assert.equal(f.elements.has('nav-logout'), false);
  assert.equal(f.elements.get('lg-user'), typed, 'the login form is not rebuilt');
});

test('a full or blocked storage never stops a sign-in from being sent or leaves a blank error', async () => {
  for (const [hash, form, error] of [['#/login', 'login-form', 'lg-error'], ['#/register', 'reg-form', 'rg-error']]) {
    const f = fixture({ storageFull: true });
    f.navigate(hash);
    const rejected = f.click(form, 'submit');
    f.take().resolve({ error: 'Falsches Passwort' }, 401);
    await rejected;
    assert.equal(f.elements.get(error).textContent, 'Falsches Passwort');
    // The server accepts, but the session cannot be stored: say so instead of failing silently.
    const accepted = f.click(form, 'submit');
    f.take().resolve({ token: 'session', user: { username: 'u', displayName: 'U' } });
    await accepted;
    assert.notEqual(f.elements.get(error).textContent, '');
    assert.equal(f.location.hash, hash);
  }
});
