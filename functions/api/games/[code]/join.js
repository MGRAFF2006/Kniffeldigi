import { GameError, addPlayer, loadGame, publicState, saveGame } from '../../_lib/game.js';
import { apiError, getUser, json, readJson, validName } from '../../_lib/util.js';

// POST /api/games/:code/join
export async function onRequestPost({ request, env, params }) {
  const body = await readJson(request);
  const user = await getUser(env, request);
  const name = validName(body.name || (user && user.display_name));
  if (!name) return apiError('Spielername: 2–20 Zeichen.');

  // Gleichzeitige Beitritte konkurrieren um dieselbe Version: bis zu zweimal neu laden.
  for (let attempt = 0; ; attempt++) {
    const game = await loadGame(env, params.code);
    if (!game) return apiError('Kein Spiel mit diesem Code gefunden.', 404);
    const player = addPlayer(game.state, name, user && user.id);
    try {
      await saveGame(env, game);
      return json({
        code: game.code,
        playerToken: player.token,
        version: game.version,
        state: publicState(game.state, player.token),
      });
    } catch (err) {
      if (err instanceof GameError && err.status === 409 && attempt < 2) continue;
      throw err;
    }
  }
}
