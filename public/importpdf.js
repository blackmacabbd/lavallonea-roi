/* Import PDF condiviso — analisi guidata, revisione e conferma.
 *
 * Componente unico usato da Gestione piani, Gestione concorrenti e Macchinari.
 * Il PDF non viene mai riscaricato dal server: il browser rende il file
 * locale scelto dall'utente, mentre le coordinate delle righe riconosciute
 * arrivano dall'analisi lato server (punti PDF a scala 1, origine in alto a
 * sinistra).
 *
 * Uso:  ImportPdf.avvia({ entita: 'piano' | 'concorrente' | 'macchina', nomeDefault, file, alFine })
 * Senza `file` il documento viene chiesto all'utente; con `file` si usa quello
 * (serve quando il documento e' gia' stato scelto da un input della pagina).
 * `alFine` viene chiamata dopo un import confermato con successo.
 *
 * Nulla viene scritto nel catalogo finche' l'operatore non conferma
 * esplicitamente: l'analisi resta una bozza lato server.
 */
(function () {
  'use strict';

  const PDFJS_SRC = '/vendor/pdf.min.js';
  const PDFJS_WORKER = '/vendor/pdf.worker.min.js';

  const SCALE_MIN = 0.5;
  const SCALE_MAX = 3;
  const SCALE_STEP = 0.25;

  // Deve restare allineata a ENTITA in lib/importbozze.js: e' il server, non
  // qui, a decidere dove finiscono le righe. Un valore fuori da questa lista
  // (o assente, come nelle chiamate storiche di Gestione piani) ricade su
  // 'piano', il comportamento di sempre.
  const ENTITA_VALIDE = ['piano', 'concorrente', 'macchina'];

  // Fascia, sopra e sotto la vista, di pagine tenute gia' disegnate.
  const MARGINE_ANTEPRIMA = 800;
  // Intervallo minimo fra due ricalcoli durante lo scorrimento.
  const MS_RICALCOLO = 120;

  // Le quattro fasi mostrate all'operatore. Il progresso per pagina compare
  // dove il lavoro e' davvero per pagina: la preparazione dell'anteprima.
  // L'estrazione e il riconoscimento avvengono in un'unica chiamata server,
  // quindi lì si mostra la dimensione del documento, non un avanzamento finto.
  const FASI = [
    { chiave: 'carica',    etichetta: 'Caricamento del file' },
    { chiave: 'estrai',    etichetta: 'Estrazione del testo' },
    { chiave: 'riconosci', etichetta: 'Riconoscimento esami e pacchetti' },
    { chiave: 'pronto',    etichetta: 'Pronto per la revisione' }
  ];

  let S = null;          // stato dell'import in corso
  let contatoreRighe = 0; // id locali delle righe in revisione

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const eur = n => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Interpreta un prezzo scritto a mano in formato italiano o anglosassone.
  // Deve restare allineata a parsePrezzo di lib/pdfclassifica.js: qui decide
  // cosa viene inviato, la' cosa viene salvato. "1.234,56" vale 1234.56.
  const numero = v => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    let t = String(v == null ? '' : v).replace(/[\s €]/g, '');
    if (!t) return NaN;
    const ultimaVirgola = t.lastIndexOf(',');
    const ultimoPunto = t.lastIndexOf('.');
    if (ultimaVirgola >= 0 && ultimoPunto >= 0) {
      t = ultimaVirgola > ultimoPunto
        ? t.replace(/\./g, '').replace(',', '.')
        : t.replace(/,/g, '');
    } else if (ultimaVirgola >= 0) {
      t = (t.match(/,/g) || []).length > 1 ? t.replace(/,/g, '') : t.replace(',', '.');
    } else if (ultimoPunto >= 0 && /^\d{1,3}(\.\d{3})+$/.test(t)) {
      t = t.replace(/\./g, '');
    }
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : NaN;
  };

  function authHeaders() {
    return (typeof window.authHeaders === 'function') ? window.authHeaders() : {};
  }

  function caricaScript(src) {
    return new Promise((risolvi, rifiuta) => {
      if (document.querySelector(`script[src="${src}"]`)) return risolvi();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => risolvi();
      s.onerror = () => rifiuta(new Error('Libreria PDF non caricata'));
      document.head.appendChild(s);
    });
  }

  async function pdfjs() {
    if (!window.pdfjsLib) {
      await caricaScript(PDFJS_SRC);
      if (!window.pdfjsLib) throw new Error('Libreria PDF non disponibile');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    }
    return window.pdfjsLib;
  }

  // ── Finestra ──────────────────────────────────────────────────────────
  function montaFinestra(titolo, sottotitolo) {
    chiudi();
    const ov = document.createElement('div');
    ov.className = 'imp-overlay';
    ov.id = 'imp-overlay';
    ov.innerHTML = `
      <div class="imp-modal" role="dialog" aria-modal="true" aria-label="${esc(titolo)}">
        <div class="imp-head">
          <div>
            <div class="imp-title">${esc(titolo)}</div>
            <div class="imp-sub" id="imp-sub">${esc(sottotitolo || '')}</div>
          </div>
          <button class="imp-x" type="button" aria-label="Chiudi">✕</button>
        </div>
        <div class="imp-body" id="imp-body"></div>
      </div>`;
    document.body.appendChild(ov);
    document.body.classList.add('imp-aperto');
    ov.querySelector('.imp-x').addEventListener('click', chiudiConVerifica);
    ov.addEventListener('click', e => { if (e.target === ov) chiudiConVerifica(); });
    document.addEventListener('keydown', suEsc);
    return ov;
  }

  function suEsc(e) { if (e.key === 'Escape') chiudiConVerifica(); }

  // La revisione non e' salvata da nessuna parte: chiuderla per sbaglio dopo
  // aver corretto venti righe sarebbe una perdita di lavoro silenziosa.
  function chiudiConVerifica() {
    const modificato = S && S.righe && S.righe.some(r => r.modificata || r.origine !== 'estratta');
    if (modificato && !confirm('Le correzioni fatte in questa revisione non sono salvate. Chiudere comunque?')) return;
    chiudi();
  }

  function chiudi() {
    // Prima di smontare, via le superfici dei canvas: su un documento lungo
    // resterebbero appesi decine di MB per ogni finestra aperta e chiusa.
    liberaPagine();
    const ov = document.getElementById('imp-overlay');
    if (ov) ov.remove();
    document.body.classList.remove('imp-aperto');
    document.removeEventListener('keydown', suEsc);
    S = null;
  }

  function corpo(html) {
    const b = document.getElementById('imp-body');
    if (b) b.innerHTML = html;
    return b;
  }

  // ── Fase 1-4: avanzamento ─────────────────────────────────────────────
  function renderFasi() {
    const attiva = FASI.findIndex(f => f.chiave === S.fase);
    corpo(`
      <div class="imp-progresso">
        <ol class="imp-fasi">
          ${FASI.map((f, i) => `
            <li class="imp-fase ${i < attiva ? 'imp-fase-fatta' : i === attiva ? 'imp-fase-corso' : ''}">
              <span class="imp-fase-n">${i < attiva ? '✓' : i + 1}</span>
              <span class="imp-fase-testo">
                ${esc(f.etichetta)}
                ${i === attiva && S.nota ? `<span class="imp-fase-nota">${esc(S.nota)}</span>` : ''}
              </span>
            </li>`).join('')}
        </ol>
        <div class="imp-barra-avanz">
          <div class="imp-barra-riemp" style="width:${S.percento}%"></div>
        </div>
      </div>`);
  }

  function fase(chiave, nota, percento) {
    if (!S) return;
    S.fase = chiave;
    S.nota = nota || '';
    if (percento != null) S.percento = Math.round(percento);

    if (document.querySelector('.imp-fasi')) { aggiornaFasi(); return; }

    // Passati alla revisione, la lista delle fasi non e' piu' in pagina: qui
    // l'avanzamento dell'anteprima si scrive accanto al titolo del documento.
    // Ricreare la schermata di caricamento cancellerebbe la revisione.
    const nota2 = document.getElementById('imp-nota-anteprima');
    if (nota2) nota2.textContent = S.nota;
  }

  // Aggiornamento puntuale: ridisegnare la lista a ogni pagina farebbe
  // lampeggiare la barra.
  function aggiornaFasi() {
    const attiva = FASI.findIndex(f => f.chiave === S.fase);
    document.querySelectorAll('.imp-fase').forEach((li, i) => {
      li.classList.toggle('imp-fase-fatta', i < attiva);
      li.classList.toggle('imp-fase-corso', i === attiva);
      const n = li.querySelector('.imp-fase-n');
      if (n) n.textContent = i < attiva ? '✓' : String(i + 1);
      let nota = li.querySelector('.imp-fase-nota');
      if (i === attiva && S.nota) {
        if (!nota) {
          nota = document.createElement('span');
          nota.className = 'imp-fase-nota';
          li.querySelector('.imp-fase-testo').appendChild(nota);
        }
        nota.textContent = S.nota;
      } else if (nota) nota.remove();
    });
    const riemp = document.querySelector('.imp-barra-riemp');
    if (riemp) riemp.style.width = `${S.percento}%`;
  }

  function statoErrore(messaggio) {
    corpo(`<div class="imp-banner imp-banner-errore imp-banner-solo">
        <div class="imp-banner-ico">⚠️</div>
        <div>
          <div class="imp-banner-tit">Non riesco a leggere questo PDF</div>
          <div class="imp-banner-msg">${esc(messaggio)}</div>
        </div>
      </div>
      <div class="imp-foot"><div class="imp-foot-dx">
        <button type="button" class="btn-primary" id="imp-chiudi-err">Chiudi</button>
      </div></div>`);
    const b = document.getElementById('imp-chiudi-err');
    if (b) b.addEventListener('click', chiudi);
  }

  // ── Avvio ─────────────────────────────────────────────────────────────
  async function avvia(opzioni) {
    const opts = opzioni || {};
    const entita = ENTITA_VALIDE.includes(opts.entita) ? opts.entita : 'piano';
    const file = opts.file || await scegliFile();
    if (!file) return;

    montaFinestra('Importa listino PDF', file.name);
    S = {
      entita, file,
      nomeDefault: opts.nomeDefault || file.name.replace(/\.pdf$/i, ''),
      alFine: typeof opts.alFine === 'function' ? opts.alFine : null,
      fase: 'carica', nota: '', percento: 4,
      buffer: null, analisi: null, righe: [], coord: new Map(),
      scala: 1.2, pdfDoc: null, selezionata: null,
      pagine: [], dpr: 1,
      mostraScartate: false, inCorso: false,
      // Solo per l'entita' 'macchina': elenco dei concorrenti fra cui scegliere
      // la provenienza. Il caricamento parte subito ma non deve rallentare
      // l'apertura della finestra (vedi caricaProvenienza).
      provenienza: entita === 'macchina' ? { stato: 'carico', lista: [] } : null
    };
    renderFasi();
    if (entita === 'macchina') caricaProvenienza();

    // Apertura locale del PDF in parallelo all'analisi: serve il numero di
    // pagine da mostrare subito e il documento per l'anteprima, senza allungare
    // l'attesa complessiva.
    const localePronto = (async () => {
      S.buffer = await file.arrayBuffer();
      const lib = await pdfjs();
      S.pdfDoc = await lib.getDocument({ data: S.buffer.slice(0) }).promise;
      if (S && S.fase === 'estrai') fase('estrai', `documento di ${S.pdfDoc.numPages} pagine`);
      return S.pdfDoc;
    })().catch(() => null);

    try {
      S.analisi = await analizza(file, entita);
    } catch (err) {
      statoErrore(err.message);
      return;
    }
    if (!S) return; // finestra chiusa durante l'attesa

    // "righe riconosciute", non "esami": il totale comprende anche le macchine,
    // e su un listino di soli analizzatori dire "esami" sarebbe falso.
    fase('riconosci', `${S.analisi.classificate} righe riconosciute su ${S.analisi.totaliTabellari} righe con prezzo`, 72);
    costruisciModello();

    await localePronto;
    if (!S) return;

    renderRevisione();
    try { await renderPdf(); }
    catch (err) {
      const cont = document.getElementById('imp-pdf');
      if (cont) cont.innerHTML = `<div class="imp-banner-msg" style="padding:16px">
        Anteprima non disponibile: ${esc(err.message)}. L'elenco estratto resta utilizzabile.</div>`;
    }
  }

  function scegliFile() {
    return new Promise(risolvi => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.pdf,application/pdf';
      inp.addEventListener('change', () => risolvi(inp.files[0] || null));
      inp.click();
    });
  }

  // XHR invece di fetch: serve l'avanzamento del caricamento, che fetch non
  // espone. Le due fasi server (estrazione e riconoscimento) tornano insieme.
  function analizza(file, entita) {
    return new Promise((risolvi, rifiuta) => {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/import-pdf/analizza?entita=${encodeURIComponent(entita)}`);
      const h = authHeaders();
      Object.keys(h).forEach(k => xhr.setRequestHeader(k, h[k]));

      xhr.upload.addEventListener('progress', e => {
        if (!e.lengthComputable || !S) return;
        const q = e.loaded / e.total;
        fase('carica', `${Math.round(q * 100)}% di ${(e.total / 1024).toFixed(0)} KB`, 4 + q * 26);
      });
      xhr.upload.addEventListener('load', () => fase('estrai', S && S.pdfDoc ? `documento di ${S.pdfDoc.numPages} pagine` : '', 34));

      xhr.addEventListener('load', () => {
        let dati = null;
        try { dati = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300 && dati) risolvi(dati);
        else rifiuta(new Error((dati && dati.error) || `Errore ${xhr.status}`));
      });
      xhr.addEventListener('error', () => rifiuta(new Error('Connessione interrotta durante il caricamento')));
      xhr.send(fd);
    });
  }

  // Elenco dei concorrenti per il selettore di provenienza (solo entita'
  // 'macchina'). Parte in parallelo all'analisi del PDF, senza bloccare
  // l'apertura della finestra: se fallisce o non e' ancora arrivato, il
  // selettore mostra solo "Le mie macchine" (vedi opzioniProvenienza).
  function caricaProvenienza() {
    fetch('/api/concorrenti', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('errore')))
      .then(lista => {
        if (!S) return; // finestra chiusa nel frattempo
        S.provenienza = { stato: 'pronto', lista: Array.isArray(lista) ? lista : [] };
        aggiornaSelettoreProvenienza();
      })
      .catch(() => {
        if (!S) return;
        S.provenienza = { stato: 'errore', lista: [] };
        aggiornaSelettoreProvenienza();
      });
  }

  // "Le mie macchine" e' sempre la prima opzione e l'unica finche' l'elenco
  // dei concorrenti non e' arrivato. Se e' arrivato ma e' vuoto, una voce non
  // selezionabile lo dichiara invece di lasciare il selettore silenziosamente
  // a una sola scelta senza spiegazione.
  function opzioniProvenienza() {
    const p = S.provenienza || { stato: 'pronto', lista: [] };
    let html = `<option value="">Le mie macchine</option>`;
    if (p.stato === 'pronto') {
      html += p.lista.length
        ? p.lista.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('')
        : `<option value="" disabled>Nessun concorrente in archivio</option>`;
    }
    // Stato 'carico' o 'errore': nessuna opzione in piu', il selettore degrada
    // a "Le mie macchine" senza bloccare l'import.
    return html;
  }

  function aggiornaSelettoreProvenienza() {
    const sel = document.getElementById('imp-provenienza');
    if (!sel) return;
    const valorePrecedente = sel.value;
    sel.innerHTML = opzioniProvenienza();
    // Se l'operatore aveva gia' scelto qualcosa prima che l'elenco arrivasse
    // (praticamente solo "Le mie macchine", l'unica opzione possibile fino ad
    // allora), la selezione resta quella.
    if (Array.from(sel.options).some(o => o.value === valorePrecedente)) sel.value = valorePrecedente;
  }

  // Modello editabile: e' questo, non l'analisi, a decidere cosa verra'
  // importato e quali riquadri restano evidenziati sul PDF.
  function costruisciModello() {
    S.coord = new Map();
    for (const r of S.analisi.righe) {
      S.coord.set(r.indice, { pagina: r.pagina, x: r.x, y: r.y, w: r.w, h: r.h, testo: r.testo });
    }
    S.righe = S.analisi.righe.filter(r => !r.scartata).map(r => ({
      id: ++contatoreRighe,
      indice: r.indice,
      nome: r.nome,
      prezzo: r.prezzo,
      confidenza: r.confidenza,
      motivo: r.motivo,
      origine: 'estratta',
      modificata: false
    }));
  }

  // Righe che nel PDF hanno un importo ma non sono state accettate: sono il
  // divario di completezza, quindi vanno mostrate e recuperabili a mano.
  function scartateTabellari() {
    const presenti = new Set(S.righe.map(r => r.indice));
    return S.analisi.righe.filter(r => r.tabellare && r.scartata && !presenti.has(r.indice));
  }

  // ── Revisione ─────────────────────────────────────────────────────────
  function renderRevisione() {
    fase('pronto', '', 100);
    const a = S.analisi;
    const sub = document.getElementById('imp-sub');
    if (sub) sub.textContent = `${S.file.name} · ${a.pagine} ${a.pagine === 1 ? 'pagina' : 'pagine'}`;

    corpo(`
      <div id="imp-banner"></div>
      <div class="imp-split">
        <div class="imp-col imp-col-pdf">
          <div class="imp-barra">
            <span class="imp-barra-tit">Documento</span>
            <span class="imp-nota-anteprima" id="imp-nota-anteprima"></span>
            <div class="imp-zoom">
              <button type="button" class="imp-zoom-b" data-zoom="-1" aria-label="Riduci">−</button>
              <span id="imp-zoom-val">${Math.round(S.scala * 100)}%</span>
              <button type="button" class="imp-zoom-b" data-zoom="1" aria-label="Ingrandisci">+</button>
            </div>
          </div>
          <div class="imp-pdf" id="imp-pdf"></div>
          <div class="imp-legenda">
            <span><i class="imp-chip imp-chip-alta"></i> riconosciuto</span>
            <span><i class="imp-chip imp-chip-incerta"></i> da rivedere</span>
            <span class="imp-legenda-nota">il testo scartato non è evidenziato</span>
          </div>
        </div>
        <div class="imp-col imp-col-tab">
          <div class="imp-barra">
            <span class="imp-barra-tit">Elenco da confermare</span>
            <div class="imp-barra-azioni">
              <span class="imp-conteggio" id="imp-conteggio"></span>
              <button type="button" class="imp-mini" id="imp-aggiungi">+ Riga</button>
            </div>
          </div>
          ${S.entita === 'concorrente' ? `
            <div class="imp-campo">
              <label for="imp-nome-conc">Nome del concorrente</label>
              <input class="roi-input" id="imp-nome-conc" value="${esc(S.nomeDefault)}" placeholder="Es. IDEXX 2026">
            </div>` : ''}
          ${S.entita === 'macchina' ? `
            <div class="imp-campo">
              <label for="imp-provenienza">Provenienza delle macchine</label>
              <select class="roi-input" id="imp-provenienza">${opzioniProvenienza()}</select>
            </div>` : ''}
          <div class="imp-tab" id="imp-tab"></div>
        </div>
      </div>
      <div class="imp-foot">
        <label class="imp-conferma">
          <input type="checkbox" id="imp-ok">
          <span>Confermo che l'elenco è corretto e completo</span>
        </label>
        <div class="imp-foot-dx">
          <span class="imp-foot-nota" id="imp-foot-nota"></span>
          <button type="button" class="btn-ghost" id="imp-annulla">Annulla</button>
          <button type="button" class="btn-primary" id="imp-conferma" disabled>Importa nel catalogo</button>
        </div>
      </div>`);

    const body = document.getElementById('imp-body');
    body.querySelectorAll('.imp-zoom-b').forEach(b => b.addEventListener('click', () => zoom(Number(b.dataset.zoom))));
    document.getElementById('imp-aggiungi').addEventListener('click', aggiungiRiga);
    document.getElementById('imp-annulla').addEventListener('click', chiudiConVerifica);
    document.getElementById('imp-ok').addEventListener('change', aggiornaPiede);
    document.getElementById('imp-conferma').addEventListener('click', conferma);

    // Scorrendo cambiano sia le pagine da tenere disegnate sia il numero
    // mostrato. Il freno e' a tempo e non a frame: deve funzionare anche quando
    // la scheda non sta componendo immagini.
    let ultimo = 0, atteso = null;
    document.getElementById('imp-pdf').addEventListener('scroll', () => {
      const ora = Date.now();
      if (ora - ultimo >= MS_RICALCOLO) { ultimo = ora; aggiornaVisibili(); return; }
      if (atteso) return;
      atteso = setTimeout(() => { atteso = null; ultimo = Date.now(); aggiornaVisibili(); }, MS_RICALCOLO);
    });

    renderBanner();
    renderTabella();
  }

  function renderBanner() {
    const a = S.analisi;
    const persi = scartateTabellari().length;
    const incerte = S.righe.filter(r => r.confidenza === 'incerta' && !r.modificata).length;
    const conf = Math.round((a.confidenzaComplessiva || 0) * 100);

    let tipo = 'ok', titolo, messaggio, azioni = '';
    if (persi > 0 || incerte > 0) {
      tipo = 'rivedi';
      titolo = `Estratte ${a.classificate} righe riconosciute su ${a.totaliTabellari} righe con prezzo rilevate`;
      const pezzi = [];
      if (persi > 0) pezzi.push(persi === 1
        ? `<strong>1</strong> riga con prezzo non è stata classificata`
        : `<strong>${persi}</strong> righe con prezzo non sono state classificate`);
      if (incerte > 0) pezzi.push(`<strong>${incerte}</strong> ${incerte === 1 ? 'riga è' : 'righe sono'} da rivedere`);
      messaggio = pezzi.join(' · ');
      if (incerte > 0) azioni += `<button type="button" class="imp-link" id="imp-vai-incerta">Vai alla prima da rivedere</button>`;
      if (persi > 0) azioni += `<button type="button" class="imp-link" id="imp-vedi-scartate">${S.mostraScartate ? 'Nascondi' : 'Mostra'} le righe scartate</button>`;
    } else {
      titolo = `Estratte ${a.classificate} righe riconosciute su ${a.totaliTabellari} righe con prezzo rilevate`;
      messaggio = 'Nessuna riga con prezzo è rimasta fuori e nessuna è dubbia.';
    }

    // Unico uso rimasto del tipo di riga: se in un import verso Macchinari non
    // si riconosce nessun analizzatore, quel PDF sembra un listino di esami.
    // Avvisa senza bloccare: la scelta resta dell'operatore.
    if (S.entita === 'macchina' && S.analisi.macchine === 0) {
      messaggio += `<div class="imp-banner-dest">Nessun analizzatore riconosciuto: questo documento sembra un listino di esami, mentre qui si importano solo analizzatori. Puoi proseguire comunque, se è quello che intendevi.</div>`;
    }

    document.getElementById('imp-banner').innerHTML = `
      <div class="imp-banner imp-banner-${tipo === 'ok' ? 'ok' : 'rivedi'}">
        <div class="imp-banner-ico">${tipo === 'ok' ? '✓' : '!'}</div>
        <div class="imp-banner-corpo">
          <div class="imp-banner-tit">${esc(titolo)}</div>
          <div class="imp-banner-msg">${messaggio}</div>
          ${azioni ? `<div class="imp-banner-azioni">${azioni}</div>` : ''}
        </div>
        <div class="imp-fiducia" title="Confidenza complessiva dell'estrazione">
          <div class="imp-fiducia-val">${conf}%</div>
          <div class="imp-fiducia-lab">confidenza</div>
        </div>
      </div>`;

    const vi = document.getElementById('imp-vai-incerta');
    if (vi) vi.addEventListener('click', () => {
      const r = S.righe.find(x => x.confidenza === 'incerta' && !x.modificata);
      if (r) selezionaRiga(r.indice != null ? r.indice : null, 'banner', r.id);
    });
    const vs = document.getElementById('imp-vedi-scartate');
    if (vs) vs.addEventListener('click', () => {
      S.mostraScartate = !S.mostraScartate;
      renderBanner(); renderTabella();
    });
    aggiornaPiede();
  }

  function renderTabella() {
    const cont = document.getElementById('imp-tab');
    if (!cont) return;
    const scartate = scartateTabellari();

    cont.innerHTML = `
      <table class="imp-tabella imp-tabella-edit">
        <thead><tr>
          <th style="width:30px">#</th><th>Nome</th>
          <th style="width:96px">Prezzo</th><th style="width:104px">Stato</th><th style="width:34px"></th>
        </tr></thead>
        <tbody>
          ${S.righe.length ? S.righe.map((r, i) => rigaHtml(r, i)).join('')
            : `<tr><td colspan="5" class="imp-vuoto">Nessuna riga. Usa «+ Riga» per aggiungerne a mano.</td></tr>`}
        </tbody>
      </table>` + (S.mostraScartate ? bloccoScartateHtml(scartate) : '');

    cont.querySelectorAll('[data-campo]').forEach(inp => {
      inp.addEventListener('input', () => modificaCampo(Number(inp.dataset.id), inp.dataset.campo, inp.value));
    });
    cont.querySelectorAll('[data-elimina]').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); eliminaRiga(Number(b.dataset.elimina)); });
    });
    cont.querySelectorAll('[data-recupera]').forEach(b => {
      b.addEventListener('click', () => recuperaRiga(Number(b.dataset.recupera)));
    });
    cont.querySelectorAll('[data-riga]').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('input,button')) return;
        // Una riga aggiunta a mano non viene dal PDF e ha data-riga vuoto:
        // Number('') vale 0 e selezionerebbe il riquadro di un'altra riga.
        const idx = tr.dataset.riga === '' ? null : Number(tr.dataset.riga);
        selezionaRiga(idx, 'tabella', Number(tr.dataset.id));
      });
    });
    aggiornaConteggio();
  }

  // Il prezzo si mostra in formato italiano; quello digitato a mano si lascia
  // com'e' stato scritto, cosi il campo non cambia sotto le dita a chi scrive.
  function prezzoDaMostrare(v) {
    if (typeof v === 'number') return eur(v);
    return v == null ? '' : v;
  }

  // Stato mostrato accanto alla riga. Una riga aggiunta a mano resta "aggiunta"
  // anche dopo averla compilata: dire "modificata" nasconderebbe da dove viene.
  function statoRiga(r) {
    if (r.origine === 'manuale') return { cls: 'mod', txt: 'aggiunta', tip: 'Riga aggiunta a mano' };
    if (r.origine === 'recuperata') return { cls: 'incerta', txt: 'recuperata', tip: 'Riga scartata dall\'analisi e recuperata a mano' };
    if (r.modificata) return { cls: 'mod', txt: 'modificata', tip: 'Modificata a mano in questa revisione' };
    if (r.confidenza === 'incerta') return { cls: 'incerta', txt: 'da rivedere', tip: r.motivo || '' };
    return { cls: 'alta', txt: 'alta', tip: '' };
  }

  function rigaHtml(r, i) {
    const stato = statoRiga(r);
    return `
      <tr data-riga="${r.indice == null ? '' : r.indice}" data-id="${r.id}"
          class="${stato.cls === 'incerta' ? 'imp-r-incerta' : ''}">
        <td class="imp-num">${i + 1}</td>
        <td><input class="imp-inp" data-id="${r.id}" data-campo="nome" value="${esc(r.nome)}"></td>
        <td><input class="imp-inp imp-inp-num" data-id="${r.id}" data-campo="prezzo"
                   inputmode="decimal" value="${esc(prezzoDaMostrare(r.prezzo))}"></td>
        <td><span class="imp-tag imp-tag-${stato.cls}" ${stato.tip ? `title="${esc(stato.tip)}"` : ''}>${stato.txt}</span></td>
        <td class="imp-azioni-riga">
          <button type="button" class="imp-x-riga" data-elimina="${r.id}" title="Togli questa riga">✕</button>
        </td>
      </tr>`;
  }

  function bloccoScartateHtml(scartate) {
    if (!scartate.length) return '';
    return `
      <div class="imp-scartate">
        <div class="imp-scartate-tit">${scartate.length} righe con un importo, non classificate</div>
        <table class="imp-tabella">
          <tbody>
            ${scartate.map(r => `
              <tr>
                <td class="imp-scartate-testo" title="${esc(r.motivo || '')}">
                  <span class="imp-scartate-pag">p.${r.pagina}</span> ${esc(r.testo)}
                  <div class="imp-scartate-motivo">${esc(r.motivo || '')}</div>
                </td>
                <td style="width:96px"><button type="button" class="imp-mini" data-recupera="${r.indice}">Recupera</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ── Modifiche (nessun salvataggio automatico) ──────────────────────────
  function trova(id) { return S.righe.find(r => r.id === id); }

  function modificaCampo(id, campo, valore) {
    const r = trova(id);
    if (!r) return;
    r[campo] = valore;
    r.modificata = true;
    const tr = document.querySelector(`[data-id="${id}"]`);
    if (tr) {
      const stato = statoRiga(r);
      const tag = tr.querySelector('.imp-tag');
      if (tag) {
        tag.className = `imp-tag imp-tag-${stato.cls}`;
        tag.textContent = stato.txt;
        tag.title = stato.tip;
      }
      tr.classList.toggle('imp-r-incerta', stato.cls === 'incerta');
    }
    aggiornaConteggio();
    aggiornaPiede();
  }

  function eliminaRiga(id) {
    S.righe = S.righe.filter(r => r.id !== id);
    renderTabella();
    aggiornaRiquadri();
    renderBanner();
  }

  function aggiungiRiga() {
    const id = ++contatoreRighe;
    S.righe.push({
      id, indice: null, nome: '', prezzo: '',
      confidenza: 'alta', motivo: null,
      origine: 'manuale', modificata: false
    });
    renderTabella();
    // Per id, non per posizione: la riga appena creata e' comunque l'ultima
    // dell'elenco, ma selezionare per id resta corretto anche se in futuro
    // l'ordine cambiasse.
    const inp = document.querySelector(`[data-id="${id}"][data-campo="nome"]`);
    if (inp) inp.focus();
    aggiornaPiede();
  }

  function recuperaRiga(indice) {
    const orig = S.analisi.righe.find(r => r.indice === indice);
    if (!orig) return;
    const id = ++contatoreRighe;
    // Dell'analisi si tiene solo l'importo trovato: il nome va scritto a mano,
    // perche' proprio il nome e' cio' che ha fatto scartare la riga.
    S.righe.push({
      id, indice,
      // Senza nome utilizzabile si parte dal testo della riga meno l'importo
      // finale (ed eventuale simbolo di percentuale), che l'operatore correggera.
      nome: orig.nome || orig.testo.replace(/\s*€?\s*[\d.,]+\s*%?\s*$/, '').trim(),
      prezzo: orig.prezzo != null ? orig.prezzo : '',
      confidenza: 'incerta', motivo: orig.motivo, origine: 'recuperata', modificata: false
    });
    renderTabella();
    aggiornaRiquadri();
    renderBanner();
    // Per id, non per posizione: le righe scartate possono essere recuperate
    // in un ordine diverso da quello del documento, quindi la piu' recente
    // non e' detto sia l'ultima in tabella.
    const tr = document.querySelector(`[data-id="${id}"][data-campo="nome"]`);
    if (tr) tr.focus();
  }

  function valide() {
    return S.righe
      .map(r => ({
        nome: String(r.nome || '').trim(),
        prezzo: numero(r.prezzo)
      }))
      .filter(r => r.nome && Number.isFinite(r.prezzo) && r.prezzo >= 0);
  }

  function aggiornaConteggio() {
    const c = document.getElementById('imp-conteggio');
    if (c) c.textContent = `${valide().length} da importare`;
  }

  function aggiornaPiede() {
    const ok = document.getElementById('imp-ok');
    const bottone = document.getElementById('imp-conferma');
    const nota = document.getElementById('imp-foot-nota');
    if (!ok || !bottone) return;
    const n = valide().length;
    const scartate = S.righe.length - n;
    // La conferma resta l'unico passaggio che scrive nel catalogo.
    bottone.disabled = !(ok.checked && n > 0) || S.inCorso;
    if (nota) {
      nota.textContent = S.inCorso ? 'Import in corso…'
        : n === 0 ? 'Nessuna riga valida'
        : [
            n === 1 ? '1 riga da importare' : `${n} righe da importare`,
            scartate === 0 ? null
              : scartate === 1 ? '1 riga incompleta verrà ignorata'
              : `${scartate} righe incomplete verranno ignorate`
          ].filter(Boolean).join(' · ');
    }
    aggiornaConteggio();
  }

  // ── Conferma ──────────────────────────────────────────────────────────
  async function conferma() {
    const righe = valide();
    if (!righe.length) return;
    // Per l'entita' 'concorrente' il nome e' testo libero digitato
    // dall'operatore. Per 'macchina' la provenienza scelta nel selettore vale
    // come concorrenteId: vuoto per "Le mie macchine", l'id del concorrente
    // scelto altrimenti. Nessun altro caso invia questi due campi.
    const nomeConc = S.entita === 'concorrente'
      ? String((document.getElementById('imp-nome-conc') || {}).value || '').trim()
      : '';
    const concorrenteId = S.entita === 'macchina'
      ? (String((document.getElementById('imp-provenienza') || {}).value || '').trim() || null)
      : null;
    if (S.entita === 'concorrente' && !nomeConc) {
      alert('Inserisci il nome del concorrente prima di importare.');
      const i = document.getElementById('imp-nome-conc');
      if (i) i.focus();
      return;
    }

    S.inCorso = true;
    aggiornaPiede();
    try {
      const resp = await fetch(`/api/import-pdf/${S.analisi.importId}/conferma`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ nome: nomeConc, righe, confermaCompletezza: true, concorrenteId })
      });
      const dati = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error((dati && dati.error) || `Errore ${resp.status}`);

      const alFine = S.alFine;
      const esito = dati;
      chiudi();
      const dettagli = [
        esito.ignorate ? `${esito.ignorate} ignorate` : null,
        esito.duplicate ? `${esito.duplicate} duplicate accorpate` : null
      ].filter(Boolean);
      alert(`Import completato: ${esito.importate} righe salvate${dettagli.length ? ' (' + dettagli.join(', ') + ')' : ''}.`);
      if (alFine) alFine(esito);
    } catch (err) {
      // La finestra puo' essere stata chiusa durante l'invio: senza questa
      // guardia il ripristino del piede fallirebbe su uno stato inesistente.
      if (S) {
        S.inCorso = false;
        aggiornaPiede();
      }
      alert('Import non riuscito: ' + err.message);
    }
  }

  // ── Rendering del PDF con evidenziazione ──────────────────────────────
  //
  // Le cornici di tutte le pagine esistono da subito, con i riquadri sopra:
  // l'altezza della colonna e' quella definitiva e le evidenziazioni ci sono
  // prima del disegno. Solo le pagine vicine alla vista vengono rasterizzate.
  // Un listino di 117 pagine, disegnato tutto, occuperebbe centinaia di MB di
  // canvas (~3 MB a pagina, di piu' sugli schermi ad alta densita') e secondi
  // di attesa: cosi ne restano in memoria una manciata.
  async function renderPdf() {
    const lib = await pdfjs();
    const cont = document.getElementById('imp-pdf');
    if (!cont) return;
    liberaPagine();          // lo zoom ridisegna: prima si liberano i canvas vecchi
    cont.innerHTML = '';

    if (!S.pdfDoc) S.pdfDoc = await lib.getDocument({ data: S.buffer.slice(0) }).promise;

    const dpr = window.devicePixelRatio || 1;
    S.pagine = [];

    for (let n = 1; n <= S.pdfDoc.numPages; n++) {
      const page = await S.pdfDoc.getPage(n);
      if (!S) return;
      const vp = page.getViewport({ scale: S.scala });

      const wrap = document.createElement('div');
      wrap.className = 'imp-page';
      wrap.dataset.pagina = String(n);
      wrap.style.width = `${vp.width}px`;
      wrap.style.height = `${vp.height}px`;

      // Il canvas nasce senza superficie: la misura in CSS tiene fermo il
      // layout, i pixel arrivano quando la pagina si avvicina alla vista.
      const canvas = document.createElement('canvas');
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      wrap.appendChild(canvas);
      cont.appendChild(wrap);

      S.pagine.push({ n, page, vp, wrap, canvas, disegnata: false, task: null });
    }
    aggiornaRiquadri();
    S.dpr = dpr;
    aggiornaVisibili();
  }

  // Decide quali pagine tenere disegnate: quelle nella vista piu' una fascia
  // sopra e sotto, cosi scorrendo si trovano gia' pronte.
  //
  // Il calcolo e' diretto invece che affidato a un IntersectionObserver perche'
  // il disegno non deve dipendere dallo scatto di un osservatore: se quello non
  // arrivasse, l'anteprima resterebbe bianca per sempre. Qui la prima passata
  // avviene subito e lo scorrimento aggiorna il resto.
  function aggiornaVisibili() {
    if (!S || !S.pagine || !S.pagine.length) return;
    const cont = document.getElementById('imp-pdf');
    if (!cont) return;

    const alto = cont.scrollTop - MARGINE_ANTEPRIMA;
    const basso = cont.scrollTop + cont.clientHeight + MARGINE_ANTEPRIMA;
    let cima = 0;

    for (const p of S.pagine) {
      const inizio = p.wrap.offsetTop - cont.offsetTop;
      const fine = inizio + p.wrap.offsetHeight;
      if (fine > alto && inizio < basso) disegnaPagina(p, S.dpr);
      else liberaPagina(p);
      if (!cima && fine > cont.scrollTop + 4) cima = p.n;
    }

    if (S.pagine.length > 1) fase('pronto', `pagina ${cima || 1} di ${S.pagine.length}`, 100);
  }

  function liberaPagine() {
    if (!S) return;
    (S.pagine || []).forEach(liberaPagina);
  }

  function disegnaPagina(p, dpr) {
    if (p.disegnata || p.task) return;
    p.canvas.width = Math.floor(p.vp.width * dpr);
    p.canvas.height = Math.floor(p.vp.height * dpr);
    p.task = p.page.render({
      canvasContext: p.canvas.getContext('2d'),
      viewport: p.vp,
      transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0]
    });
    p.task.promise.then(() => { p.disegnata = true; p.task = null; })
      .catch(() => { p.task = null; });   // annullata perche' e' uscita di vista
  }

  function liberaPagina(p) {
    if (p.task) { try { p.task.cancel(); } catch (_) {} p.task = null; }
    if (!p.disegnata && p.canvas.width === 0) return;
    // Azzerare le dimensioni libera la superficie del canvas; la misura in CSS
    // resta, quindi il layout non si muove.
    p.canvas.width = 0;
    p.canvas.height = 0;
    p.disegnata = false;
  }


  // I riquadri seguono il modello editabile, non l'analisi: se l'operatore
  // toglie una riga l'evidenziazione sparisce, se ne recupera una compare.
  // Il testo senza riquadro e' quello che non entrera' nel catalogo.
  function aggiornaRiquadri() {
    const cont = document.getElementById('imp-pdf');
    if (!cont) return;
    cont.querySelectorAll('.imp-box').forEach(b => b.remove());

    for (const r of S.righe) {
      if (r.indice == null) continue;
      const c = S.coord.get(r.indice);
      if (!c) continue;
      const wrap = cont.querySelector(`.imp-page[data-pagina="${c.pagina}"]`);
      if (!wrap) continue;
      const incerta = r.origine === 'recuperata' || (r.confidenza === 'incerta' && !r.modificata);
      const box = document.createElement('div');
      box.className = `imp-box imp-box-${incerta ? 'incerta' : 'alta'}`;
      box.dataset.indice = String(r.indice);
      box.style.left = `${c.x * S.scala}px`;
      box.style.top = `${c.y * S.scala}px`;
      box.style.width = `${c.w * S.scala}px`;
      box.style.height = `${c.h * S.scala}px`;
      box.title = `${r.nome} — ${Number.isFinite(numero(r.prezzo)) ? eur(numero(r.prezzo)) : '?'}${r.motivo ? ' · ' + r.motivo : ''}`;
      box.addEventListener('click', () => selezionaRiga(r.indice, 'pdf', r.id));
      wrap.appendChild(box);
    }
    // Ridisegnati i riquadri, si ripristina la selezione senza spostare nulla.
    if (S.selezionata != null) evidenzia(S.selezionata, null, null);
  }

  async function zoom(direzione) {
    const nuova = Math.min(SCALE_MAX, Math.max(SCALE_MIN, S.scala + direzione * SCALE_STEP));
    if (nuova === S.scala) return;
    S.scala = nuova;
    const val = document.getElementById('imp-zoom-val');
    if (val) val.textContent = `${Math.round(nuova * 100)}%`;
    await renderPdf();
  }

  // Si scorre sempre il lato da cui NON e' arrivato il click: chi clicca una
  // riga vuole vedere il punto nel PDF, chi clicca un riquadro vuole la riga,
  // e chi arriva dal banner vuole entrambi, perche' non e' su nessuno dei due.
  function selezionaRiga(indice, origine, idRiga) {
    S.selezionata = indice;
    evidenzia(indice, idRiga, { pdf: origine !== 'pdf', tabella: origine !== 'tabella' });
  }

  function evidenzia(indice, idRiga, scorri) {
    const vai = scorri || { pdf: false, tabella: false };
    document.querySelectorAll('.imp-sel').forEach(e => e.classList.remove('imp-sel'));

    // Ricerca ristretta alle righe: data-id sta anche sui campi di testo.
    const tr = idRiga != null
      ? document.querySelector(`tr[data-id="${idRiga}"]`)
      : (indice == null ? null : document.querySelector(`tr[data-riga="${indice}"]`));
    if (tr) {
      tr.classList.add('imp-sel');
      if (vai.tabella) tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    const box = indice == null ? null : document.querySelector(`.imp-box[data-indice="${indice}"]`);
    if (!box) return;
    box.classList.add('imp-sel');
    if (!vai.pdf) return;

    const cont = document.getElementById('imp-pdf');
    if (!cont) return;
    // Differenza fra rettangoli invece di offsetTop: l'offsetParent dei riquadri
    // e' la pagina, e quello della pagina e' l'overlay fisso, non la colonna
    // scorrevole — sommarli sfalserebbe il salto di tutta l'intestazione.
    const rBox = box.getBoundingClientRect();
    const rCont = cont.getBoundingClientRect();
    const y = cont.scrollTop + (rBox.top - rCont.top) - cont.clientHeight / 2 + rBox.height / 2;
    cont.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });

    // Dopo un salto le pagine da tenere disegnate cambiano. Affidarsi al solo
    // evento di scorrimento non basta: saltando a pagina 90 si arriverebbe su
    // un foglio bianco. Si ricalcola subito e di nuovo a scorrimento concluso,
    // perche' con l'animazione la posizione finale arriva dopo.
    aggiornaVisibili();
    setTimeout(aggiornaVisibili, 400);
  }

  window.ImportPdf = { avvia, chiudi };
})();
