'use strict';

/* ════════════════════════════════════════════════════
   Mylav ROI Dashboard — app.js
   ════════════════════════════════════════════════════ */

const S = {
  strutture: [],
  expanded:  {},
  gestioneOpen: false,
  vistaMia:  true,
  charts:    {},
  piani:     [],
  concorrenti: [],
  foglio: { dati: null, totali: null, file: null, foglio: null, fileId: null },
  roi: {
    struttura: '',
    pianoId: null,
    concorrenteId: null,
    esamiConc: [],          // listino del concorrente selezionato, per i suggerimenti
    righe: [roiRigaVuota()]
  },
  clip: {
    pianoId: null,
    catalogo: [],           // clip dell'account (GET /api/clip), per i suggerimenti
    righe: [clipRigaVuota()]
  },
  auth: {
    token: localStorage.getItem('authToken') || null,
    email: localStorage.getItem('authEmail') || null,
    isAdmin: localStorage.getItem('authIsAdmin') === '1',
    guest: false
  }
};

function roiRigaVuota() {
  // `esame` e `n_esami` restano il lato MYLAV, come sono sempre stati: i calcoli
  // salvati prima si riaprono col nome nella colonna giusta senza migrazioni.
  // I due campi nuovi sono il lato concorrenza.
  return {
    esame_concorrente: '', n_concorrenza: '',
    esame: '', n_esami: 1,
    listino_concorrenza: '', sconto_concorrenza: '', listino_lav: '', prezzo_scontato_lav: ''
  };
}

// Riga vuota del calcolatore clip: 'concorrenza' e' il lato clip precaricata
// (il costo che il veterinario sostiene facendo l'esame in casa), 'mylav' e' il
// profilo Mylav a cui la si confronta.
function clipRigaVuota() {
  return {
    clip_nome: '', n_clip: 1, prezzo_confezione: '', pezzi: '', sconto_clip: '',
    profilo_mylav: '', n_mylav: 1, listino_lav: '', prezzo_scontato_lav: ''
  };
}

// ── Utils ──────────────────────────────────────────
function euro(n) {
  return '€ ' + (Number(n) || 0).toLocaleString('it-IT', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}
function euroCompact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return '€ ' + (v / 1000).toFixed(1) + 'k';
  return '€ ' + v.toFixed(0);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtEuro(n) {
  return Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function authHeaders(extra = {}) {
  const h = { ...extra };
  if (S.auth && S.auth.token) h['Authorization'] = 'Bearer ' + S.auth.token;
  return h;
}
async function api(path, opts = {}) {
  const merged = { ...opts, headers: authHeaders(opts.headers || {}) };
  const res = await fetch(path, merged);
  if (res.status === 401) {
    // Se avevamo un token era una sessione scaduta/invalida: torna al login.
    // Se non c'era token (ospite su una rotta privata) è un 401 atteso: non forzare il logout.
    // Il codice va sull'oggetto Error perche' il messaggio ora cambia con la
    // lingua e non puo' piu' servire a distinguere il caso.
    if (S.auth && S.auth.token) {
      authLogout(true);
      const err = new Error(t('errore.sessioneScaduta'));
      err.codice = 'SESSIONE_SCADUTA';
      throw err;
    }
    const err = new Error(t('errore.accediPerVedere'));
    err.codice = 'AUTENTICAZIONE_RICHIESTA';
    throw err;
  }
  if (!res.ok) {
    const dati = await res.json().catch(() => ({ error: res.statusText }));
    // Stessa guardia della finestra di import, in un solo posto: traduce il
    // codice quando lo conosciamo, altrimenti lascia il testo del server.
    // Con un corpo non JSON e statusText vuoto (HTTP/2, proxy) resterebbe una
    // frase vuota: l'ultima ricaduta e' lo stato numerico, tradotto.
    const fallback = res.statusText || t('errore.rispostaServer', { stato: res.status });
    const messaggio = (window.I18n && typeof window.I18n.messaggioErrore === 'function')
      ? window.I18n.messaggioErrore(dati, fallback)
      : ((dati && dati.error) || fallback);
    const err = new Error(messaggio);
    if (dati && dati.codice) err.codice = dati.codice;
    throw err;
  }
  return res.json();
}
function destroyCharts() {
  Object.values(S.charts).forEach(c => { try { c.destroy(); } catch (_) {} });
  S.charts = {};
}
function el(id) { return document.getElementById(id); }
function setMain(html) {
  destroyCharts();
  el('main-content').innerHTML = html;
}

// ── Sidebar ────────────────────────────────────────
async function loadStrutture() {
  S.strutture = await api('/api/strutture');
}

async function loadPiani() {
  S.piani = await api('/api/piani');
}

async function loadConcorrenti() {
  S.concorrenti = await api('/api/concorrenti');
  // Se c'e' un solo concorrente, selezionalo di default nel Calcolatore ROI
  // (cosi le mappature si applicano subito senza doverlo scegliere a mano).
  if (S.roi.concorrenteId == null && S.concorrenti.length === 1) {
    S.roi.concorrenteId = S.concorrenti[0].id;
  }
  // Il listino serve ai suggerimenti della colonna concorrenza del calcolatore.
  // Si carica anche qui, e non solo al disegno della dashboard, perche' li' il
  // concorrente di default poteva non essere ancora stato scelto.
  if (S.roi.concorrenteId != null) caricaEsamiConcorrente();
}

function buildSidebar() {
  const nav = el('sidebar-nav');
  if (!nav) return;

  let html = `
    <div class="nav-upload" onclick="openUploadModal()">
      <span class="nav-icon">+</span> ${t('menu.upload')}
    </div>
    <div class="nav-item ${isActive('dashboard')}" onclick="navigate('dashboard')">
      <span class="nav-icon">📊</span> ${t('menu.dashboard')}
    </div>
    <div class="nav-item ${isActive('calcolatore-clip')}" onclick="navigate('calcolatore-clip')">
      <span class="nav-icon">🧪</span> ${t('menu.calcolatoreClip')}
    </div>
    <div class="nav-divider">${t('sidebar.divStrutture')}</div>
  `;

  if (S.strutture.length === 0) {
    html += `<div style="padding:8px 16px;font-size:12px;color:#9ca3af">${t('sidebar.nessunaStruttura')}</div>`;
  }

  for (const s of S.strutture) {
    const files = s.files || [];
    if (files.length > 1) {
      // Piu' calcoli salvati sotto la stessa struttura: una riga per file,
      // etichettate nome, nome(2), nome(3)... in ordine di creazione.
      files.forEach((f, i) => {
        const label = i === 0 ? s.nome : `${s.nome}(${i + 1})`;
        const foglio = f.fogli && f.fogli.length ? f.fogli[0] : '';
        const attiva = (window._currentFileId === f.id) ? 'active' : '';
        const onclick = foglio
          ? `navigate('foglio', { fileId: ${f.id}, foglio: '${foglio}', strutturaId: ${s.id} })`
          : `navigate('dashboard')`;
        html += `
          <div class="struttura-group">
            <div class="struttura-header struttura-flat ${attiva}" onclick="${onclick}">
              <span class="sname">${escHtml(label)}</span>
              <span class="struttura-del" title="${escHtml(t('sidebar.eliminaCalcolo'))}" onclick="event.stopPropagation(); eliminaFileSidebarUI(${f.id}, ${jsAttr(label)})">×</span>
            </div>
          </div>
        `;
      });
    } else {
      const primoFoglio = s.fogli && s.fogli.length ? s.fogli[0] : null;
      const attiva = (window._currentStrutturaId === s.id) ? 'active' : '';
      const onclick = primoFoglio
        ? `navigateToStruttura(${s.id}, '${primoFoglio}')`
        : `navigate('dashboard')`;
      html += `
        <div class="struttura-group">
          <div class="struttura-header struttura-flat ${attiva}" onclick="${onclick}">
            <span class="sname">${escHtml(s.nome)}</span>
            <span class="struttura-del" title="${escHtml(t('sidebar.eliminaStruttura'))}" onclick="event.stopPropagation(); eliminaStrutturaUI(${s.id})">×</span>
          </div>
        </div>
      `;
    }
  }

  html += `
    <div class="nav-divider" style="margin-top:8px">${t('sidebar.divGestione')}</div>
    <div class="nav-item ${isActive('piani')}" onclick="navigate('piani')">
      <span class="nav-icon">💰</span> ${t('menu.piani')}
    </div>
    <div class="nav-item ${isActive('concorrenti')}" onclick="navigate('concorrenti')">
      <span class="nav-icon">🏷️</span> ${t('menu.concorrenti')}
    </div>
  `;

  if (S.strutture.length >= 2) {
    html += `
      <div class="nav-item ${isActive('confronto')}" onclick="navigate('confronto')">
        <span class="nav-icon">⚖️</span> ${t('menu.confrontoStrutture')}
      </div>
    `;
  }

  // Gruppo a scomparsa "Altro": voci usate raramente / tecniche
  const altroOpen = S.gestioneOpen ? 'open' : '';
  html += `
    <div class="nav-divider" style="margin-top:8px">${t('sidebar.divAltro')}</div>
    <div class="struttura-group">
      <div class="struttura-header ${altroOpen}" onclick="toggleGestione()">
        <span class="sname">${t('sidebar.cronologiaStrumenti')}</span>
        <span class="struttura-chevron">›</span>
      </div>
      <div class="struttura-children ${altroOpen}">
        <div class="struttura-child ${isActive('risparmio-totale')}" onclick="navigate('risparmio-totale')">${t('menu.risparmioTotale')}</div>
        <div class="struttura-child ${isActive('cronologia')}" onclick="navigate('cronologia')">${t('menu.cronologia')}</div>
        <div class="struttura-child ${isActive('cronologia-clip')}" onclick="navigate('cronologia-clip')">${t('menu.cronologiaClip')}</div>
        <div class="struttura-child ${isActive('debug')}" onclick="navigate('debug')">${t('menu.debugExcel')}</div>
      </div>
    </div>
  `;

  html += `
    <div class="sidebar-account">
      <button class="account-btn" onclick="toggleAccountMenu()" title="${escHtml(t('comune.account'))}">
        <span class="account-ico">👤</span>
        <span class="account-email">${S.auth.guest ? t('comune.ospite') : (S.auth.email || t('comune.account'))}</span>
      </button>
      <div id="account-menu" class="account-menu" style="display:none">
        ${S.auth.guest || !S.auth.token ? `
          <div onclick="mostraAuthScreen('login')">${t('comune.accedi')}</div>
          <div onclick="mostraAuthScreen('register')">${t('auth.registrati')}</div>
          <div onclick="authGuest()">${t('auth.ospiteEntra')}</div>` : `
          <div onclick="authLogout()">${t('comune.esci')}</div>
          <div onclick="mostraAuthScreen('login')">${t('auth.cambiaAccount')}</div>`}
      </div>
    </div>`;

  nav.innerHTML = html;
  titoliVociTroncate();
}

// Le etichette tradotte possono essere piu' lunghe dell'italiano: dove non
// stanno nella barra vengono troncate, e il nome della sezione si perde. Il
// titolo si mette solo dove il troncamento avviene davvero, cosi' vale anche
// per le lingue che verranno, senza sporcare le voci che stanno larghe.
function titoliVociTroncate() {
  document.querySelectorAll('#sidebar-nav .nav-item, #sidebar-nav .nav-upload').forEach(voce => {
    if (voce.scrollWidth > voce.clientWidth + 1) voce.title = voce.textContent.trim();
    else voce.removeAttribute('title');
  });
}

function toggleAccountMenu() {
  const m = el('account-menu');
  if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

// Chiude il menu account cliccando fuori (bottone o popover).
document.addEventListener('click', e => {
  const m = el('account-menu');
  if (!m || m.style.display === 'none') return;
  if (e.target.closest('.sidebar-account')) return;
  m.style.display = 'none';
});

function toggleGestione() {
  S.gestioneOpen = !S.gestioneOpen;
  buildSidebar();
}

async function eliminaStrutturaUI(id) {
  const s = S.strutture.find(x => x.id === id);
  const nome = s ? s.nome : t('sidebar.questaStruttura');
  if (!confirm(t('sidebar.confermaEliminaStruttura', { nome }))) return;
  try {
    await api(`/api/strutture/${id}`, { method: 'DELETE' });
    await loadStrutture();
    buildSidebar();
    navigate('dashboard');
  } catch (e) { alert(t('errore.generico', { msg: e.message })); }
}

// Elimina un singolo calcolo (file) quando una struttura ne ha piu' di uno in sidebar.
async function eliminaFileSidebarUI(fileId, label) {
  if (!confirm(t('sidebar.confermaEliminaCalcolo', { label }))) return;
  try {
    await api(`/api/cronologia/${fileId}`, { method: 'DELETE' });
    await loadStrutture();
    buildSidebar();
    if (window._currentFileId === fileId) navigate('dashboard');
  } catch (e) { alert(t('errore.generico', { msg: e.message })); }
}

function isActive(view, extra) {
  if (window._currentView === view) {
    if (extra === undefined) return 'active';
    if (extra === window._currentStrutturaId) return 'active';
  }
  return '';
}
function isActiveFoglio(strutturaId, foglio) {
  if (window._currentView === 'foglio' &&
      window._currentStrutturaId === strutturaId &&
      window._currentFoglio === foglio) return 'active';
  return '';
}
function toggleStruttura(id) {
  S.expanded[id] = !S.expanded[id];
  buildSidebar();
}
async function navigateToStruttura(strutturaId, foglio) {
  const files = await api(`/api/strutture/${strutturaId}/file`);
  const f = files.find(x => x.fogli && x.fogli.includes(foglio));
  if (!f) return;
  navigate('foglio', { fileId: f.id, foglio, strutturaId });
}

// Sotto-vista aperta dentro la pagina corrente: editor prezzi di un piano,
// dettaglio di un concorrente. Non passano da navigate, quindi un ridisegno
// le farebbe sparire portandosi via quello che l'operatore aveva digitato: le
// si ricorda per riaprirle dopo un cambio lingua.
let _sottoVista = null; // { tipo: 'pianoEdit' | 'concorrente', arg }

// Se l'oggetto della sotto-vista viene eliminato, ricordarsela non ha piu'
// senso: riaprirla dopo un cambio lingua darebbe un errore all'operatore per
// qualcosa che ha appena cancellato lui.
function scordaSottoVista(tipo, arg) {
  if (_sottoVista && _sottoVista.tipo === tipo && Number(_sottoVista.arg) === Number(arg)) _sottoVista = null;
}

function riapriSottoVista(sotto) {
  if (!sotto) return Promise.resolve();
  if (sotto.tipo === 'pianoEdit') return Promise.resolve(renderPianoEdit(sotto.arg));
  if (sotto.tipo === 'concorrente') return Promise.resolve(renderConcorrenteDettaglio(sotto.arg));
  return Promise.resolve();
}

// ── Navigation ─────────────────────────────────────
function navigate(view, params = {}) {
  window._currentView        = view;
  window._currentParams      = params;
  window._currentStrutturaId = params.strutturaId || null;
  window._currentFoglio      = params.foglio      || null;
  window._currentFileId      = params.fileId      || null;

  // Un cambio lingua non e' una navigazione: la sotto-vista aperta resta.
  if (!window._cambioLingua) _sottoVista = null;

  setMain('<div class="page-loading"><div class="spinner"></div></div>');

  // Il disegno delle viste e' asincrono: restituire la promessa permette a
  // ridisegnaTutto di aspettare la pagina prima di riaprirci la sotto-vista.
  let disegno;
  switch (view) {
    case 'dashboard':  disegno = renderDashboard();                              break;
    case 'foglio':     disegno = renderFoglio(params.fileId, params.foglio);     break;
    case 'totali':     disegno = renderTotali(params.strutturaId, params.nome);  break;
    case 'cronologia': disegno = renderCronologia();                             break;
    case 'cronologia-clip': disegno = renderCronologiaClip();                    break;
    case 'confronto':  disegno = renderConfronto();                              break;
    case 'debug':      disegno = renderDebug();                                  break;
    case 'risparmio-totale': disegno = renderRisparmioTotale();                  break;
    case 'piani':      disegno = renderPiani();                                  break;
    case 'concorrenti': disegno = renderConcorrentiAdmin();                      break;
    case 'calcolatore-clip': disegno = renderCalcolatoreClip();                  break;
  }
  buildSidebar();
  return Promise.resolve(disegno);
}

// Cambio lingua a caldo: si riusa la navigazione esistente invece di un
// secondo percorso di disegno, cosi' ogni vista resta l'unica responsabile
// del proprio markup.
//
// Il main e' pero' coperto da #auth-overlay quando l'operatore non ha ancora
// fatto accesso: ridisegnare 'main-content' in quel caso non serve a nulla
// (resta invisibile) e lascia la schermata di accesso, che sta sopra, nella
// lingua precedente. _authUltimo ricorda l'ultimo disegno mostrato
// nell'overlay per poterlo riprodurre nella lingua nuova, riusando le
// funzioni di disegno esistenti invece di duplicarle.
let _authUltimo = null; // { tipo: 'vista' | 'step2' | 'codice', arg }

function ridisegnaAuth(ultimo) {
  if (!ultimo) return;
  if (ultimo.tipo === 'vista') mostraAuthScreen(ultimo.arg);
  else if (ultimo.tipo === 'step2') renderResetStep2(ultimo.arg);
  else if (ultimo.tipo === 'codice') renderCodiceRecupero(ultimo.arg);
}

window.ridisegnaTutto = function () {
  traduciMarkupStatico();
  const ov = el('auth-overlay');
  if (ov && ov.style.display !== 'none' && _authUltimo) {
    // I valori gia' digitati (es. il codice di reset ricevuto via email) non
    // devono sparire solo perche' si cambia lingua.
    const valori = [...ov.querySelectorAll('input')].map(i => [i.id, i.value]);
    ridisegnaAuth(_authUltimo);
    valori.forEach(([id, v]) => { const i = el(id); if (i) i.value = v; });
    return; // il main e' coperto: ridisegnarlo non serve
  }

  // Stessa regola fuori dall'overlay: un editor aperto con dei prezzi appena
  // digitati non deve svuotarsi perche' l'operatore ha cambiato lingua. Si
  // fotografa quello che c'e' nei campi, si ridisegna la pagina, si riapre la
  // sotto-vista che era aperta e si rimette dentro quello che c'era.
  // Non tutti i campi hanno un id: quelli dell'editor dei prezzi si
  // riconoscono dall'esame a cui appartengono. La chiave usa quello che c'e',
  // altrimenti la fotografia salta proprio i campi che contano.
  const chiaveCampo = i => i.id
    || (i.dataset && i.dataset.esameId ? 'esame:' + i.dataset.esameId : '')
    || i.name || '';
  const campiOra = () => [...document.querySelectorAll('#main-content input, #main-content select')]
    .filter(i => chiaveCampo(i));
  const valori = campiOra().map(i => [chiaveCampo(i), i.value]);
  const sotto = _sottoVista;
  // Un contatore e non un interruttore: due cambi lingua ravvicinati
  // sovrappongono due ridisegni, e il primo che finisce non deve spegnere la
  // bandiera mentre il secondo e' ancora in corso — la spegnerebbe sotto i
  // piedi al secondo, che tornerebbe a chiudere il listino aperto.
  window._cambiLinguaInCorso = (window._cambiLinguaInCorso || 0) + 1;
  window._cambioLingua = true;
  // navigate dentro la catena: se lanciasse in modo sincrono (per esempio con
  // il contenitore principale non ancora nel documento) la bandiera resterebbe
  // accesa per sempre, e da quel momento nessuna navigazione vera chiuderebbe
  // piu' quello che l'operatore ha aperto.
  Promise.resolve()
    .then(() => navigate(window._currentView || 'dashboard', window._currentParams || {}))
    .then(() => riapriSottoVista(sotto))
    .then(() => {
      const mappa = new Map(valori);
      campiOra().forEach(i => {
        const v = mappa.get(chiaveCampo(i));
        if (v !== undefined && i.value !== v) i.value = v;
      });
    })
    .catch(e => console.warn('ridisegno dopo cambio lingua:', e && e.message))
    .finally(() => {
      window._cambiLinguaInCorso = Math.max(0, (window._cambiLinguaInCorso || 1) - 1);
      if (!window._cambiLinguaInCorso) window._cambioLingua = false;
    });
};

// ── Dashboard ──────────────────────────────────────
async function renderDashboard() {
  let data;
  try {
    data = await api('/api/dashboard');
  } catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">${t('stato.erroreCaricamento')}</div>
      <div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  const { strutture_count, file_count, differenziale_totale, ultimi_file, per_struttura } = data;

  if (strutture_count === 0) {
    setMain(`
      <div class="page-header">
        <div><div class="page-title">${t('pagina.dashboard.titolo')}</div></div>
      </div>
      <div class="page-body">
        <div class="empty-state" style="margin-bottom:24px">
          <div class="empty-icon">📂</div>
          <div class="empty-title">${t('stato.nessunDato')}</div>
          <div class="empty-sub">${t('pagina.dashboard.corpoVuoto')}</div>
          <button class="btn-primary mt-4" onclick="openUploadModal()">${t('pagina.dashboard.caricaBtn')}</button>
        </div>
      </div>
    `);
    const roiSection = document.createElement('div');
    roiSection.className = 'section-card';
    roiSection.style.cssText = 'margin:0 24px 24px';
    roiSection.innerHTML = buildRoiSectionHtml();
    el('main-content').querySelector('.page-body').appendChild(roiSection);
    const actions = document.createElement('div');
    actions.style.cssText = 'margin:0 24px 24px';
    actions.innerHTML = buildRoiActionsHtml();
    el('main-content').querySelector('.page-body').appendChild(actions);
    motoreEsami.inizializzaEventi();
    return;
  }

  setMain(`
    <div class="page-body" style="padding-top:24px">
      <div class="section-card" id="roi-hero"></div>
      <div class="riepilogo-band">
        <div class="kpi-card kpi-risparmio" id="dash-risparmio-card">
          <div class="kpi-label">${t('pagina.dashboard.risparmioLabel')}</div>
          <div class="kpi-value" id="dash-risparmio-val">${euro(0)}</div>
          <div class="kpi-sub">${t('pagina.dashboard.risparmioSub')}</div>
        </div>
      </div>
      ${buildRoiActionsHtml()}
    </div>
  `);

  // Calcolatore ROI — eroe in cima alla dashboard
  el('roi-hero').innerHTML = buildRoiSectionHtml();
  motoreEsami.inizializzaEventi();
  // I suggerimenti della colonna concorrenza arrivano dal listino del
  // concorrente gia' selezionato: senza questo comparirebbero solo dopo averlo
  // riselezionato a mano.
  caricaEsamiConcorrente();
  updateDashRisparmio();
}

// KPI "Risparmio calcolo attuale": riflette solo il calcolatore in uso, live.
function updateDashRisparmio() {
  const val = el('dash-risparmio-val');
  if (!val) return;
  const d = calcolaRoiTotali().differenziale;
  val.textContent = euro(d);
  val.style.color = d >= 0 ? 'var(--blue)' : 'var(--red)';
  const card = el('dash-risparmio-card');
  if (card) card.style.setProperty('--kpi-accent', d >= 0 ? 'var(--blue)' : 'var(--red)');
}

// ── Risparmio totale strutture (sezione "Altro", poco evidente) ──
async function renderRisparmioTotale() {
  let data;
  try { data = await api('/api/dashboard'); }
  catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">${t('stato.errore')}</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }
  const { differenziale_totale, per_struttura } = data;
  setMain(`
    <div class="page-header">
      <div>
        <div class="page-title">${t('menu.risparmioTotale')}</div>
        <div class="page-subtitle">${t('pagina.risparmioTotale.sottotitolo')}</div>
      </div>
    </div>
    <div class="page-body">
      <div class="kpi-card kpi-risparmio" style="max-width:340px;margin-bottom:24px">
        <div class="kpi-label">${t('pagina.risparmioTotale.kpiLabel')}</div>
        <div class="kpi-value" style="color:${differenziale_totale >= 0 ? 'var(--blue)' : 'var(--red)'}">${euro(differenziale_totale)}</div>
        <div class="kpi-sub">${t('pagina.risparmioTotale.kpiSub')}</div>
      </div>
      ${per_struttura.length ? `
      <div class="section-card">
        <div class="section-card-title">${t('pagina.risparmioTotale.riepilogoTitolo')}</div>
        <div class="chart-canvas-wrap">
          <canvas id="chart-confronto-tot" height="${Math.max(180, per_struttura.length * 46)}"></canvas>
        </div>
      </div>` : `<div class="empty-state"><div class="empty-icon">📭</div>
        <div class="empty-title">${t('pagina.risparmioTotale.nessunCalcolo')}</div></div>`}
    </div>
  `);

  if (per_struttura.length) {
    const ctx = el('chart-confronto-tot');
    if (ctx) {
      S.charts.tot = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: per_struttura.map(s => s.nome),
          datasets: [
            { label: t('chart.concorrenzaScontata'), data: per_struttura.map(s => s.fatturato), backgroundColor: '#ce181e', borderRadius: 4 },
            { label: t('chart.mylavScontata'),  data: per_struttura.map(s => s.costo),    backgroundColor: '#0f76bc', borderRadius: 4 }
          ]
        },
        options: {
          animation: { duration: 600 },
          plugins: { legend: { display: true, labels: { font: { size: 11 } } },
            tooltip: tooltipDefaults() },
          scales: {
            x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11 } } },
            y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11 },
              callback: v => euroCompact(v) } }
          }
        }
      });
    }
  }
}

