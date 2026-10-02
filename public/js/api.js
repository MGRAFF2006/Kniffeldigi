// Kleiner API-Client. Session-Token und Spieler-Tokens liegen im localStorage.

const SESSION_KEY = 'wb_session';
const USER_KEY = 'wb_user';

export function getSession() {
  return localStorage.getItem(SESSION_KEY);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  if (token) {
    localStorage.setItem(SESSION_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_KEY);
  }
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
  gameState: (code, since) => {
    const token = playerTokenFor(code);
    const query = since ? `?since=${since}` : '';
    return call('GET', `/games/${encodeURIComponent(code)}/state${query}`, undefined, token ? { 'X-Player-Token': token } : {});
  },
  gameAction: (code, action) => {
    const token = playerTokenFor(code);
    return call('POST', `/games/${encodeURIComponent(code)}/action`, action, token ? { 'X-Player-Token': token } : {});
  },
};
