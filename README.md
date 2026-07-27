# MStreamParserWeb

Web based service to process and utilize various music streaming APIs.
Includes web based integration of ImmersiveMusicDisplay (https://github.com/Erik-M1999/ImmersiveMusicDisplay)

**Current TODO\*:**

**Improvements\*:**

**Interface:**
- Library throws Error when User has no Folder or File saved yet

**External API:**
- Make 3Ds Max Pre-Render Script communicate with .ini that's set by the UI
- E-Mail Notification when a new API Token has been set
- Integrate File Browser for UI Tool


**Roadmap:**

- [X] Implement basic Web and Spotify API connection.
- [X] Do not forget to NOT commit API key.
- [X] Integrate and expand ImmersiveMusicDisplay functionality.
- [X] Set up optional login with databases.
- [X] Testing
- [X] Revamp Interface design
- [X] Set up API for external tool access. Test it with 3Ds Max. (Can be improved further)
- [X] Add parser to convert playlists into plain .txt or .csv files.
- [X] Implement a welcome page (Potentially add gifs and pictures)
- [X] Trial a different API: last.fm.

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
**Architekturentscheidung: SSE**

In der Anwendung ist ein User in seiner Session isoliert, es gibt keine User -> User Kommunikation, sondern nur Server -> Client. Da wir aber ein "Listener" haben, das anzeigt was gerade auf Spotify spielt, wäre das ein Feature für SEE.

Da Spotifys API leider kein Push hat, wird das abfragen über serverseitiges Polling gemacht und das Frontend bekommt die Daten dann in Echtzeit sobald es bereit ist. 

### 08)
Gleiches Szenario wie bei 07:

Die App handelt sich um Single-Users. Es gibt keine User -> User Kommunikation. Allerdings werden zwei Benachritigungs Events nötig sein:

1. Registrierung und Bestätigung
2. Benachrichtigung, dass ein API Token erstellt wurde

Für Beide Zwecke reicht eine E-Mail Benachrichtigung komplett aus

### 09)
**Bestandsaufnahme**

| Datei | Wofür ist sie verantwortlich? | Greift sie auf Daten anderer Bereiche zu? |
|---|---|---|
| routes/auth.js | Register, Login, Logout | Nein, stößt aber mail.ts an für Wilkommen-Mail |
| routes/immersive.js | Rendering: Template + API Daten -> gefülltes SVG / PNG | Ruft Spotify Funktionen zum Rendern auf |
| routes/sampleTemplates.js | Read-Only Demo Daten | Nein (Auf Festplatte gespeicherte Elemente) |
| templates.js | Template Management | Liest `Folder` für `folderId` |
| routes/folders.js | Ordner Management | Liest `Template` für Unterstruktur |
| routes/spotify.js | Spotify OAuth, Tokene Management und API Anfragen | Nein |
| server.js | CORS, Router Mounting, `/api/tools`: beide Main Tools auf Dashboard, `/api/connections`: Externe API Tools | `/api/connections` ruft externe APIs bzw. Spotify |


**Analysis — business logic to extract & cross-domain access**

Handlers that contain business logic that belongs in its own service function:

- `auth.ts` (register/login): input validation, duplicate check, `bcrypt`, `jwt.sign`, and the Prisma calls are all inline → `authService.register()/login()` (cookie-setting stays in the route).
- `spotify.ts` (OAuth callback): the token exchange + token encryption + `connection.upsert` is one big inline block → `spotifyService.connect(userId, code)`. (`refreshAndStore`, `getValidAccessToken`, `getNowPlaying/Queue/Playlists` are already extracted functions — good.)
- `immersive.ts` (render): token check + `buildFill` + cover-inlining + `fillTemplate` + error mapping live in the handler → `renderingService.render(userId, svg, mode)`.
- `templates.ts` / `folders.ts`: validation + `resolveFolder`/`resolveParent` + every Prisma call sit in the handlers → `libraryService`.
- `server.ts`: the `/api/connections` logic belongs in the Spotify module, not the composition root.

Cross-domain DB access — essentially none (no real violations):

- `templates.ts` reads `Folder` and `folders.ts` reads `Template`, but Folder + Template are the **same context (Library)**, so it's intra-context — which is exactly why they stay in one module.
- `immersive.ts` gets its Spotify data by **calling Spotify's functions**, never touching the `Connection` table directly → already the correct service-to-service pattern.
- Only mild reach: `server.ts`'s `/api/connections` calls `isSpotifyConnected()` (fine for a composition root, cleaner inside the Spotify module).

Conclusion: the codebase is already clean on cross-domain *data* access; the Session-09 work is pulling business logic out of fat route handlers into per-context services.

**Bounded Contexts**

| Auth Context | Library Context | Rendering Context | Spotify Context |
|---|---|---|---|
| User | Template | fillTemplates() | Connection |
| Register / Login | Folder | render(svg, data) | OAuth access / refresh |
| Session / JWT | _debug Demo |  | now-playing / queue / playlists |
| Authenticate |  |  |  |

Kontexte die miteinander Kommunizieren: `Rendering -> Spotify`: Zum Rendern eines Template fragt Rendering bei Spotify zu einem `userId` die nötigen Daten für den aktiven Modus ab. Zum Beispiel Current Song benötige es nur `artist, title, album, coverUrl`.

**Modul-Schnittstellen**

```
auth.service.ts
  öffentlich:   register(), login(), TOKEN_TTL_SECONDS


spotify.service.ts
  öffentlich:   isSpotifyConnected(), getValidAccessToken(), getNowPlaying(),
            getQueue(), getPlaylists(), toNowPlayingPayload(), getProfile(),
            getDebugInfo(), beginConnect(), isValidAuthState(),
            clearAuthState(), exchangeCodeAndStore(), isConfigured(), SCOPES
  intern: getConnection(), refreshAndStore(), basicAuthHeader(),
            normTrack(), rawSpotifyGet(), pendingStates


library.service.ts
  öffentlich:   listTemplates(), getTemplate(), createTemplate(), updateTemplate(),
            deleteTemplate(), listFolders(), getFolder(), listFolderTemplates(),
            createFolder(), updateFolder(), deleteFolder()
  intern: parseTemplateBody(), parseFolderName(), resolveFolder(), resolveParent()


rendering.service.ts
  öffentlich:   render()
  intern: buildFill(), fetchCoverDataUri(), isConflict()
```

> "Welches Modul wäre am einfachsten zu extrahieren, wenn man es irgendwann als eigenen Service deployen müsste?"

Das `Rendering`, da es komplett "stateless" ist. Es hat keinen Zugriff auf die Datenbank oder andere Services. Es empfängt nur Daten von Externe APIs (Spotify) und `fillTemplate()` und verarbeitet diese.

### 10)
Ersetzt durch Session 11
### 11)
**Überblick**

| Bestandteil | Läuft als | Hostname / Pfad | Wird ausgeliefert von |
|---|---|---|---|
| Frontend (Next.js) | statisches Build | m1999-tools.de | Express (express.static) |
| Backend (Express) | Node.js-App | m1999-tools.de/api | konsoleH Node.js |
| Datenbank (SQL) | MySQL | localhost:3306 | konsoleH DB-Verwaltung |

### 12)
