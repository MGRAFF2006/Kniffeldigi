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
//
// Login-Fehlversuche zählen dreifach:
// - loginUserIp: pro Benutzername *und* IP, streng. Ein Angreifer auf einer IP
//   sperrt den Namen damit nur für sich, nicht für die echte Person anderswo.
// - loginUser: pro Benutzername über alle IPs, deutlich höher. Bremst verteiltes
//   Raten; ein Angreifer mit vielen IPs kann den Namen damit weiterhin sperren.
// - loginIp: pro IP über alle Namen (Passwort-Spraying).
export const LIMITS = {
  loginUserIp: { max: 10, windowMs: 15 * MINUTE },
  loginUser: { max: 100, windowMs: 15 * MINUTE },
  loginIp: { max: 50, windowMs: 15 * MINUTE },
  passwordUser: { max: 10, windowMs: 15 * MINUTE },
  registerIp: { max: 20, windowMs: 60 * MINUTE },
};

const LONGEST_WINDOW_MS = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));

export const TOO_MANY_MESSAGE = 'Zu viele Versuche. Bitte später erneut versuchen.';

/**
 * Client-IP für die Pro-IP-Limits. Auf Cloudflare setzt die Edge
 * CF-Connecting-IP bei jeder Anfrage von außen und überschreibt dabei einen vom
 * Client mitgeschickten Wert. Fehlt der Header oder ist er keine gültige IP
 * (nur außerhalb der Cloudflare-Edge möglich; `wrangler dev` setzt ohne Header
 * 127.0.0.1), entfallen die IP-Limits, statt alle Clients in einen gemeinsamen
 * Bucket zu sperren.
 */
export function clientIp(request) {
  return normalizeIp(request.headers.get('CF-Connecting-IP'));
}

/**
 * Bringt eine IP in die Form, nach der gezählt wird:
 * - IPv4 als a.b.c.d (ohne führende Nullen),
 * - IPv4-gemappte IPv6-Adressen (::ffff:1.2.3.4 oder ::ffff:102:304) als IPv4,
 * - übrige IPv6-Adressen als /64-Präfix, weil ein Anschluss meist ein ganzes
 *   /64-Netz erhält und sonst beliebig viele Adressen wechseln könnte.
 * Liefert null für alles, was keine gültige IP ist.
 */
export function normalizeIp(raw) {
  const ip = String(raw ?? '').trim().toLowerCase();
  if (!ip) return null;
  if (!ip.includes(':')) {
    const v4 = ipv4Octets(ip);
    return v4 ? v4.join('.') : null;
  }
  const groups = ipv6Groups(ip);
  if (!groups) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

function ipv4Octets(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const octets = parts.map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

// Die acht 16-Bit-Gruppen einer IPv6-Adresse (auch mit "::" und mit
// IPv4-Schreibweise am Ende) oder null, wenn die Adresse ungültig ist.
function ipv6Groups(ip) {
  let text = ip;
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const v4 = ipv4Octets(text.slice(lastColon + 1));
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (![...head, ...tail].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array(missing).fill('0'), ...tail].map((g) => parseInt(g, 16));
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
  return { retryAfter: await retryAfterSeconds(env, rules) };
}

// Sekunden, bis jeder gesperrte Bucket wieder unter seinem Limit liegt: Der
// max-jüngste Versuch im Fenster (bei vollem Bucket der älteste gezählte) muss
// herausfallen. Mit frischem "jetzt" gerechnet, weil zwischen Prüfung und
// dieser Abfrage Zeit vergangen sein kann; begrenzt auf 1 s bis zur Fensterlänge.
async function retryAfterSeconds(env, rules) {
  const now = Date.now();
  let waitMs = 0;
  for (const r of rules) {
    const row = await env.DB.prepare(
      `SELECT created_at FROM auth_attempts WHERE bucket = ? AND created_at > ?
       ORDER BY created_at DESC LIMIT 1 OFFSET ?`
    )
      .bind(r.bucket, now - r.windowMs, r.max - 1)
      .first();
    if (row) waitMs = Math.max(waitMs, Math.min(row.created_at + r.windowMs - now, r.windowMs));
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
