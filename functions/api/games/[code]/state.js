import { loadGame, publicState } from '../../_lib/game.js';
import { apiError, json } from '../../_lib/util.js';

// GET /api/games/:code/state?since=VERSION
// Für Spieler (mit X-Player-Token) und Zuschauer (ohne Token).
// Mit ?since liefert der Server 204, solange sich nichts geändert hat – ideal zum Pollen.
export async function onRequestGet({ request, env, params }) {
  const game = await loadGame(env, params.code);
  if (!game) return apiError('Kein Spiel mit diesem Code gefunden.', 404);

  const url = new URL(request.url);
  const since = Number(url.searchParams.get('since') || 0);
  if (since && game.version <= since) {
    return new Response(null, { status: 204 });
  }

  const playerToken = request.headers.get('X-Player-Token');
  return json({ code: game.code, version: game.version, state: publicState(game.state, playerToken) });
}