// ── Vista Foglio ───────────────────────────────────
// Riapre il file corrente (S.foglio) nel Calcolatore ROI, precaricandone le righe.
function modificaNelCalcolatore() {
  const f = S.foglio;
  if (!f || !Array.isArray(f.dati) || !f.dati.length) return;
  S.roi.struttura = f.file?.struttura_nome || '';
  const pid = f.dati.find(d => d.piano_id != null)?.piano_id;
  S.roi.pianoId = pid != null ? pid : null;
  S.roi.righe = f.dati.map(d => {
    const tc = d.totale_concorrenza || 0;
    const scRaw = tc > 0 ? Math.round((1 - (d.prezzo_scontato_concorrenza || 0) / tc) * 1000) / 10 : 0;
    return {
      esame: d.esame || '',
      n_esami: d.n_esami || 1,
      listino_concorrenza: d.listino_concorrenza || '',
      sconto_concorrenza: scRaw > 0 ? scRaw : '',
      listino_lav: d.listino_lav || '',
      prezzo_scontato_lav: d.prezzo_scontato_lav || ''
    };
  });
  if (!S.roi.righe.length) S.roi.righe = [roiRigaVuota()];
  navigate('dashboard');
}

async function renderFoglio(fileId, foglio) {
  let resp;
  try {
    resp = await api(`/api/file/${fileId}/dati?foglio=${encodeURIComponent(foglio)}`);
  } catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">${t('stato.errore')}</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  const { dati, totali: t, file } = resp;
  S.foglio = { dati, totali: t, file, foglio, fileId };

  if (!dati.length) {
    setMain(`<div class="empty-state"><div class="empty-icon">📭</div>
      <div class="empty-title">${window.t('foglio.nessunDato')}</div>
      <div class="empty-sub">${window.t('foglio.nessunaRigaPerFoglio', { foglio })}</div></div>`);
    return;
  }

  const datiSorted = [...dati].sort((a, b) => (b.risparmio_dottore || 0) - (a.risparmio_dottore || 0));
  const rispPct = t.risparmio_pct || 0;

  setMain(`
    <div class="page-header">
      <div>
        <div class="page-title">${file.struttura_nome} — ${foglio}</div>
        <div class="page-subtitle">${file.nome_file} &middot; ${fmtDate(file.data_carico)}</div>
      </div>
      <div class="page-actions export-bar">
        <button class="btn-outline" onclick="downloadPdf(${fileId}, ${jsAttr(foglio)}, 'dottore')">
          ${window.t('foglio.resocontoStruttura')}
        </button>
      </div>
    </div>

    <div class="page-body">
      <!-- KPI 4 card -->
      <div class="kpi-grid kpi-grid-4">
        <div class="kpi-card kpi-yellow">
          <div class="kpi-label">${window.t('foglio.paghiConMylav')}</div>
          <div class="kpi-value">${euro(t.totale_scontato_lav)}</div>
          <div class="kpi-sub">${window.t('foglio.kpi.paghiSub')}</div>
        </div>
        <div class="kpi-card kpi-red">
          <div class="kpi-label">${window.t('foglio.kpi.pagherestiLabel')}</div>
          <div class="kpi-value">${euro(t.prezzo_scontato_concorrenza)}</div>
          <div class="kpi-sub">${window.t('foglio.kpi.pagherestiSub')}</div>
        </div>
        <div class="kpi-card kpi-green">
          <div class="kpi-label">${window.t('foglio.kpi.risparmiLabel')}</div>
          <div class="kpi-value">${euro(t.risparmio_totale_dottore)}</div>
          <div class="kpi-sub">${window.t('foglio.kpi.risparmiSub')}</div>
        </div>
        <div class="kpi-card kpi-blue">
          <div class="kpi-label">${window.t('foglio.kpi.pctLabel')}</div>
          <div class="kpi-value">${rispPct}%</div>
          <div class="kpi-sub">${window.t('foglio.kpi.pctSub')}</div>
        </div>
      </div>

      <!-- Banner: riapri nel calcolatore -->
      <div class="roi-edit-banner" onclick="modificaNelCalcolatore()" title="${escHtml(window.t('foglio.banner.titleAttr'))}">
        <span class="roi-edit-ico">✏️</span>
        <div class="roi-edit-txt">
          <div class="roi-edit-title">${window.t('foglio.banner.titolo')}</div>
          <div class="roi-edit-sub">${window.t('foglio.banner.sub')}</div>
        </div>
        <span class="roi-edit-arrow">→</span>
      </div>

      <!-- Vista toggle -->
      <div class="vista-toggle-bar">
        <span class="vista-label">${window.t('foglio.vistaLabel')}</span>
        <div class="vista-toggle">
          <button class="vista-btn ${S.vistaMia ? 'active' : ''}" id="btn-mia"
                  onclick="setVista(true)">${window.t('foglio.vistaMia')}</button>
          <button class="vista-btn ${!S.vistaMia ? 'active' : ''}" id="btn-dottore"
                  onclick="setVista(false)">${window.t('foglio.vistaDottore')}</button>
        </div>
      </div>

      <!-- Grafici -->
      <div class="charts-row">
        <!-- Donut -->
        <div class="chart-card">
          <div class="chart-title" id="donut-title">${window.t('foglio.donutTitolo')}</div>
          <div id="donut-legend" class="chart-legend"></div>
          <div class="donut-wrap">
            <canvas id="chart-donut" height="220"></canvas>
            <div class="donut-center" id="donut-center">
              <div class="donut-center-value" id="donut-cv"></div>
              <div class="donut-center-label" id="donut-cl"></div>
            </div>
          </div>
        </div>

        <!-- Barre orizzontali -->
        <div class="chart-card">
          <div class="chart-title" id="barre-title">${window.t('foglio.barreTitolo')}</div>
          <div id="barre-legend" class="chart-legend"></div>
          <div class="chart-canvas-wrap" style="overflow:auto;max-height:320px">
            <canvas id="chart-barre"></canvas>
          </div>
        </div>
      </div>

      <!-- Tabella -->
      <div class="table-card">
        <div class="table-header">
          <div class="table-title" id="table-title">${window.t('foglio.tabellaTitolo')}</div>
        </div>
        <div class="table-scroll">
          <table>
            <thead id="table-head"></thead>
            <tbody id="table-body"></tbody>
          </table>
        </div>
      </div>
    </div>
  `);

  renderFoglioCharts(datiSorted, t);
  renderFoglioTable(datiSorted);
}

function setVista(mia) {
  S.vistaMia = mia;
  el('btn-mia')    ?.classList.toggle('active',  mia);
  el('btn-dottore')?.classList.toggle('active', !mia);

  if (S.foglio.dati) {
    const sorted = [...S.foglio.dati].sort((a, b) =>
      (b.risparmio_dottore || 0) - (a.risparmio_dottore || 0)
    );
    renderFoglioCharts(sorted, S.foglio.totali);
    renderFoglioTable(sorted);
  }
}

function tooltipDefaults(mode = 'index', stacked = false) {
  return {
    backgroundColor: '#fff',
    borderColor: '#e8e9eb',
    borderWidth: 1,
    titleColor: '#1a1a1a',
    bodyColor: '#6b7280',
    padding: 12,
    cornerRadius: 8,
    boxPadding: 4,
    mode,
    intersect: false,
    callbacks: {
      label: ctx => {
        const v = typeof ctx.raw === 'number' ? ctx.raw : ctx.parsed?.y ?? ctx.parsed?.x ?? 0;
        return `  ${ctx.dataset.label}: ${euro(v)}`;
      }
    }
  };
}

const whiteBgPlugin = {
  id: 'whiteBg',
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
};

function makeDonutOptions(tooltipCallbacks) {
  return {
    cutout: '65%',
    responsive: true,
    maintainAspectRatio: true,
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#fff',
        borderColor: '#e8e9eb',
        borderWidth: 1,
        titleColor: '#1a1a1a',
        bodyColor: '#6b7280',
        padding: 12,
        cornerRadius: 8,
        callbacks: tooltipCallbacks
      }
    }
  };
}

function renderFoglioCharts(dati, t) {
  ['donut', 'barre'].forEach(k => {
    if (S.charts[k]) { try { S.charts[k].destroy(); } catch(_){} delete S.charts[k]; }
  });

  if (S.vistaMia) {
    renderDonutMia(t);
    renderBarreMia(dati);
  } else {
    renderDonutDottore(t);
    renderBarreDottore(dati);
  }
}

