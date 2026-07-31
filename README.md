# Würfelblock – Kniffel & Yatzy, analog würfeln, digital eintragen

Der digitale Würfelblock: Ihr spielt **Kniffel** oder **Yatzy** mit echten Würfeln am Tisch –
der Block wird digital geführt. Mitspieler treten per Spielcode bei, tragen Punkte am eigenen
Handy ein und sehen live, was den anderen noch fehlt. Summen, Bonus und Endstand rechnet die
App. Optional kann auch komplett digital gewürfelt werden.

Läuft auf **Cloudflare** (Worker + statische Assets + D1).

## Features

- **Analogmodus:** Spiel erstellen, Code teilen, Mitspieler kommen jederzeit dazu. Unmögliche
  Werte werden serverseitig abgelehnt. Das Spiel endet, sobald alle Bögen voll sind.
- **Korrekturen:** Eigene Einträge ändern oder rückgängig machen; Kniffel-Bonus (+50) per Knopf.
- **Digitalmodus:** Rundenbasiertes Würfeln mit Festhalten, 3 Würfen und Jokerregel.
- **Zwei Bögen:** Kniffel und Yatzy mit den jeweiligen Originalregeln.
- **Live zuschauen:** `/#/watch/CODE` – ohne Anmeldung.
- **Konten & Historie:** Registrierung/Login, Siege, Bestwerte, Durchschnitt.
- **Einstellungen:** Anzeigename, Passwort, Tintenfarbe der „Handschrift“.

## Projektstruktur

```
public/               Statisches Frontend (SPA, Vanilla JS, Hash-Routing)
  js/rules.js         Wertungs-/Validierungslogik (eine Quelle für Client & Server)
functions/api/        API-Handler (Pages-Functions-Format, vom Worker gemappt)
  _lib/rules.js       Re-Export von public/js/rules.js
  _lib/game.js        Spiel-Engine (Züge, Validierung, Persistenz)
  _lib/schema.js      D1-Schema (Bootstrap beim ersten Request)
src/worker.js         Worker-Einstieg: Assets + API-Routing
schema.sql            Schema-Referenz für manuelle D1-Migrationen
tests/                Unit-Tests (Regeln) + API-E2E + optionales Screenshot-Skript
```

Live-Updates über leichtes Polling (`GET /api/games/CODE/state?since=VERSION` → `204` wenn
unverändert) – ohne Websockets, im kostenlosen Tarif nutzbar.

## Lokal entwickeln

```bash
npm install
npm run dev          # http://localhost:8788 (lokale D1 wird automatisch angelegt)
npm test             # Regel-Unit-Tests + API-E2E (Dev-Server muss laufen)
```

## Auf Cloudflare deployen

Cloudflare Worker mit statischen Assets – passend zur Git-Integration
(*Workers & Pages → Create → Workers → Connect to Git*), Deploy-Kommando: `npx wrangler deploy`.

1. **D1 anlegen** (einmalig): Dashboard *Storage & Databases → D1 → Create*, Name
   `wuerfelblock-db` – oder `npx wrangler login && npm run db:create`. Die `database_id` in
   `wrangler.toml` eintragen und committen.
2. **Deployen:** Git-Integration (Deploy: `npx wrangler deploy`) oder `npm run deploy`.

Schema wird beim ersten API-Request angelegt. Optional manuell:
`npx wrangler d1 execute wuerfelblock-db --remote --file=schema.sql`.

> Die Handler liegen im `functions/`-Ordner im Pages-Functions-Format. Ein klassisches
> Pages-Projekt (Ausgabe: `public`) geht ebenfalls, dann D1-Binding `DB` manuell setzen.

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

Kniffel-Jokerregel (Digitalmodus): Ein weiterer Kniffel gibt +50 und darf als Joker in ein
freies Feld. Im Analogmodus gibt es den „+50“-Knopf in der Kniffel-Bonus-Zeile.
