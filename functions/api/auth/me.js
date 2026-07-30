import { apiError, getUser, json, validName } from '../_lib/util.js';

export async function onRequestGet({ request, env }) {
  const user = await getUser(env, request);
  if (!user) return apiError('Nicht eingeloggt.', 401);
  return json({ user: { id: user.id, username: user.username, displayName: user.display_name } });
}

// Anzeigename ändern
export async function onRequestPatch({ request, env }) {
  const user = await getUser(env, request);
  if (!user) return apiError('Nicht eingeloggt.', 401);

  const body = await request.json().catch(() => ({}));
  const displayName = validName(body.displayName);
  if (!displayName) return apiError('Anzeigename: 2–20 Zeichen.');

  await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(displayName, user.id).run();
  return json({ user: { id: user.id, username: user.username, displayName } });
}