// ─── DONUT Vista MIA (4 fette) ─────────────────────
function renderDonutMia(t) {
  const v1 = Math.max(0, t.totale_scontato_lav         || 0); // giallo
  const v2 = Math.max(0, t.sconto_totale_lav            || 0); // giallo chiaro
  const v3 = Math.max(0, t.risparmio_totale_dottore     || 0); // verde
  const v4 = Math.max(0, t.sconto_totale_concorrenza    || 0); // rosso
  const totale = v1 + v2 + v3 + v4;
  const base   = t.totale_concorrenza || 1;

  const labels = [
    window.t('foglio.legendaDonutMia.prezzoMylavDottore'),
    window.t('foglio.legendaDonutMia.scontoMylavApplicato'),
    window.t('foglio.legendaDonutMia.risparmioDottoreVsConc'),
    window.t('foglio.legendaDonutMia.scontoConcorrenzaApplicato')
  ];
  el('donut-cv').textContent = euro(t.risparmio_totale_dottore);
  el('donut-cl').textContent = window.t('comune.risparmio');
  el('donut-legend').innerHTML = legendHtml([
    { label: labels[0], color: '#0f76bc' },
    { label: labels[1], color: '#9cc8e8' },
    { label: labels[2], color: '#26262a' },
    { label: labels[3], color: '#ce181e' }
  ]);

  const canvas = el('chart-donut');
  if (!canvas) return;
  canvas.style.display = 'block';

  S.charts.donut = new Chart(canvas, {
    type: 'doughnut',
    plugins: [whiteBgPlugin],
    data: {
      labels,
      datasets: [{
        data: totale > 0 ? [v1, v2, v3, v4] : [1, 1, 1, 1],
        backgroundColor: ['#0f76bc', '#9cc8e8', '#26262a', '#ce181e'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: makeDonutOptions({
      title: items => items[0]?.label || '',
      label: ctx => {
        if (totale === 0) return '  ' + window.t('foglio.nessunDato');
        const v   = ctx.raw;
        const pct = base > 0 ? ((v / base) * 100).toFixed(1) : 0;
        return [`  € ${(Number(v)||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}`, '  ' + window.t('foglio.donutMia.tooltipPct', { pct })];
      }
    })
  });
}

// ─── DONUT Vista DOTTORE (2 fette) ────────────────
function renderDonutDottore(t) {
  const v1 = Math.max(0, t.totale_scontato_lav         || 0);
  const v2 = Math.max(0, t.risparmio_totale_dottore     || 0);
  const totale = v1 + v2;
  const pct = t.risparmio_pct || 0;

  const labels = [window.t('foglio.paghiConMylav'), window.t('foglio.risparmioVsMercato')];
  el('donut-cv').textContent = `${pct}%`;
  el('donut-cl').textContent = window.t('foglio.donutDottore.cl');
  el('donut-legend').innerHTML = legendHtml([
    { label: labels[0], color: '#0f76bc' },
    { label: labels[1], color: '#26262a' }
  ]);

  const canvas = el('chart-donut');
  if (!canvas) return;
  canvas.style.display = 'block';

  const concBase = t.prezzo_scontato_concorrenza || 0;

  S.charts.donut = new Chart(canvas, {
    type: 'doughnut',
    plugins: [whiteBgPlugin],
    data: {
      labels,
      datasets: [{
        data: totale > 0 ? [v1, v2] : [1, 1],
        backgroundColor: ['#0f76bc', '#26262a'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: makeDonutOptions({
      title: items => items[0]?.label || '',
      label: ctx => {
        if (totale === 0) return '  ' + window.t('foglio.nessunDato');
        if (ctx.dataIndex === 0) return [
          '  ' + window.t('foglio.tooltip.paghiMylavImporto', { importo: euro(ctx.raw) }),
          '  ' + window.t('foglio.tooltip.invece', { importo: euro(concBase) })
        ];
        return [
          '  ' + window.t('foglio.tooltip.risparmioImporto', { importo: euro(ctx.raw) }),
          '  ' + window.t('foglio.tooltip.percentuale', { pct })
        ];
      }
    })
  });
}

// ─── BARRE Vista MIA (stacked: giallo=Lav + verde=risparmio = totale concorrenza) ──
function renderBarreMia(dati) {
  const labelPago = t('foglio.paghiConMylav');
  const labelRisp = t('chart.risparmioDottore');
  el('barre-legend').innerHTML = legendHtml([
    { label: labelPago, color: '#0f76bc' },
    { label: labelRisp,    color: '#26262a' }
  ]);

  const canvas = el('chart-barre');
  if (!canvas) return;

  const h = Math.max(200, dati.length * 32);
  canvas.parentElement.style.height = h + 'px';
  canvas.style.display = 'block';

  S.charts.barre = new Chart(canvas, {
    type: 'bar',
    plugins: [whiteBgPlugin],
    data: {
      labels: dati.map(d => d.esame),
      datasets: [
        {
          label: labelPago,
          data: dati.map(d => Math.max(0, d.totale_scontato_lav || 0)),
          backgroundColor: '#0f76bc',
          borderRadius: 0
        },
        {
          label: labelRisp,
          data: dati.map(d => Math.max(0, d.risparmio_dottore || 0)),
          backgroundColor: '#26262a',
          borderRadius: { topRight: 4, bottomRight: 4 }
        }
      ]
    },
    options: makeBarreOptions(dati, true, {
      title: items => {
        const d = dati[items[0]?.dataIndex];
        return d ? `${d.esame}${d.n_esami > 1 ? ` (×${d.n_esami})` : ''}` : '';
      },
      label: ctx => {
        const d = dati[ctx.dataIndex];
        if (!d) return '';
        if (ctx.datasetIndex === 0) return '  ' + t('foglio.tooltip.paghiMylavImporto', { importo: euro(d.totale_scontato_lav) });
        const pct = d.prezzo_scontato_concorrenza > 0
          ? ((d.risparmio_dottore / d.prezzo_scontato_concorrenza) * 100).toFixed(1) : '0';
        return '  ' + t('foglio.tooltip.risparmioPct', { importo: euro(d.risparmio_dottore), pct });
      },
      afterBody: items => {
        const d = dati[items[0]?.dataIndex];
        if (!d) return [];
        return ['  ' + t('foglio.tooltip.totaleBarraMia', { importo: euro(d.prezzo_scontato_concorrenza) })];
      }
    })
  });
}

// ─── BARRE Vista DOTTORE (stacked: giallo=Lav + verde=risparmio) ──
function renderBarreDottore(dati) {
  const labelPago = t('foglio.paghiConMylav');
  const labelRisp = t('foglio.risparmioVsMercato');
  el('barre-legend').innerHTML = legendHtml([
    { label: labelPago, color: '#0f76bc' },
    { label: labelRisp, color: '#26262a' }
  ]);

  const canvas = el('chart-barre');
  if (!canvas) return;

  const h = Math.max(200, dati.length * 32);
  canvas.parentElement.style.height = h + 'px';
  canvas.style.display = 'block';

  S.charts.barre = new Chart(canvas, {
    type: 'bar',
    plugins: [whiteBgPlugin],
    data: {
      labels: dati.map(d => d.esame),
      datasets: [
        {
          label: labelPago,
          data: dati.map(d => Math.max(0, d.totale_scontato_lav || 0)),
          backgroundColor: '#0f76bc',
          borderRadius: 0
        },
        {
          label: labelRisp,
          data: dati.map(d => Math.max(0, d.risparmio_dottore || 0)),
          backgroundColor: '#26262a',
          borderRadius: { topRight: 4, bottomRight: 4 }
        }
      ]
    },
    options: makeBarreOptions(dati, true, {
      title: items => dati[items[0]?.dataIndex]?.esame || '',
      label: ctx => {
        const d = dati[ctx.dataIndex];
        if (!d) return '';
        if (ctx.datasetIndex === 0) return '  ' + t('foglio.tooltip.prezzoMylavImporto', { importo: euro(d.totale_scontato_lav) });
        const pct = d.prezzo_scontato_concorrenza > 0
          ? ((d.risparmio_dottore / d.prezzo_scontato_concorrenza) * 100).toFixed(1) : '0';
        return '  ' + t('foglio.tooltip.risparmiPct', { importo: euro(d.risparmio_dottore), pct });
      },
      afterBody: items => {
        const d = dati[items[0]?.dataIndex];
        if (!d) return [];
        return ['  ' + t('foglio.tooltip.prezzoMercatoImporto', { importo: euro(d.prezzo_scontato_concorrenza) })];
      }
    })
  });
}

function makeBarreOptions(dati, stacked, tooltipCbs) {
  return {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    scales: {
      x: {
        stacked: !!stacked,
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { font: { size: 11 }, callback: v => euroCompact(v) }
      },
      y: {
        stacked: !!stacked,
        grid: { display: false },
        ticks: { font: { size: 11 } }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'y', intersect: false,
        backgroundColor: '#fff', borderColor: '#e8e9eb', borderWidth: 1,
        titleColor: '#1a1a1a', bodyColor: '#6b7280',
        padding: 12, cornerRadius: 8,
        callbacks: tooltipCbs
      }
    }
  };
}

function legendHtml(items) {
  return items.map(i => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${i.color}"></span>
      <span>${i.label}</span>
    </div>`).join('');
}

function renderFoglioTable(dati) {
  const head = el('table-head');
  const body = el('table-body');
  if (!head || !body) return;

  if (S.vistaMia) {
    head.innerHTML = `<tr>
      <th>${t('piani.tabella.esame')}</th><th>${t('roi.tabella.n')}</th>
      <th>${t('comune.listinoConc')}</th><th>${t('comune.scontatoConc')}</th>
      <th>${t('foglio.tabella.listinoLav')}</th><th>${t('confrontoStrutture.tabella.scontatoLav')}</th>
      <th>${t('foglio.tabella.risparmioEuro')}</th><th>${t('foglio.tabella.risparmioPct')}</th>
    </tr>`;
    body.innerHTML = dati.map(d => {
      const risp = d.risparmio_dottore || 0;
      const pct  = d.prezzo_scontato_concorrenza > 0
        ? ((risp / d.prezzo_scontato_concorrenza) * 100).toFixed(1) : '0.0';
      return `<tr>
        <td>${d.esame}</td>
        <td class="text-center">${d.n_esami}</td>
        <td class="td-muted">${euro(d.listino_concorrenza)}</td>
        <td style="color:#ce181e">${euro(d.prezzo_scontato_concorrenza)}</td>
        <td class="td-muted">${euro(d.listino_lav)}</td>
        <td class="td-yellow">${euro(d.totale_scontato_lav)}</td>
        <td class="td-green">${euro(risp)}</td>
        <td class="td-green">${pct}%</td>
      </tr>`;
    }).join('');
  } else {
    head.innerHTML = `<tr>
      <th>${t('piani.tabella.esame')}</th><th>${t('roi.tabella.n')}</th>
      <th>${t('foglio.tabella.prezzoMercato')}</th><th>${t('foglio.tabella.prezzoMylav')}</th>
      <th>${t('foglio.tabella.risparmiEuro')}</th><th>${t('foglio.tabella.risparmiPct')}</th>
    </tr>`;
    body.innerHTML = dati.map(d => {
      const risp = d.risparmio_dottore || 0;
      const pct  = d.prezzo_scontato_concorrenza > 0
        ? ((risp / d.prezzo_scontato_concorrenza) * 100).toFixed(1) : '0.0';
      return `<tr>
        <td>${d.esame}</td>
        <td class="text-center">${d.n_esami}</td>
        <td style="color:#ce181e">${euro(d.prezzo_scontato_concorrenza)}</td>
        <td class="td-yellow">${euro(d.totale_scontato_lav)}</td>
        <td class="td-green">${euro(risp)}</td>
        <td class="td-green">${pct}%</td>
      </tr>`;
    }).join('');
  }
}

// ── Totali struttura ───────────────────────────────
async function renderTotali(strutturaId, nome) {
  let data;
  try {
    data = await api(`/api/strutture/${strutturaId}/aggregato`);
  } catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">Errore</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  const { struttura, files } = data;
  if (!files.length) {
    setMain(`<div class="empty-state"><div class="empty-icon">📭</div>
      <div class="empty-title">Nessun dato</div></div>`);
    return;
  }

  const cum = files.reduce((acc, f) => {
    for (const t of Object.values(f.fogli)) {
      acc.totale_concorrenza          += t.totale_concorrenza          || 0;
      acc.prezzo_scontato_concorrenza += t.prezzo_scontato_concorrenza || 0;
      acc.totale_scontato_lav         += t.totale_scontato_lav         || 0;
      acc.risparmio_totale_dottore    += t.risparmio_totale_dottore    || 0;
    }
    return acc;
  }, { totale_concorrenza: 0, prezzo_scontato_concorrenza: 0, totale_scontato_lav: 0, risparmio_totale_dottore: 0 });

  const labels       = files.map(f => fmtDate(f.file.data_carico));
  const foglioSet    = ['Foglio 1', 'Platinum', 'Gold'];
  const foglioColors = { 'Foglio 1': '#6b7280', 'Platinum': '#0f76bc', 'Gold': '#0f76bc' };

  setMain(`
    <div class="page-header">
      <div>
        <div class="page-title">Totali — ${struttura.nome}</div>
        <div class="page-subtitle">${files.length} file caricati</div>
      </div>
    </div>
    <div class="page-body">
      <div class="kpi-grid kpi-grid-4">
        <div class="kpi-card">
          <div class="kpi-label">Listino concorrenza</div>
          <div class="kpi-value">${euro(cum.totale_concorrenza)}</div>
        </div>
        <div class="kpi-card kpi-red">
          <div class="kpi-label">Scontato concorrenza</div>
          <div class="kpi-value">${euro(cum.prezzo_scontato_concorrenza)}</div>
        </div>
        <div class="kpi-card kpi-yellow">
          <div class="kpi-label">Scontato Mylav</div>
          <div class="kpi-value">${euro(cum.totale_scontato_lav)}</div>
        </div>
        <div class="kpi-card kpi-green">
          <div class="kpi-label">Risparmio dottore</div>
          <div class="kpi-value">${euro(cum.risparmio_totale_dottore)}</div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-title">Risparmio nel tempo</div>
        <div id="linea-legend" class="chart-legend" style="margin-bottom:12px"></div>
        <canvas id="chart-linea" height="220"></canvas>
      </div>

      <div class="section-card">
        <div class="section-card-title">Confronto file — Platinum vs Gold</div>
        <canvas id="chart-grouped" height="200"></canvas>
      </div>
    </div>
  `);

  const lineDatasets = foglioSet
    .filter(fg => files.some(f => f.fogli[fg]))
    .map(fg => ({
      label: fg,
      data: files.map(f => f.fogli[fg]?.risparmio_totale_dottore ?? null),
      borderColor: foglioColors[fg],
      backgroundColor: foglioColors[fg] + '22',
      tension: 0.3,
      fill: false,
      pointRadius: 5,
      pointHoverRadius: 7,
      spanGaps: true
    }));

  el('linea-legend').innerHTML = lineDatasets
    .map(d => `<div class="legend-item">
      <span class="legend-dot" style="background:${d.borderColor}"></span>
      <span>${d.label}</span></div>`).join('');

  S.charts.linea = new Chart(el('chart-linea'), {
    type: 'line',
    data: { labels, datasets: lineDatasets },
    options: {
      animation: { duration: 600 },
      plugins: { legend: { display: false }, tooltip: tooltipDefaults() },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11 } } },
        y: { grid: { color: 'rgba(0,0,0,0.05)' },
             ticks: { font: { size: 11 }, callback: v => euroCompact(v) } }
      }
    }
  });

  const pgDatasets = ['Platinum', 'Gold']
    .filter(fg => files.some(f => f.fogli[fg]))
    .map(fg => ({
      label: fg,
      data: files.map(f => f.fogli[fg]?.prezzo_scontato_concorrenza ?? 0),
      backgroundColor: foglioColors[fg],
      borderRadius: 4
    }));

  S.charts.grouped = new Chart(el('chart-grouped'), {
    type: 'bar',
    data: { labels, datasets: pgDatasets },
    options: {
      animation: { duration: 600 },
      plugins: { legend: { display: true, labels: { font: { size: 12 } } },
                 tooltip: tooltipDefaults() },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: 'rgba(0,0,0,0.05)' },
             ticks: { font: { size: 11 }, callback: v => euroCompact(v) } }
      }
    }
  });
}

// ── Cronologia ─────────────────────────────────────
async function renderCronologia() {
  let rows, strutture;
  try {
    [rows, strutture] = await Promise.all([api('/api/cronologia'), api('/api/strutture')]);
  } catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">${t('stato.errore')}</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  const optStrutture = strutture.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');

  setMain(`
    <div class="page-header">
      <div><div class="page-title">${t('pagina.cronologia.titolo')}</div>
        <div class="page-subtitle">${t('pagina.cronologia.sottotitolo')}</div>
      </div>
    </div>
    <div class="page-body">
      <div class="filter-bar">
        <label>${t('cronologia.filtroLabel')}</label>
        <select id="filter-struttura" onchange="filterCronologia()">
          <option value="">${t('cronologia.tutte')}</option>
          ${optStrutture}
        </select>
      </div>
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>${t('cronologia.tabella.data')}</th><th>${t('cronologia.tabella.file')}</th><th>${t('comune.struttura')}</th><th>${t('cronologia.tabella.fogli')}</th>
              <th>${t('chart.concorrenzaScontata')}</th><th>${t('chart.mylavScontata')}</th><th>${t('comune.risparmio')}</th><th></th>
            </tr></thead>
            <tbody id="crono-tbody">
              ${buildCronoRows(rows)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `);

  window._cronoRows = rows;
}

function buildCronoRows(rows) {
  if (!rows.length) return `<tr><td colspan="7" class="td-muted text-center" style="padding:24px">
    ${t('cronologia.nessunFile')}</td></tr>`;

  // Se la stessa struttura ha piu' salvataggi, numerali (n) in ordine di creazione
  // (id crescente = piu' vecchio prima) cosi' si distinguono in elenco.
  const perStruttura = {};
  rows.forEach(r => { (perStruttura[r.struttura_id] = perStruttura[r.struttura_id] || []).push(r); });
  Object.values(perStruttura).forEach(list => {
    if (list.length < 2) return;
    list.slice().sort((a, b) => a.id - b.id).forEach((r, i) => { r._ordine = i + 1; });
  });

  return rows.map(r => `
    <tr class="clickable" onclick="navigateFromCrono(${r.id}, ${r.struttura_id}, ${jsAttr((r.fogli||'').split(',')[0])})">
      <td class="td-muted">${fmtDate(r.data_carico)}</td>
      <td>${r.nome_file}${r._ordine ? ` <span class="crono-ordine">(${r._ordine})</span>` : ''}</td>
      <td>${r.struttura_nome}</td>
      <td>${(r.fogli || '').split(',').map(f => `<span class="badge badge-gray">${f}</span>`).join(' ')}</td>
      <td style="color:#ce181e">${euro(r.totale_dottore)}</td>
      <td class="td-yellow">${euro(r.totale_costo)}</td>
      <td class="td-green">${euro(r.differenziale)}</td>
      <td onclick="event.stopPropagation()">
        <button class="roi-del-btn" onclick="deleteCrono(${r.id})" title="${escHtml(t('comune.elimina'))}">×</button>
      </td>
    </tr>`).join('');
}

async function filterCronologia() {
  const sId = el('filter-struttura')?.value;
  const url = sId ? `/api/cronologia?struttura_id=${sId}` : '/api/cronologia';
  const rows = await api(url).catch(() => []);
  const tbody = el('crono-tbody');
  if (tbody) tbody.innerHTML = buildCronoRows(rows);
}

async function deleteCrono(id) {
  if (!confirm(t('cronologia.confermaElimina'))) return;
  try {
    await fetch(`/api/cronologia/${id}`, { method: 'DELETE', headers: authHeaders() });
    await loadStrutture();
    buildSidebar();
    renderCronologia();
  } catch (e) {
    alert(t('errore.generico', { msg: e.message }));
  }
}

function navigateFromCrono(fileId, strutturaId, foglio) {
  navigate('foglio', { fileId, foglio, strutturaId });
}

// ── Cronologia clip ─────────────────────────────────
// Voce di menu propria, separata da "Cronologia file": legge solo
// calcoli_clip/righe_calcolo_clip, mai file_caricati/dati_foglio.
async function renderCronologiaClip() {
  let rows;
  try { rows = await api('/api/calcolo-clip'); }
  catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">${t('stato.errore')}</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  setMain(`
    <div class="page-header">
      <div><div class="page-title">${t('pagina.cronologiaClip.titolo')}</div>
        <div class="page-subtitle">${t('pagina.cronologiaClip.sottotitolo')}</div>
      </div>
    </div>
    <div class="page-body">
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>${t('cronologia.tabella.data')}</th><th>${t('comune.struttura')}</th>
              <th>${t('cronologiaClip.tabella.righe')}</th><th>${t('comune.risparmio')}</th><th></th>
            </tr></thead>
            <tbody id="crono-clip-tbody">
              ${buildCronoClipRows(rows)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `);
}

function buildCronoClipRows(rows) {
  if (!rows.length) return `<tr><td colspan="5" class="td-muted text-center" style="padding:24px">
    ${t('cronologiaClip.nessunCalcolo')}</td></tr>`;

  return rows.map(r => `
    <tr class="clickable" onclick="apriCalcoloClipDaCronologia(${r.id})">
      <td class="td-muted">${fmtDate(r.data)}</td>
      <td>${escHtml(r.struttura_nome || '')}</td>
      <td>${r.n_righe || 0}</td>
      <td class="td-green">${euro(r.differenziale)}</td>
      <td onclick="event.stopPropagation()">
        <button class="roi-del-btn" onclick="deleteCronoClip(${r.id}, ${r.n_righe || 0}, ${jsAttr(r.struttura_nome)})" title="${escHtml(t('comune.elimina'))}">×</button>
      </td>
    </tr>`).join('');
}

async function deleteCronoClip(id, nRighe, struttura) {
  const chiave = nRighe === 1 ? 'cronologiaClip.confermaElimina.uno' : 'cronologiaClip.confermaElimina';
  if (!confirm(t(chiave, { n: nRighe, struttura }))) return;
  try {
    await api(`/api/calcolo-clip/${id}`, { method: 'DELETE' });
    renderCronologiaClip();
  } catch (e) {
    alert(t('errore.generico', { msg: e.message }));
  }
}

// Riapre un calcolo salvato dentro il calcolatore clip: righe e piano come
// erano al momento del salvataggio (fotografia, non riferimento al catalogo o
// al piano correnti). Se il piano non esiste piu' (disattivato o rimosso) si
// apre comunque, senza piano, e lo si dice invece di far fallire l'apertura.
async function apriCalcoloClipDaCronologia(id) {
  let resp;
  try { resp = await api(`/api/calcolo-clip/${id}`); }
  catch (e) { alert(t('errore.generico', { msg: e.message })); return; }

  const { calcolo, righe, piano } = resp;
  S.clip.pianoId = piano ? piano.id : null;
  S.clip.righe = righe.map((r, i) => ({
    // La struttura e' una colonna di ogni riga nel calcolatore, ma nel salvataggio
    // e' un solo campo di testata: si rimette solo sulla prima riga, come la fa
    // leggere salvaCalcoloClip al momento del salvataggio.
    struttura: i === 0 ? (calcolo.struttura_nome || '') : '',
    clip_nome: r.clip_nome || '',
    n_clip: r.n_clip || 1,
    prezzo_confezione: r.prezzo_confezione ?? '',
    pezzi: r.pezzi ?? '',
    sconto_clip: r.sconto_clip ?? '',
    profilo_mylav: r.profilo_mylav || '',
    n_mylav: r.n_mylav || 1,
    listino_lav: r.listino_lav ?? '',
    prezzo_scontato_lav: r.prezzo_scontato_lav ?? ''
  }));
  if (!S.clip.righe.length) S.clip.righe = [clipRigaVuota()];

  await navigate('calcolatore-clip');

  if (calcolo.piano_id != null && !piano) {
    clipMsg(t('clip.pianoNonPiuDisponibile'), 'info');
  }
}

// ── Confronto strutture ────────────────────────────
async function renderConfronto() {
  let data;
  try { data = await api('/api/confronto'); }
  catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">${t('stato.errore')}</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  if (data.length < 2) {
    setMain(`<div class="empty-state">
      <div class="empty-icon">⚖️</div>
      <div class="empty-title">${t('confrontoStrutture.serveAlmeno2')}</div>
      <div class="empty-sub">${t('confrontoStrutture.caricaDatiSub')}</div>
    </div>`);
    return;
  }

  setMain(`
    <div class="page-header">
      <div><div class="page-title">${t('pagina.confrontoStrutture.titolo')}</div>
        <div class="page-subtitle">${t('pagina.confrontoStrutture.sottotitolo' + (data.length === 1 ? '.uno' : ''), { n: data.length })}</div>
      </div>
    </div>
    <div class="page-body">
      <div class="section-card">
        <div class="section-card-title">${t('confrontoStrutture.chartTitolo')}</div>
        <div class="chart-legend" id="conf-legend" style="margin-bottom:12px"></div>
        <canvas id="chart-conf" height="240"></canvas>
      </div>

      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>${t('comune.struttura')}</th><th>${t('comune.listinoConc')}</th>
              <th>${t('comune.scontatoConc')}</th><th>${t('confrontoStrutture.tabella.scontatoLav')}</th><th>${t('comune.risparmio')}</th>
            </tr></thead>
            <tbody>
              ${data.map(s => `<tr>
                <td><strong>${s.nome}</strong></td>
                <td class="td-muted">${euro(s.totale_concorrenza)}</td>
                <td style="color:#ce181e">${euro(s.prezzo_scontato_concorrenza)}</td>
                <td class="td-yellow">${euro(s.totale_scontato_lav)}</td>
                <td class="td-green">${euro(s.risparmio_totale)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `);

  el('conf-legend').innerHTML = legendHtml([
    { label: t('chart.concorrenzaScontata'), color: '#ce181e' },
    { label: t('chart.mylavScontata'),  color: '#5fa8db' },
    { label: t('chart.risparmioDottore'),    color: '#0f76bc' }
  ]);

  S.charts.conf = new Chart(el('chart-conf'), {
    type: 'bar',
    data: {
      labels: data.map(s => s.nome),
      datasets: [
        { label: t('chart.concorrenzaScontata'), data: data.map(s => s.prezzo_scontato_concorrenza), backgroundColor: '#ce181e', borderRadius: 4 },
        { label: t('chart.mylavScontata'),  data: data.map(s => s.totale_scontato_lav),         backgroundColor: '#5fa8db', borderRadius: 4 },
        { label: t('chart.risparmioDottore'),    data: data.map(s => s.risparmio_totale),              backgroundColor: '#0f76bc', borderRadius: 4 }
      ]
    },
    options: {
      animation: { duration: 600 },
      plugins: { legend: { display: false }, tooltip: tooltipDefaults() },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: 'rgba(0,0,0,0.05)' },
             ticks: { font: { size: 11 }, callback: v => euroCompact(v) } }
      }
    }
  });
}

// ── Upload ─────────────────────────────────────────
function openUploadModal() {
  el('upload-modal').hidden   = false;
  el('modal-backdrop').hidden = false;
  el('upload-status').hidden  = true;
  el('upload-status').className = 'upload-status';
  el('upload-status').textContent = '';
}
function closeUploadModal() {
  el('upload-modal').hidden   = true;
  el('modal-backdrop').hidden = true;
}
function showStatus(type, msg) {
  const s = el('upload-status');
  s.hidden = false;
  s.className = `upload-status ${type}`;
  s.innerHTML = msg;
}

async function doUpload(file, force = false) {
  if (S.auth.guest || !S.auth.token) { showStatus('error', '❌ ' + t('stato.ospiteAccedi', { azione: t('azione.salvareDati') })); return; }
  showStatus('loading', '<div class="spinner" style="width:18px;height:18px"></div> ' + t('caricamento.elaborazione'));

  const fd = new FormData();
  fd.append('file', file);
  if (force) fd.append('force', '1');

  let resp;
  try {
    const res = await fetch('/api/upload', { method: 'POST', headers: authHeaders(), body: fd });
    resp = await res.json();

    if (res.status === 409 && resp.conflict) {
      el('confirm-msg').textContent = t('caricamento.confermaSovrascrivi', { file: file.name, struttura: resp.struttura });
      el('confirm-modal').hidden = false;
      el('confirm-ok').onclick  = () => { el('confirm-modal').hidden = true; doUpload(file, true); };
      el('confirm-cancel').onclick = () => { el('confirm-modal').hidden = true; };
      el('upload-status').hidden = true;
      return;
    }
    if (!res.ok) throw new Error(I18n.messaggioErrore(resp, t('errore.upload')));
  } catch (e) {
    showStatus('error', '❌ ' + e.message);
    return;
  }

  await loadStrutture();
  S.expanded[resp.struttura_id] = true;
  closeUploadModal();
  navigate('foglio', {
    fileId:      resp.file_id,
    foglio:      resp.fogli[0],
    strutturaId: resp.struttura_id
  });
}

async function downloadPdf(fileId, foglio, tipo) {
  const donutCanvas = el('chart-donut');
  const barreCanvas = el('chart-barre');
  const donutImg = donutCanvas ? donutCanvas.toDataURL('image/png') : null;
  const barreImg = barreCanvas ? barreCanvas.toDataURL('image/png') : null;

  // Le legende sono HTML separati dal canvas: le catturo per riprodurle nel PDF.
  const grabLegend = id => [...document.querySelectorAll(`#${id} .legend-item`)].map(it => ({
    label: (it.querySelector('span:last-child')?.textContent || '').trim(),
    color: it.querySelector('.legend-dot')?.style.background || '#26262a'
  }));
  const donutLegend = grabLegend('donut-legend');
  const barreLegend = grabLegend('barre-legend');

  let res;
  try {
    res = await fetch(`/api/pdf/${tipo}/${fileId}/${encodeURIComponent(foglio)}`, {
      method:  'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify({ donutImg, barreImg, donutLegend, barreLegend })
    });
  } catch (e) {
    alert(t('errore.reteMsg', { msg: e.message }));
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const fallback = res.statusText || t('errore.rispostaServer', { stato: res.status });
    alert(t('errore.pdfMsg', { msg: I18n.messaggioErrore(err, fallback) }));
    return;
  }

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `mylav_${foglio}_${tipo}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Dropzone ───────────────────────────────────────
function initDropzone() {
  const dz = el('dropzone');
  const fi = el('file-input');
  if (!dz || !fi) return;

  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => {
    if (fi.files[0]) doUpload(fi.files[0]);
    fi.value = '';
  });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) doUpload(file);
  });

  el('modal-close').addEventListener('click', closeUploadModal);
  el('modal-backdrop').addEventListener('click', closeUploadModal);
}

// ── Debug Excel ─────────────────────────────────────
function renderDebug() {
  setMain(`
    <div class="page-header">
      <div>
        <div class="page-title">${t('pagina.debug.titolo')}</div>
        <div class="page-subtitle">${t('pagina.debug.sottotitolo')}</div>
      </div>
    </div>
    <div class="page-body">
      <div class="section-card">
        <div class="section-card-title">${t('pagina.debug.caricaTitolo')}</div>
        <div style="margin-top:12px">
          <input type="file" id="dbg-input" accept=".xlsx,.xls"
                 style="font-size:13px;padding:6px;border:1px solid #e8e9eb;border-radius:6px;width:100%">
        </div>
        <div id="dbg-result" style="margin-top:16px"></div>
      </div>
    </div>
  `);

  el('dbg-input').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    const out = el('dbg-result');
    out.innerHTML = '<div class="spinner" style="width:20px;height:20px"></div>';
    const fd = new FormData();
    fd.append('file', file);
    const res  = await fetch('/api/debug', { method: 'POST', headers: authHeaders(), body: fd });
    const data = await res.json();
    let html = '';
    for (const [sheet, info] of Object.entries(data)) {
      html += `<div style="margin-bottom:24px">
        <div style="font-weight:500;font-size:14px;margin-bottom:8px;color:#0f76bc">
          ${t('pagina.debug.foglioInfo', { sheet, riga: info.hRow })}
        </div>
        <div style="font-family:monospace;font-size:12px;background:#f5f6f8;
                    padding:12px;border-radius:6px;overflow-x:auto;white-space:pre">${info.headers.join('\n')}</div>
        <div style="margin-top:8px;font-size:12px;color:#6b7280;font-weight:500">${t('pagina.debug.prime3Righe')}</div>
        <div style="font-family:monospace;font-size:11px;background:#f5f6f8;
                    padding:10px;border-radius:6px;overflow-x:auto;white-space:pre;margin-top:4px">${
          info.sample.map((r,i) => t('pagina.debug.rigaN', { n: i + 1, json: JSON.stringify(r) })).join('\n')
        }</div>
      </div>`;
    }
    out.innerHTML = html || `<div style="color:#6b7280">${t('pagina.debug.nessunFoglio')}</div>`;
  });
}

// ── Gestione piani ──────────────────────────────────
async function renderPiani() {
  let elenco;
  try { elenco = await api('/api/piani?all=1'); }
  catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">${t('stato.errore')}</div><div class="empty-sub">${escHtml(e.message)}</div></div>`);
    return;
  }

  S.pianiAdmin = elenco;
  // Ogni account modifica la PROPRIA copia del catalogo: basta essere loggati.
  const admin = !!(S.auth && S.auth.token && !S.auth.guest);
  setMain(`
    <div class="page-header">
      <div><div class="page-title">${t('pagina.piani.titolo')}</div>
        <div class="page-subtitle">${t('pagina.piani.sottotitolo' + (elenco.length === 1 ? '.uno' : ''), { n: elenco.length })}</div>
      </div>
      <div class="page-actions">
        ${admin ? `<label class="btn-outline" for="piani-import-input">${t('piani.importaJson')}</label>
        <input type="file" id="piani-import-input" accept=".json" style="display:none" onchange="importaPianiJson(this)">
        <button class="btn-outline" onclick="ImportPdf.avvia({ entita: 'piano' })">${t('comune.importaListinoPdf')}</button>` : ''}
      </div>
    </div>
    <div class="page-body">
      ${admin ? '' : `<div class="empty-state" style="padding:12px 16px;margin-bottom:14px;text-align:left">
        <div class="empty-sub">${t('piani.avvisoOspite')}</div>
      </div>`}
      <div class="dett-toolbar" style="margin-bottom:14px">
        <input class="roi-input dett-search" id="piani-search" placeholder="${escHtml(t('piani.cercaPlaceholder'))}"
               value="${escHtml(S.pianiFiltro || '')}" oninput="filtraPiani(this.value)" autocomplete="off">
      </div>
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>${t('piani.tabella.nome')}</th><th>${t('piani.tabella.categoria')}</th><th>${t('piani.tabella.anno')}</th><th>${t('piani.tabella.attivo')}</th><th></th></tr></thead>
            <tbody id="piani-tbody"></tbody>
          </table>
        </div>
      </div>
      <div id="piano-edit-wrap"></div>
    </div>
  `);
  renderPianiBody();
}

function renderPianiBody() {
  const tb = el('piani-tbody');
  if (!tb) return;
  // Ogni account modifica la PROPRIA copia del catalogo: basta essere loggati.
  const admin = !!(S.auth && S.auth.token && !S.auth.guest);
  const q = (S.pianiFiltro || '').trim().toLowerCase();
  const list = (S.pianiAdmin || []).filter(p =>
    !q || p.nome.toLowerCase().includes(q) || (p.categoria || '').toLowerCase().includes(q));
  tb.innerHTML = list.map(p => `<tr>
    <td>${escHtml(p.nome)}</td>
    <td class="td-muted">${escHtml(p.categoria)}</td>
    <td class="td-muted">${p.anno || '—'}</td>
    <td>${p.attivo ? '✅' : '❌'}</td>
    <td style="display:flex;gap:6px">
      ${admin
        ? `<button class="btn-outline" onclick="togglePianoAttivo(${p.id}, ${p.attivo ? 0 : 1})">${p.attivo ? t('piani.disattiva') : t('piani.attiva')}</button>
      <button class="btn-outline" onclick="renderPianoEdit(${p.id})">${t('piani.modificaPrezzi')}</button>`
        : `<button class="btn-outline" onclick="renderPianoEdit(${p.id})">${t('piani.vediPrezzi')}</button>`}
    </td>
  </tr>`).join('') || `<tr><td colspan="5" class="td-muted" style="text-align:center;padding:16px">${t('piani.nessunTrovato')}</td></tr>`;
}

function filtraPiani(v) {
  S.pianiFiltro = v;
  renderPianiBody();
}

async function togglePianoAttivo(id, attivo) {
  if (S.auth.guest || !S.auth.token) { alert(t('stato.ospiteAccedi', { azione: t('azione.modificarePiani') })); return; }
  try {
    await api(`/api/piani/${id}/attivo`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attivo })
    });
    await loadPiani();
    renderPiani();
  } catch (e) {
    alert(t('errore.generico', { msg: e.message }));
  }
}

async function renderPianoEdit(id) {
  _sottoVista = { tipo: 'pianoEdit', arg: id };
  let data;
  try {
    data = await api(`/api/piani/${id}`);
  } catch (e) {
    alert(t('errore.generico', { msg: e.message }));
    return;
  }
  const wrap = el('piano-edit-wrap');
  if (!wrap) return;
  // Ogni account modifica la PROPRIA copia del catalogo: basta essere loggati.
  const admin = !!(S.auth && S.auth.token && !S.auth.guest);
  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">${t('piani.titoloPrezziPiano', { nome: escHtml(data.piano.nome) })}</div>
      ${admin ? '' : `<div class="empty-sub" style="margin-bottom:10px">${t('piani.avvisoOspiteBreve')}</div>`}
      <table class="roi-editable-table">
        <thead><tr><th>${t('piani.tabella.esame')}</th><th>${t('piani.tabella.prezzoBase')}</th><th>${t('piani.tabella.prezzoPiano')}</th></tr></thead>
        <tbody>
          ${data.prezzi.map(p => `<tr>
            <td>${escHtml(p.esame_nome)}</td>
            <td class="td-muted">${fmtE(p.prezzo_base)}</td>
            <td><input class="roi-input roi-num" data-esame-id="${p.esame_id}" value="${p.prezzo != null ? p.prezzo : ''}" placeholder="0.00" ${admin ? '' : 'disabled'}></td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${admin ? `<button class="btn-primary mt-4" onclick="salvaPianoPrezzi(${id})">${t('piani.salvaPrezziBtn')}</button>` : ''}
    </div>
  `;
}

async function salvaPianoPrezzi(id) {
  if (S.auth.guest || !S.auth.token) { alert(t('stato.ospiteAccedi', { azione: t('azione.modificarePiani') })); return; }
  const wrap = el('piano-edit-wrap');
  const inputs = wrap.querySelectorAll('[data-esame-id]');
  const prezzi = Array.from(inputs)
    .map(inp => ({ esame_id: Number(inp.dataset.esameId), prezzo: parseFloat(inp.value) }))
    .filter(p => !isNaN(p.prezzo));
  try {
    await api(`/api/piani/${id}/prezzi`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prezzi })
    });
    alert(t('piani.prezziSalvati'));
  } catch (e) {
    alert(t('errore.generico', { msg: e.message }));
  }
}

async function importaPianiJson(inputEl) {
  if (S.auth.guest || !S.auth.token) { alert(t('stato.ospiteAccedi', { azione: t('azione.salvareDati') })); inputEl.value = ''; return; }
  const file = inputEl.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { alert(t('piani.jsonNonValido')); return; }
  try {
    const resp = await fetch('/api/piani/import', {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!resp.ok) {
      const dati = await resp.json().catch(() => ({}));
      throw new Error(I18n.messaggioErrore(dati, t('errore.rispostaServer', { stato: resp.status })));
    }
    await loadPiani();
    renderPiani();
    alert(t('comune.importCompletato'));
  } catch (e) { alert(`${t('comune.erroreImport')}: ${e.message}`); }
  inputEl.value = '';
}

// ══════════════════════════════════════════════════
// GESTIONE CONCORRENTI
// ══════════════════════════════════════════════════

async function renderConcorrentiAdmin() {
  let elenco;
  try { elenco = await api('/api/concorrenti'); }
  catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">${t('stato.errore')}</div><div class="empty-sub">${escHtml(e.message)}</div></div>`);
    return;
  }

  setMain(`
    <div class="page-header">
      <div><div class="page-title">${t('pagina.concorrenti.titolo')}</div>
        <div class="page-subtitle">${t('pagina.concorrenti.sottotitolo' + (elenco.length === 1 ? '.uno' : ''), { n: elenco.length })}</div>
      </div>
      <div class="page-actions">
        <label class="btn-outline" for="concorrenti-import-input">${t('concorrenti.importaListinoExcel')}</label>
        <input type="file" id="concorrenti-import-input" accept=".xlsx,.xls" style="display:none" onchange="avviaImportConcorrente(this)">
        <button class="btn-outline" onclick="importaPdfConcorrente()">${t('comune.importaListinoPdf')}</button>
      </div>
    </div>
    <div class="page-body">
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>${t('concorrenti.tabella.nome')}</th><th>${t('concorrenti.tabella.dataImport')}</th><th>${t('concorrenti.tabella.esami')}</th><th>${t('concorrenti.tabella.mappati')}</th><th></th></tr></thead>
            <tbody>
              ${elenco.map(c => `<tr>
                <td>${escHtml(c.nome)}</td>
                <td class="td-muted">${fmtDate(c.data_import)}</td>
                <td class="td-muted">${c.n_esami}</td>
                <td class="td-muted">${c.n_mappati} / ${c.n_esami}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn-outline" onclick="renderConcorrenteDettaglio(${c.id})">${t('concorrenti.vediEsami')}</button>
                  <button class="btn-outline" onclick="eliminaConcorrenteUI(${c.id})" style="color:var(--red);border-color:var(--red)">${t('comune.elimina')}</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div id="concorrente-import-wrap"></div>
      <div id="concorrente-dettaglio-wrap"></div>
    </div>
  `);
}

async function avviaImportConcorrente(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  let parsed;
  try {
    const resp = await fetch('/api/concorrenti/import', { method: 'POST', headers: authHeaders(), body: formData });
    if (!resp.ok) {
      const dati = await resp.json().catch(() => ({}));
      throw new Error(I18n.messaggioErrore(dati, t('errore.rispostaServer', { stato: resp.status })));
    }
    parsed = await resp.json();
  } catch (e) {
    alert(`${t('concorrenti.erroreLetturaFile')}: ${e.message}`);
    inputEl.value = '';
    return;
  }
  inputEl.value = '';

  if (!parsed.headers.length || !parsed.rows.length) {
    alert(t('concorrenti.headerNonTrovato'));
    return;
  }

  window._importConcorrenteRows = parsed.rows;
  renderImportConcorrenteForm(parsed);
}

function renderImportConcorrenteForm(parsed) {
  const wrap = el('concorrente-import-wrap');
  if (!wrap) return;
  const opts = parsed.headers.map((h, i) => `<option value="${i}">[${i}] ${escHtml(h || t('concorrenti.colonnaVuota'))}</option>`).join('');
  const optsConSconto = `<option value="-1">${t('concorrenti.nessunaColonnaSconto')}</option>` + opts;

  const anteprima = parsed.rows.slice(0, 5).map(r =>
    `<tr>${parsed.headers.map((_, i) => `<td>${escHtml(r[i])}</td>`).join('')}</tr>`
  ).join('');

  const titoloChiave = parsed.rows.length === 1 ? 'concorrenti.confermaColonneTitolo.uno' : 'concorrenti.confermaColonneTitolo.molti';

  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">${t(titoloChiave, { n: parsed.rows.length })}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <label>${t('concorrenti.labelNomeConcorrente')}<br>
          <input class="roi-input" id="import-nome-concorrente" placeholder="${escHtml(t('concorrenti.placeholderNomeEsempio'))}" style="width:200px">
        </label>
        <label>${t('concorrenti.labelColonnaNomeEsame')}<br>
          <select class="roi-input" id="import-col-esame" style="width:200px">${opts}</select>
        </label>
        <label>${t('concorrenti.labelColonnaPrezzo')}<br>
          <select class="roi-input" id="import-col-prezzo" style="width:200px">${opts}</select>
        </label>
        <label>${t('concorrenti.labelColonnaSconto')}<br>
          <select class="roi-input" id="import-col-sconto" style="width:200px">${optsConSconto}</select>
        </label>
      </div>
      <div class="table-scroll" style="margin-bottom:12px">
        <table><thead><tr>${parsed.headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${anteprima}</tbody></table>
      </div>
      <button class="btn-primary" onclick="confermaImportConcorrente()">${t('concorrenti.confermaImportBtn')}</button>
    </div>
  `;
  const selEsame = el('import-col-esame');
  const selPrezzo = el('import-col-prezzo');
  const selSconto = el('import-col-sconto');
  if (selEsame && parsed.colEsame >= 0) selEsame.value = String(parsed.colEsame);
  if (selPrezzo && parsed.colPrezzo >= 0) selPrezzo.value = String(parsed.colPrezzo);
  if (selSconto) selSconto.value = String(parsed.colSconto);
}

async function confermaImportConcorrente() {
  if (S.auth.guest || !S.auth.token) { alert(t('stato.ospiteAccedi', { azione: t('azione.salvareDati') })); return; }
  const nomeConcorrente = el('import-nome-concorrente')?.value.trim();
  const colEsame  = Number(el('import-col-esame')?.value);
  const colPrezzo = Number(el('import-col-prezzo')?.value);
  const colSconto = Number(el('import-col-sconto')?.value);
  const rows = window._importConcorrenteRows || [];

  if (!nomeConcorrente) return alert(t('concorrenti.inserisciNomeConcorrente'));
  if (!rows.length) return alert(t('concorrenti.nessunaRigaImportare'));

  try {
    await api('/api/concorrenti/import/conferma', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeConcorrente, colEsame, colPrezzo, colSconto, rows })
    });
    await loadConcorrenti();
    renderConcorrentiAdmin();
    alert(t('comune.importCompletato'));
  } catch (e) {
    alert(`${t('comune.erroreImport')}: ${e.message}`);
  }
}

