import { bearerToken, json } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const token = bearerToken(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return json({ ok: true });
}
