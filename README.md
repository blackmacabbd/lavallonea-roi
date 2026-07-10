# MYLAV ROI

Dashboard ROI per MYLAV — uso privato locale. Node/Express + `node:sqlite`, frontend vanilla JS.

## Comandi

```bash
npm install
npm start   # avvia il server (node server.js)
npm run dev # avvia con nodemon (hot reload)
npm test    # esegue la suite di test (node --test lib/*.test.js)
```

## Persistenza e configurazione Railway

Per far funzionare correttamente l'app in produzione su Railway (dati persistenti tra i deploy e invio email) servono un Volume e alcune variabili d'ambiente.

- Creare un **Volume** Railway montato su `/data`.
- Variabili d'ambiente:
  - `DB_PATH=/data/database.sqlite`
  - `UPLOADS_DIR=/data/uploads`
  - `RESEND_API_KEY=<chiave>`
  - `MAIL_FROM=MYLAV ROI <noreply@dominio-verificato>`

**Nota:** senza dominio verificato su Resend, le email si inviano solo alla propria email di account (mittente di test `onboarding@resend.dev`).

Con il volume, i dati (utenti, strutture, calcoli, concorrenti) persistono tra i deploy. Senza volume, il container si ricrea e i dati si azzerano.

**Nota sviluppo locale:** senza `RESEND_API_KEY` le email vengono loggate in console (fallback), l'app funziona comunque.