async function eliminaConcorrenteUI(id) {
  const c = S.concorrenti.find(x => x.id === id);
  const nome = c ? c.nome : t('concorrenti.questoConcorrente');
  const nEsami = c && c.n_esami != null ? c.n_esami : null;
  const chiave = nEsami == null
    ? 'concorrenti.confermaElimina.senzaConteggio'
    : (nEsami === 1 ? 'concorrenti.confermaElimina.uno' : 'concorrenti.confermaElimina.molti');
  if (!confirm(t(chiave, { nome, n: nEsami }))) return;
  try {
    await api(`/api/concorrenti/${id}`, { method: 'DELETE' });
    scordaSottoVista('concorrente', id);
    await loadConcorrenti();
    renderConcorrentiAdmin();
  } catch (e) { alert(t('errore.generico', { msg: e.message })); }
}

// ── Import PDF ──
// Il flusso completo (analisi, anteprima affiancata con evidenziazione,
// revisione editabile e conferma di completezza) vive in public/importpdf.js
// ed e' lo stesso usato da Gestione piani: un solo componente, due destinazioni.
function importaPdfConcorrente() {
  if (S.auth.guest || !S.auth.token) { alert(t('stato.ospiteAccedi', { azione: t('azione.importareListino') })); return; }
  ImportPdf.avvia({
    entita: 'concorrente',
    alFine: async () => {
      await loadConcorrenti();
      renderConcorrentiAdmin();
    }
  });
}

async function renderConcorrenteDettaglio(id) {
  _sottoVista = { tipo: 'concorrente', arg: id };
  let dettaglio;
  try { dettaglio = await api(`/api/concorrenti/${id}`); }
  catch (e) { alert(t('errore.generico', { msg: e.message })); return; }

  const wrap = el('concorrente-dettaglio-wrap');
  if (!wrap) return;

  // Nomi del catalogo Mylav per l'autocomplete del campo "Nome Mylav" (una volta, in cache).
  if (!S.esamiMylavNomi) S.esamiMylavNomi = await api('/api/esami-riferimento/nomi').catch(() => []);

  // Stato locale della vista (ricerca + ordinamento) — il body si ri-renderizza senza ricaricare.
  S.concDett = { id, esami: dettaglio.esami, nome: dettaglio.concorrente.nome, filtro: '', dir: 1 };

  const hint = S.mappingDaRoi;   // lista di esami Mylav da mappare, arrivata dal Calcolatore ROI
  S.mappingDaRoi = null;         // consuma (una volta sola)
  const hintHtml = (Array.isArray(hint) && hint.length)
    ? `<div class="dett-maphint">${t(hint.length === 1 ? 'concorrenti.hintMapping.uno' : 'concorrenti.hintMapping.molti', {
        n: hint.length,
        elenco: hint.map(h => `<strong>${escHtml(h)}</strong>`).join(' · ')
      })}</div>`
    : '';

  const datalist = `<datalist id="mylav-esami-list">${(S.esamiMylavNomi || []).map(n => `<option value="${escHtml(n)}">`).join('')}</datalist>`;

  wrap.innerHTML = `
    <div class="section-card" data-concorrente-id="${id}">
      ${datalist}
      <div class="section-card-title">${t('concorrenti.titoloEsamiConcorrente', { nome: escHtml(dettaglio.concorrente.nome) })}</div>
      ${hintHtml}
      <div class="dett-maplabel">${t('concorrenti.mapLabel')}</div>
      <div class="dett-toolbar">
        <input class="roi-input dett-search" id="conc-search" placeholder="${escHtml(t('concorrenti.cercaEsamePlaceholder'))}"
               oninput="filtraDettaglio(this.value)" autocomplete="off">
        <button class="btn-outline" id="conc-sort" onclick="toggleSortDettaglio()">${t('concorrenti.ordinaAZ')}</button>
      </div>
      <div id="conc-dett-body"></div>
    </div>
  `;
  renderDettaglioBody();
}

function renderDettaglioBody() {
  const body = el('conc-dett-body');
  const st = S.concDett;
  if (!body || !st) return;

  const q = st.filtro.trim().toLowerCase();
  const byNome = (a, b) => st.dir * a.nome_originale.localeCompare(b.nome_originale, 'it', { sensitivity: 'base' });
  const filtrati = st.esami.filter(e => !q || e.nome_originale.toLowerCase().includes(q));
  const mappati    = filtrati.filter(e => e.esame_mylav_nome).sort(byNome);
  const nonMappati = filtrati.filter(e => !e.esame_mylav_nome).sort(byNome);

  const rigaHtml = e => `<tr>
    <td>${escHtml(e.nome_originale)}</td>
    <td class="td-muted">${fmtE(e.prezzo)}</td>
    <td class="td-muted">${e.sconto != null ? e.sconto + '%' : '—'}</td>
    <td>${e.esame_mylav_nome ? (e.confermato ? t('concorrenti.statoConfermato') : t('concorrenti.statoAuto')) : t('concorrenti.statoNonMappato')}</td>
    <td><input class="roi-input" data-esame-concorrente-id="${e.id}" list="mylav-esami-list" value="${escHtml(e.esame_mylav_nome || '')}" placeholder="${escHtml(t('concorrenti.sceglieEsameMylavPlaceholder'))}" autocomplete="off" style="width:220px"></td>
    <td style="display:flex;gap:6px">
      <button class="btn-outline" onclick="salvaMappaturaManuale(${st.id}, ${e.id})">${t('comune.salva')}</button>
      ${e.esame_mylav_nome ? `<button class="btn-outline" onclick="rimuoviMappaturaManuale(${st.id}, ${e.id})">${t('concorrenti.rimuovi')}</button>` : ''}
    </td>
  </tr>`;

  const tabella = (lista) => `
    <table class="roi-editable-table" style="margin-bottom:8px">
      <thead><tr><th>${t('concorrenti.tabella.nomeOriginale')}</th><th>${t('concorrenti.tabella.prezzo')}</th><th>${t('concorrenti.tabella.sconto')}</th><th>${t('concorrenti.tabella.stato')}</th><th>${t('concorrenti.tabella.nomeMylav')}</th><th></th></tr></thead>
      <tbody>${lista.map(rigaHtml).join('')}</tbody>
    </table>`;

  const gruppo = (titolo, cls, lista) => `
    <div class="grp-title ${cls}">${titolo} (${lista.length})</div>
    ${lista.length ? tabella(lista) : `<div class="td-muted" style="padding:4px 0">${t('concorrenti.nessuno')}</div>`}`;

  body.innerHTML = gruppo(t('concorrenti.grpMappati'), 'grp-map', mappati) + gruppo(t('concorrenti.grpDaMappare'), 'grp-nomap', nonMappati);
}

