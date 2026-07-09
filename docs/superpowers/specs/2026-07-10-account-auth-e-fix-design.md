# Design — Account/Auth, persistenza e fix calcolatore/PDF

Data: 2026-07-10
Progetto: lavallonea-roi (Node/Express + `node:sqlite`, frontend vanilla, deploy Railway).

Due blocchi indipendenti. **Blocco A** (fix veloci) si implementa e verifica per primo; **Blocco B** (account + persistenza) è un sottosistema a sé, implementato dopo con più agenti.

Vincoli trasversali: **nessuna nuova dipendenza npm** (auth con `node:crypto`, email via `fetch` a Resend). UI in italiano. Palette brand MYLAV (grafite `#26262a`, blu `#0f76bc`, rosso `#ce181e`). Non fare push finché l'utente non lo autorizza.

---

## BLOCCO A — Fix calcolatore + PDF

### A1. Bug: la riga del calcolatore non si azzera/aggiorna al cambio del nome esame

**Sintomo attuale:** se scrivo un esame e poi cancello o cambio il nome, la riga mantiene i vecchi prezzi (concorrenza e MYL).

**Comportamento voluto:**
- Nome esame **svuotato** → la riga si azzera: `listino_concorrenza`, `sconto_concorrenza`, `listino_lav`, `prezzo_scontato_lav` tornano vuoti; i flag `dataset.auto` sui campi prezzo tornano `'0'`; la riga resta presente ma vuota.
- Nome esame **cambiato** in un esame diverso → prima si azzerano i valori della riga (anche quelli inseriti a mano), poi si riesegue la cascata: prezzi MYL (base/piano via `aggiornaPrezziAutomatici`) e prezzi concorrenza (via `aggiornaMatchConcorrente`, solo se esiste mappatura) del **nuovo** esame.
- Nome invariato → nessun azzeramento (comportamento attuale).

**Implementazione** (`public/app.js`):
- Su ogni riga tracciare l'ultimo esame processato in `dataset.lastEsame` sull'input esame (o attributo sulla `<tr>`).
- Nell'handler `blur` del campo esame (dentro `initRoiEvents`) / all'inizio di `aggiornaPrezziAutomatici(tr)`:
  - `const nuovo = esameInp.value.trim(); const vecchio = esameInp.dataset.lastEsame || '';`
  - Se `nuovo !== vecchio`: azzerare i 4 campi prezzo della riga (`value=''`, `dataset.auto='0'`, rimuovere classi tipo `roi-prezzo-nuovo`), aggiornare lo stato `S.roi.righe` corrispondente, poi `aggiornaRigaDOM(tr)`.
  - Aggiornare `esameInp.dataset.lastEsame = nuovo`.
  - Se `nuovo === ''`: dopo l'azzeramento, ritornare senza cascata (riga vuota). Aggiornare comunque totali, consiglio, classifica.
  - Se `nuovo !== ''`: procedere con la cascata prezzi esistente (che ora parte da campi puliti, quindi riflette il nuovo esame).
- Verificare che `syncRoiStateFromDOM`/`calcolaRoiTotali`/`mostraClassificaPiani`/`mostraConsiglioTotale` vengano riaggiornati dopo l'azzeramento.

**Test/verifica (browser, dati reali):**
1. Scrivo esame A → prezzi MYL compaiono; se mappato, concorrenza compare.
2. Cancello il nome → riga azzerata (tutti i prezzi vuoti), totali aggiornati.
3. Scrivo esame B (diverso) sopra ad A → la riga mostra i prezzi di B (MYL sempre; concorrenza se mappato), non residui di A.
4. Ripeto con un valore concorrenza inserito a mano su A → cambiando in B, il valore manuale di A sparisce.

### A2. PDF: un solo pulsante "Resoconto struttura"

- `public/app.js` (`renderFoglio`): rimuovere il bottone "PDF completo"; rinominare "PDF dottore" in **"Resoconto struttura"** (testo esatto, senza la parola "PDF"). Icona 📄 ammessa.
- `server.js`: **rimuovere del tutto** la rotta `POST /api/pdf/completo/:fileId/:foglio` e la funzione `buildHtmlCompleto`. La rotta dottore e `buildHtmlDottore` restano invariate.
- Verifica: la vista file mostra un solo pulsante "Resoconto struttura"; il download genera il PDF dottore brandizzato; nessun riferimento residuo a `completo` in `app.js`/`server.js`.

---

## BLOCCO B — Account, autenticazione, persistenza

### B0. Principi

