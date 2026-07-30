# 🎲 Würfelblock – Kniffel & Yatzy, analog würfeln, digital eintragen

Der digitale Würfelblock: Ihr spielt **Kniffel** oder **Yatzy** ganz normal mit echten Würfeln am Tisch –
aber der Block wird digital geführt. Jeder Spieler tritt mit dem Spielcode bei, trägt seine Punkte am
eigenen Handy ein und alle sehen live, was den anderen noch fehlt. Summen, Bonus und Endstand rechnet
der Block automatisch. Wer mag, kann alternativ auch komplett digital würfeln lassen.

Läuft auf **Cloudflare** (Worker + statische Assets + D1).

## Features

- **Analogmodus (Hauptnutzung):** Spiel erstellen, Code teilen, Mitspieler kommen jederzeit dazu.
  Jeder füllt seinen eigenen Bogen; unmögliche Werte werden serverseitig abgelehnt
  (z. B. 7 Einser oder Full House mit 24 Punkten). Fortschritt (ausgefüllte Felder) ist für alle sichtbar,
  das Spiel endet automatisch, sobald alle Bögen voll sind. Kniffel-Bonus (+50 je weiterem Kniffel) per Knopf.
- **Fehler korrigieren:** Eigene ausgefüllte Felder antippen, um den Wert zu ändern oder den Eintrag
  vollständig rückgängig zu machen. Auch ein beendetes Analogspiel wird für eine Korrektur wieder geöffnet;
  Rangliste und protokollierte Ergebnisse werden anschließend sauber neu berechnet. Kniffel-Boni lassen sich
  ebenfalls zurücknehmen.
- **Digitalmodus (optional):** Die App würfelt rundenbasiert mit Krypto-Zufall – für Runden über Distanz,
  inkl. Würfel festhalten, 3 Würfen und Jokerregel.
- **Zwei echte Bögen:** Kniffel (Pasche = Summe aller Würfel, Straßen 30/40, Bonus +35) und
  Yatzy (Ein Paar/Zwei Paare, Straßen 15/20 fest, Full House = Augensumme, Bonus +50).
- **Live zuschauen:** Jedes Spiel hat einen Zuschauer-Link (`/#/watch/CODE`) – ohne Anmeldung.
- **Konten & Historie:** Registrierung/Login (PBKDF2-gehashte Passwörter). Ergebnisse eingeloggter
  Spieler werden protokolliert: Siege, Bestwerte, Durchschnitt, komplette Liste.
- **Einstellungen:** Anzeigename & Passwort ändern, Tintenfarbe der „Handschrift“, Spielhistorie.
- **Design:** reduziert wie ein klassischer schwarzweißer Spielblock: kompakte Tabellen, gerade
  Formularfelder, zurückhaltende Graustufen und ein durchgehendes 28-Pixel-Grundlinienraster, an dem
  Papierlinien und Schrift ausgerichtet sind. Die fünf Würfel auf dem Deckblatt lassen sich antippen
  und rollen als kleine Spielerei.

## Projektstruktur

```
public/            Statisches Frontend (SPA, Vanilla JS, Hash-Routing)
  js/rules.js      Client-Kopie der Wertungs-/Validierungslogik (nur für die UI)
functions/api/     API-Handler (kompatibel mit Cloudflare Pages Functions)
  _lib/rules.js    Wertungslogik – die maßgebliche Quelle
  _lib/game.js     Spiel-Engine (Einträge, Züge, Validierung, Persistenz)
src/worker.js      Worker-Einstiegspunkt: statische Assets + API-Routing
schema.sql         D1-Schema (Referenz; wird auch automatisch angelegt)
tests/             Unit-Tests (Regeln) + End-to-End-Test (API) + Screenshot-Skript
```

Live-Updates laufen über leichtgewichtiges Polling (`GET /api/games/CODE/state?since=VERSION`
antwortet mit `204`, solange sich nichts geändert hat) – das kommt ohne Websockets/Durable Objects aus
und funktioniert komplett im kostenlosen Tarif.

## Lokal entwickeln

```bash
npm install
npm run dev          # http://localhost:8788 (lokale D1-Datenbank wird automatisch angelegt)
npm test             # Regel-Unit-Tests + API-End-to-End-Test (Dev-Server muss laufen)
```

## Auf Cloudflare deployen

Das Projekt ist ein **Cloudflare Worker mit statischen Assets** – genau passend für die
Git-Integration im Dashboard (*Workers & Pages → Create → Workers → Connect to Git*),
deren Standard-Deploy-Kommando `npx wrangler deploy` ist.

1. **D1-Datenbank anlegen** (einmalig, Pflicht!):
   - Im Dashboard: *Storage & Databases → D1 → Create database*, Name: `wuerfelblock-db` –
     oder per CLI: `npx wrangler login && npm run db:create`
   - Die angezeigte **database_id (UUID)** in `wrangler.toml` bei `database_id` eintragen
     (aktuell steht dort ein Platzhalter aus Nullen) und die Änderung committen/pushen.

2. **Deployen** – zwei Möglichkeiten:
   - **Git-Integration:** Repository im Dashboard mit einem Worker-Projekt verbinden.
     Build-Kommando leer lassen, Deploy-Kommando: `npx wrangler deploy` (Standard).
     Jeder Push deployt automatisch.
   - **Direkt per CLI:** `npm run deploy`

Das Datenbankschema wird beim ersten API-Request automatisch angelegt – keine manuelle Migration nötig.
Wer mag: `npx wrangler d1 execute wuerfelblock-db --remote --file=schema.sql`.

> Hinweis: Die API-Handler liegen weiterhin im `functions/`-Ordner im Pages-Functions-Format.
> Wer stattdessen ein klassisches **Pages**-Projekt anlegt (Build-Ausgabe: `public`), kann das tun,
> muss dann aber das D1-Binding `DB` manuell in den Pages-Projekteinstellungen setzen.

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

Hinweis zur Kniffel-Jokerregel (Digitalmodus): Ein weiterer Kniffel gibt +50 Bonuspunkte und darf als
Joker in ein beliebiges freies Feld eingetragen werden (Full House 25, Straßen 30/40, sonst normale
Wertung). Im Analogmodus gibt es dafür den „+50“-Knopf in der Kniffel-Bonus-Zeile.