function filtraDettaglio(v) {
  if (!S.concDett) return;
  S.concDett.filtro = v;
  renderDettaglioBody();
}

function toggleSortDettaglio() {
  if (!S.concDett) return;
  S.concDett.dir = -S.concDett.dir;
  const btn = el('conc-sort');
  if (btn) btn.textContent = S.concDett.dir === 1 ? t('concorrenti.ordinaAZ') : t('concorrenti.ordinaZA');
  renderDettaglioBody();
}

async function salvaMappaturaManuale(concorrenteId, esameConcorrenteId) {
  if (S.auth.guest || !S.auth.token) { alert(t('stato.ospiteAccedi', { azione: t('azione.salvareDati') })); return; }
  const inp = document.querySelector(`[data-esame-concorrente-id="${esameConcorrenteId}"]`);
  const esameMylavNome = inp ? inp.value.trim() : '';
  if (!esameMylavNome) return alert(t('concorrenti.scriviNomeEsameMylav'));
  try {
    await api(`/api/concorrenti/${concorrenteId}/conferma-match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ esameConcorrenteId, esameMylavNome })
    });
    // aggiornamento istantaneo: sposta la riga in "Mappati" senza refresh, preservando la ricerca
    if (S.concDett && S.concDett.id === concorrenteId) {
      const row = S.concDett.esami.find(e => e.id === esameConcorrenteId);
      if (row) { row.esame_mylav_nome = esameMylavNome; row.confermato = 1; }
      renderDettaglioBody();
    }
    // il nuovo nome Mylav diventa disponibile in autocomplete calcolatore e datalist
    if (Array.isArray(S.esamiMylavNomi) && !S.esamiMylavNomi.includes(esameMylavNome)) {
      S.esamiMylavNomi.push(esameMylavNome);
      const dl = el('mylav-esami-list');
      if (dl) { const opt = document.createElement('option'); opt.value = esameMylavNome; dl.appendChild(opt); }
    }
  } catch (e) { alert(t('errore.generico', { msg: e.message })); }
}

async function rimuoviMappaturaManuale(concorrenteId, esameConcorrenteId) {
  if (S.auth.guest || !S.auth.token) { alert(t('stato.ospiteAccedi', { azione: t('azione.salvareDati') })); return; }
  try {
    await api(`/api/concorrenti/${concorrenteId}/rimuovi-match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ esameConcorrenteId })
    });
    if (S.concDett && S.concDett.id === concorrenteId) {
      const row = S.concDett.esami.find(e => e.id === esameConcorrenteId);
      if (row) { row.esame_mylav_nome = null; row.confermato = 0; }
      renderDettaglioBody();
    }
  } catch (e) { alert(t('errore.generico', { msg: e.message })); }
}

// ══════════════════════════════════════════════════
// ROI CALCOLATORE
// ══════════════════════════════════════════════════

// Descrittore del calcolatore esami per il motore comune (calcolatore.js).
// Le 16 colonne della tabella, nell'ordine in cui compaiono: struttura e una
// colonna di servizio vuota, le 6 della concorrenza, le 6 di Mylav, il
// risparmio e il bottone di eliminazione riga.
const colonneRoiEsami = [
  { col: 'struttura', tipo: 'vuota', larghezza: 130, gruppo: 'nessuno',
    intestazione: 'comune.struttura',
    contenutoVuoto: (r, i) => i === 0
      ? `<input class="roi-input roi-struttura-inp" list="roi-strutture-list" value="${escHtml(S.roi.struttura)}" placeholder="${escHtml(t('roi.placeholderStruttura'))}" autocomplete="off" oninput="S.roi.struttura=this.value" style="width:120px">`
      : '' },
  { col: '__spacer', tipo: 'vuota', larghezza: 12, gruppo: 'nessuno' },
  { col: 'esame_concorrente', tipo: 'testo', larghezza: 170, larghezzaCampo: 160, gruppo: 'concorrenza',
    intestazione: 'roi.tabella.esameConc', elenco: 'roi-esami-conc-list', posizioneRelativa: true,
    segnaposto: () => t('roi.placeholderEsameConc') },
  { col: 'n_concorrenza', tipo: 'numero', larghezza: 60, larghezzaCampo: 50, gruppo: 'concorrenza',
    intestazione: 'roi.tabella.n', fallbackSuZero: '',
    segnaposto: r => r.n_esami || 1 },
  { col: 'listino_concorrenza', tipo: 'numero', larghezza: 95, gruppo: 'concorrenza',
    intestazione: 'comune.listinoConc', totale: 'tot_listino_conc', segnaposto: '0.00' },
  { col: 'sconto_concorrenza', tipo: 'numero', larghezza: 65, larghezzaCampo: 55, gruppo: 'concorrenza',
    intestazione: 'roi.tabella.scontoPct', segnaposto: '%',
    valore: r => { const sc = parseFloat(r.sconto_concorrenza) || 0; return sc > 0 ? String(sc) : ''; } },
  { col: 'tot_conc', tipo: 'calcolato', larghezza: 95, gruppo: 'concorrenza',
    intestazione: 'roi.tabella.totConc', totale: 'tot_conc' },
  { col: 'prezzo_conc', tipo: 'calcolato', larghezza: 95, gruppo: 'concorrenza',
    intestazione: 'comune.scontatoConc', totale: 'tot_prezzo_conc' },
  { col: 'esame', tipo: 'testo', larghezza: 170, larghezzaCampo: 160, gruppo: 'mylav',
    intestazione: 'roi.tabella.esameMyl', posizioneRelativa: true,
    segnaposto: () => t('roi.placeholderEsame'),
    extra: (r, i) => `<button class="roi-lega-btn" data-idx="${i}" onclick="salvaAbbinamentoRiga(${i})" title="${escHtml(t('roi.legaTooltip'))}" style="display:none">🔗</button>` },
  { col: 'n_esami', tipo: 'numero', larghezza: 60, larghezzaCampo: 50, gruppo: 'mylav',
    intestazione: 'roi.tabella.n', fallbackSuZero: 1, segnaposto: '1' },
  { col: 'listino_lav', tipo: 'numero', larghezza: 95, gruppo: 'mylav',
    intestazione: 'roi.tabella.listinoMyl', totale: 'tot_listino_lav', segnaposto: '0.00' },
  { col: 'tot_listino_lav', tipo: 'calcolato', larghezza: 95, gruppo: 'mylav',
    intestazione: 'roi.tabella.totMyl', totale: 'tot_tot_lav' },
  { col: 'prezzo_scontato_lav', tipo: 'numero', larghezza: 95, gruppo: 'mylav',
    intestazione: 'roi.tabella.pianoMyl', totale: 'tot_prezzo_lav_sc', segnaposto: '0.00' },
  { col: 'tot_prezzo_lav', tipo: 'calcolato', larghezza: 95, gruppo: 'mylav',
    intestazione: 'roi.tabella.totScMyl', totale: 'tot_tot_prezzo_lav' },
  { col: 'risparmio', tipo: 'calcolato', larghezza: 95, gruppo: 'nessuno', separaInTestata: true,
    intestazione: 'comune.risparmio', totale: 'differenziale', coloreCondizionale: true },
  { col: '__delete', tipo: 'vuota', larghezza: 28, gruppo: 'nessuno', separaInTestata: true,
    contenutoVuoto: (r, i) => `<button class="roi-del-btn" onclick="removeRigaRoi(${i})" title="${escHtml(t('concorrenti.rimuovi'))}">×</button>` }
];

// La cascata di riempimento quando un campo perde il focus: e' la stessa
// funzione per tutti i campi, e' il campo (col) a decidere cosa fare.
async function suCampoUscitoRoiEsami(tr, col) {
  if (col === 'esame') {
    await aggiornaPrezziAutomatici(tr);
    aggiornaTastoAbbinamento(tr);
  } else if (col === 'esame_concorrente') {
    await compilaDaEsameConcorrente(tr);
  } else if (col === 'prezzo_scontato_lav') {
    const inp = tr.querySelector('[data-col="prezzo_scontato_lav"]');
    if (inp && S.roi.pianoId && inp.dataset.auto !== '1' && inp.value.trim()) {
      const esameInp = tr.querySelector('[data-col="esame"]');
      const esame = esameInp ? esameInp.value.trim() : '';
      if (esame) {
        await fetch('/api/prezzi-custom', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ esame_nome: esame, piano_id: S.roi.pianoId, prezzo: parseFloat(inp.value) || 0 })
        });
        inp.dataset.auto = '1';
        inp.classList.remove('roi-prezzo-nuovo');
        inp.title = t('roi.tooltip.prezzoCustomSalvatoOra');
      }
    }
  }
}

// Selezionato un suggerimento dalla tendina esami: la cascata prezzi Mylav,
// poi il pre-riempimento (solo se vuoti) dai prezzi storici dell'esame.
async function suSelezioneAutocompleteRoiEsami(tr, nome) {
  await aggiornaPrezziAutomatici(tr);
  const prezzi = await fetch(`/api/esami/prezzi?nome=${encodeURIComponent(nome)}`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({}));
  if (prezzi.listino_lav) {
    const llInp = tr.querySelector('[data-col="listino_lav"]');
    if (llInp && !llInp.value) llInp.value = prezzi.listino_lav;
  }
  if (prezzi.prezzo_scontato_lav) {
    const plInp = tr.querySelector('[data-col="prezzo_scontato_lav"]');
    if (plInp && !plInp.value) plInp.value = prezzi.prezzo_scontato_lav;
  }
}

const motoreEsami = window.Calcolatore.crea({
  chiave: 'esami',
  idTbody: 'roi-tbody',
  idTableWrap: 'roi-table-wrap',
  idMsg: 'roi-msg',
  idAc: 'roi-ac',
  stato: () => S.roi,
  rigaVuota: roiRigaVuota,
  colonne: colonneRoiEsami,
  calcolaRiga: r => calcolaRigaRoi(r),
  totali: righe => calcolaRoiTotali(righe),
  suCampoUscito: suCampoUscitoRoiEsami,
  rigaValida: r => !!(r.esame && r.esame.trim()),
  colonnaAutocomplete: 'esame',
  suggerimenti: q => fetch(`/api/esami/autocomplete?q=${encodeURIComponent(q)}`, { headers: authHeaders() }).then(r => r.json()),
  suSelezioneAutocomplete: suSelezioneAutocompleteRoiEsami,
  dopoTotali: () => updateDashRisparmio(),
  dopoInizializzaEventi: () => {
    // Ristretto al proprio contenitore: con due calcolatori nella stessa pagina
    // una ricerca su tutto il documento prenderebbe anche le righe dell'altro.
    const wrap = el('roi-table-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('[data-col="esame"]').forEach(inp => {
      inp.dataset.lastEsame = (inp.value || '').trim();
    });
  },
  tipoRiga: 'Platinum',
  etichettaTotaleRiga: 'roi.tabella.totale',
  etichettaDifferenziale: 'roi.differenzialeTotale',
  avvisoNegativo: 'roi.avvisoNonRisparmia'
});

function buildRoiSectionHtml() {
  const struttureOpts = S.strutture.map(s => `<option value="${escHtml(s.nome)}">`).join('');

  return `
    <datalist id="roi-strutture-list">${struttureOpts}</datalist>
    <datalist id="roi-esami-conc-list">${(S.roi.esamiConc || []).map(e => `<option value="${escHtml(e.nome_originale)}">`).join('')}</datalist>
    <div class="roi-toolbar">
      <div>
        <div class="roi-toolbar-title">${t('roi.toolbarTitolo')}</div>
        <div class="roi-toolbar-sub">${t('roi.toolbarSub')}</div>
      </div>
      <div class="roi-toolbar-controls">
        <div style="position:relative">
          <button class="btn-outline roi-piano-btn roi-pill-myl" id="roi-piano-btn"
                  onclick="togglePianoPanel()" title="${escHtml(pianoSelezionatoNome() || '')}">
            ${t('roi.pianoBtn', { nome: escHtml(pianoSelezionatoNome() || t('roi.nessuno')) })}
          </button>
          <div id="roi-piano-panel" class="roi-piano-panel" style="display:none"></div>
        </div>
        <div style="position:relative">
          <button class="btn-outline roi-piano-btn roi-pill-conc" id="roi-concorrente-btn"
                  onclick="toggleConcorrentePanel()" title="${escHtml(concorrenteSelezionatoNome() || '')}">
            ${t('roi.concorrenteBtn', { nome: escHtml(concorrenteSelezionatoNome() || t('roi.nessuno')) })}
          </button>
          <div id="roi-concorrente-panel" class="roi-piano-panel" style="display:none"></div>
        </div>
      </div>
    </div>
    <div id="roi-table-wrap" style="overflow-x:auto">${motoreEsami.disegnaTabella()}</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn-outline" onclick="addRigaRoi()" style="font-size:12px">${t('roi.aggiungiEsame')}</button>
    </div>
    <div id="roi-msg" style="margin-top:8px;font-size:12px;min-height:18px"></div>
    <div id="roi-ac" class="roi-autocomplete" style="display:none"></div>
    <div id="roi-consiglio-banner" class="roi-consiglio-banner" style="display:none"></div>
    <div id="roi-match-banner" class="roi-consiglio-banner roi-match-banner" style="display:none"></div>
  `;
}

// Barra azioni sotto il banner Risparmio: salvataggio/export + scorciatoie a Gestione piani/concorrenti
function buildRoiActionsHtml() {
  return `
    <div class="roi-actions-bar">
      <button class="btn-outline" onclick="salvaCalcolo()" style="color:var(--blue);border-color:var(--blue)">${t('roi.salvaComeFile')}</button>
      <button class="btn-outline" onclick="esportaExcelRoi()">${t('roi.esportaExcel')}</button>
      <button class="btn-outline" onclick="navigate('piani')" style="color:var(--blue);border-color:var(--blue)">${t('roi.aggiungiPianoMyl')}</button>
      <button class="btn-outline" onclick="navigate('concorrenti')" style="color:var(--red);border-color:var(--red)">${t('roi.aggiungiPianoConcorrenza')}</button>
    </div>
    <button class="roi-clear-all-btn" onclick="rimuoviTuttoRoi()">${t('confronto.rimuoviTutto')}</button>
    <div id="roi-classifica"></div>`;
}

// Azzera completamente il calcolatore ROI: righe, struttura, piano, concorrente.
function rimuoviTuttoRoi() {
  if (!confirm(t('roi.confermaRimuoviTutto'))) return;
  S.roi.struttura = '';
  S.roi.pianoId = null;
  S.roi.concorrenteId = null;
  S.roi.righe = [roiRigaVuota()];
  navigate('dashboard');
}

function pianoSelezionatoNome() {
  const p = S.piani.find(p => p.id === S.roi.pianoId);
  return p ? p.nome : null;
}

function togglePianoPanel() {
  const panel = el('roi-piano-panel');
  if (!panel) return;
  const show = panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  if (show) renderPianoPanel('');
}

