import { addPlayer, loadGame, publicState, saveGame } from '../../_lib/game.js';
import { apiError, getUser, json, validName } from '../../_lib/util.js';

// POST /api/games/:code/join
export async function onRequestPost({ request, env, params }) {
  const game = await loadGame(env, params.code);
  if (!game) return apiError('Kein Spiel mit diesem Code gefunden.', 404);

  const body = await request.json().catch(() => ({}));
  const user = await getUser(env, request);
  const name = validName(body.name || (user && user.display_name));
  if (!name) return apiError('Spielername: 2–20 Zeichen.');

  const player = addPlayer(game.state, name, user && user.id);
  await saveGame(env, game);

  return json({
    code: game.code,
    playerToken: player.token,
    version: game.version,
    state: publicState(game.state, player.token),
  });
}
