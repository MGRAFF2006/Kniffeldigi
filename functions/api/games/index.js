import { MODES } from '../_lib/rules.js';
import { addPlayer, createGame, publicState, saveGame } from '../_lib/game.js';
import { apiError, getUser, json, validName } from '../_lib/util.js';

// POST /api/games – neues Spiel anlegen, Ersteller tritt sofort bei.
// entry: 'manual' (analog spielen, Punkte digital führen – Standard) oder 'digital' (App würfelt).
export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const mode = String(body.mode || '');
  if (!MODES[mode]) return apiError('Unbekannter Spielmodus. Verfügbar: kniffel, yatzy');
  const entry = body.entry === 'digital' ? 'digital' : 'manual';

  const user = await getUser(env, request);
  const name = validName(body.name || (user && user.display_name));
  if (!name) return apiError('Spielername: 2–20 Zeichen.');

  const game = await createGame(env, mode, entry);
  const player = addPlayer(game.state, name, user && user.id);
  await saveGame(env, game);

  return json(
    {
      code: game.code,
      playerToken: player.token,
      version: game.version,
      state: publicState(game.state, player.token),
    },
    201
  );
}
