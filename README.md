# MStreamParserWeb
Web based service to process and utilize various music streaming APIs.
Includes web based integration of ImmersiveMusicDisplay (https://github.com/Erik-M1999/ImmersiveMusicDisplay)

Current TODO*:


Roadmap:
- [X] Implement basic Web and Spotify API connection.
- [X] Do not forget to NOT commit  API key.
- [X] Integrate and expand ImmersiveMusicDisplay functionality.
- [X] Set up optional login with databases.
- [ ] *Testing
- [ ] Revamp Interface design
- [ ] Set up API for external tool access. Test it with 3Ds Max.
- [ ] Add parser to convert playlists into plain .txt or .csv files.
- [ ] Trial a different API, especially last.fm.

-> When repo has reached a working state with all mandatory function implemented, add other APIs.


####

Class progress and report (DE):

01)

02) 
"Braucht eure App SSR/Next.js – oder wäre Vite eigentlich besser geeignet? Begründet anhand von SEO und Interaktivität."

Vite wäre grundsätzlich besser geeignet, da der Inhalt der Webapp hauptsächlich erst nach API Aktionen entsteht und der größere Anteil hinter Login versteckt ist. Daher ist der SEO Anteil nahezu irrelevant.

03) 
Resources: 
User: Accounts
Connection: External Service wie Spotify. OAuth Tokens für User inbegriffen
Folder: Selbstverschachtelte Bibliothek
Template: Hauptressource
ApiKey: Persönlicher Key für externer Zugriff

Hierarchie: Dem User gehört Connection, Folder, Template, ApiKey. Folder kann mehrere Unterordner und Template haben, aber jeder ist immer nur einem parentId zugewiesen. Template gehören immer maximal nur einem Folder (Es gibt die Möglichkeit Template direkt im Root des User zu speichern)

Strukturentscheidung: Flaches Design mit Query-Parametern:
Da der User in der Lage ist "Folder Management" zu machen, indem es Dateien und Ordner in der Bibliothek verschieben, duplizieren oder löschen kann, eignen sich hierbei die Query Parameters besser. 

CRUD:
GET /api/templates          - alle Templates zurückgeben. Alternative per Ornder mit ?folderId=
GET /api/templates/:id      - einzelnes Template zurückgeben, 404 wenn nicht gefunden
POST /api/templates         - neues Template speichern, 400 wenn Titel oder Datei fehlt
PUT /api/templates/:id      - Template komplett ersetzen, 404 wenn Zieldatei fehlt
DELETE /api/templates/:id   - Template löschen, 204 als Antwort

Bonus:
Das gleiche CRUD kann man für die Resource Folder anlegen, da sie die gleicher Beziehung zum User hat und ebenfalls optional die Templates verschachtelt.

04) 
Datenschema der Datenbank:

| users | connection | folders | templates | api_keys |
|---|---|---|---|---|
| id | id | id | id | id |
| email | userId | userId | userId | userId |
| username | provider | name | name | name |
| password | accessToken | parentId | svg | KeyHash |
| createdAt | refreshToken | createdAt | mode | createdAt |
|  | expiresAt |  | folderId | lastUsedAt |
|  | scopes |  | created/updatedAt |  |

Beziehungen:
Von Users aus, 1:n. Gleiche gilt für Folders -> Mehrere Resourcen an einem gebunden
Templates sind immer "unique" daher n:1

Nicht leere Felder:

| users | connection | folders | templates | api_keys |
|---|---|---|---|---|
| email | userId | userId | userId | userId |
| username | provider | name | name | KeyHash |
| password | accessToken |  | svg |  |
|  | refreshToken |  |  |  |
|  | expiresAt |  |  |  |
|  | scopes |  |  |  |

Architekturentscheidung:
Daten die in der Datenbank liegne müssen sind auf jeden Fall die Users, Connection, Template, API Keys. Die werden für die Queries gebraucht.
Allerdings die erzeugten oder gespeicherten Bilddateien bzw Binärdaten wären viel sinnvoller in einem S3 zu speichern, da wir keine binäre Daten in der Datenbank speichern wollen.
Daten wie Tokens für API Zugriff könnte man ins Redis verlagern, da es nicht ewig lebende Daten sind und immer wieder ausgetauscht werden. Würde auch schnelleren Zugriff anbieten (?)

05)
Das Problem bisher war der Spotify Token. Dieser wurde nicht einer Session / User zugewiesen, sondern sobald ein User sich verbunden hat, war dieser Token verfügbar für alle User.
Sprich der Nutzer könnte sämtliche Daten von anderen einsehen wie /api/spotify/me.
Zudem könnte es gespeicherte Templates einsehen sowohl als auch Anhand des fremden API Token neue Templates generieren.

Die JWT-Payload wird mit einer Signatur versendet. Diese wird auf dem Server mit HMAC-SHA256(header + "." + payload, JWT_SECRET) berechnet und dann verglichen.
Versucht jemand die userId auszutauschen, dann ist die Signatur ungültig.
Eine Signatur nachzubauen ist ebenfalls unmöglich, der JWT_SECRET liegt nur im Server und wird niemals weitergeleitet. Es zu brute-forcen ist unmöglich lang.

| OWASP Top 10 | Status | Detail (code) |
|---|---|---|
| A01 – Broken Access Control | OK (after fix) | templates/folders queries scoped by userId; Spotify + /immersive/render now require authenticate + per-user Connection. Was broken (global token). |
| A02 – Cryptographic Failures | OK | Passwords bcrypt (cost 12); JWT_SECRET in .env; cookie HttpOnly + secure in prod. Spotify access/refresh tokens now encrypted at rest (AES-256-GCM, crypto.ts, key from TOKEN_ENC_KEY). |
| A03 – Injection | OK | All DB access via Prisma (parameterized — no string-built SQL); uploaded SVG rendered as <img> (no script execution) -> no SQLi/XSS path. |
| A07 – Identification & Auth Failures | OK | Login error identical for wrong-user vs wrong-password (no user enumeration); 24h HttpOnly cookie; login/register rate-limited (10 attempts / 15 min per IP). Password min length 8. |


06)

07)

08)

09)

10)

11)

12)