function renderPianoPanel(filtro) {
  const panel = el('roi-piano-panel');
  if (!panel) return;
  const f = filtro.trim().toLowerCase();
  const filtrati = S.piani.filter(p => !f || p.nome.toLowerCase().includes(f));
  const perCategoria = {};
  filtrati.forEach(p => { (perCategoria[p.categoria] = perCategoria[p.categoria] || []).push(p); });

  let html = `<input class="roi-input" id="roi-piano-search" placeholder="${escHtml(t('roi.cercaPianoPlaceholder'))}"
    value="${escHtml(filtro)}" oninput="renderPianoPanel(this.value)"
    style="width:100%;box-sizing:border-box;margin-bottom:8px;border:1px solid #e8e9eb">`;
  html += `<div class="roi-piano-item" onclick="selezionaPiano(null)" style="font-style:italic">${t('roi.nessunPianoOpzione')}</div>`;
  for (const [categoria, items] of Object.entries(perCategoria)) {
    html += `<div class="roi-piano-categoria">${escHtml(categoria)}</div>`;
    items.forEach(p => {
      html += `<div class="roi-piano-item" onclick="selezionaPiano(${p.id})">${escHtml(p.nome)}</div>`;
    });
  }
  panel.innerHTML = html;
  const inp = el('roi-piano-search');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function selezionaPiano(id) {
  S.roi.pianoId = id;
  const panel = el('roi-piano-panel');
  if (panel) panel.style.display = 'none';
  const btn = el('roi-piano-btn');
  if (btn) {
    btn.textContent = t('roi.pianoBtn', { nome: pianoSelezionatoNome() || t('roi.nessuno') });
    btn.title = pianoSelezionatoNome() || '';
  }
  const tbody = el('roi-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaPrezziAutomatici(tr, true));
  }
}

function concorrenteSelezionatoNome() {
  const c = S.concorrenti.find(c => c.id === S.roi.concorrenteId);
  return c ? c.nome : null;
}

function toggleConcorrentePanel() {
  const panel = el('roi-concorrente-panel');
  if (!panel) return;
  const show = panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  if (show) renderConcorrentePanel('');
}

function renderConcorrentePanel(filtro) {
  const panel = el('roi-concorrente-panel');
  if (!panel) return;
  const f = filtro.trim().toLowerCase();
  const filtrati = S.concorrenti.filter(c => !f || c.nome.toLowerCase().includes(f));

  let html = `<input class="roi-input" id="roi-concorrente-search" placeholder="${escHtml(t('roi.cercaConcorrentePlaceholder'))}"
    value="${escHtml(filtro)}" oninput="renderConcorrentePanel(this.value)"
    style="width:100%;box-sizing:border-box;margin-bottom:8px;border:1px solid #e8e9eb">`;
  html += `<div class="roi-piano-item" onclick="selezionaConcorrente(null)" style="font-style:italic">${t('roi.nessunConcorrenteOpzione')}</div>`;
  filtrati.forEach(c => {
    html += `<div class="roi-piano-item" onclick="selezionaConcorrente(${c.id})">${escHtml(c.nome)}</div>`;
  });
  panel.innerHTML = html;
  const inp = el('roi-concorrente-search');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function selezionaConcorrente(id) {
  S.roi.concorrenteId = id;
  const panel = el('roi-concorrente-panel');
  if (panel) panel.style.display = 'none';
  const btn = el('roi-concorrente-btn');
  if (btn) {
    btn.textContent = t('roi.concorrenteBtn', { nome: concorrenteSelezionatoNome() || t('roi.nessuno') });
    btn.title = concorrenteSelezionatoNome() || '';
  }
  caricaEsamiConcorrente();
  const tbody = el('roi-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaMatchConcorrente(tr));
  }
}

// Il listino del concorrente selezionato, tenuto in memoria: serve a suggerire i
// nomi nella colonna concorrenza e a riempire prezzo, sconto ed esame Mylav
// abbinato senza una chiamata per ogni tasto premuto.
async function caricaEsamiConcorrente() {
  const id = S.roi.concorrenteId;
  if (!id) { S.roi.esamiConc = []; aggiornaElencoEsamiConc(); return; }
  try {
    const d = await api(`/api/concorrenti/${id}`);
    S.roi.esamiConc = (d && d.esami) || [];
  } catch (_) {
    // Elenco non leggibile: si resta senza suggerimenti, i campi restano a mano.
    S.roi.esamiConc = [];
  }
  aggiornaElencoEsamiConc();
}

function aggiornaElencoEsamiConc() {
  const dl = el('roi-esami-conc-list');
  if (!dl) return;
  dl.innerHTML = (S.roi.esamiConc || [])
    .map(e => `<option value="${escHtml(e.nome_originale)}">`).join('');
}

// Cerca nel listino del concorrente il nome digitato. Prima la corrispondenza
// esatta; poi quella tollerante (errori di battitura, parole in altro ordine),
// ma solo se e' l'unica, perche' riempire prezzi con l'esame sbagliato e' peggio
// che non riempirli.
function trovaEsameConcorrente(nome) {
  const elenco = S.roi.esamiConc || [];
  const n = String(nome || '').trim();
  if (!n || !elenco.length) return null;
  const esatto = elenco.find(e => (e.nome_originale || '').trim().toLowerCase() === n.toLowerCase());
  if (esatto) return esatto;
  if (!window.Ricerca) return null;
  const vicini = elenco.filter(e => Ricerca.corrisponde(e.nome_originale, n));
  return vicini.length === 1 ? vicini[0] : null;
}

// Riempie la riga a partire dall'esame del concorrente: prezzo e sconto suoi, e
// se quell'esame e' gia' abbinato a un esame Mylav anche il nome Mylav, da cui
// riparte la cascata dei prezzi Mylav che esisteva gia'.
async function compilaDaEsameConcorrente(tr) {
  const inp = tr.querySelector('[data-col="esame_concorrente"]');
  if (!inp) return;
  const nome = inp.value.trim();
  const prec = inp.dataset.lastEsameConc || '';
  if (nome === prec) { aggiornaTastoAbbinamento(tr); return; }
  inp.dataset.lastEsameConc = nome;

  const lcInp = tr.querySelector('[data-col="listino_concorrenza"]');
  const scInp = tr.querySelector('[data-col="sconto_concorrenza"]');
  const esameInp0 = tr.querySelector('[data-col="esame"]');

  // Cambiato l'esame del concorrente, quello che era stato riempito da solo per
  // l'esame precedente non vale piu': va tolto, altrimenti la riga accosta due
  // esami che non c'entrano nulla e i prezzi sembrano giusti. Quello che ha
  // scritto l'operatore resta: non e' roba nostra da cancellare.
  [lcInp, scInp].forEach(i => { if (i && i.dataset.auto === '1') { i.value = ''; i.dataset.auto = '0'; } });
  if (esameInp0 && esameInp0.dataset.auto === '1') {
    esameInp0.value = '';
    esameInp0.dataset.auto = '0';
    await aggiornaPrezziAutomatici(tr);
  }

  if (!nome) { aggiornaRigaDOM(tr); aggiornaTastoAbbinamento(tr); return; }

  const e = trovaEsameConcorrente(nome);
  if (!e) { aggiornaRigaDOM(tr); aggiornaTastoAbbinamento(tr); return; }
  if (lcInp && e.prezzo != null && campoFillabile(lcInp)) { lcInp.value = e.prezzo; lcInp.dataset.auto = '1'; }
  if (scInp && e.sconto != null && campoFillabile(scInp)) { scInp.value = e.sconto; scInp.dataset.auto = '1'; }

  const esameInp = tr.querySelector('[data-col="esame"]');
  if (esameInp && e.esame_mylav_nome && campoFillabile(esameInp)) {
    esameInp.value = e.esame_mylav_nome;
    esameInp.dataset.auto = '1';
    await aggiornaPrezziAutomatici(tr);
  }
  aggiornaRigaDOM(tr);
  aggiornaTastoAbbinamento(tr);
  mostraConsiglioTotale();
  mostraClassificaPiani();
}

// Il comando per legare i due esami compare solo quando serve: entrambi i nomi
// scritti, l'esame del concorrente riconosciuto, e l'abbinamento non gia' fatto.
function aggiornaTastoAbbinamento(tr) {
  const btn = tr.querySelector('.roi-lega-btn');
  if (!btn) return;
  const conc = (tr.querySelector('[data-col="esame_concorrente"]') || {}).value || '';
  const myl  = (tr.querySelector('[data-col="esame"]') || {}).value || '';
  const e = trovaEsameConcorrente(conc);
  const serve = !!(e && myl.trim() && (e.esame_mylav_nome || '').trim().toLowerCase() !== myl.trim().toLowerCase());
  btn.style.display = serve ? 'inline-block' : 'none';
}

// Salva la coppia nel listino del concorrente, la stessa mappatura che si fa in
// Gestione concorrenti: quel percorso resta, questo lo affianca.
async function salvaAbbinamentoRiga(i) {
  const tr = document.querySelector(`#roi-tbody tr[data-idx="${i}"]`);
  if (!tr || !S.roi.concorrenteId) return;
  const conc = (tr.querySelector('[data-col="esame_concorrente"]') || {}).value || '';
  const myl  = (tr.querySelector('[data-col="esame"]') || {}).value || '';
  const e = trovaEsameConcorrente(conc);
  if (!e || !myl.trim()) return;
  try {
    await api(`/api/concorrenti/${S.roi.concorrenteId}/conferma-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ esameConcorrenteId: e.id, esameMylavNome: myl.trim() })
    });
    e.esame_mylav_nome = myl.trim();   // l'elenco in memoria riflette subito il salvataggio
    e.confermato = 1;
    aggiornaTastoAbbinamento(tr);
    alert(t('roi.abbinamentoSalvato', { conc: e.nome_originale, myl: myl.trim() }));
  } catch (err) {
    alert(t('errore.generico', { msg: err.message }));
  }
}

async function aggiornaMatchConcorrente(tr) {
  const banner = el('roi-match-banner');
  const esameInp = tr.querySelector('[data-col="esame"]');
  const lcInp = tr.querySelector('[data-col="listino_concorrenza"]');
  const scInp = tr.querySelector('[data-col="sconto_concorrenza"]');
  if (!esameInp || !lcInp || !scInp) return;
  const esame = esameInp.value.trim();

  if (!S.roi.concorrenteId || !esame) {
    if (banner) banner.style.display = 'none';
    return;
  }

  const requestedConcorrenteId = S.roi.concorrenteId;
  const m = await fetch(`/api/concorrenti/${requestedConcorrenteId}/match?esame=${encodeURIComponent(esame)}`, { headers: authHeaders() })
    .then(r => r.json()).catch(() => ({ trovato: false }));
  if (S.roi.concorrenteId !== requestedConcorrenteId) return; // selezione concorrente cambiata nel frattempo

  if (m.trovato && m.sicuro) {
    if (banner) banner.style.display = 'none';
    if (campoFillabile(lcInp)) {
      lcInp.value = m.prezzo;
      lcInp.dataset.auto = '1';
    }
    if (m.sconto != null && campoFillabile(scInp)) {
      scInp.value = m.sconto;
      scInp.dataset.auto = '1';
    }
    aggiornaRigaDOM(tr);
  } else if (m.trovato && !m.sicuro) {
    mostraBannerMatch(tr, m);
  } else {
    // nessuna corrispondenza: banner cliccabile per mappare a mano nel listino concorrente
    mostraBannerNoMatch(esame, requestedConcorrenteId);
  }
}

function mostraBannerNoMatch(esame, concorrenteId) {
  const banner = el('roi-match-banner');
  if (!banner) return;
  banner.innerHTML = `
    <span class="roi-consiglio-close" onclick="event.stopPropagation(); this.parentElement.style.display='none'">×</span>
    <div onclick="mappaturaManualeDaRoi(${concorrenteId})" style="cursor:pointer">
      ${t('roi.matchBanner.nessunaCorrispondenza', { esame: escHtml(esame) })}<br>
      <span style="font-size:11px;color:#6b7280">${t('roi.matchBanner.clicaMappa')}</span>
    </div>
  `;
  banner.style.display = 'block';
}

async function mappaturaManualeDaRoi(concorrenteId) {
  const banner = el('roi-match-banner');
  if (banner) banner.style.display = 'none';

  // Raccogli TUTTI gli esami in tabella che NON hanno un match sicuro per questo concorrente
  const nomi = getRoiRigheValide().map(r => r.esame);
  const stati = await Promise.all(nomi.map(n =>
    fetch(`/api/concorrenti/${concorrenteId}/match?esame=${encodeURIComponent(n)}`, { headers: authHeaders() })
      .then(r => r.json()).then(m => ({ n, ok: !!(m.trovato && m.sicuro) })).catch(() => ({ n, ok: false }))
  ));
  S.mappingDaRoi = stati.filter(s => !s.ok).map(s => s.n);   // array di nomi Mylav da mappare

  window._currentView = 'concorrenti';
  await renderConcorrentiAdmin();
  await renderConcorrenteDettaglio(concorrenteId);
  el('concorrente-dettaglio-wrap')?.scrollIntoView({ behavior: 'smooth' });
  const s = el('conc-search');
  if (s) s.focus();
  buildSidebar();
}

function mostraBannerMatch(tr, m) {
  const banner = el('roi-match-banner');
  if (!banner) return;
  banner.innerHTML = `
    <span class="roi-consiglio-close" onclick="event.stopPropagation(); this.parentElement.style.display='none'">×</span>
    <div onclick="confermaMatchBanner(${tr.dataset.idx}, ${m.esameConcorrenteId})" style="cursor:pointer">
      ${t('roi.matchBanner.forseCorrisponde', { nome: escHtml(m.nomeOriginale), prezzo: fmtE(m.prezzo) })}<br>
      <span style="font-size:11px;color:#6b7280">${t('roi.matchBanner.clicaConfermare')}</span>
    </div>
  `;
  banner.style.display = 'block';
}

async function confermaMatchBanner(idx, esameConcorrenteId) {
  const tbody = el('roi-tbody');
  const tr = tbody?.querySelector(`tr[data-idx="${idx}"]`);
  if (!tr || !S.roi.concorrenteId) return;
  const esameInp = tr.querySelector('[data-col="esame"]');
  const esame = esameInp ? esameInp.value.trim() : '';
  if (!esame) return;

  await fetch(`/api/concorrenti/${S.roi.concorrenteId}/conferma-match`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ esameConcorrenteId, esameMylavNome: esame })
  });
  const banner = el('roi-match-banner');
  if (banner) banner.style.display = 'none';
  await aggiornaMatchConcorrente(tr);
}

function calcPrezConc(lc, sc, n) {
  const mult = sc > 0 ? (1 - sc / 100) : 1;
  return parseFloat((lc * mult).toFixed(2));
}

// Ridotta al solo calcolo: la costruzione dell'HTML (intestazioni, righe,
// piede) e' ora generica e vive nel motore comune (calcolatore.js), guidata
// dall'elenco delle colonne. Questa funzione resta il "calcolaRiga" del
// descrittore e la usano sia il disegno iniziale sia l'aggiornamento per riga.
function calcolaRigaRoi(r) {
  const n  = r.n_esami || 1;
  const nc = parseFloat(r.n_concorrenza) || n;   // senza quantita' propria segue quella Mylav
  const lc = parseFloat(r.listino_concorrenza) || 0;
  const sc = parseFloat(r.sconto_concorrenza)  || 0;
  const ll = parseFloat(r.listino_lav) || 0;
  const pl = parseFloat(r.prezzo_scontato_lav) || 0;

  const totConc  = lc * nc;
  const prezConc = calcPrezConc(totConc, sc, 1);
  const totLL    = ll * n;
  const totPL    = pl * n;
  // Costo Mylav effettivo: prezzo di piano se c'e', altrimenti il listino (senza piano
  // il dottore paga il listino) -> evita un falso "risparmio" positivo quando manca il piano.
  const mylavCost = totPL > 0 ? totPL : totLL;
  const risp     = prezConc - mylavCost;

  return { tot_conc: totConc, prezzo_conc: prezConc, tot_listino_lav: totLL, tot_prezzo_lav: totPL, risparmio: risp };
}

function fmtE(n) {
  if (!n && n !== 0) return '—';
  const v = Number(n) || 0;
  return '€ ' + v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// Un valore dell'operatore dentro un onclick attraversa DUE parser: prima
// l'HTML decodifica l'attributo, poi il JS legge il codice che ne esce. Per
// questo escHtml da sola non basta, e nemmeno sfuggire l'apice: il browser
// decodifica &#39; prima che il JS lo veda, e l'apice torna a chiudere la
// stringa. Serve una stringa JS valida (JSON.stringify), e solo dopo l'escape
// dei caratteri che chiuderebbero l'attributo.
// Le virgolette che JSON.stringify aggiunge fanno parte del valore: nel
// risultato NON si mettono apici attorno.
function jsAttr(v) {
  return JSON.stringify(String(v == null ? '' : v))
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function calcolaRoiTotali(righe) {
  righe = righe || S.roi.righe;
  let t = { tot_listino_conc:0, tot_conc:0, tot_prezzo_conc:0, tot_listino_lav:0, tot_tot_lav:0, tot_prezzo_lav_sc:0, tot_tot_prezzo_lav:0, differenziale:0 };
  for (const r of righe) {
    const n  = r.n_esami || 1;
    // Le due quantita' sono indipendenti: il concorrente puo' fatturare tre
    // esami dove Mylav ne ha uno. Senza quantita' propria si usa quella Mylav,
    // che e' come si comportavano tutte le righe prima delle due colonne.
    const nc = parseFloat(r.n_concorrenza) || n;
    const lc = parseFloat(r.listino_concorrenza) || 0;
    const sc = parseFloat(r.sconto_concorrenza)  || 0;
    const ll = parseFloat(r.listino_lav) || 0;
    const pl = parseFloat(r.prezzo_scontato_lav) || 0;
    const tc  = lc * nc;
    const pc  = calcPrezConc(tc, sc, 1);
    const tll = ll * n;
    const tpl = pl * n;
    t.tot_listino_conc   += lc;
    t.tot_conc           += tc;
    t.tot_prezzo_conc    += pc;
    t.tot_listino_lav    += ll;
    t.tot_tot_lav        += tll;
    t.tot_prezzo_lav_sc  += pl;
    t.tot_tot_prezzo_lav += tpl;
    t.differenziale      += pc - (tpl > 0 ? tpl : tll); // senza piano usa il listino Mylav
  }
  return t;
}

// Un campo prezzo e' sovrascrivibile dall'autofill se e' vuoto, 0, o gia' automatico.
// (aggiornaRigaDOM forza i campi vuoti a 0 in stato: senza questo, dopo un re-render
//  un "0" verrebbe scambiato per valore inserito a mano e bloccherebbe l'autofill.)
function campoFillabile(inp) {
  return !parseFloat(inp.value) || inp.dataset.auto === '1';
}

async function aggiornaPrezziAutomatici(tr, force = false) {
  // force=true: la cascata è stata innescata da una scelta ESPLICITA del piano
  // → il prezzo Mylav va ricalcolato per il nuovo piano anche se un valore è già
  //   presente (altrimenti cambiando piano il prezzo resterebbe quello vecchio).
  const esameInp = tr.querySelector('[data-col="esame"]');
  const llInp    = tr.querySelector('[data-col="listino_lav"]');
  const plInp    = tr.querySelector('[data-col="prezzo_scontato_lav"]');
  if (!esameInp || !llInp || !plInp) return;
  const esame = esameInp.value.trim();

  // Se l'identità dell'esame è cambiata (nome diverso o svuotato), azzera i prezzi
  // della riga — concorrenza E Mylav, anche i valori inseriti a mano — così la
  // cascata riparte pulita e riflette il nuovo esame.
  const prevEsame = esameInp.dataset.lastEsame || '';
  if (esame !== prevEsame) {
    // Il lato concorrenza si azzera solo quando e' l'esame Mylav a guidarlo,
    // cioe' quando la colonna del concorrente e' vuota e il prezzo arriva
    // dall'abbinamento automatico. Se l'operatore ha scelto l'esame del
    // concorrente, quel lato ha una sua identita': azzerarlo qui gli
    // cancellerebbe sotto gli occhi il prezzo appena comparso.
    const concInp = tr.querySelector('[data-col="esame_concorrente"]');
    const concGuidato = !concInp || !(concInp.value || '').trim();
    const daAzzerare = concGuidato
      ? ['listino_concorrenza', 'sconto_concorrenza', 'listino_lav', 'prezzo_scontato_lav']
      : ['listino_lav', 'prezzo_scontato_lav'];
    daAzzerare.forEach(col => {
      const inp = tr.querySelector(`[data-col="${col}"]`);
      if (inp) { inp.value = ''; inp.dataset.auto = '0'; inp.classList.remove('roi-prezzo-nuovo'); inp.title = ''; }
    });
    esameInp.dataset.lastEsame = esame;
    aggiornaRigaDOM(tr);
  }

  if (!esame) {
    // Riga svuotata: nessuna cascata, ma aggiorna totali/consiglio/classifica e nascondi banner match.
    const mb = el('roi-match-banner'); if (mb) mb.style.display = 'none';
    aggiornaRigaDOM(tr);
    mostraConsiglioTotale();
    mostraClassificaPiani();
    return;
  }

  const baseResp = await fetch(`/api/esami-riferimento/prezzo-base?nome=${encodeURIComponent(esame)}`, { headers: authHeaders() })
    .then(r => r.json()).catch(() => ({}));
  if (baseResp.prezzo_base != null && campoFillabile(llInp)) {
    llInp.value = baseResp.prezzo_base;
    llInp.dataset.auto = '1';
  }

  if (S.roi.pianoId) {
    const requestedPianoId = S.roi.pianoId;
    const pResp = await fetch(`/api/piani/${requestedPianoId}/prezzo?esame=${encodeURIComponent(esame)}`, { headers: authHeaders() })
      .then(r => r.json()).catch(() => ({}));
    if (S.roi.pianoId !== requestedPianoId) return; // a newer plan selection superseded this in-flight request; discard
    plInp.classList.remove('roi-prezzo-nuovo');
    if (pResp.fonte === 'piano' || pResp.fonte === 'custom' || pResp.fonte === 'base_fallback') {
      const titolo = pResp.fonte === 'piano' ? t('roi.tooltip.prezzoAutomatico')
        : pResp.fonte === 'custom' ? t('roi.tooltip.prezzoCustomSalvato')
        : t('roi.tooltip.prezzoBaseFallback');
      if (force || campoFillabile(plInp)) {
        plInp.value = pResp.prezzo;
        plInp.dataset.auto = '1';
        plInp.title = titolo;
      } else {
        plInp.title = t('roi.tooltip.nonApplicato', { titolo });
      }
    } else {
      plInp.dataset.auto = '0';
      plInp.title = '';
      if (!plInp.value) plInp.classList.add('roi-prezzo-nuovo');
    }
  } else {
    plInp.dataset.auto = '0';
    plInp.title = '';
    plInp.classList.remove('roi-prezzo-nuovo');
  }

  aggiornaRigaDOM(tr);
  mostraConsiglioTotale();
  mostraClassificaPiani();
  aggiornaMatchConcorrente(tr);
}

// Elenca tutti i piani MYLAV convenienti per gli esami inseriti, dal piu' economico
// al meno. Con un totale concorrenza disponibile mostra solo i piani sotto la
// concorrenza + il risparmio; senza, mostra tutti i piani ordinati. Click = seleziona.
async function mostraClassificaPiani() {
  const box = el('roi-classifica');
  if (!box) return;
  const esami = getRoiRigheValide().map(r => ({ nome: r.esame, n: r.n_esami || 1 }));
  if (!esami.length) { box.innerHTML = ''; return; }

  const piani = await fetch('/api/piani/classifica', {
    method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ esami })
  }).then(r => r.json()).catch(() => null);
  if (!Array.isArray(piani) || !piani.length) { box.innerHTML = ''; return; }

  const totConc = calcolaRoiTotali().tot_prezzo_conc;
  const conConc = totConc > 0;
  const mostrati = conConc ? piani.filter(p => p.totale < totConc) : piani;

  const titolo = `<div class="section-card-title">${t('roi.classifica.titolo')}</div>`;

  if (conConc && !mostrati.length) {
    box.innerHTML = `<div class="section-card roi-classifica-card">${titolo}
      <div class="roi-classifica-empty">${t('roi.classifica.nessunoConviene')}</div></div>`;
    return;
  }

  const righe = mostrati.map(p => {
    const attivo = p.pianoId === S.roi.pianoId;
    const risp = conConc
      ? `<td class="roi-classifica-risp">${fmtE(totConc - p.totale)}</td>` : '';
    return `<tr class="${attivo ? 'riga-attiva' : ''}" onclick="selezionaPiano(${p.pianoId})">
      <td>${escHtml(p.pianoNome)}${attivo ? ` <span class="roi-classifica-badge">${t('roi.classifica.selezionato')}</span>` : ''}</td>
      <td class="roi-classifica-tot">${fmtE(p.totale)}</td>${risp}</tr>`;
  }).join('');

  box.innerHTML = `<div class="section-card roi-classifica-card">${titolo}
    <table class="roi-classifica-table">
      <thead><tr><th>${t('roi.classifica.colPiano')}</th><th>${t('roi.classifica.colTotale')}</th>${conConc ? `<th>${t('roi.classifica.colRisparmio')}</th>` : ''}</tr></thead>
      <tbody>${righe}</tbody>
    </table></div>`;
}

// Suggerisce il piano MYLAV piu conveniente sul TOTALE di tutti gli esami in tabella.
async function mostraConsiglioTotale() {
  const banner = el('roi-consiglio-banner');
  if (!banner) return;
  const esami = getRoiRigheValide().map(r => ({ nome: r.esame, n: r.n_esami || 1 }));
  if (!esami.length) { banner.style.display = 'none'; return; }

  const resp = await fetch('/api/piani/consiglio-totale', {
    method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ esami, pianoIdAttuale: S.roi.pianoId })
  }).then(r => r.json()).catch(() => null);
  if (!resp) { banner.style.display = 'none'; return; }

  const stesso = resp.pianoId === S.roi.pianoId;
  const saltati = resp.nSaltati > 0
    ? `<br><span style="font-size:11px;color:#6b7280">${t('roi.consiglio.esamiEsclusi' + (resp.nSaltati === 1 ? '.uno' : '.molti'), { n: resp.nSaltati })}</span>` : '';
  let messaggio;
  if (stesso) {
    messaggio = t('roi.consiglio.stessoPiano' + (resp.nEsami === 1 ? '.uno' : '.molti'), { n: resp.nEsami, pianoNome: escHtml(resp.pianoNome), totale: fmtE(resp.totale) }) + saltati;
  } else {
    const risparmio = (resp.totaleAttuale != null && resp.totaleAttuale > resp.totale)
      ? `<br><span style="font-size:11px;color:#6b7280">${t('roi.consiglio.risparmioAttuale', { risparmio: fmtE(resp.totaleAttuale - resp.totale) })}</span>` : '';
    messaggio = t('roi.consiglio.pianoConviene' + (resp.nEsami === 1 ? '.uno' : '.molti'), { n: resp.nEsami, pianoNome: escHtml(resp.pianoNome), totale: fmtE(resp.totale) })
      + risparmio + `<br><span style="font-size:11px;color:#6b7280">${t('roi.consiglio.clicaSeleziona')}</span>` + saltati;
  }

  banner.innerHTML = `
    <span class="roi-consiglio-close" onclick="event.stopPropagation(); this.parentElement.style.display='none'">×</span>
    <div ${stesso ? '' : `onclick="selezionaPiano(${resp.pianoId})" style="cursor:pointer"`}>${messaggio}</div>
  `;
  banner.style.display = 'block';
}

async function mostraConsiglioPiano(esame) {
  const banner = el('roi-consiglio-banner');
  if (!banner) return;
  const consiglio = await fetch(`/api/piani/consiglio?esame=${encodeURIComponent(esame)}`, { headers: authHeaders() })
    .then(r => r.json()).catch(() => null);
  if (!consiglio) { banner.style.display = 'none'; return; }

  const stessoPiano = consiglio.pianoId === S.roi.pianoId;
  const messaggio = stessoPiano
    ? t('roi.consiglio.stessoPianoSingolo', { esame: escHtml(esame), pianoNome: escHtml(consiglio.pianoNome), prezzo: fmtE(consiglio.prezzo) })
    : t('roi.consiglio.pianoConvieneSingolo', { esame: escHtml(esame), pianoNome: escHtml(consiglio.pianoNome), prezzo: fmtE(consiglio.prezzo) })
      + `<br><span style="font-size:11px;color:#6b7280">${t('roi.consiglio.clicaSeleziona')}</span>`;

  banner.innerHTML = `
    <span class="roi-consiglio-close" onclick="event.stopPropagation(); this.parentElement.style.display='none'">×</span>
    <div ${stessoPiano ? '' : `onclick="selezionaPiano(${consiglio.pianoId})" style="cursor:pointer"`}>${messaggio}</div>
  `;
  banner.style.display = 'block';
}

// ── Wrapper verso il motore comune (calcolatore.js) ──────────────────────
// La logica generica (sincronizzare lo stato dal DOM, disegnare, aggiungere/
// rimuovere righe, la tendina dei suggerimenti, Tab/Escape/Invio) vive ora in
// motoreEsami. Questi wrapper mantengono invariati i nomi globali gia' usati
// altrove in questo file (anche dentro stringhe onclick="..."), cosi' non e'
// stato necessario toccare tutti i punti che li chiamano.
function aggiornaRigaDOM(tr) { motoreEsami.aggiornaRiga(tr); }

function syncRoiStateFromDOM() { motoreEsami.sincronizza(); }

function addRigaRoi() { motoreEsami.aggiungiRiga(); }

function removeRigaRoi(idx) {
  motoreEsami.rimuoviRiga(idx);
  mostraConsiglioTotale();
  mostraClassificaPiani();
}

function getRoiRigheValide() { return motoreEsami.righeValide(); }

function roiMsg(msg, tipo) { motoreEsami.messaggio(msg, tipo); }

async function salvaCalcolo() {
  if (S.auth.guest || !S.auth.token) { roiMsg(t('stato.ospiteAccedi', { azione: t('azione.salvareDati') }), 'error'); return; }
  const righe    = getRoiRigheValide();
  const struttura = (document.querySelector('.roi-struttura-inp')?.value || S.roi.struttura || '').trim();

  if (!struttura) return roiMsg(t('roi.scriviStruttura'), 'error');
  if (!righe.length) return roiMsg(t('roi.nessunEsameConNome'), 'error');

  // Una riga con il solo esame del concorrente non viene salvata: senza l'esame
  // Mylav non c'e' niente da confrontare. Prima si poteva solo sbagliare in un
  // modo, ora che le colonne sono due va detto, altrimenti la riga sparisce
  // senza che nessuno se ne accorga.
  const soloConcorrente = S.roi.righe.filter(r =>
    (r.esame_concorrente || '').trim() && !(r.esame || '').trim()).length;
  if (soloConcorrente) {
    const chiave = soloConcorrente === 1 ? 'roi.righeSenzaEsameMylav.uno' : 'roi.righeSenzaEsameMylav';
    if (!confirm(t(chiave, { n: soloConcorrente }))) return;
  }

  const nomeFile = `Calcolo_${new Date().toLocaleDateString('it-IT').replace(/\//g, '-')}`;
  try {
    const resp = await api('/api/calcolo/salva', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ struttura, foglio: 'Platinum', righe, nomeFile, piano_id: S.roi.pianoId })
    });
    roiMsg(t('roi.salvatoOk'), 'ok');
    await loadStrutture();
    buildSidebar();
  } catch(e) {
    roiMsg(t('errore.generico', { msg: e.message }), 'error');
  }
}

async function esportaExcelRoi() {
  syncRoiStateFromDOM();
  const righe     = getRoiRigheValide();
  const struttura = (document.querySelector('.roi-struttura-inp')?.value || S.roi.struttura || '').trim();

  if (!righe.length) return roiMsg(t('roi.nessunEsameCompilato'), 'error');
  try {
    const res = await fetch('/api/export-excel', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ foglio: 'Platinum', struttura: struttura || 'Struttura', righe })
    });
    if (res.status === 401) {
      if (S.auth && S.auth.token) authLogout(true);
      throw new Error(t('roi.sessioneScaduta'));
    }
    if (!res.ok) {
      const dati = await res.json().catch(() => ({}));
      throw new Error(I18n.messaggioErrore(dati, t('errore.rispostaServer', { stato: res.status })));
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `mylav_roi.xlsx`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch(e) { roiMsg(t('roi.erroreExport', { msg: e.message }), 'error'); }
}

// ══════════════════════════════════════════════════
// CALCOLATORE CLIP — fare in casa (clip precaricata) o mandare a Mylav?
// ══════════════════════════════════════════════════
// Non confronta il prezzo di acquisto degli analizzatori (quella era la
// logica dei "macchinari", rimossa): mette uno accanto all'altro il costo di
// una clip gia' pronta sull'analizzatore da banco e il costo del profilo
// Mylav corrispondente. Usa lo stesso motore comune (calcolatore.js) del
// calcolatore esami, con colonne, id e stato propri.

// Il listino del fornitore da' il prezzo della confezione: il costo di una
// singola analisi si ottiene dividendo per i pezzi. Senza pezzi non si inventa
// un numero, si lascia vuoto: un costo sbagliato di un fattore dodici in una
// trattativa e' peggio di un costo mancante.
function calcolaRigaClip(r) {
  const pezzi = parseFloat(r.pezzi) || 0;
  const prezzoConf = parseFloat(r.prezzo_confezione) || 0;
  const sconto = parseFloat(r.sconto_clip) || 0;
  const costoClip = pezzi > 0
    ? parseFloat((prezzoConf / pezzi * (1 - sconto / 100)).toFixed(2))
    : null;
  const nClip = parseFloat(r.n_clip) || 1;
  const totaleClip = costoClip == null ? null : costoClip * nClip;

  const nMyl = parseFloat(r.n_mylav) || 1;
  const listinoLav = parseFloat(r.listino_lav) || 0;
  const prezzoPiano = parseFloat(r.prezzo_scontato_lav) || 0;
  // Senza piano il veterinario paga il listino: usarlo evita un falso
  // risparmio positivo quando il piano non e' stato scelto.
  const totaleMylav = (prezzoPiano > 0 ? prezzoPiano : listinoLav) * nMyl;

  // Il segno qui e' l'INVERSO del calcolatore esami: la' il positivo era il
  // risparmio scegliendo Mylav rispetto al concorrente (prezzoConc - mylavCost).
  // Qui il confronto e' clip contro Mylav, quindi e' totaleClip - totaleMylav:
  // positivo vuol dire che la clip costa PIU' di Mylav, cioe' conviene Mylav.
  // Per chi legge il senso resta lo stesso, positivo e blu = conviene Mylav,
  // solo l'operazione che ci arriva e' scambiata.
  const risparmio = totaleClip == null ? null : totaleClip - totaleMylav;

  // Le chiavi restituite sono snake_case per combaciare con `col.col` delle
  // colonne 'calcolato' (il motore comune legge valori[col.col]): stessa
  // formula del brief, nomi di ritorno adattati al resto della tabella.
  return { costo_clip: costoClip, totale_clip: totaleClip, totale_mylav: totaleMylav, risparmio };
}

// Le 14 colonne della tabella, nell'ordine in cui compaiono: struttura, le 6
// della clip (concorrenza, nel senso del motore comune: il costo che il
// veterinario sostiene da solo), le 6 di Mylav, il risparmio e l'eliminazione
// riga. Le tre colonne del conto — prezzo confezione, pezzi, costo clip — sono
// marcate 'tenue: true': contano meno del risultato, l'occhio deve cadere su
// costo clip e sul totale, non sul percorso che ci arriva.
const COLONNE_CLIP = [
  { col: 'struttura',         intestazione: 'comune.struttura',        tipo: 'testo',     larghezza: 130, gruppo: 'nessuno', elenco: 'roi-strutture-list' },
  { col: 'clip_nome',         intestazione: 'clip.tabella.clip',       tipo: 'testo',     larghezza: 200, larghezzaCampo: 190, gruppo: 'concorrenza', elenco: 'clip-list',
    segnaposto: () => t('clip.placeholderClip') },
  { col: 'n_clip',            intestazione: 'roi.tabella.n',           tipo: 'numero',    larghezza: 60,  larghezzaCampo: 50, gruppo: 'concorrenza', fallbackSuZero: 1, segnaposto: '1' },
  { col: 'prezzo_confezione', intestazione: 'clip.tabella.prezzoConf', tipo: 'numero',    larghezza: 95,  gruppo: 'concorrenza', segnaposto: '0.00', tenue: true },
  { col: 'pezzi',             intestazione: 'clip.tabella.pezzi',      tipo: 'numero',    larghezza: 60,  larghezzaCampo: 50, gruppo: 'concorrenza', tenue: true },
  { col: 'sconto_clip',       intestazione: 'roi.tabella.scontoPct',   tipo: 'numero',    larghezza: 65,  larghezzaCampo: 55, gruppo: 'concorrenza', segnaposto: '%',
    valore: r => { const sc = parseFloat(r.sconto_clip) || 0; return sc > 0 ? String(sc) : ''; } },
  { col: 'costo_clip',        intestazione: 'clip.tabella.costoClip',  tipo: 'calcolato', larghezza: 95,  gruppo: 'concorrenza', totale: 'tot_costo_clip', tenue: true },
  { col: 'totale_clip',       intestazione: 'clip.tabella.totaleClip', tipo: 'calcolato', larghezza: 95,  gruppo: 'concorrenza', totale: 'tot_totale_clip' },
  { col: 'profilo_mylav',     intestazione: 'clip.tabella.profilo',    tipo: 'testo',     larghezza: 180, larghezzaCampo: 170, gruppo: 'mylav', elenco: 'mylav-esami-list',
    segnaposto: () => t('clip.placeholderProfilo') },
  { col: 'n_mylav',           intestazione: 'roi.tabella.n',           tipo: 'numero',    larghezza: 60,  larghezzaCampo: 50, gruppo: 'mylav', fallbackSuZero: 1, segnaposto: '1' },
  { col: 'listino_lav',       intestazione: 'roi.tabella.listinoMyl',  tipo: 'numero',    larghezza: 95,  gruppo: 'mylav', totale: 'tot_listino_lav', segnaposto: '0.00' },
  { col: 'prezzo_scontato_lav', intestazione: 'roi.tabella.pianoMyl',  tipo: 'numero',    larghezza: 95,  gruppo: 'mylav', totale: 'tot_prezzo_scontato_lav', segnaposto: '0.00' },
  { col: 'totale_mylav',      intestazione: 'clip.tabella.totaleMylav', tipo: 'calcolato', larghezza: 95, gruppo: 'mylav', totale: 'tot_totale_mylav' },
  { col: 'risparmio',         intestazione: 'comune.risparmio',        tipo: 'calcolato', larghezza: 95,  gruppo: 'nessuno', separaInTestata: true,
    totale: 'differenziale', coloreCondizionale: true },
  { col: '__delete',          tipo: 'vuota', larghezza: 28, gruppo: 'nessuno', separaInTestata: true,
    contenutoVuoto: (r, i) => `<button class="roi-del-btn" onclick="removeRigaClip(${i})" title="${escHtml(t('concorrenti.rimuovi'))}">×</button>` }
];

// Cerca nel catalogo clip il nome digitato. Prima la corrispondenza esatta;
// poi quella tollerante (errori di battitura), ma solo se e' l'unica — stessa
// regola di trovaEsameConcorrente: riempire con la clip sbagliata e' peggio
// che non riempire.
function trovaClip(nome) {
  const catalogo = S.clip.catalogo || [];
  const n = String(nome || '').trim();
  if (!n || !catalogo.length) return null;
  const esatto = catalogo.find(c => (c.nome || '').trim().toLowerCase() === n.toLowerCase());
  if (esatto) return esatto;
  if (!window.Ricerca) return null;
  const vicini = catalogo.filter(c => Ricerca.corrisponde(c.nome, n));
  return vicini.length === 1 ? vicini[0] : null;
}

// Cascata dal nome della clip: prezzo di confezione, pezzi e sconto abituale
// dal catalogo. Un valore scritto dall'operatore non viene mai sovrascritto
// (campoFillabile); cambiata la clip, quello che era stato riempito da solo
// per la clip precedente si azzera — quello scritto a mano resta.
async function compilaDaClip(tr) {
  const inp = tr.querySelector('[data-col="clip_nome"]');
  if (!inp) return;
  const nome = inp.value.trim();
  const prec = inp.dataset.lastClipNome || '';
  if (nome === prec) return;
  inp.dataset.lastClipNome = nome;

  const pcInp = tr.querySelector('[data-col="prezzo_confezione"]');
  const pzInp = tr.querySelector('[data-col="pezzi"]');
  const scInp = tr.querySelector('[data-col="sconto_clip"]');
  [pcInp, pzInp, scInp].forEach(i => { if (i && i.dataset.auto === '1') { i.value = ''; i.dataset.auto = '0'; } });

  if (nome) {
    const c = trovaClip(nome);
    if (c) {
      if (pcInp && c.prezzoConfezione != null && campoFillabile(pcInp)) { pcInp.value = c.prezzoConfezione; pcInp.dataset.auto = '1'; }
      if (pzInp && c.pezzi != null && campoFillabile(pzInp)) { pzInp.value = c.pezzi; pzInp.dataset.auto = '1'; }
      if (scInp && c.sconto != null && campoFillabile(scInp)) { scInp.value = c.sconto; scInp.dataset.auto = '1'; }
    }
  }
  aggiornaRigaDOMClip(tr);
}

// Cascata dal profilo Mylav: stessa logica del calcolatore esami (prezzo base,
// poi prezzo del piano selezionato). Cambiato il profilo, i prezzi Mylav
// riempiti da soli per il profilo precedente si azzerano; quelli scritti a
// mano restano. Lato clip indipendente: non viene mai toccato da qui.
async function aggiornaPrezziAutomaticiClip(tr, force = false) {
  const profInp = tr.querySelector('[data-col="profilo_mylav"]');
  const llInp   = tr.querySelector('[data-col="listino_lav"]');
  const plInp   = tr.querySelector('[data-col="prezzo_scontato_lav"]');
  if (!profInp || !llInp || !plInp) return;
  const profilo = profInp.value.trim();

  const prevProfilo = profInp.dataset.lastProfilo || '';
  if (profilo !== prevProfilo) {
    ['listino_lav', 'prezzo_scontato_lav'].forEach(col => {
      const inp = tr.querySelector(`[data-col="${col}"]`);
      if (inp && inp.dataset.auto === '1') { inp.value = ''; inp.dataset.auto = '0'; inp.title = ''; inp.classList.remove('roi-prezzo-nuovo'); }
    });
    profInp.dataset.lastProfilo = profilo;
    aggiornaRigaDOMClip(tr);
  }

  if (!profilo) { aggiornaRigaDOMClip(tr); return; }

  const baseResp = await fetch(`/api/esami-riferimento/prezzo-base?nome=${encodeURIComponent(profilo)}`, { headers: authHeaders() })
    .then(r => r.json()).catch(() => ({}));
  if (baseResp.prezzo_base != null && campoFillabile(llInp)) {
    llInp.value = baseResp.prezzo_base;
    llInp.dataset.auto = '1';
  }

  if (S.clip.pianoId) {
    const requestedPianoId = S.clip.pianoId;
    const pResp = await fetch(`/api/piani/${requestedPianoId}/prezzo?esame=${encodeURIComponent(profilo)}`, { headers: authHeaders() })
      .then(r => r.json()).catch(() => ({}));
    if (S.clip.pianoId !== requestedPianoId) return; // un'altra selezione di piano ha superato questa richiesta in corso
    plInp.classList.remove('roi-prezzo-nuovo');
    if (pResp.fonte === 'piano' || pResp.fonte === 'custom' || pResp.fonte === 'base_fallback') {
      const titolo = pResp.fonte === 'piano' ? t('roi.tooltip.prezzoAutomatico')
        : pResp.fonte === 'custom' ? t('roi.tooltip.prezzoCustomSalvato')
        : t('roi.tooltip.prezzoBaseFallback');
      if (force || campoFillabile(plInp)) {
        plInp.value = pResp.prezzo;
        plInp.dataset.auto = '1';
        plInp.title = titolo;
      } else {
        plInp.title = t('roi.tooltip.nonApplicato', { titolo });
      }
    } else {
      plInp.dataset.auto = '0';
      plInp.title = '';
      if (!plInp.value) plInp.classList.add('roi-prezzo-nuovo');
    }
  } else {
    plInp.dataset.auto = '0';
    plInp.title = '';
    plInp.classList.remove('roi-prezzo-nuovo');
  }

  aggiornaRigaDOMClip(tr);
}

async function suCampoUscitoClip(tr, col) {
  if (col === 'clip_nome') await compilaDaClip(tr);
  else if (col === 'profilo_mylav') await aggiornaPrezziAutomaticiClip(tr);
}

// Selezionato un suggerimento dalla tendina profilo Mylav: la cascata piano,
// poi il pre-riempimento (solo se vuoti) dai prezzi storici del profilo.
async function suSelezioneAutocompleteClip(tr, nome) {
  await aggiornaPrezziAutomaticiClip(tr);
  const prezzi = await fetch(`/api/esami/prezzi?nome=${encodeURIComponent(nome)}`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({}));
  if (prezzi.listino_lav) {
    const llInp = tr.querySelector('[data-col="listino_lav"]');
    if (llInp && !llInp.value) llInp.value = prezzi.listino_lav;
  }
  if (prezzi.prezzo_scontato_lav) {
    const plInp = tr.querySelector('[data-col="prezzo_scontato_lav"]');
    if (plInp && !plInp.value) plInp.value = prezzi.prezzo_scontato_lav;
  }
}

function calcolaClipTotali(righe) {
  righe = righe || S.clip.righe;
  const t2 = {
    tot_prezzo_confezione: 0, tot_costo_clip: 0, tot_totale_clip: 0,
    tot_listino_lav: 0, tot_prezzo_scontato_lav: 0, tot_totale_mylav: 0,
    differenziale: 0
  };
  for (const r of righe) {
    const v = calcolaRigaClip(r);
    t2.tot_prezzo_confezione += parseFloat(r.prezzo_confezione) || 0;
    t2.tot_costo_clip        += v.costo_clip || 0;
    t2.tot_totale_clip       += v.totale_clip || 0;
    t2.tot_listino_lav       += parseFloat(r.listino_lav) || 0;
    t2.tot_prezzo_scontato_lav += parseFloat(r.prezzo_scontato_lav) || 0;
    t2.tot_totale_mylav      += v.totale_mylav || 0;
    t2.differenziale         += v.risparmio || 0;
  }
  return t2;
}

const motoreClip = window.Calcolatore.crea({
  chiave: 'clip',
  idTbody: 'clip-tbody',
  idTableWrap: 'clip-table-wrap',
  idMsg: 'clip-msg',
  idAc: 'clip-ac',
  stato: () => S.clip,
  rigaVuota: clipRigaVuota,
  colonne: COLONNE_CLIP,
  calcolaRiga: r => calcolaRigaClip(r),
  totali: righe => calcolaClipTotali(righe),
  suCampoUscito: suCampoUscitoClip,
  rigaValida: r => !!(r.profilo_mylav && r.profilo_mylav.trim()),
  colonnaAutocomplete: 'profilo_mylav',
  suggerimenti: q => fetch(`/api/esami/autocomplete?q=${encodeURIComponent(q)}`, { headers: authHeaders() }).then(r => r.json()),
  suSelezioneAutocomplete: suSelezioneAutocompleteClip,
  dopoInizializzaEventi: () => {
    // Ristretto al proprio contenitore: con due calcolatori possibili nella
    // stessa pagina una ricerca su tutto il documento prenderebbe anche
    // l'altro calcolatore.
    const wrap = el('clip-table-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('[data-col="profilo_mylav"]').forEach(inp => {
      inp.dataset.lastProfilo = (inp.value || '').trim();
    });
    wrap.querySelectorAll('[data-col="clip_nome"]').forEach(inp => {
      inp.dataset.lastClipNome = (inp.value || '').trim();
    });
  },
  // Il lato rosso qui non e' un concorrente ma il costo della clip precaricata:
  // l'etichetta la dichiara il descrittore, invece di correggere il DOM dopo il
  // disegno.
  etichetteGruppo: { concorrenza: 'clip.tabella.gruppoClip' },
  tipoRiga: 'Clip',
  etichettaTotaleRiga: 'roi.tabella.totale',
  etichettaDifferenziale: 'roi.differenzialeTotale',
  avvisoNegativo: 'clip.avvisoClipConviene'
});

function aggiornaRigaDOMClip(tr) { motoreClip.aggiornaRiga(tr); }
function addRigaClip() { motoreClip.aggiungiRiga(); }
function removeRigaClip(idx) { motoreClip.rimuoviRiga(idx); }
function getClipRigheValide() { return motoreClip.righeValide(); }
function clipMsg(msg, tipo) { motoreClip.messaggio(msg, tipo); }

function pianoSelezionatoNomeClip() {
  const p = S.piani.find(p => p.id === S.clip.pianoId);
  return p ? p.nome : null;
}

function toggleClipPianoPanel() {
  const panel = el('clip-piano-panel');
  if (!panel) return;
  const show = panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  if (show) renderClipPianoPanel('');
}

function renderClipPianoPanel(filtro) {
  const panel = el('clip-piano-panel');
  if (!panel) return;
  const f = filtro.trim().toLowerCase();
  const filtrati = S.piani.filter(p => !f || p.nome.toLowerCase().includes(f));
  const perCategoria = {};
  filtrati.forEach(p => { (perCategoria[p.categoria] = perCategoria[p.categoria] || []).push(p); });

  let html = `<input class="roi-input" id="clip-piano-search" placeholder="${escHtml(t('roi.cercaPianoPlaceholder'))}"
    value="${escHtml(filtro)}" oninput="renderClipPianoPanel(this.value)"
    style="width:100%;box-sizing:border-box;margin-bottom:8px;border:1px solid #e8e9eb">`;
  html += `<div class="roi-piano-item" onclick="selezionaPianoClip(null)" style="font-style:italic">${t('roi.nessunPianoOpzione')}</div>`;
  for (const [categoria, items] of Object.entries(perCategoria)) {
    html += `<div class="roi-piano-categoria">${escHtml(categoria)}</div>`;
    items.forEach(p => {
      html += `<div class="roi-piano-item" onclick="selezionaPianoClip(${p.id})">${escHtml(p.nome)}</div>`;
    });
  }
  panel.innerHTML = html;
  const inp = el('clip-piano-search');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function selezionaPianoClip(id) {
  S.clip.pianoId = id;
  const panel = el('clip-piano-panel');
  if (panel) panel.style.display = 'none';
  const btn = el('clip-piano-btn');
  if (btn) {
    btn.textContent = t('roi.pianoBtn', { nome: pianoSelezionatoNomeClip() || t('roi.nessuno') });
    btn.title = pianoSelezionatoNomeClip() || '';
  }
  const tbody = el('clip-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaPrezziAutomaticiClip(tr, true));
  }
}

function buildClipSectionHtml() {
  const struttureOpts = S.strutture.map(s => `<option value="${escHtml(s.nome)}">`).join('');
  const mylavOpts = (S.esamiMylavNomi || []).map(n => `<option value="${escHtml(n)}">`).join('');
  const clipOpts = (S.clip.catalogo || []).map(c => `<option value="${escHtml(c.nome)}">`).join('');

  return `
    <datalist id="roi-strutture-list">${struttureOpts}</datalist>
    <datalist id="mylav-esami-list">${mylavOpts}</datalist>
    <datalist id="clip-list">${clipOpts}</datalist>
    <div class="roi-toolbar">
      <div></div>
      <div class="roi-toolbar-controls">
        <div style="position:relative">
          <button class="btn-outline roi-piano-btn roi-pill-myl" id="clip-piano-btn"
                  onclick="toggleClipPianoPanel()" title="${escHtml(pianoSelezionatoNomeClip() || '')}">
            ${t('roi.pianoBtn', { nome: escHtml(pianoSelezionatoNomeClip() || t('roi.nessuno')) })}
          </button>
          <div id="clip-piano-panel" class="roi-piano-panel" style="display:none"></div>
        </div>
      </div>
    </div>
    <div id="clip-table-wrap" style="overflow-x:auto">${motoreClip.disegnaTabella()}</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn-outline" onclick="addRigaClip()" style="font-size:12px">${t('clip.aggiungiRiga')}</button>
    </div>
    <div id="clip-msg" style="margin-top:8px;font-size:12px;min-height:18px"></div>
    <div id="clip-ac" class="roi-autocomplete" style="display:none"></div>
  `;
}

function buildClipActionsHtml() {
  return `
    <div class="roi-actions-bar">
      <button class="btn-outline" onclick="salvaCalcoloClip()" style="color:var(--blue);border-color:var(--blue)">${t('roi.salvaComeFile')}</button>
    </div>
    <button class="roi-clear-all-btn" onclick="rimuoviTuttoClip()">${t('confronto.rimuoviTutto')}</button>
  `;
}

// Azzera il calcolatore clip: righe e piano selezionato.
function rimuoviTuttoClip() {
  if (!confirm(t('clip.confermaRimuoviTutto'))) return;
  S.clip.pianoId = null;
  S.clip.righe = [clipRigaVuota()];
  navigate('calcolatore-clip');
}

// Vista dedicata (non incorporata nella dashboard, a differenza del
// calcolatore esami): il titolo dice cosa si sta decidendo, non come
// funziona lo strumento.
async function renderCalcolatoreClip() {
  try { S.clip.catalogo = await api('/api/clip'); }
  catch (_) { S.clip.catalogo = []; }
  // Nomi del catalogo Mylav per l'autocomplete del profilo, in cache come nel
  // dettaglio concorrente.
  if (!S.esamiMylavNomi) S.esamiMylavNomi = await api('/api/esami-riferimento/nomi').catch(() => []);

  setMain(`
    <div class="page-header">
      <div><div class="page-title">${t('clip.pagina.titolo')}</div></div>
    </div>
    <div class="page-body">
      <div class="section-card" id="clip-hero"></div>
    </div>
  `);

  el('clip-hero').innerHTML = buildClipSectionHtml() + buildClipActionsHtml();
  motoreClip.inizializzaEventi();
}

async function salvaCalcoloClip() {
  if (S.auth.guest || !S.auth.token) { clipMsg(t('stato.ospiteAccedi', { azione: t('azione.salvareDati') }), 'error'); return; }
  const righe = getClipRigheValide();
  // La struttura non ha un campo dedicato in testata come nel calcolatore
  // esami: si prende dalla prima riga che la riporta compilata.
  const struttura = ((S.clip.righe.find(r => (r.struttura || '').trim())) || {}).struttura || '';

  if (!struttura.trim()) return clipMsg(t('clip.scriviStruttura'), 'error');
  if (!righe.length) return clipMsg(t('clip.nessunaRigaValida'), 'error');

  // Una riga con la sola clip non viene salvata: senza il profilo Mylav non
  // c'e' niente da confrontare. Come nel calcolatore esami, va detto invece di
  // far sparire la riga senza che nessuno se ne accorga.
  const soloClip = S.clip.righe.filter(r =>
    (r.clip_nome || '').trim() && !(r.profilo_mylav || '').trim()).length;
  if (soloClip) {
    const chiave = soloClip === 1 ? 'clip.righeSenzaProfiloMylav.uno' : 'clip.righeSenzaProfiloMylav';
    if (!confirm(t(chiave, { n: soloClip }))) return;
  }

  const nomeFile = `Calcolo_clip_${new Date().toLocaleDateString('it-IT').replace(/\//g, '-')}`;
  try {
    await api('/api/calcolo-clip/salva', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ struttura: struttura.trim(), righe, nomeFile, piano_id: S.clip.pianoId })
    });
    clipMsg(t('clip.salvatoOk'), 'ok');
  } catch (e) {
    clipMsg(t('errore.generico', { msg: e.message }), 'error');
  }
}

