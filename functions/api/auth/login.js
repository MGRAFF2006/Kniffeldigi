import { SESSION_TTL_MS, apiError, hashPassword, json, randomToken } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  const user = await env.DB.prepare('SELECT id, username, display_name, pass_hash, salt FROM users WHERE username = ?')
    .bind(username)
    .first();
  if (!user) return apiError('Benutzername oder Passwort ist falsch.', 401);

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.pass_hash) return apiError('Benutzername oder Passwort ist falsch.', 401);

  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, user.id, Date.now(), Date.now() + SESSION_TTL_MS)
    .run();

  return json({ token, user: { id: user.id, username: user.username, displayName: user.display_name } });
}