- Link universale: chiunque apra il sito senza sessione valida vede la schermata di autenticazione.
- Dati privati per account; catalogo MYLAV condiviso e in sola lettura per gli utenti.
- Zero nuove dipendenze: hashing e token con `node:crypto`; email con `fetch` a Resend.

### B1. Modello dati (`server.js` schema + `lib/auth.js` nuovo)

Nuovo modulo `lib/auth.js` con `ensureSchema(db)` che crea:

```
users (
  id             INTEGER PK AUTOINCREMENT,
  email          TEXT UNIQUE NOT NULL,          -- normalizzata lowercase/trim
  pass_hash      TEXT NOT NULL,                 -- scrypt: "salt:hash" hex
  recovery_hash  TEXT NOT NULL,                 -- scrypt del codice univoco
  recovery_lookup TEXT UNIQUE NOT NULL,         -- sha256(codice) per lookup nel recupero totale
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
)

sessions (
  token       TEXT PRIMARY KEY,                 -- randomBytes(32) hex
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)

reset_codes (
  id         INTEGER PK AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  code       TEXT NOT NULL,                      -- 6 cifre
  expires_at INTEGER NOT NULL,                   -- epoch ms
  used       INTEGER NOT NULL DEFAULT 0
)
```

Aggiunta di `user_id INTEGER REFERENCES users(id)` alle tabelle dati esistenti: `strutture`, `concorrenti`, `prezzi_esami_custom`. Le tabelle figlie (`file_caricati`, `dati_foglio`, `esami_concorrente`) ereditano il proprietario tramite il padre e vengono filtrate con JOIN.

Vincoli aggiornati: da `strutture.nome UNIQUE` a `UNIQUE(user_id, nome)`; idem `concorrenti` → `UNIQUE(user_id, nome)`.

Catalogo condiviso invariato: `piani_sconto`, `esami_riferimento`, `prezzi_piano_esame`.

**Migrazione:** additiva e non distruttiva. Rimuovere il blocco attuale che fa `DROP TABLE dati_foglio` (righe ~59-81 di `server.js`) e sostituirlo con `ALTER TABLE ... ADD COLUMN` idempotenti (guardati da try/catch o da controllo su `PRAGMA table_info`). Le righe legacy con `user_id IS NULL` (dati di test) vengono eliminate una tantum al boot.

### B2. Crittografia e sessioni (`lib/auth.js`)

- `hashPassword(pw)` → `scryptSync(pw, salt16, 64)`; salva `"<saltHex>:<hashHex>"`. `verifyPassword(pw, stored)` con `timingSafeEqual`.
- `genToken()` → `randomBytes(32).toString('hex')`.
- `genRecoveryCode()` → 12 caratteri base32 leggibili (no O/0/I/1), raggruppati (es. `K7M4-Q2XR-9T5P`). Salvato come `recovery_hash` (scrypt) + `recovery_lookup` (sha256 hex, UNIQUE).
- `genResetCode()` → 6 cifre.
- Middleware `requireAuth(req,res,next)`: legge il token da header `Authorization: Bearer <token>` (o `X-Auth-Token`); risolve `sessions`→`users`; setta `req.user`; altrimenti `401`.
- Regola password server-side: `≥8 caratteri, ≥1 cifra, ≥1 carattere speciale` (validata anche client-side).

### B3. Rotte auth (`server.js`)

Tutte sotto `/api/auth`, `express.json()`:
- `POST /register {email, password}` → valida email/password, email unica (409 se esiste), crea utente, genera codice univoco, invia email col codice, crea sessione. Risponde `{token, email, recoveryCode}` (il codice mostrato a schermo una volta).
- `POST /login {email, password}` → verifica, crea sessione, `{token, email}`. Credenziali errate → 401.
- `POST /logout` (auth) → cancella la sessione corrente.
- `GET /me` (auth) → `{email}` (per validare il token al boot del client).
- `POST /request-reset {email}` → se l'email esiste, genera reset code (scadenza 30 min), invia email. Risposta sempre 200 generica (no user-enumeration).
- `POST /reset-password {email, code, newPassword}` → verifica code valido/non scaduto/non usato → aggiorna `pass_hash`, invalida il code.
- `POST /recover-full {recoveryCode, newEmail, newPassword}` → lookup via `sha256(recoveryCode)`; se trovato e `verifyPassword(recoveryCode, recovery_hash)` ok → imposta nuova email (409 se già in uso da altri) e nuova password. Il codice univoco resta invariato.

