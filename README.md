# MStreamParserWeb

Web based service to process and utilize various music streaming APIs.
Includes web based integration of ImmersiveMusicDisplay (https://github.com/Erik-M1999/ImmersiveMusicDisplay)

**Current TODO\*:**

**Roadmap:**

- [X] Implement basic Web and Spotify API connection.
- [X] Do not forget to NOT commit API key.
- [X] Integrate and expand ImmersiveMusicDisplay functionality.
- [X] Set up optional login with databases.
- [X] Testing
- [ ] Revamp Interface design
- [ ] Set up API for external tool access. Test it with 3Ds Max.
- [ ] Add parser to convert playlists into plain .txt or .csv files.
- [ ] Trial a different API, especially last.fm.

-> When repo has reached a working state with all mandatory function implemented, add other APIs.

####

## Class progress and report (DE)

### 01)

### 02)

> "Braucht eure App SSR/Next.js – oder wäre Vite eigentlich besser geeignet? Begründet anhand von SEO und Interaktivität."

Vite wäre grundsätzlich besser geeignet, da der Inhalt der Webapp hauptsächlich erst nach API Aktionen entsteht und der größere Anteil hinter Login versteckt ist. Daher ist der SEO Anteil nahezu irrelevant.

### 03)

**Resources:**

- **User:** Accounts
- **Connection:** External Service wie Spotify. OAuth Tokens für User inbegriffen
- **Folder:** Selbstverschachtelte Bibliothek
- **Template:** Hauptressource
- **ApiKey:** Persönlicher Key für externer Zugriff

**Hierarchie:** Dem User gehört Connection, Folder, Template, ApiKey. Folder kann mehrere Unterordner und Template haben, aber jeder ist immer nur einem parentId zugewiesen. Template gehören immer maximal nur einem Folder (Es gibt die Möglichkeit Template direkt im Root des User zu speichern).

**Strukturentscheidung — Flaches Design mit Query-Parametern:**
Da der User in der Lage ist "Folder Management" zu machen, indem es Dateien und Ordner in der Bibliothek verschieben, duplizieren oder löschen kann, eignen sich hierbei die Query Parameters besser.

**CRUD:**

```
GET    /api/templates       - alle Templates zurückgeben. Alternative per Ordner mit ?folderId=
GET    /api/templates/:id   - einzelnes Template zurückgeben, 404 wenn nicht gefunden
POST   /api/templates       - neues Template speichern, 400 wenn Titel oder Datei fehlt
PUT    /api/templates/:id   - Template komplett ersetzen, 404 wenn Zieldatei fehlt
DELETE /api/templates/:id   - Template löschen, 204 als Antwort
```

**Bonus:** Das gleiche CRUD kann man für die Resource Folder anlegen, da sie die gleicher Beziehung zum User hat und ebenfalls optional die Templates verschachtelt.

### 04)

**Datenschema der Datenbank:**

| users | connection | folders | templates | api_keys |
|---|---|---|---|---|
| id | id | id | id | id |
| email | userId | userId | userId | userId |
| username | provider | name | name | name |
| password | accessToken | parentId | svg | KeyHash |
| createdAt | refreshToken | createdAt | mode | createdAt |
|  | expiresAt |  | folderId | lastUsedAt |
|  | scopes |  | created/updatedAt |  |

**Beziehungen:**
Von Users aus, 1:n. Gleiche gilt für Folders -> Mehrere Resourcen an einem gebunden.
Templates sind immer "unique", daher n:1.

**Nicht leere Felder:**

| users | connection | folders | templates | api_keys |
|---|---|---|---|---|
| email | userId | userId | userId | userId |
| username | provider | name | name | KeyHash |
| password | accessToken |  | svg |  |
|  | refreshToken |  |  |  |
|  | expiresAt |  |  |  |
|  | scopes |  |  |  |

**Architekturentscheidung:**
Daten die in der Datenbank liegen müssen sind auf jeden Fall die Users, Connection, Template, API Keys. Die werden für die Queries gebraucht.
Allerdings die erzeugten oder gespeicherten Bilddateien bzw. Binärdaten wären viel sinnvoller in einem S3 zu speichern, da wir keine binäre Daten in der Datenbank speichern wollen.
Daten wie Tokens für API Zugriff könnte man ins Redis verlagern, da es nicht ewig lebende Daten sind und immer wieder ausgetauscht werden. Würde auch schnelleren Zugriff anbieten (?).

### 05)

Das Problem bisher war der Spotify Token. Dieser wurde nicht einer Session / User zugewiesen, sondern sobald ein User sich verbunden hat, war dieser Token verfügbar für alle User.
Sprich der Nutzer könnte sämtliche Daten von anderen einsehen wie `/api/spotify/me`.
Zudem könnte es gespeicherte Templates einsehen sowohl als auch anhand des fremden API Token neue Templates generieren.

Die JWT-Payload wird mit einer Signatur versendet. Diese wird auf dem Server mit `HMAC-SHA256(header + "." + payload, JWT_SECRET)` berechnet und dann verglichen.
Versucht jemand die userId auszutauschen, dann ist die Signatur ungültig.
Eine Signatur nachzubauen ist ebenfalls unmöglich, der JWT_SECRET liegt nur im Server und wird niemals weitergeleitet. Es zu brute-forcen ist unmöglich lang.

| OWASP Top 10 | Status | Detail (code) |
|---|---|---|
| A01 – Broken Access Control | OK (after fix) | templates/folders queries scoped by userId; Spotify + /immersive/render now require authenticate + per-user Connection. Was broken (global token). |
| A02 – Cryptographic Failures | OK | Passwords bcrypt (cost 12); JWT_SECRET in .env; cookie HttpOnly + secure in prod. Spotify access/refresh tokens now encrypted at rest (AES-256-GCM, crypto.ts, key from TOKEN_ENC_KEY). |
| A03 – Injection | OK | All DB access via Prisma (parameterized — no string-built SQL); uploaded SVG rendered as `<img>` (no script execution) -> no SQLi/XSS path. |
| A07 – Identification & Auth Failures | OK | Login error identical for wrong-user vs wrong-password (no user enumeration); 24h HttpOnly cookie; login/register rate-limited (10 attempts / 15 min per IP). Password min length 8. |

### 06)

**Test-Pyramide**
| Ebene | Was testen wir bei uns? | Tool |
|---|---|---|
| Unit | Reine Frontend Logik ohne DB testen: Ordnerstruktur durch `buildPaths()` validieren, SVG Platzhalter `fillTemplate()` testen, Passwort Validierung und zuletzt `encryptSecret`/`decryptSecret` Round-Trip testen.  | Vitest |
| Integration | Routing und Queries testen: Anlegen von Templates `POST /api/templates`, Löschen von Ornder löscht auch alle Unterordner und Inhalte, `authenticate` soll ungültige Tokens ablehnen, Ownership-Scoping im Sinne von Inhalt von andere User ist nicht zugänglich | Vitest |
| E2E | Login Flow: Login -> Spotify soll verbunden sein -> ImmersiveMusicDisplay -> Ordner A anlegen -> Seite neuladen -> Ordner A soll da sein -> Datei von _debug in einen neuen Unterordner B in A kopieren und umbennen -> Seite neuladen -> Ordner A und Unterordner B mit neu benannter SVG Datei existieren | Cypress |

**Was würde den meisten Schaden anrichten, wenn es Änderung kaputt macht?**

1. **Template/Ordner CRUD Persistenz**: Bricht die ganze Logik wie zum Beispiel Speichern, Verschieben oder Löschen, dann kann es dazu führen, dass der Benutzer nach neuladen der Seiten die ganze Bibliothek verliert.
2. **Auth und Ownership**: Das Scoping von `authenticate` + `userId` muss richtig sitzen, sonst kann es dazu führen, dass die gespeicher Elemente sowie Tokens für andere User sichtbar werden. Gleiche Lücke wie von Session 05 Security.

### 07)
Architekturentscheidung: SSE
In der Anwendung ist ein User in seiner Session isoliert, es gibt keine User -> User Kommunikation, sondern nur Server -> Client. Da wir aber ein "Listener" haben, das anzeigt was gerade auf Spotify spielt, wäre das ein Feature für SEE.

Da Spotifys API leider kein Push hat, wird das abfragen über serverseitiges Polling gemacht und das Frontend bekommt die Daten dann in Echtzeit sobald es bereit ist. 

### 08)
Gleiches Szenario wie bei 07:
Die App handelt sich um Single-Users. Es gibt keine User -> User Kommunikation. Allerdings werden zwei Benachritigungs Events nötig sein:

1. Registrierung und Bestätigung
2. Benachrichtigung, dass ein API Token erstellt wurde

Für Beide Zwecke reicht eine E-Mail Benachrichtigung komplett aus

### 09)

### 10)

### 11)

### 12)
