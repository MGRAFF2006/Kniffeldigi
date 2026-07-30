// Cloudflare-Worker-Einstiegspunkt (für `npx wrangler deploy`).
// Statische Dateien kommen aus public/ (Assets-Binding), die API-Routen
// werden auf dieselben Handler wie bei Cloudflare Pages Functions gemappt.

import { onRequest as middleware } from '../functions/api/_middleware.js';
import * as login from '../functions/api/auth/login.js';
import * as logout from '../functions/api/auth/logout.js';
import * as me from '../functions/api/auth/me.js';
import * as password from '../functions/api/auth/password.js';
import * as register from '../functions/api/auth/register.js';
import * as gameAction from '../functions/api/games/[code]/action.js';
import * as gameJoin from '../functions/api/games/[code]/join.js';
import * as gameState from '../functions/api/games/[code]/state.js';
import * as games from '../functions/api/games/index.js';
import * as history from '../functions/api/history.js';

const routes = [
  ['POST', /^\/api\/auth\/register$/, register.onRequestPost],
  ['POST', /^\/api\/auth\/login$/, login.onRequestPost],
  ['POST', /^\/api\/auth\/logout$/, logout.onRequestPost],
  ['GET', /^\/api\/auth\/me$/, me.onRequestGet],
  ['PATCH', /^\/api\/auth\/me$/, me.onRequestPatch],
  ['POST', /^\/api\/auth\/password$/, password.onRequestPost],
  ['GET', /^\/api\/history$/, history.onRequestGet],
  ['POST', /^\/api\/games$/, games.onRequestPost],
  ['POST', /^\/api\/games\/([^/]+)\/join$/, gameJoin.onRequestPost, 'code'],
  ['GET', /^\/api\/games\/([^/]+)\/state$/, gameState.onRequestGet, 'code'],
  ['POST', /^\/api\/games\/([^/]+)\/action$/, gameAction.onRequestPost, 'code'],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      for (const [method, pattern, handler, paramName] of routes) {
        if (request.method !== method) continue;
        const match = url.pathname.match(pattern);
        if (!match) continue;
        const params = paramName ? { [paramName]: decodeURIComponent(match[1]) } : {};
        return middleware({ request, env, params, next: () => handler({ request, env, params }) });
      }
      return new Response(JSON.stringify({ error: 'Nicht gefunden.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
