// Kleiner API-Client. Session-Token und Spieler-Tokens liegen im localStorage.

// Token und Nutzer liegen in EINEM Eintrag: ein anderer Tab sieht nie den Token des einen und
// den Namen des anderen Kontos. Ältere Versionen speicherten beides getrennt (wb_session/wb_user);
// solche Anmeldungen werden weiter gelesen und beim nächsten Speichern umgestellt.
const AUTH_KEY = 'wb_auth';
const LEGACY_SESSION_KEY = 'wb_session';
const LEGACY_USER_KEY = 'wb_user';

function parse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getAuth() {
  const auth = parse(localStorage.getItem(AUTH_KEY));
  if (auth && auth.token) return { token: auth.token, user: auth.user ?? null };
  const token = localStorage.getItem(LEGACY_SESSION_KEY);
  return token ? { token, user: parse(localStorage.getItem(LEGACY_USER_KEY)) } : null;
}

export function getSession() {
  return getAuth()?.token ?? null;
}

export function getStoredUser() {
  return getAuth()?.user ?? null;
}

export function setSession(token, user) {
  if (token) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user }));
    localStorage.removeItem(LEGACY_SESSION_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
  } else {
    // Alte Einträge zuerst: bis zuletzt wb_auth verschwindet, liest ein anderer Tab keine halbe Sitzung.
    localStorage.removeItem(LEGACY_SESSION_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
    localStorage.removeItem(AUTH_KEY);
  }
}

// Ob eine Änderung in einem anderen Tab die Anmeldung betrifft (null: Speicher geleert).
export function isSessionKey(key) {
  return key === null || key === AUTH_KEY || key === LEGACY_SESSION_KEY || key === LEGACY_USER_KEY;
}

export function playerTokenFor(code) {
  return localStorage.getItem(`wb_player_${code}`);
}

export function setPlayerToken(code, token) {
  localStorage.setItem(`wb_player_${code}`, token);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const session = getSession();
  if (session) headers.Authorization = `Bearer ${session}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Fehler ${res.status}`, res.status);
  return data;
}

export const api = {
  register: (username, displayName, password) => call('POST', '/auth/register', { username, displayName, password }),
  login: (username, password) => call('POST', '/auth/login', { username, password }),
  logout: () => call('POST', '/auth/logout'),
  me: () => call('GET', '/auth/me'),
  updateProfile: (displayName) => call('PATCH', '/auth/me', { displayName }),
  changePassword: (oldPassword, newPassword) => call('POST', '/auth/password', { oldPassword, newPassword }),
  history: () => call('GET', '/history'),

  createGame: (mode, name, entry, hostPaper = false) =>
    call('POST', '/games', { mode, name, entry, hostPaper: !!hostPaper }),
  joinGame: (code, name) => call('POST', `/games/${encodeURIComponent(code)}/join`, { name }),
  // Eine offene Spielansicht übergibt den Platz, mit dem sie geöffnet wurde.
  gameState: (code, since, token = playerTokenFor(code)) => {
    const query = since ? `?since=${since}` : '';
    return call('GET', `/games/${encodeURIComponent(code)}/state${query}`, undefined, token ? { 'X-Player-Token': token } : {});
  },
  gameAction: (code, action, token = playerTokenFor(code)) => {
    return call('POST', `/games/${encodeURIComponent(code)}/action`, action, token ? { 'X-Player-Token': token } : {});
  },
};
