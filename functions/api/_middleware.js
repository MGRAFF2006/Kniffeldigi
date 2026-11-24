// Middleware für alle /api-Routen: legt das Schema beim ersten Request an
// und fängt Fehler als saubere JSON-Antworten ab.

import { SCHEMA } from './_lib/schema.js';
import { RequestError, apiError } from './_lib/util.js';

let schemaReady = false;

export async function onRequest(context) {
  const { env, next } = context;
  if (!env.DB) {
    return apiError('D1-Datenbank nicht konfiguriert. Bitte Binding "DB" im Cloudflare-Dashboard bzw. wrangler.toml einrichten.', 500);
  }
  try {
    if (!schemaReady) {
      const stmts = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
      await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
      schemaReady = true;
    }
    return await next();
  } catch (err) {
    if (err instanceof RequestError) return apiError(err.message, err.status);
    console.error('API-Fehler:', err);
    return apiError('Interner Fehler. Bitte später erneut versuchen.', 500);
  }
}
