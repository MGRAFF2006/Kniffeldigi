import { SESSION_TTL_MS, apiError, hashPassword, json, randomToken } from '../_lib/util.js';
import { clientIp, releaseAttempts, reserveAttempt, rule, tooManyAttempts } from '../_lib/throttle.js';

// Unbekannte Benutzer werden trotzdem gehasht, damit die Antwortzeit nicht
// verrät, ob ein Konto existiert.
const DUMMY_SALT = '00000000000000000000000000000000';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  // Vor Datenbanksuche und Hashing prüfen: Gesperrte Versuche verraten weder
  // die Existenz des Kontos noch, ob das Passwort gestimmt hätte.
  // Ohne bekannte IP zählt der strenge Bucket nur nach Benutzername ("*" kann
  // keine normalisierte IP sein, Schlüssel bleiben also eindeutig).
  const ip = clientIp(request);
  const userIpRule = rule('loginUserIp', `${ip || '*'}|${username}`);
  const rules = [userIpRule, rule('loginUser', username)];
  if (ip) rules.push(rule('loginIp', ip));
  const attempt = await reserveAttempt(env, rules);
  if (attempt.retryAfter) return tooManyAttempts(attempt.retryAfter);

  const user = await env.DB.prepare('SELECT id, username, display_name, pass_hash, salt FROM users WHERE username = ?')
    .bind(username)
    .first();
  const hash = await hashPassword(password, user ? user.salt : DUMMY_SALT);
  if (!user || hash !== user.pass_hash) return apiError('Benutzername oder Passwort ist falsch.', 401);

  // Erfolg zählt nicht als Fehlversuch und setzt den Zähler für diesen Namen von
  // dieser IP zurück. Der globale Namenszähler bleibt, damit ein Login der echten
  // Person verteiltem Raten kein neues Kontingent verschafft; der IP-Zähler
  // bleibt, damit ein Angreifer ihn nicht mit einem eigenen Konto leeren kann.
  await releaseAttempts(env, attempt.ids, [userIpRule.bucket]);

  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, user.id, Date.now(), Date.now() + SESSION_TTL_MS)
    .run();

  return json({ token, user: { id: user.id, username: user.username, displayName: user.display_name } });
}
