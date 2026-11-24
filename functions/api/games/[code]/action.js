import { GameError, applyAction, loadGame, publicState, saveGame } from '../../_lib/game.js';
import { apiError, json, readJson } from '../../_lib/util.js';

// POST /api/games/:code/action  { type: 'start' | 'roll' | 'hold' | 'score' | 'leave', ... }
export async function onRequestPost({ request, env, params }) {
  const playerToken = request.headers.get('X-Player-Token');
  if (!playerToken) return apiError('Spieler-Token fehlt.', 401);

  const action = await readJson(request);

  // Bei Versionskonflikten (gleichzeitige Aktionen) bis zu zweimal neu versuchen.
  for (let attempt = 0; ; attempt++) {
    const game = await loadGame(env, params.code);
    if (!game) return apiError('Kein Spiel mit diesem Code gefunden.', 404);

    const wasFinished = game.state.status === 'finished';
    try {
      applyAction(game.state, playerToken, action);
      const isFinished = game.state.status === 'finished';
      // Historie mit dem Spielstand atomar abgleichen, sobald ein Spielende beteiligt ist
      // oder ein Reset die alten Ergebnisse verwirft.
      await saveGame(env, game, { syncResults: wasFinished || isFinished || action.type === 'reset' });
      return json({ code: game.code, version: game.version, state: publicState(game.state, playerToken) });
    } catch (err) {
      if (err instanceof GameError && err.status === 409 && attempt < 2) continue;
      throw err;
    }
  }
}
