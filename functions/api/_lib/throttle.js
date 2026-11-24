// Schutz gegen Passwort-Raten: Versuche werden in der D1-Tabelle auth_attempts
// gezählt (gleitendes Zeitfenster). D1 serialisiert alle Schreibzugriffe, daher
// ist die Prüfung "unter dem Limit?" und das Eintragen des Versuchs in einem
// einzigen INSERT atomar – auch parallele Anfragen können das Limit nicht
// überholen. Abgewiesene Anfragen schreiben nichts.

import { json } from './util.js';

const MINUTE = 60 * 1000;

// Limits pro Bucket. Beim Login zählen nur Fehlversuche (ein erfolgreicher
// Login nimmt seinen Versuch wieder heraus), bei der Registrierung jeder
// Versuch nach der Formularprüfung (auch "Benutzername vergeben").
export const LIMITS = {
  loginUser: { max: 10, windowMs: 15 * MINUTE },
  loginIp: { max: 50, windowMs: 15 * MINUTE },
  passwordUser: { max: 10, windowMs: 15 * MINUTE },
  registerIp: { max: 20, windowMs: 60 * MINUTE },
};

const LONGEST_WINDOW_MS = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));

export const TOO_MANY_MESSAGE = 'Zu viele Versuche. Bitte später erneut versuchen.';

/**
 * Client-IP für die Pro-IP-Limits. Cloudflare setzt CF-Connecting-IP immer;
 * fehlt der Header (z. B. außerhalb von Cloudflare), entfallen die IP-Limits,
 * statt alle Clients in einen gemeinsamen Bucket zu sperren.
 * IPv6 wird auf das /64-Präfix gekürzt, weil ein Anschluss meist ein ganzes
 * /64-Netz erhält und sonst beliebig viele Adressen wechseln könnte.
 */
export function clientIp(request) {
  const ip = (request.headers.get('CF-Connecting-IP') || '').trim().toLowerCase();
  if (!ip) return null;
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = ip.includes('::') ? 8 - headParts.length - tailParts.length : 0;
  const groups = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** Eine Regel { bucket, max, windowMs } für ein Limit aus LIMITS und einen Schlüssel. */
export function rule(name, key) {
  return { bucket: `${name}:${String(key).toLowerCase().slice(0, 100)}`, ...LIMITS[name] };
}

/**
 * Trägt einen Versuch in alle Buckets ein, sofern keiner davon sein Limit
 * erreicht hat. Liefert { ids } bei Erfolg oder { retryAfter } (Sekunden),
 * wenn mindestens ein Bucket gesperrt ist.
 */
export async function reserveAttempt(env, rules, now = Date.now()) {
  const conditions = rules
    .map(() => '(SELECT COUNT(*) FROM auth_attempts WHERE bucket = ? AND created_at > ?) < ?')
    .join(' AND ');
  const insert = env.DB.prepare(
    `INSERT INTO auth_attempts (bucket, created_at)
     SELECT column1, ? FROM (VALUES ${rules.map(() => '(?)').join(', ')})
     WHERE ${conditions}
     RETURNING id`
  ).bind(
    now,
    ...rules.map((r) => r.bucket),
    ...rules.flatMap((r) => [r.bucket, now - r.windowMs, r.max])
  );
  // Alte Einträge nebenbei aufräumen, damit die Tabelle klein bleibt.
  const prune = env.DB.prepare('DELETE FROM auth_attempts WHERE created_at <= ?').bind(now - LONGEST_WINDOW_MS);
  const [, inserted] = await env.DB.batch([prune, insert]);
  if (inserted.results.length === rules.length) {
    return { ids: inserted.results.map((row) => row.id) };
  }
  return { retryAfter: await retryAfterSeconds(env, rules, now) };
}

// Sekunden, bis jeder gesperrte Bucket wieder unter seinem Limit liegt:
// Der max-jüngste Versuch im Fenster muss herausfallen.
async function retryAfterSeconds(env, rules, now) {
  let waitMs = 0;
  for (const r of rules) {
    const row = await env.DB.prepare(
      `SELECT created_at FROM auth_attempts WHERE bucket = ? AND created_at > ?
       ORDER BY created_at DESC LIMIT 1 OFFSET ?`
    )
      .bind(r.bucket, now - r.windowMs, r.max - 1)
      .first();
    if (row) waitMs = Math.max(waitMs, row.created_at + r.windowMs - now);
  }
  return Math.max(1, Math.ceil(waitMs / 1000));
}

/** Nimmt Versuche zurück (eigene ids) und leert optional ganze Buckets. */
export async function releaseAttempts(env, ids, clearBuckets = []) {
  const stmts = [];
  if (ids.length) {
    stmts.push(env.DB.prepare(`DELETE FROM auth_attempts WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids));
  }
  for (const bucket of clearBuckets) {
    stmts.push(env.DB.prepare('DELETE FROM auth_attempts WHERE bucket = ?').bind(bucket));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export function tooManyAttempts(retryAfter) {
  return json({ error: TOO_MANY_MESSAGE }, 429, { 'Retry-After': String(retryAfter) });
}
