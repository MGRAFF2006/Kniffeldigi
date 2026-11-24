// Run with node --test tests/navigation.test.mjs; no server or dependencies needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as rules from '../public/js/rules.js';

const apiSource = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const appSource = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');

function fixture() {
  const storage = new Map();
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
      setItem: (key, value) => storage.set(key, value),
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
    window: { scrollTo() {} },
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
  const probe = sandbox.probe;
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
  return { probe, take, open, navigate, flush, click, location, elements, renders, notices, timeouts, intervals, sandbox, pending };
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

test('late login keeps its session without redirecting; it cannot replace another session', async () => {
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
  f.probe.setSession('other-tab', { displayName: 'Other' });
  oldResponse.resolve({ token: 'old-session', user: { displayName: 'Old' } });
  await oldLogin;
  assert.equal(f.probe.getSession(), 'other-tab');
  f.probe.setSession(null);
  f.navigate('#/login');
  const login = f.click('login-form', 'submit');
  f.take().resolve({ token: 'session', user: { displayName: 'Fixture' } });
  await login;
  assert.equal(f.probe.getSession(), 'session');
  assert.equal(f.location.hash, '#/');
  assert.equal(f.notices.length, 1);
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