// ── Init ───────────────────────────────────────────
async function avviaApp() {
  // loadStrutture/loadConcorrenti richiedono un account (dati privati per utente):
  // in modalita' ospite falliscono con 401, atteso. Non deve bloccare il boot.
  await loadStrutture().catch(() => { S.strutture = []; });
  await loadPiani().catch(() => { S.piani = []; });
  await loadConcorrenti().catch(() => { S.concorrenti = []; });
  buildSidebar();
  initDropzone();
  navigate('dashboard');
}

// public/index.html contiene alcuni nodi statici (finestra di caricamento file
// Excel, la sua conferma di sovrascrittura, il "Caricamento..." iniziale della
// sidebar) che non passano mai da un t() perche' non li disegna nessun render
// di questo file: li aggiorniamo a mano qui, richiamata sia all'avvio sia da
// ridisegnaTutto() a ogni cambio lingua.
//
// L'accoppiamento testo/chiave vive nel markup stesso (data-i18n/data-i18n-attr
// su ciascun nodo in index.html), non in un elenco di selettori CSS qui dentro:
// rinominare una classe non fa piu' silenziosamente sparire una traduzione, e
// una chiave mancante fa gia' scattare l'avviso di t() invece di essere
// scavalcata da un `if (nodo)` che non trova nulla.
function traduciMarkupStatico() {
  document.querySelectorAll('[data-i18n]').forEach(nodo => {
    nodo.innerHTML = t(nodo.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(nodo => {
    nodo.getAttribute('data-i18n-attr').split(';').forEach(coppia => {
      const [attr, chiave] = coppia.split(':').map(s => s.trim());
      if (attr && chiave) nodo.setAttribute(attr, t(chiave));
    });
  });
}

async function boot() {
  document.documentElement.lang = I18n.lingua();
  traduciMarkupStatico();
  const selettore = el('selettore-lingua');
  if (selettore) selettore.innerHTML = I18n.selettoreHtml();
  if (S.auth.token) {
    try {
      const me = await fetch('/api/auth/me', { headers: authHeaders() }).then(r => r.ok ? r.json() : null);
      if (me) {
        S.auth.email = me.email; S.auth.isAdmin = !!me.isAdmin;
        localStorage.setItem('authIsAdmin', me.isAdmin ? '1' : '0');
        nascondiAuthScreen(); return avviaApp();
      }
    } catch (_) {}
  }
  mostraAuthScreen();
}

document.addEventListener('DOMContentLoaded', boot);

// ── Autenticazione ─────────────────────────────────
function salvaSessione(token, email, isAdmin) {
  S.auth.token = token; S.auth.email = email; S.auth.guest = false; S.auth.isAdmin = !!isAdmin;
  localStorage.setItem('authToken', token); localStorage.setItem('authEmail', email);
  localStorage.setItem('authIsAdmin', isAdmin ? '1' : '0');
}

async function authLogin(email, password) {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const d = await r.json(); if (!r.ok) throw new Error(I18n.messaggioErrore(d, t('auth.loginFallito')));
  salvaSessione(d.token, d.email, d.isAdmin); nascondiAuthScreen(); avviaApp();
}

async function authRegister(email, password) {
  const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const d = await r.json(); if (!r.ok) throw new Error(I18n.messaggioErrore(d, t('auth.registrazioneFallita')));
  salvaSessione(d.token, d.email, d.isAdmin);
  return d.recoveryCode; // il chiamante mostra la schermata "salva il codice"
}

function authGuest() {
  S.auth = { token: null, email: null, isAdmin: false, guest: true };
  nascondiAuthScreen(); avviaApp();
}

async function authLogout(silent) {
  if (S.auth.token) { try { await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }); } catch (_) {} }
  S.auth = { token: null, email: null, isAdmin: false, guest: false };
  localStorage.removeItem('authToken'); localStorage.removeItem('authEmail'); localStorage.removeItem('authIsAdmin');
  mostraAuthScreen();
}

async function authRequestReset(email) {
  const r = await fetch('/api/auth/request-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const d = await r.json(); if (!r.ok) throw new Error(I18n.messaggioErrore(d, t('auth.richiestaFallita')));
  return d;
}

async function authResetPassword(email, code, newPassword) {
  const r = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, newPassword }) });
  const d = await r.json(); if (!r.ok) throw new Error(I18n.messaggioErrore(d, t('auth.resetFallito')));
  return d;
}

