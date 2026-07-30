# 🎲 Würfelblock – Kniffel & Yatzy online

Der digitale Würfelblock: **Kniffel** und **Yatzy** mit Freunden spielen – mit Spielcode zum Beitreten,
Live-Zuschauermodus, Kontosystem zum Protokollieren der Spiele und einem Design wie ein echter Spielblock.
Gebaut für **Cloudflare Pages** (Pages Functions + D1).

## Features

- **Zwei Spiele, zwei echte Bögen** – Kniffel (Dreier-/Viererpasch, Straßen 30/40, Bonus +35,
  Kniffel-Bonus & Jokerregel) und Yatzy (Ein Paar/Zwei Paare, Straßen 15/20 fest, Bonus +50).
  Die Wertung passiert immer serverseitig, gewürfelt wird mit Krypto-Zufall.
- **Spielcode** – Spiel erstellen, 5-stelligen Code teilen, bis zu 8 Spieler treten über die Startseite bei.
- **Live zuschauen** – jedes Spiel hat einen Zuschauer-Link (`/#/watch/CODE`). Zuschauer sehen den
  Spielbogen, die Würfel und das Protokoll in Echtzeit, ganz ohne Anmeldung.
- **Konten & Historie** – Registrierung/Login (PBKDF2-gehashte Passwörter, Sitzungs-Tokens).
  Ergebnisse eingeloggter Spieler werden protokolliert: Siege, Bestwerte, Durchschnitt, komplette Liste.
- **Einstellungen** – Anzeigename & Passwort ändern, Tintenfarbe für die „Handschrift“ wählen,
  Spielhistorie einsehen.
- **Design** – weißes Spielblatt-Design mit Papierlinien, Handschrift-Font und animierten Würfeln.

## Projektstruktur

```
public/            Statisches Frontend (SPA, Vanilla JS, Hash-Routing)
  js/rules.js      Client-Kopie der Wertungslogik (nur für die Punktevorschau)
functions/api/     Cloudflare Pages Functions (REST-API)
  _lib/rules.js    Wertungslogik – die maßgebliche Quelle
  _lib/game.js     Spiel-Engine (Züge, Validierung, Persistenz)
  _middleware.js   Schema-Anlage + Fehlerbehandlung
schema.sql         D1-Schema (Referenz; wird auch automatisch angelegt)
tests/             Unit-Tests (Regeln) + End-to-End-Test (API) + Screenshot-Skript
```

Live-Updates laufen über leichtgewichtiges Polling (`GET /api/games/CODE/state?since=VERSION`
antwortet mit `204`, solange sich nichts geändert hat) – das kommt ohne Websockets/Durable Objects aus
und funktioniert damit komplett im kostenlosen Pages-Tarif.

## Lokal entwickeln

```bash
npm install
npm run dev          # http://localhost:8788 (lokale D1-Datenbank wird automatisch angelegt)
npm test             # Regel-Unit-Tests + API-End-to-End-Test (Dev-Server muss laufen)
```

## Auf Cloudflare Pages deployen

1. **D1-Datenbank anlegen** (einmalig):

   ```bash
   npx wrangler login
   npm run db:create        # gibt die database_id aus
   ```

   Die ausgegebene `database_id` in `wrangler.toml` eintragen.

2. **Deployen** – zwei Möglichkeiten:
   - **Git-Integration (empfohlen):** Repository im Cloudflare-Dashboard unter
     *Workers & Pages → Create → Pages → Connect to Git* verbinden.
     Build-Kommando leer lassen, Build-Ausgabeverzeichnis: `public`.
   - **Direkt per CLI:** `npm run deploy`

3. **D1-Binding prüfen:** Im Pages-Projekt unter *Settings → Bindings* muss die Datenbank als
   `DB` gebunden sein (bei Deploys mit `wrangler.toml` passiert das automatisch).

Das Datenbankschema wird beim ersten API-Request automatisch angelegt – es ist keine manuelle
Migration nötig. Wer mag: `npx wrangler d1 execute wuerfelblock-db --remote --file=schema.sql`.

## Regeln im Detail

| | Kniffel | Yatzy |
|---|---|---|
| Felder | 13 | 15 |
| Bonus oben | +35 ab 63 | +50 ab 63 |
| Paare | – | Ein Paar / Zwei Paare (Augensumme) |
| Pasche | Summe **aller** Würfel | Summe **nur** der gleichen Würfel |
| Kleine Straße | 4 in Folge · 30 Punkte | exakt 1-2-3-4-5 · 15 Punkte |
| Große Straße | 5 in Folge · 40 Punkte | exakt 2-3-4-5-6 · 20 Punkte |
| Full House | 25 Punkte fest | Summe aller Würfel |
| 5 Gleiche | Kniffel · 50 | Yatzy · 50 |
| Extra | Jeder weitere Kniffel +50 (Jokerregel) | – |

Hinweis zur Kniffel-Jokerregel: Ein weiterer Kniffel gibt +50 Bonuspunkte und darf als Joker in ein
beliebiges freies Feld eingetragen werden (Full House 25, Straßen 30/40, sonst normale Wertung).
