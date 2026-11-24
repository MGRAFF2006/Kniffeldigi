<p align="center">
  <img src="docs/logo.svg" alt="Würfelblock" width="420">
</p>

# 🎲 Würfelblock

**Echte Würfel. Ein gemeinsamer digitaler Block.**

Ihr spielt Kniffel oder Yatzy am Tisch, teilt einen Spielcode und tragt eure Punkte am eigenen Handy ein. Alle sehen den gemeinsamen Spielstand; Summen, Bonus und Rangliste berechnet die App. Für eine Runde über Distanz gibt es auch einen digitalen Würfelmodus.

Vanilla JavaScript im Browser, ein **Cloudflare Worker** für die API und **D1** für die Daten. Kein Frontend-Build nötig.

## Eine Runde spielen

1. Spiel erstellen und **Kniffel** oder **Yatzy** auswählen.
2. Den Spielcode mit den Mitspielern teilen.
3. Mit echten Würfeln spielen und die Punkte auf dem eigenen Bogen eintragen.

Ein Zuschauer-Link (`/#/watch/CODE`) zeigt den Spielstand ohne Anmeldung.

## Was der Block kann

- **Gemeinsam spielen:** Jeder führt seinen eigenen Bogen; ausgefüllte Felder und Spielstände werden laufend aktualisiert.
- **Richtig rechnen:** Serverseitige Wertungsprüfung, automatische Summen, Bonuspunkte und Abschluss, sobald alle Bögen voll sind.
- **Einträge korrigieren:** Punkte ändern oder zurücknehmen, auch nach Spielende. Rangliste und protokollierte Ergebnisse werden neu berechnet.
- **Digital würfeln:** Drei Würfe pro Zug, Würfel festhalten, Krypto-Zufall und Kniffel-Jokerregel.
- **Konten und Historie:** Siege, Bestwerte und vergangene Ergebnisse für eingeloggte Spieler; Anzeigename, Passwort und Tintenfarbe sind einstellbar.
- **Papier statt Dashboard:** Ein klassischer Wertungsblock mit handschriftlichen Namen und klar getrennten Spielerspalten.

Live-Updates verwenden leichtgewichtiges Polling. Hat sich seit der letzten Version nichts geändert, antwortet die API mit `204`; WebSockets sind dafür nicht nötig.

## Lokal starten

Voraussetzung: Node.js mit npm.

```bash
git clone https://github.com/MGRAFF2006/Kniffeldigi.git
cd Kniffeldigi
npm ci
npm run dev
```

Öffne <http://localhost:8788>. Die lokale D1-Datenbank wird automatisch angelegt.

In einem zweiten Terminal, während der Dev-Server läuft:

```bash
npm test
```

Das führt die Regeltests und den API-End-to-End-Test aus. Nur die Regeltests:

```bash
node tests/rules.test.mjs
```

## Auf Cloudflare deployen

1. Mit `npx wrangler login` anmelden und mit `npm run db:create` eine eigene D1-Datenbank erstellen.
2. Die zurückgegebene `database_id` in `wrangler.toml` eintragen. Die vorhandene ID gehört zur ursprünglichen Bereitstellung.
3. Mit `npm run deploy` den Worker samt statischen Assets veröffentlichen.

Das Datenbankschema wird beim ersten API-Request angelegt. Alternativ kann es vorab mit `npx wrangler d1 execute wuerfelblock-db --remote --file=schema.sql` erstellt werden.

Für automatische Deployments das Repository über die Git-Integration im Cloudflare-Dashboard mit einem Worker verbinden: kein Build-Kommando, Deploy-Kommando `npx wrangler deploy`.

Die Handler unter `functions/api/` bleiben mit Pages Functions kompatibel. Bei einer Bereitstellung als Cloudflare Pages muss das D1-Binding `DB` in den Projekteinstellungen gesetzt werden; das Ausgabeverzeichnis ist `public`.

## Schutz vor Passwort-Raten

Die API zählt Anmelde- und Registrierungsversuche in der D1-Tabelle `auth_attempts` (gleitendes Zeitfenster, alte Einträge werden automatisch gelöscht). Ist ein Limit erreicht, antwortet sie mit `429` und `Retry-After`:

| Aktion | Limit |
| :--- | :--- |
| Login, Fehlversuche pro Benutzername und IP | 10 in 15 Minuten |
| Login, Fehlversuche pro Benutzername über alle IPs | 100 in 15 Minuten |
| Login, Fehlversuche pro IP über alle Benutzernamen | 50 in 15 Minuten |
| Passwort ändern, falsches aktuelles Passwort pro Konto | 10 in 15 Minuten |
| Registrierungsversuche pro IP | 20 pro Stunde |

IPv6-Adressen zählen pro /64-Netz, IPv4-gemappte IPv6-Adressen (`::ffff:1.2.3.4`) wie die IPv4-Adresse. Während einer Sperre gilt auch das richtige Passwort als gesperrt, damit die Sperre nichts verrät.

Ein erfolgreicher Login leert nur den Zähler für diesen Benutzernamen von dieser IP. Der Zähler pro Benutzername über alle IPs und der Zähler pro IP behalten ihre Fehlversuche.

Bleibendes Risiko: Wer von einer IP aus einen fremden Benutzernamen falsch eingibt, sperrt ihn nur für diese IP. Ein Angreifer mit vielen IPs kann einen Benutzernamen aber weiterhin für jeweils 15 Minuten sperren, solange er 100 Fehlversuche pro 15 Minuten aufrechterhält.

Die IP kommt aus dem Header `CF-Connecting-IP`. Die Cloudflare-Edge setzt ihn bei jeder Anfrage an den Worker (auf `*.workers.dev` und eigenen Domains) und überschreibt dabei einen vom Client mitgeschickten Wert. Fehlt der Header oder ist er ungültig (nur außerhalb von Cloudflare, z. B. unter `wrangler dev`), entfallen die Limits pro IP; der strenge Login-Zähler gilt dann pro Benutzername allein, die Limits pro Konto gelten weiter. Die Werte stehen in `functions/api/_lib/throttle.js`.

## Im Code

| Pfad | Aufgabe |
| :--- | :--- |
| `public/` | Statisches Frontend mit Hash-Routing |
| `public/js/rules.js` | Gemeinsame Wertungs- und Validierungslogik für Client und Server |
| `functions/api/_lib/rules.js` | Re-Export der gemeinsamen Regeln für die API |
| `functions/api/_lib/game.js` | Spielzustand, Züge und Persistenz |
| `functions/api/_lib/schema.js` | D1-Schema und Bootstrap beim ersten Request |
| `functions/api/_lib/throttle.js` | Versuchslimits für Login, Passwortänderung und Registrierung |
| `src/worker.js` | Worker-Einstiegspunkt und API-Routing |
| `schema.sql` | D1-Schema |
| `tests/` | Regeltests, API-Test und Screenshot-Skript |

## Kniffel und Yatzy im Vergleich

| | Kniffel | Yatzy |
| :--- | :--- | :--- |
| Felder | 13 | 15 |
| Bonus oben | +35 ab 63 | +50 ab 63 |
| Paare | – | Ein Paar / Zwei Paare (Augensumme) |
| Pasche | Summe **aller** Würfel | Summe **nur** der gleichen Würfel |
| Kleine Straße | 4 in Folge · 30 Punkte | exakt 1–2–3–4–5 · 15 Punkte |
| Große Straße | 5 in Folge · 40 Punkte | exakt 2–3–4–5–6 · 20 Punkte |
| Full House | 25 Punkte fest | Summe aller Würfel |
| 5 Gleiche | Kniffel · 50 | Yatzy · 50 |
| Extra | Jeder weitere Kniffel +50 (Jokerregel) | – |

Im Digitalmodus gibt ein weiterer Kniffel +50 Bonuspunkte und darf als Joker in ein freies Feld eingetragen werden: Full House 25, Straßen 30/40, sonst normale Wertung. Im Analogmodus gibt es dafür den „+50“-Knopf in der Kniffel-Bonus-Zeile; auch diese Boni lassen sich zurücknehmen.
