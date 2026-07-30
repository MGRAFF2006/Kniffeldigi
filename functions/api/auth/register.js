import { SESSION_TTL_MS, apiError, hashPassword, json, randomToken, validName } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const displayName = validName(body.displayName || username);
  const password = String(body.password || '');

  if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(username)) {
    return apiError('Benutzername: 3–20 Zeichen, nur Buchstaben, Zahlen, . _ -');
  }
  if (!displayName) return apiError('Anzeigename: 2–20 Zeichen.');
  if (password.length < 8) return apiError('Das Passwort braucht mindestens 8 Zeichen.');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return apiError('Dieser Benutzername ist schon vergeben.', 409);

  const salt = randomToken(16);
  const passHash = await hashPassword(password, salt);
  const result = await env.DB.prepare(
    'INSERT INTO users (username, display_name, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(username, displayName, passHash, salt, Date.now())
    .run();

  const userId = result.meta.last_row_id;
  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, userId, Date.now(), Date.now() + SESSION_TTL_MS)
    .run();

  return json({ token, user: { id: userId, username, displayName } }, 201);
}