Rotte dati esistenti: applicare `requireAuth` e filtrare per `req.user.id`. Il catalogo MYLAV in lettura (`GET /api/piani`, prezzo, autocomplete, prezzo-base) resta accessibile anche all'ospite (non scrive nulla).

### B4. Email (Resend)

- `lib/mailer.js`: `sendMail({to, subject, html})` → `fetch('https://api.resend.com/emails', {headers:{Authorization: Bearer ${RESEND_API_KEY}}, ...})`.
- Env: `RESEND_API_KEY`, `MAIL_FROM` (es. `MYLAV ROI <noreply@dominio>`; in test `onboarding@resend.dev` invia solo alla propria mail).
- Se `RESEND_API_KEY` mancante: in locale logga l'email in console invece di inviarla (così lo sviluppo funziona senza chiave); in produzione l'assenza è un errore loggato ma non blocca la registrazione (il codice è comunque mostrato a schermo).
- Due template: "Il tuo codice di recupero MYLAV" (registrazione) e "Reimposta la password" (reset code). Brand MYLAV minimale.

### B5. Frontend (`public/app.js`, `index.html`, `style.css`)

- **Boot:** all'avvio, se in `localStorage` c'è `authToken`, chiamare `GET /api/auth/me`; se ok → app normale; altrimenti mostrare schermata auth. Tutte le `fetch` verso rotte dati includono l'header del token (wrapper `api()` esistente esteso).
- **Schermata auth** (overlay a tutta pagina, gestita client-side, non una route separata):
  - Card centrata su sfondo neutro; **logo MYLAV in primo piano** in alto, titolo/banner sotto, tutto centrato; colori brand + barra brand rossa/blu.
  - Tab **Accedi** / **Registrati**; link **Entra come ospite**; link **Password dimenticata?** e **Ho dimenticato email e password**.
  - Registrazione: campi email, password (con hint requisiti e validazione live), conferma. Dopo la registrazione: schermata che mostra il **codice univoco** con avviso "salvalo, serve per il recupero" + conferma di averlo salvato.
  - Validazione password client-side: ≥8, ≥1 cifra, ≥1 speciale.
- **Modalità ospite:** flag client `S.guest = true`; niente token; le azioni di salvataggio (Salva calcolo, crea struttura, gestione concorrenti/piani import) sono disabilitate o mostrano "Accedi per salvare". Il calcolatore funziona; nulla è persistito.
- **Icona account (omino) in basso a destra nella sidebar:** menu con **Accedi**, **Registrati**, **Entra come ospite**, **Logout**. Logout → cancella token, torna alla schermata auth. Mostra l'email dell'utente loggato.
- **Recuperi:** due form (password via email; totale via codice) raggiungibili dalla schermata auth.

### B6. Persistenza deploy (compito 3)

- Codice: `DB_PATH`/`UPLOADS_DIR` già da env → nessuna modifica se non rimuovere la migrazione distruttiva (vedi B1).
- **Azione manuale Railway (documentata, non codice):** creare un Volume montato su `/data`; impostare env `DB_PATH=/data/database.sqlite`, `UPLOADS_DIR=/data/uploads`, `RESEND_API_KEY`, `MAIL_FROM`. Da lì i dati persistono tra i deploy.
- Aggiungere note in `README`/`docs` con questi passi.

### B7. Sicurezza

- Password/codici mai in chiaro nel DB (scrypt). Confronti con `timingSafeEqual`.
- Reset e recupero non rivelano se un'email esiste (risposte generiche).
- Token sessione ad alta entropia, senza scadenza (requisito "resta loggato"); logout cancella la riga.
- Rate-limit leggero in-memory su login/reset (contatore per IP+email) per limitare brute force — best-effort, senza dipendenze.

### B8. Test

- `lib/auth.test.js` (`node:test`): hash/verify password (ok/ko), validazione regola password, genToken/genRecoveryCode univoci, lookup recupero via sha256, verifica reset code (valido/scaduto/usato), unicità email.
- Rotte e UI: verifica end-to-end nel browser (register → logout → login → dati isolati per utente → ospite non salva → reset password → recupero totale).

---

## Ordine di esecuzione

1. **Blocco A** — implementare, verificare live, committare.
2. **Blocco B** — implementare con più agenti (schema/auth lib → mailer → rotte → frontend → schermata brand → verifica), poi documentare i passi Railway. Push solo su autorizzazione esplicita.

## Compatibilità e vincoli

Nessuna nuova dipendenza npm. Testo UI in italiano. Catalogo MYLAV condiviso invariato. Migrazioni additive e non distruttive. Ospite senza persistenza. Account attivo subito (nessuna verifica email obbligatoria).
