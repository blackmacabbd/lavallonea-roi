/* Import PDF condiviso — visore affiancato con evidenziazione.
 *
 * Componente unico usato da Gestione piani e Gestione concorrenti. Il PDF non
 * viene mai riscaricato dal server: il browser rende il file locale scelto
 * dall'utente, mentre le coordinate delle righe riconosciute arrivano
 * dall'analisi lato server (punti PDF a scala 1, origine in alto a sinistra).
 *
 * Uso:  ImportPdf.avvia({ entita: 'piano' | 'concorrente', nomeDefault, file })
 * Senza `file` il documento viene chiesto all'utente; con `file` si usa quello
 * (serve quando il documento e' gia' stato scelto da un input della pagina).
 */
(function () {
  'use strict';

  const PDFJS_SRC = '/vendor/pdf.min.js';
  const PDFJS_WORKER = '/vendor/pdf.worker.min.js';

  const SCALE_MIN = 0.5;
  const SCALE_MAX = 3;
  const SCALE_STEP = 0.25;

  // Stato dell'import in corso. Vive solo mentre la finestra e' aperta.
  let S = null;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const eur = n => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function authHeaders() {
    // Riusa la sessione dell'app senza dipendere dai suoi interni.
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
    ov.querySelector('.imp-x').addEventListener('click', chiudi);
    ov.addEventListener('click', e => { if (e.target === ov) chiudi(); });
    document.addEventListener('keydown', suEsc);
    return ov;
  }

  function suEsc(e) { if (e.key === 'Escape') chiudi(); }

  function chiudi() {
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

  function statoAttesa(messaggio) {
    corpo(`<div class="imp-attesa"><div class="imp-spinner"></div><div>${esc(messaggio)}</div></div>`);
  }

  function statoErrore(messaggio) {
    corpo(`<div class="imp-errore">
      <div class="imp-errore-icona">⚠️</div>
      <div><div class="imp-errore-tit">Non riesco a leggere questo PDF</div>
      <div class="imp-errore-msg">${esc(messaggio)}</div></div>
    </div>`);
  }

  // ── Avvio ─────────────────────────────────────────────────────────────
  async function avvia(opzioni) {
    const opts = opzioni || {};
    const entita = opts.entita === 'concorrente' ? 'concorrente' : 'piano';
    const file = opts.file || await scegliFile();
    if (!file) return;

    montaFinestra('Importa listino PDF', file.name);
    statoAttesa('Analisi del PDF in corso…');

    let analisi, buffer;
    try {
      buffer = await file.arrayBuffer();
      analisi = await analizza(file, entita);
    } catch (err) {
      statoErrore(err.message);
      return;
    }

    S = {
      entita,
      file,
      buffer,
      analisi,
      nomeDefault: opts.nomeDefault || file.name.replace(/\.pdf$/i, ''),
      scala: 1.2,
      pdfDoc: null,
      selezionata: null
    };

    renderRevisione();
    try { await renderPdf(); }
    catch (err) {
      const cont = document.getElementById('imp-pdf');
      if (cont) cont.innerHTML = `<div class="imp-errore-msg" style="padding:16px">
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

  async function analizza(file, entita) {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch(`/api/import-pdf/analizza?entita=${encodeURIComponent(entita)}`, {
      method: 'POST', headers: authHeaders(), body: fd
    });
    let dati = null;
    try { dati = await resp.json(); } catch (_) { /* risposta non JSON */ }
    if (!resp.ok) throw new Error((dati && dati.error) || `Errore ${resp.status}`);
    return dati;
  }

  // ── Vista affiancata ──────────────────────────────────────────────────
  function renderRevisione() {
    const a = S.analisi;
    const sub = document.getElementById('imp-sub');
    if (sub) sub.textContent = `${S.file.name} · ${a.pagine} ${a.pagine === 1 ? 'pagina' : 'pagine'}`;

    corpo(`
      <div class="imp-split">
        <div class="imp-col imp-col-pdf">
          <div class="imp-barra">
            <span class="imp-barra-tit">Documento</span>
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
            <span class="imp-barra-tit">Elenco estratto</span>
            <span class="imp-conteggio">${a.classificate} su ${a.totaliTabellari} righe con prezzo</span>
          </div>
          <div class="imp-tab" id="imp-tab">${tabellaHtml()}</div>
        </div>
      </div>`);

    const body = document.getElementById('imp-body');
    body.querySelectorAll('.imp-zoom-b').forEach(b => {
      b.addEventListener('click', () => zoom(Number(b.dataset.zoom)));
    });
    body.querySelectorAll('[data-riga]').forEach(tr => {
      tr.addEventListener('click', () => selezionaRiga(Number(tr.dataset.riga)));
    });
  }

  function tabellaHtml() {
    const righe = S.analisi.righe.filter(r => !r.scartata);
    if (!righe.length) {
      return `<div class="imp-vuoto">Nessuna riga con prezzo riconosciuta in questo documento.</div>`;
    }
    return `
      <table class="imp-tabella">
        <thead><tr><th style="width:34px">#</th><th>Esame</th><th style="width:92px">Prezzo</th><th style="width:96px">Stato</th></tr></thead>
        <tbody>
          ${righe.map((r, i) => `
            <tr data-riga="${r.indice}" class="${r.confidenza === 'incerta' ? 'imp-r-incerta' : ''}">
              <td class="imp-num">${i + 1}</td>
              <td>${esc(r.nome)}</td>
              <td class="imp-prezzo">${eur(r.prezzo)}</td>
              <td>${r.confidenza === 'incerta'
                ? `<span class="imp-tag imp-tag-incerta" title="${esc(r.motivo || '')}">da rivedere</span>`
                : `<span class="imp-tag imp-tag-alta">alta</span>`}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // ── Rendering del PDF con evidenziazione ──────────────────────────────
  async function renderPdf() {
    const lib = await pdfjs();
    const cont = document.getElementById('imp-pdf');
    if (!cont) return;
    cont.innerHTML = '';

    if (!S.pdfDoc) {
      // pdfjs trasferisce il buffer al worker: passargli una copia tiene
      // l'originale integro per eventuali riletture.
      S.pdfDoc = await lib.getDocument({ data: S.buffer.slice(0) }).promise;
    }

    const dpr = window.devicePixelRatio || 1;
    const daRendere = [];

    // Prima passata: cornici delle pagine e riquadri di evidenziazione. Le
    // dimensioni sono note prima di disegnare, quindi l'operatore vede subito
    // dove sono le righe riconosciute mentre le pagine si riempiono.
    for (let n = 1; n <= S.pdfDoc.numPages; n++) {
      const page = await S.pdfDoc.getPage(n);
      const vp = page.getViewport({ scale: S.scala });

      const wrap = document.createElement('div');
      wrap.className = 'imp-page';
      wrap.dataset.pagina = String(n);
      wrap.style.width = `${vp.width}px`;
      wrap.style.height = `${vp.height}px`;

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      wrap.appendChild(canvas);
      cont.appendChild(wrap);
      disegnaRiquadri(wrap, n);

      daRendere.push({ page, vp, canvas });
    }

    // Seconda passata: rasterizzazione, una pagina alla volta.
    for (const { page, vp, canvas } of daRendere) {
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: vp,
        transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0]
      }).promise;
    }
  }

  // Le righe scartate non sono evidenziate: e' il segnale visivo che quel testo
  // e' stato considerato rumore e non finira' nel catalogo.
  function disegnaRiquadri(wrap, pagina) {
    for (const r of S.analisi.righe) {
      if (r.pagina !== pagina || r.scartata) continue;
      const box = document.createElement('div');
      box.className = `imp-box imp-box-${r.confidenza === 'incerta' ? 'incerta' : 'alta'}`;
      box.dataset.indice = String(r.indice);
      box.style.left = `${r.x * S.scala}px`;
      box.style.top = `${r.y * S.scala}px`;
      box.style.width = `${r.w * S.scala}px`;
      box.style.height = `${r.h * S.scala}px`;
      box.title = `${r.nome} — ${eur(r.prezzo)}${r.motivo ? ' · ' + r.motivo : ''}`;
      box.addEventListener('click', () => selezionaRiga(r.indice, true));
      wrap.appendChild(box);
    }
    if (S.selezionata != null) evidenzia(S.selezionata, false);
  }

  async function zoom(direzione) {
    const nuova = Math.min(SCALE_MAX, Math.max(SCALE_MIN, S.scala + direzione * SCALE_STEP));
    if (nuova === S.scala) return;
    S.scala = nuova;
    const val = document.getElementById('imp-zoom-val');
    if (val) val.textContent = `${Math.round(nuova * 100)}%`;
    await renderPdf();
  }

  // Click su una riga della tabella: porta il visore sulla posizione nel PDF.
  // Click su un riquadro del PDF: porta la tabella sulla riga corrispondente.
  function selezionaRiga(indice, daPdf) {
    S.selezionata = indice;
    evidenzia(indice, !daPdf);
    const tr = document.querySelector(`[data-riga="${indice}"]`);
    if (tr && daPdf) tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function evidenzia(indice, portaIlPdf) {
    document.querySelectorAll('.imp-box.imp-sel').forEach(b => b.classList.remove('imp-sel'));
    document.querySelectorAll('[data-riga].imp-sel').forEach(t => t.classList.remove('imp-sel'));

    const tr = document.querySelector(`[data-riga="${indice}"]`);
    if (tr) tr.classList.add('imp-sel');

    const box = document.querySelector(`.imp-box[data-indice="${indice}"]`);
    if (!box) return;
    box.classList.add('imp-sel');
    if (!portaIlPdf) return;

    const cont = document.getElementById('imp-pdf');
    if (!cont) return;
    // Differenza fra rettangoli invece di offsetTop: l'offsetParent dei riquadri
    // e' la pagina, e quello della pagina e' l'overlay fisso, non la colonna
    // scorrevole — sommarli sfalserebbe il salto di tutta l'intestazione.
    const rBox = box.getBoundingClientRect();
    const rCont = cont.getBoundingClientRect();
    const y = cont.scrollTop + (rBox.top - rCont.top) - cont.clientHeight / 2 + rBox.height / 2;
    cont.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  window.ImportPdf = { avvia, chiudi };
})();