async function authRecoverFull(recoveryCode, newEmail, newPassword) {
  const r = await fetch('/api/auth/recover-full', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryCode, newEmail, newPassword }) });
  const d = await r.json(); if (!r.ok) throw new Error(I18n.messaggioErrore(d, t('auth.recuperoFallito')));
  return d;
}

function validaPasswordClient(pw) {
  const s = String(pw || '');
  return {
    lunghezza: s.length >= 8,
    cifra: /[0-9]/.test(s),
    speciale: /[^A-Za-z0-9]/.test(s)
  };
}
function passwordOk(pw) {
  const v = validaPasswordClient(pw);
  return v.lunghezza && v.cifra && v.speciale;
}

function authErr(msg) {
  const d = el('auth-err');
  if (!d) return;
  d.textContent = msg || '';
  d.style.display = msg ? 'block' : 'none';
}

function mostraAuthScreen(vista = 'login') {
  _authUltimo = { tipo: 'vista', arg: vista };
  const ov = el('auth-overlay');
  ov.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">MYL<svg viewBox="0 0 100 100" width="26" height="30">
        <polygon points="6,94 40,10 52,10 22,94" fill="#ce181e"/>
        <polygon points="94,94 60,10 48,10 78,94" fill="#0f76bc"/></svg>V<span class="auth-reg">®</span></div>
      <div class="auth-rule"></div>
      <div class="auth-tabs" id="auth-tabs">
        <button class="auth-tab ${vista === 'login' ? 'active' : ''}" data-i18n="comune.accedi" onclick="mostraAuthScreen('login')">${t('comune.accedi')}</button>
        <button class="auth-tab ${vista === 'register' ? 'active' : ''}" data-i18n="auth.registrati" onclick="mostraAuthScreen('register')">${t('auth.registrati')}</button>
      </div>
      <div id="auth-err" class="auth-err" style="display:none"></div>
      <div id="auth-body"></div>
      <div class="auth-links">
        <a data-i18n="auth.ospiteEntra" onclick="authGuest()">${t('auth.ospiteEntra')}</a>
        <a data-i18n="auth.passwordDimenticata" onclick="mostraAuthScreen('reset')">${t('auth.passwordDimenticata')}</a>
        <a data-i18n="auth.recuperoCompleto" onclick="mostraAuthScreen('recover')">${t('auth.recuperoCompleto')}</a>
      </div>
    </div>`;
  ov.style.display = 'flex';
  renderAuthBody(vista);
}

function nascondiAuthScreen() {
  _authUltimo = null;
  const ov = el('auth-overlay');
  if (ov) { ov.style.display = 'none'; ov.innerHTML = ''; }
}

function renderAuthBody(vista) {
  const body = el('auth-body');
  const tabs = el('auth-tabs');
  if (!body) return;
  authErr('');

  if (vista === 'login') {
    if (tabs) tabs.style.display = 'flex';
    body.innerHTML = `
      <form id="auth-form-login" class="auth-form">
        <label class="auth-label">${t('auth.email')}</label>
        <input class="auth-input" type="email" id="auth-login-email" required autocomplete="username">
        <label class="auth-label">${t('auth.password')}</label>
        <input class="auth-input" type="password" id="auth-login-pass" required autocomplete="current-password">
        <button type="submit" class="btn-primary auth-submit">${t('comune.accedi')}</button>
      </form>`;
    el('auth-form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      authErr('');
      try {
        await authLogin(el('auth-login-email').value.trim(), el('auth-login-pass').value);
      } catch (err) { authErr(err.message); }
    });
    return;
  }

  if (vista === 'register') {
    if (tabs) tabs.style.display = 'flex';
    body.innerHTML = `
      <form id="auth-form-register" class="auth-form">
        <label class="auth-label">${t('auth.email')}</label>
        <input class="auth-input" type="email" id="auth-reg-email" required autocomplete="username">
        <label class="auth-label">${t('auth.password')}</label>
        <input class="auth-input" type="password" id="auth-reg-pass" required autocomplete="new-password">
        <ul class="auth-rules" id="auth-rules">
          <li data-rule="lunghezza">${t('auth.regola.lunghezza')}</li>
          <li data-rule="cifra">${t('auth.regola.cifra')}</li>
          <li data-rule="speciale">${t('auth.regola.speciale')}</li>
        </ul>
        <button type="submit" class="btn-primary auth-submit">${t('auth.registrati')}</button>
      </form>`;
    const passInp = el('auth-reg-pass');
    passInp.addEventListener('input', () => {
      const v = validaPasswordClient(passInp.value);
      Object.entries(v).forEach(([rule, ok]) => {
        const li = el('auth-rules').querySelector(`[data-rule="${rule}"]`);
        if (li) li.classList.toggle('ok', ok);
      });
    });
    el('auth-form-register').addEventListener('submit', async (e) => {
      e.preventDefault();
      authErr('');
      const email = el('auth-reg-email').value.trim();
      const pass = passInp.value;
      if (!passwordOk(pass)) return authErr(t('auth.passwordNonConforme'));
      try {
        const recoveryCode = await authRegister(email, pass);
        renderCodiceRecupero(recoveryCode);
      } catch (err) { authErr(err.message); }
    });
    return;
  }

  if (vista === 'reset') {
    if (tabs) tabs.style.display = 'none';
    body.innerHTML = `
      <form id="auth-form-reset" class="auth-form">
        <div class="auth-form-title">${t('auth.reset.titolo')}</div>
        <label class="auth-label">${t('auth.email')}</label>
        <input class="auth-input" type="email" id="auth-reset-email" required autocomplete="username">
        <button type="submit" class="btn-primary auth-submit">${t('auth.reset.inviaCodice')}</button>
        <div class="auth-back"><a onclick="mostraAuthScreen('login')">${t('auth.tornaLogin')}</a></div>
      </form>`;
    el('auth-form-reset').addEventListener('submit', async (e) => {
      e.preventDefault();
      authErr('');
      const email = el('auth-reset-email').value.trim();
      try {
        await authRequestReset(email);
        renderResetStep2(email);
      } catch (err) { authErr(err.message); }
    });
    return;
  }

  if (vista === 'recover') {
    if (tabs) tabs.style.display = 'none';
    body.innerHTML = `
      <form id="auth-form-recover" class="auth-form">
        <div class="auth-form-title">${t('auth.recover.titolo')}</div>
        <label class="auth-label">${t('auth.recover.codiceLabel')}</label>
        <input class="auth-input" type="text" id="auth-rec-code" required placeholder="XXXX-XXXX-XXXX">
        <label class="auth-label">${t('auth.recover.nuovaEmailLabel')}</label>
        <input class="auth-input" type="email" id="auth-rec-email" required autocomplete="username">
        <label class="auth-label">${t('auth.nuovaPasswordLabel')}</label>
        <input class="auth-input" type="password" id="auth-rec-pass" required autocomplete="new-password">
        <ul class="auth-rules" id="auth-rec-rules">
          <li data-rule="lunghezza">${t('auth.regola.lunghezza')}</li>
          <li data-rule="cifra">${t('auth.regola.cifra')}</li>
          <li data-rule="speciale">${t('auth.regola.speciale')}</li>
        </ul>
        <button type="submit" class="btn-primary auth-submit">${t('auth.recover.submitBtn')}</button>
        <div class="auth-back"><a onclick="mostraAuthScreen('login')">${t('auth.tornaLogin')}</a></div>
      </form>`;
    const passInp = el('auth-rec-pass');
    passInp.addEventListener('input', () => {
      const v = validaPasswordClient(passInp.value);
      Object.entries(v).forEach(([rule, ok]) => {
        const li = el('auth-rec-rules').querySelector(`[data-rule="${rule}"]`);
        if (li) li.classList.toggle('ok', ok);
      });
    });
    el('auth-form-recover').addEventListener('submit', async (e) => {
      e.preventDefault();
      authErr('');
      const code = el('auth-rec-code').value.trim();
      const newEmail = el('auth-rec-email').value.trim();
      const newPassword = passInp.value;
      if (!passwordOk(newPassword)) return authErr(t('auth.passwordNonConforme'));
      try {
        await authRecoverFull(code, newEmail, newPassword);
        authErr('');
        const body2 = el('auth-body');
        body2.innerHTML = `<div class="auth-ok">${t('auth.recover.successo')}</div>`;
        setTimeout(() => mostraAuthScreen('login'), 1800);
      } catch (err) { authErr(err.message); }
    });
    return;
  }
}

function renderResetStep2(email) {
  _authUltimo = { tipo: 'step2', arg: email };
  const body = el('auth-body');
  authErr('');
  body.innerHTML = `
    <form id="auth-form-reset2" class="auth-form">
      <div class="auth-form-title">${t('auth.resetStep2.titolo')}</div>
      <div class="auth-hint">${t('auth.resetStep2.hint', { email: escHtml(email) })}</div>
      <label class="auth-label">${t('auth.resetStep2.codiceLabel')}</label>
      <input class="auth-input" type="text" id="auth-reset-code" required>
      <label class="auth-label">${t('auth.nuovaPasswordLabel')}</label>
      <input class="auth-input" type="password" id="auth-reset-newpass" required autocomplete="new-password">
      <ul class="auth-rules" id="auth-reset-rules">
        <li data-rule="lunghezza">${t('auth.regola.lunghezza')}</li>
        <li data-rule="cifra">${t('auth.regola.cifra')}</li>
        <li data-rule="speciale">${t('auth.regola.speciale')}</li>
      </ul>
      <button type="submit" class="btn-primary auth-submit">${t('auth.resetStep2.submitBtn')}</button>
      <div class="auth-back"><a onclick="mostraAuthScreen('login')">${t('auth.tornaLogin')}</a></div>
    </form>`;
  const passInp = el('auth-reset-newpass');
  passInp.addEventListener('input', () => {
    const v = validaPasswordClient(passInp.value);
    Object.entries(v).forEach(([rule, ok]) => {
      const li = el('auth-reset-rules').querySelector(`[data-rule="${rule}"]`);
      if (li) li.classList.toggle('ok', ok);
    });
  });
  el('auth-form-reset2').addEventListener('submit', async (e) => {
    e.preventDefault();
    authErr('');
    const code = el('auth-reset-code').value.trim();
    const newPassword = passInp.value;
    if (!passwordOk(newPassword)) return authErr(t('auth.passwordNonConforme'));
    try {
      await authResetPassword(email, code, newPassword);
      const body2 = el('auth-body');
      body2.innerHTML = `<div class="auth-ok">${t('auth.resetStep2.successo')}</div>`;
      setTimeout(() => mostraAuthScreen('login'), 1500);
    } catch (err) { authErr(err.message); }
  });
}

function renderCodiceRecupero(recoveryCode) {
  _authUltimo = { tipo: 'codice', arg: recoveryCode };
  const tabs = el('auth-tabs');
  if (tabs) tabs.style.display = 'none';
  authErr('');
  const body = el('auth-body');
  body.innerHTML = `
    <div class="auth-form-title">${t('auth.codiceRecupero.titolo')}</div>
    <div class="auth-hint">${t('auth.codiceRecupero.avviso')}</div>
    <div class="auth-code">${escHtml(recoveryCode)}</div>
    <button type="button" class="btn-primary auth-submit" id="auth-code-continua">${t('auth.codiceRecupero.continua')}</button>`;
  el('auth-code-continua').addEventListener('click', () => {
    nascondiAuthScreen();
    avviaApp();
  });
}
