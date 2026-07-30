import { GameError, applyAction, loadGame, publicState, recordResults, saveGame } from '../../_lib/game.js';
import { apiError, json } from '../../_lib/util.js';

// POST /api/games/:code/action  { type: 'start' | 'roll' | 'hold' | 'score' | 'leave', ... }
export async function onRequestPost({ request, env, params }) {
  const playerToken = request.headers.get('X-Player-Token');
  if (!playerToken) return apiError('Spieler-Token fehlt.', 401);

  const action = await request.json().catch(() => ({}));

  // Bei Versionskonflikten (zwei gleichzeitige Aktionen) einmal neu versuchen.
  for (let attempt = 0; ; attempt++) {
    const game = await loadGame(env, params.code);
    if (!game) return apiError('Kein Spiel mit diesem Code gefunden.', 404);

    const wasFinished = game.state.status === 'finished';
    try {
      applyAction(game.state, playerToken, action);
      await saveGame(env, game);
      if (!wasFinished && game.state.status === 'finished') {
        await recordResults(env, game.code, game.state);
      }
      return json({ code: game.code, version: game.version, state: publicState(game.state, playerToken) });
    } catch (err) {
      if (err instanceof GameError && err.message.startsWith('Konflikt') && attempt < 2) continue;
      throw err;
    }
  }
}
