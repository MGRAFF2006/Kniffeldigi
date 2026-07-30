import { apiError, bearerToken, getUser, hashPassword, json, randomToken } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const user = await getUser(env, request);
  if (!user) return apiError('Nicht eingeloggt.', 401);

  const body = await request.json().catch(() => ({}));
  const oldPassword = String(body.oldPassword || '');
  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 8) return apiError('Das neue Passwort braucht mindestens 8 Zeichen.');

  const row = await env.DB.prepare('SELECT pass_hash, salt FROM users WHERE id = ?').bind(user.id).first();
  const oldHash = await hashPassword(oldPassword, row.salt);
  if (oldHash !== row.pass_hash) return apiError('Das aktuelle Passwort ist falsch.', 401);

  const salt = randomToken(16);
  const passHash = await hashPassword(newPassword, salt);
  await env.DB.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?').bind(passHash, salt, user.id).run();

  // Alle anderen Sitzungen beenden, die aktuelle behalten.
  const current = bearerToken(request);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(user.id, current).run();

  return json({ ok: true });
}
