import { apiError, getUser, json } from './_lib/util.js';

// GET /api/history – protokollierte Spiele des eingeloggten Benutzers + Statistiken.
export async function onRequestGet({ request, env }) {
  const user = await getUser(env, request);
  if (!user) return apiError('Nicht eingeloggt.', 401);

  const rows = await env.DB.prepare(
    `SELECT game_code, mode, score, placement, player_count, finished_at
     FROM game_results WHERE user_id = ? ORDER BY finished_at DESC LIMIT 100`
  )
    .bind(user.id)
    .all();

  const stats = await env.DB.prepare(
    `SELECT mode, COUNT(*) AS games, SUM(placement = 1) AS wins, MAX(score) AS best, ROUND(AVG(score), 1) AS avg
     FROM game_results WHERE user_id = ? GROUP BY mode`
  )
    .bind(user.id)
    .all();

  return json({ games: rows.results, stats: stats.results });
}
