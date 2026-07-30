// Gemeinsame Hilfsfunktionen für die Pages Functions API.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function apiError(message, status = 400) {
  return json({ error: message }, status);
}

export function randomToken(bytes = 24) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Alphabet ohne verwechselbare Zeichen (kein O/0, I/1, ...)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomGameCode(length = 5) {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function randomDie() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % 6) + 1;
}

// --- Passwörter (PBKDF2 über WebCrypto) ---

const PBKDF2_ITERATIONS = 100000;

export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Auth ---

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 Tage

export function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/** Liefert den eingeloggten Benutzer oder null. */
export async function getUser(env, request) {
  const token = bearerToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.created_at, s.token
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  )
    .bind(token, Date.now())
    .first();
  return row || null;
}

export function validName(name) {
  const n = String(name || '').trim();
  return n.length >= 2 && n.length <= 20 ? n : null;
}
