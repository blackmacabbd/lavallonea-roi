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
  listiniMacchine: [],
  listinoAperto: null,
  macchinaInModifica: null,
  filtroMacchine: '',
  filtroListiniMie: '',
  filtroListiniLoro: '',
  salvataggioMacchinaInCorso: false,
  macchine: [],
  confrontoMacchine: null,
  foglio: { dati: null, totali: null, file: null, foglio: null, fileId: null },
  roi: {
    struttura: '',
    pianoId: null,
    concorrenteId: null,
    righe: [roiRigaVuota()]
  },
  auth: {
    token: localStorage.getItem('authToken') || null,
    email: localStorage.getItem('authEmail') || null,
    isAdmin: localStorage.getItem('authIsAdmin') === '1',
    guest: false
  }
};

function roiRigaVuota() {
  return { esame: '', n_esami: 1, listino_concorrenza: '', sconto_concorrenza: '', listino_lav: '', prezzo_scontato_lav: '' };
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
    if (S.auth && S.auth.token) {
      authLogout(true);
      throw new Error('Sessione scaduta, effettua di nuovo l\'accesso');
    }
    throw new Error('Accedi o registrati per vedere questi dati');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
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
    <div class="nav-divider">Strutture</div>
  `;

  if (S.strutture.length === 0) {
    html += `<div style="padding:8px 16px;font-size:12px;color:#9ca3af">Nessuna struttura</div>`;
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
              <span class="struttura-del" title="Elimina questo calcolo" onclick="event.stopPropagation(); eliminaFileSidebarUI(${f.id}, '${escHtml(label)}')">×</span>
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
            <span class="struttura-del" title="Elimina struttura" onclick="event.stopPropagation(); eliminaStrutturaUI(${s.id})">×</span>
          </div>
        </div>
      `;
    }
  }

  html += `
    <div class="nav-divider" style="margin-top:8px">Gestione</div>
    <div class="nav-item ${isActive('piani')}" onclick="navigate('piani')">
      <span class="nav-icon">💰</span> ${t('menu.piani')}
    </div>
    <div class="nav-item ${isActive('concorrenti')}" onclick="navigate('concorrenti')">
      <span class="nav-icon">🏷️</span> ${t('menu.concorrenti')}
    </div>
    <div class="nav-item ${isActive('macchinari')}" onclick="navigate('macchinari')">
      <span class="nav-icon">🔬</span> ${t('menu.macchinari')}
    </div>
    <div class="nav-item ${isActive('confronto-macchine')}" onclick="navigate('confronto-macchine')">
      <span class="nav-icon">🆚</span> ${t('menu.confrontoMacchine')}
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
    <div class="nav-divider" style="margin-top:8px">Altro</div>
    <div class="struttura-group">
      <div class="struttura-header ${altroOpen}" onclick="toggleGestione()">
        <span class="sname">Cronologia e strumenti</span>
        <span class="struttura-chevron">›</span>
      </div>
      <div class="struttura-children ${altroOpen}">
        <div class="struttura-child ${isActive('risparmio-totale')}" onclick="navigate('risparmio-totale')">Risparmio totale strutture</div>
        <div class="struttura-child ${isActive('cronologia')}" onclick="navigate('cronologia')">${t('menu.cronologia')}</div>
        <div class="struttura-child ${isActive('debug')}" onclick="navigate('debug')">Debug Excel</div>
      </div>
    </div>
  `;

  html += `
    <div class="sidebar-account">
      <button class="account-btn" onclick="toggleAccountMenu()" title="Account">
        <span class="account-ico">👤</span>
        <span class="account-email">${S.auth.guest ? 'Ospite' : (S.auth.email || 'Account')}</span>
      </button>
      <div id="account-menu" class="account-menu" style="display:none">
        ${S.auth.guest || !S.auth.token ? `
          <div onclick="mostraAuthScreen('login')">${t('comune.accedi')}</div>
          <div onclick="mostraAuthScreen('register')">${t('auth.registrati')}</div>
          <div onclick="authGuest()">${t('auth.ospiteEntra')}</div>` : `
          <div onclick="authLogout()">Logout</div>
          <div onclick="mostraAuthScreen('login')">Cambia account</div>`}
      </div>
    </div>`;

  nav.innerHTML = html;
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
  const nome = s ? s.nome : 'questa struttura';
  if (!confirm(`Eliminare la struttura "${nome}" con tutti i suoi file e dati? L'operazione non è reversibile.`)) return;
  try {
    await api(`/api/strutture/${id}`, { method: 'DELETE' });
    await loadStrutture();
    buildSidebar();
    navigate('dashboard');
  } catch (e) { alert('Errore: ' + e.message); }
}

// Elimina un singolo calcolo (file) quando una struttura ne ha piu' di uno in sidebar.
async function eliminaFileSidebarUI(fileId, label) {
  if (!confirm(`Eliminare il calcolo "${label}"? L'operazione non è reversibile.`)) return;
  try {
    await api(`/api/cronologia/${fileId}`, { method: 'DELETE' });
    await loadStrutture();
    buildSidebar();
    if (window._currentFileId === fileId) navigate('dashboard');
  } catch (e) { alert('Errore: ' + e.message); }
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

// ── Navigation ─────────────────────────────────────
function navigate(view, params = {}) {
  window._currentView        = view;
  window._currentParams      = params;
  window._currentStrutturaId = params.strutturaId || null;
  window._currentFoglio      = params.foglio      || null;
  window._currentFileId      = params.fileId      || null;

  setMain('<div class="page-loading"><div class="spinner"></div></div>');

  switch (view) {
    case 'dashboard':  renderDashboard();                              break;
    case 'foglio':     renderFoglio(params.fileId, params.foglio);     break;
    case 'totali':     renderTotali(params.strutturaId, params.nome);  break;
    case 'cronologia': renderCronologia();                             break;
    case 'confronto':  renderConfronto();                              break;
    case 'debug':      renderDebug();                                  break;
    case 'risparmio-totale': renderRisparmioTotale();                  break;
    case 'piani':      renderPiani();                                  break;
    case 'concorrenti': renderConcorrentiAdmin();                      break;
    // Si arriva qui dalla voce di menu, mai da nuovaMacchina/modificaMacchina
    // (che ridisegnano chiamando renderListinoMacchine() direttamente): azzerare
    // la riga in modifica quando si entra nella sezione da un'altra pagina non
    // rompe il flusso di modifica, e toglie uno stato residuo che l'operatore
    // non ha piu' motivo di ritrovare aperto.
    case 'macchinari': S.macchinaInModifica = null; S.listinoAperto = null; renderMacchinari();  break;
    case 'confronto-macchine': renderConfrontoMacchine();               break;
  }
  buildSidebar();
}

// Cambio lingua a caldo: si riusa la navigazione esistente invece di un
// secondo percorso di disegno, cosi' ogni vista resta l'unica responsabile
// del proprio markup. Se la vista corrente azzera stato al suo ingresso
// (es. 'macchinari' chiude il listino aperto), l'effetto e' accettato.
window.ridisegnaTutto = function () {
  navigate(window._currentView || 'dashboard', window._currentParams || {});
};

// ── Dashboard ──────────────────────────────────────
async function renderDashboard() {
  let data;
  try {
    data = await api('/api/dashboard');
  } catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">Errore caricamento</div>
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
          <div class="empty-title">Nessun dato ancora</div>
          <div class="empty-sub">Carica un file Excel oppure usa il Calcolatore ROI qui sotto.</div>
          <button class="btn-primary mt-4" onclick="openUploadModal()">+ Carica file Excel</button>
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
    initRoiEvents();
    return;
  }

  setMain(`
    <div class="page-body" style="padding-top:24px">
      <div class="section-card" id="roi-hero"></div>
      <div class="riepilogo-band">
        <div class="kpi-card kpi-risparmio" id="dash-risparmio-card">
          <div class="kpi-label">Risparmio calcolo attuale</div>
          <div class="kpi-value" id="dash-risparmio-val">${euro(0)}</div>
          <div class="kpi-sub">vs concorrenza — solo il calcolo qui sopra</div>
        </div>
      </div>
      ${buildRoiActionsHtml()}
    </div>
  `);

  // Calcolatore ROI — eroe in cima alla dashboard
  el('roi-hero').innerHTML = buildRoiSectionHtml();
  initRoiEvents();
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
      <div class="empty-title">Errore</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }
  const { differenziale_totale, per_struttura } = data;
  setMain(`
    <div class="page-header">
      <div>
        <div class="page-title">Risparmio totale strutture</div>
        <div class="page-subtitle">Somma del risparmio di tutti i calcoli salvati, per struttura</div>
      </div>
    </div>
    <div class="page-body">
      <div class="kpi-card kpi-risparmio" style="max-width:340px;margin-bottom:24px">
        <div class="kpi-label">Risparmio totale dottori</div>
        <div class="kpi-value" style="color:${differenziale_totale >= 0 ? 'var(--blue)' : 'var(--red)'}">${euro(differenziale_totale)}</div>
        <div class="kpi-sub">vs concorrenza — tutte le strutture</div>
      </div>
      ${per_struttura.length ? `
      <div class="section-card">
        <div class="section-card-title">Riepilogo per struttura</div>
        <div class="chart-canvas-wrap">
          <canvas id="chart-confronto-tot" height="${Math.max(180, per_struttura.length * 46)}"></canvas>
        </div>
      </div>` : `<div class="empty-state"><div class="empty-icon">📭</div>
        <div class="empty-title">Nessun calcolo salvato</div></div>`}
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
            { label: 'Concorrenza scontata', data: per_struttura.map(s => s.fatturato), backgroundColor: '#ce181e', borderRadius: 4 },
            { label: 'Mylav scontata',  data: per_struttura.map(s => s.costo),    backgroundColor: '#0f76bc', borderRadius: 4 }
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
      <div class="empty-title">Errore</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  const { dati, totali: t, file } = resp;
  S.foglio = { dati, totali: t, file, foglio, fileId };

  if (!dati.length) {
    setMain(`<div class="empty-state"><div class="empty-icon">📭</div>
      <div class="empty-title">Nessun dato</div>
      <div class="empty-sub">Nessuna riga trovata per ${foglio}.</div></div>`);
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
        <button class="btn-outline" onclick="downloadPdf(${fileId},'${foglio}','dottore')">
          📄 Resoconto struttura
        </button>
      </div>
    </div>

    <div class="page-body">
      <!-- KPI 4 card -->
      <div class="kpi-grid kpi-grid-4">
        <div class="kpi-card kpi-yellow">
          <div class="kpi-label">Paghi con Mylav</div>
          <div class="kpi-value">${euro(t.totale_scontato_lav)}</div>
          <div class="kpi-sub">Prezzo scontato Mylav</div>
        </div>
        <div class="kpi-card kpi-red">
          <div class="kpi-label">Pagheresti con concorrenza</div>
          <div class="kpi-value">${euro(t.prezzo_scontato_concorrenza)}</div>
          <div class="kpi-sub">Prezzo scontato mercato</div>
        </div>
        <div class="kpi-card kpi-green">
          <div class="kpi-label">Risparmi scegliendo noi</div>
          <div class="kpi-value">${euro(t.risparmio_totale_dottore)}</div>
          <div class="kpi-sub">vs prezzo concorrenza</div>
        </div>
        <div class="kpi-card kpi-blue">
          <div class="kpi-label">% risparmio</div>
          <div class="kpi-value">${rispPct}%</div>
          <div class="kpi-sub">Sul prezzo di mercato</div>
        </div>
      </div>

      <!-- Banner: riapri nel calcolatore -->
      <div class="roi-edit-banner" onclick="modificaNelCalcolatore()" title="Riapri questo file nel Calcolatore ROI">
        <span class="roi-edit-ico">✏️</span>
        <div class="roi-edit-txt">
          <div class="roi-edit-title">Modifica nel Calcolatore ROI</div>
          <div class="roi-edit-sub">Riapri questo file nel calcolatore per aggiornare esami, prezzi o piano</div>
        </div>
        <span class="roi-edit-arrow">→</span>
      </div>

      <!-- Vista toggle -->
      <div class="vista-toggle-bar">
        <span class="vista-label">Vista:</span>
        <div class="vista-toggle">
          <button class="vista-btn ${S.vistaMia ? 'active' : ''}" id="btn-mia"
                  onclick="setVista(true)">Mia</button>
          <button class="vista-btn ${!S.vistaMia ? 'active' : ''}" id="btn-dottore"
                  onclick="setVista(false)">Dottore</button>
        </div>
      </div>

      <!-- Grafici -->
      <div class="charts-row">
        <!-- Donut -->
        <div class="chart-card">
          <div class="chart-title" id="donut-title">Confronto prezzi totali</div>
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
          <div class="chart-title" id="barre-title">Confronto per esame</div>
          <div id="barre-legend" class="chart-legend"></div>
          <div class="chart-canvas-wrap" style="overflow:auto;max-height:320px">
            <canvas id="chart-barre"></canvas>
          </div>
        </div>
      </div>

      <!-- Tabella -->
      <div class="table-card">
        <div class="table-header">
          <div class="table-title" id="table-title">Dettaglio esami</div>
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

  el('donut-cv').textContent = euro(t.risparmio_totale_dottore);
  el('donut-cl').textContent = 'Risparmio';
  el('donut-legend').innerHTML = legendHtml([
    { label: 'Prezzo Mylav al dottore', color: '#0f76bc' },
    { label: 'Sconto Mylav applicato',  color: '#9cc8e8' },
    { label: 'Risparmio dottore vs concorrenza', color: '#26262a' },
    { label: 'Sconto concorrenza applicato', color: '#ce181e' }
  ]);

  const canvas = el('chart-donut');
  if (!canvas) return;
  canvas.style.display = 'block';

  S.charts.donut = new Chart(canvas, {
    type: 'doughnut',
    plugins: [whiteBgPlugin],
    data: {
      labels: [
        'Prezzo Mylav al dottore',
        'Sconto Mylav applicato',
        'Risparmio dottore vs concorrenza',
        'Sconto concorrenza applicato'
      ],
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
        if (totale === 0) return '  Nessun dato';
        const v   = ctx.raw;
        const pct = base > 0 ? ((v / base) * 100).toFixed(1) : 0;
        return [`  € ${(Number(v)||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}`, `  ${pct}% del listino concorrenza`];
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

  el('donut-cv').textContent = `${pct}%`;
  el('donut-cl').textContent = 'Risparmi';
  el('donut-legend').innerHTML = legendHtml([
    { label: 'Paghi con Mylav', color: '#0f76bc' },
    { label: 'Risparmio vs mercato', color: '#26262a' }
  ]);

  const canvas = el('chart-donut');
  if (!canvas) return;
  canvas.style.display = 'block';

  const concBase = t.prezzo_scontato_concorrenza || 0;

  S.charts.donut = new Chart(canvas, {
    type: 'doughnut',
    plugins: [whiteBgPlugin],
    data: {
      labels: ['Paghi con Mylav', 'Risparmio vs mercato'],
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
        if (totale === 0) return '  Nessun dato';
        if (ctx.dataIndex === 0) return [
          `  Paghi con Mylav: ${euro(ctx.raw)}`,
          `  Invece di: ${euro(concBase)} (concorrenza)`
        ];
        return [
          `  Risparmio: ${euro(ctx.raw)}`,
          `  Percentuale: ${pct}%`
        ];
      }
    })
  });
}

// ─── BARRE Vista MIA (stacked: giallo=Lav + verde=risparmio = totale concorrenza) ──
function renderBarreMia(dati) {
  el('barre-legend').innerHTML = legendHtml([
    { label: 'Paghi con Mylav', color: '#0f76bc' },
    { label: 'Risparmio dottore',    color: '#26262a' }
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
          label: 'Paghi con Mylav',
          data: dati.map(d => Math.max(0, d.totale_scontato_lav || 0)),
          backgroundColor: '#0f76bc',
          borderRadius: 0
        },
        {
          label: 'Risparmio dottore',
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
        if (ctx.datasetIndex === 0) return `  Paghi con Mylav: ${euro(d.totale_scontato_lav)}`;
        const pct = d.prezzo_scontato_concorrenza > 0
          ? ((d.risparmio_dottore / d.prezzo_scontato_concorrenza) * 100).toFixed(1) : '0';
        return `  Risparmio: ${euro(d.risparmio_dottore)} (${pct}%)`;
      },
      afterBody: items => {
        const d = dati[items[0]?.dataIndex];
        if (!d) return [];
        return [`  Totale barra = prezzo concorrenza: ${euro(d.prezzo_scontato_concorrenza)}`];
      }
    })
  });
}

// ─── BARRE Vista DOTTORE (stacked: giallo=Lav + verde=risparmio) ──
function renderBarreDottore(dati) {
  el('barre-legend').innerHTML = legendHtml([
    { label: 'Paghi con Mylav', color: '#0f76bc' },
    { label: 'Risparmio vs mercato', color: '#26262a' }
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
          label: 'Paghi con Mylav',
          data: dati.map(d => Math.max(0, d.totale_scontato_lav || 0)),
          backgroundColor: '#0f76bc',
          borderRadius: 0
        },
        {
          label: 'Risparmio vs mercato',
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
        if (ctx.datasetIndex === 0) return `  Prezzo Mylav: ${euro(d.totale_scontato_lav)}`;
        const pct = d.prezzo_scontato_concorrenza > 0
          ? ((d.risparmio_dottore / d.prezzo_scontato_concorrenza) * 100).toFixed(1) : '0';
        return `  Risparmi: ${euro(d.risparmio_dottore)} (${pct}%)`;
      },
      afterBody: items => {
        const d = dati[items[0]?.dataIndex];
        if (!d) return [];
        return [`  Prezzo di mercato: ${euro(d.prezzo_scontato_concorrenza)}`];
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
      <th>Esame</th><th>N.</th>
      <th>Listino conc.</th><th>Scontato conc.</th>
      <th>Listino Lav</th><th>Scontato Lav</th>
      <th>Risparmio €</th><th>Risparmio %</th>
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
      <th>Esame</th><th>N.</th>
      <th>Prezzo mercato</th><th>Prezzo Mylav</th>
      <th>Risparmi €</th><th>Risparmi %</th>
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
      <div class="empty-title">Errore</div><div class="empty-sub">${e.message}</div></div>`);
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
        <label>Struttura:</label>
        <select id="filter-struttura" onchange="filterCronologia()">
          <option value="">Tutte</option>
          ${optStrutture}
        </select>
      </div>
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Data</th><th>File</th><th>Struttura</th><th>Fogli</th>
              <th>Concorrenza scontata</th><th>Mylav scontata</th><th>Risparmio</th><th></th>
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
    Nessun file caricato</td></tr>`;

  // Se la stessa struttura ha piu' salvataggi, numerali (n) in ordine di creazione
  // (id crescente = piu' vecchio prima) cosi' si distinguono in elenco.
  const perStruttura = {};
  rows.forEach(r => { (perStruttura[r.struttura_id] = perStruttura[r.struttura_id] || []).push(r); });
  Object.values(perStruttura).forEach(list => {
    if (list.length < 2) return;
    list.slice().sort((a, b) => a.id - b.id).forEach((r, i) => { r._ordine = i + 1; });
  });

  return rows.map(r => `
    <tr class="clickable" onclick="navigateFromCrono(${r.id}, ${r.struttura_id}, '${(r.fogli||'').split(',')[0]}')">
      <td class="td-muted">${fmtDate(r.data_carico)}</td>
      <td>${r.nome_file}${r._ordine ? ` <span class="crono-ordine">(${r._ordine})</span>` : ''}</td>
      <td>${r.struttura_nome}</td>
      <td>${(r.fogli || '').split(',').map(f => `<span class="badge badge-gray">${f}</span>`).join(' ')}</td>
      <td style="color:#ce181e">${euro(r.totale_dottore)}</td>
      <td class="td-yellow">${euro(r.totale_costo)}</td>
      <td class="td-green">${euro(r.differenziale)}</td>
      <td onclick="event.stopPropagation()">
        <button class="roi-del-btn" onclick="deleteCrono(${r.id})" title="Elimina">×</button>
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
  if (!confirm('Eliminare questo file dalla cronologia? Verranno rimossi tutti i dati associati.')) return;
  try {
    await fetch(`/api/cronologia/${id}`, { method: 'DELETE', headers: authHeaders() });
    await loadStrutture();
    buildSidebar();
    renderCronologia();
  } catch (e) {
    alert('Errore: ' + e.message);
  }
}

function navigateFromCrono(fileId, strutturaId, foglio) {
  navigate('foglio', { fileId, foglio, strutturaId });
}

// ── Confronto strutture ────────────────────────────
async function renderConfronto() {
  let data;
  try { data = await api('/api/confronto'); }
  catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">Errore</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  if (data.length < 2) {
    setMain(`<div class="empty-state">
      <div class="empty-icon">⚖️</div>
      <div class="empty-title">Servono almeno 2 strutture</div>
      <div class="empty-sub">Carica dati per più strutture per confrontarle.</div>
    </div>`);
    return;
  }

  setMain(`
    <div class="page-header">
      <div><div class="page-title">${t('pagina.confrontoStrutture.titolo')}</div>
        <div class="page-subtitle">${t('pagina.confrontoStrutture.sottotitolo', { n: data.length })}</div>
      </div>
    </div>
    <div class="page-body">
      <div class="section-card">
        <div class="section-card-title">Concorrenza vs Mylav vs Risparmio</div>
        <div class="chart-legend" id="conf-legend" style="margin-bottom:12px"></div>
        <canvas id="chart-conf" height="240"></canvas>
      </div>

      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Struttura</th><th>Listino conc.</th>
              <th>Scontato conc.</th><th>Scontato Lav</th><th>Risparmio</th>
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
    { label: 'Concorrenza scontata', color: '#ce181e' },
    { label: 'Mylav scontata',  color: '#5fa8db' },
    { label: 'Risparmio dottore',    color: '#0f76bc' }
  ]);

  S.charts.conf = new Chart(el('chart-conf'), {
    type: 'bar',
    data: {
      labels: data.map(s => s.nome),
      datasets: [
        { label: 'Concorrenza scontata', data: data.map(s => s.prezzo_scontato_concorrenza), backgroundColor: '#ce181e', borderRadius: 4 },
        { label: 'Mylav scontata',  data: data.map(s => s.totale_scontato_lav),         backgroundColor: '#5fa8db', borderRadius: 4 },
        { label: 'Risparmio dottore',    data: data.map(s => s.risparmio_totale),              backgroundColor: '#0f76bc', borderRadius: 4 }
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
  if (S.auth.guest || !S.auth.token) { showStatus('error', '❌ Accedi per salvare i dati'); return; }
  showStatus('loading', '<div class="spinner" style="width:18px;height:18px"></div> Elaborazione...');

  const fd = new FormData();
  fd.append('file', file);
  if (force) fd.append('force', '1');

  let resp;
  try {
    const res = await fetch('/api/upload', { method: 'POST', headers: authHeaders(), body: fd });
    resp = await res.json();

    if (res.status === 409 && resp.conflict) {
      el('confirm-msg').textContent = resp.message;
      el('confirm-modal').hidden = false;
      el('confirm-ok').onclick  = () => { el('confirm-modal').hidden = true; doUpload(file, true); };
      el('confirm-cancel').onclick = () => { el('confirm-modal').hidden = true; };
      el('upload-status').hidden = true;
      return;
    }
    if (!res.ok) throw new Error(resp.error || 'Errore upload');
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
    alert('Errore rete: ' + e.message);
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert('Errore PDF: ' + (err.error || res.statusText));
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
        <div class="page-title">🔍 Debug Excel</div>
        <div class="page-subtitle">Analizza gli header rilevati senza salvare</div>
      </div>
    </div>
    <div class="page-body">
      <div class="section-card">
        <div class="section-card-title">Carica un file Excel da analizzare</div>
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
          Foglio: <strong>${sheet}</strong> — riga header: ${info.hRow}
        </div>
        <div style="font-family:monospace;font-size:12px;background:#f5f6f8;
                    padding:12px;border-radius:6px;overflow-x:auto;white-space:pre">${info.headers.join('\n')}</div>
        <div style="margin-top:8px;font-size:12px;color:#6b7280;font-weight:500">Prime 3 righe:</div>
        <div style="font-family:monospace;font-size:11px;background:#f5f6f8;
                    padding:10px;border-radius:6px;overflow-x:auto;white-space:pre;margin-top:4px">${
          info.sample.map((r,i) => `Riga ${i+1}: ${JSON.stringify(r)}`).join('\n')
        }</div>
      </div>`;
    }
    out.innerHTML = html || '<div style="color:#6b7280">Nessun foglio trovato</div>';
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
        <div class="page-subtitle">${t('pagina.piani.sottotitolo', { n: elenco.length })}</div>
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
    alert(`${t('stato.errore')}: ${e.message}`);
  }
}

async function renderPianoEdit(id) {
  let data;
  try {
    data = await api(`/api/piani/${id}`);
  } catch (e) {
    alert(`${t('stato.errore')}: ${e.message}`);
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
    alert(`${t('stato.errore')}: ${e.message}`);
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
    if (!resp.ok) throw new Error((await resp.json()).error);
    await loadPiani();
    renderPiani();
    alert(t('comune.importCompletato'));
  } catch (e) { alert(`${t('comune.erroreImport')}: ${e.message}`); }
  inputEl.value = '';
}

// ── Macchinari (analizzatori) ──
// Due livelli come Gestione concorrenti: prima i listini importati, poi le
// macchine di quello aperto. Le macchine entrano solo da un import PDF.
async function renderMacchinari() {
  const loggato = !!(S.auth && S.auth.token && !S.auth.guest);
  let listini = [];
  if (loggato) {
    try { listini = await api('/api/listini-macchine'); }
    catch (e) {
      setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
        <div class="empty-title">${t('stato.errore')}</div><div class="empty-sub">${escHtml(e.message)}</div></div>`);
      return;
    }
    // Il blocco concorrenza deve sapere quali concorrenti esistono per il suo
    // pulsante di import: se non sono ancora in memoria si caricano qui,
    // riusando loadConcorrenti invece di duplicare la chiamata all'API.
    if (!S.concorrenti || !S.concorrenti.length) {
      try { await loadConcorrenti(); } catch (e) { /* resta vuoto, il blocco lo segnala */ }
    }
  }
  S.listiniMacchine = listini;
  disegnaMacchinari();
}

// Disegno sincrono su S.listiniMacchine gia' in memoria: le due ricerche lo
// richiamano a ogni carattere digitato, quindi non deve mai ricaricare dal
// server (a differenza di renderMacchinari, che e' async e lo fa).
function disegnaMacchinari() {
  const loggato = !!(S.auth && S.auth.token && !S.auth.guest);
  const listini = S.listiniMacchine || [];
  const mie = listini.filter(l => !l.concorrenteId);
  const loro = listini.filter(l => l.concorrenteId);

  setMain(`
    <div class="page-header">
      <div><div class="page-title">${t('pagina.macchinari.titolo')}</div>
        <div class="page-subtitle">${t('pagina.macchinari.sottotitolo', { mie: mie.length, loro: loro.length })}</div>
      </div>
    </div>
    <div class="page-body">
      <div class="macc-avviso">
        <span class="macc-avviso-ico">🔬</span>
        <div>${t('macchinari.avviso', { piani: t('menu.piani'), concorrenti: t('menu.concorrenti') })}</div>
      </div>
      ${loggato ? '' : `<div class="empty-state" style="padding:12px 16px;margin-bottom:14px;text-align:left">
        <div class="empty-sub">${t('macchinari.avvisoOspite')}</div>
      </div>`}
      ${bloccoListiniHtml('mie', t('macchinari.mieTitolo'), t('macchinari.mieSottotitolo'), mie, loggato)}
      ${bloccoListiniHtml('loro', t('macchinari.loroTitolo'), t('macchinari.loroSottotitolo'), loro, loggato)}
      <div id="listino-macchine-wrap"></div>
    </div>
  `);
}

// Due blocchi distinti dai colori che nel progetto hanno gia' un significato:
// blu Mylav, rosso concorrenza. Ogni blocco ha il suo import e la sua ricerca,
// cosi' il comando dichiara da se' dove finiranno le macchine.
function bloccoListiniHtml(lato, titolo, sottotitolo, listini, loggato) {
  const filtro = lato === 'mie' ? (S.filtroListiniMie || '') : (S.filtroListiniLoro || '');
  const visibili = listini.filter(l => Ricerca.corrisponde(l.nome, filtro));
  const funzioneFiltro = lato === 'mie' ? 'filtraListiniMie' : 'filtraListiniLoro';
  const funzioneImport = lato === 'mie' ? 'importaPdfMacchineMie' : 'importaPdfMacchineConcorrente';
  const etichettaImport = lato === 'mie' ? t('comune.importaListinoPdf') : t('macchinari.importaListinoConcorrente');

  return `
    <div class="macc-blocco macc-blocco-${lato}">
      <div class="macc-blocco-testa">
        <div>
          <div class="macc-blocco-tit">${escHtml(titolo)}</div>
          <div class="macc-blocco-sub">${escHtml(sottotitolo)}</div>
        </div>
        ${loggato ? `<button class="btn-outline" onclick="${funzioneImport}()">${etichettaImport}</button>` : ''}
      </div>
      <div class="macc-blocco-corpo">
        <input class="roi-input dett-search" placeholder="${escHtml(t('macchinari.cercaListinoPlaceholder'))}" value="${escHtml(filtro)}"
               oninput="${funzioneFiltro}(this.value)" autocomplete="off" style="margin-bottom:10px">
        <div class="table-scroll">
          <table>
            <thead><tr><th>${t('macchinari.tabella.listino')}</th>${lato === 'loro' ? `<th>${t('macchinari.tabella.concorrente')}</th>` : ''}<th style="width:100px">${t('macchinari.tabella.macchine')}</th><th style="width:110px">${t('macchinari.tabella.importato')}</th><th style="width:190px"></th></tr></thead>
            <tbody>
              ${visibili.map(l => `<tr>
                <td>${escHtml(l.nome)}</td>
                ${lato === 'loro' ? `<td class="td-muted">${escHtml(l.concorrenteNome || '')}</td>` : ''}
                <td class="td-muted">${l.nMacchine}</td>
                <td class="td-muted">${fmtDate(l.dataImport)}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn-outline" onclick="renderListinoMacchine(${l.id})">${t('macchinari.vediMacchine')}</button>
                  <button class="btn-outline" onclick="eliminaListinoUI(${l.id})" style="color:var(--red);border-color:var(--red)">${t('comune.elimina')}</button>
                </td>
              </tr>`).join('')}
              ${!visibili.length ? `<tr><td colspan="${lato === 'loro' ? 5 : 4}" class="td-muted" style="text-align:center;padding:22px">
                ${listini.length
                  ? t('macchinari.nessunListinoRicerca')
                  : (loggato
                      ? t('macchinari.nessunListinoImportato')
                      : (lato === 'mie'
                          ? t('macchinari.accediImportareMie')
                          : t('macchinari.accediImportareLoro')))}
              </td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function filtraListiniMie(v) { S.filtroListiniMie = v; disegnaMacchinari(); }
function filtraListiniLoro(v) { S.filtroListiniLoro = v; disegnaMacchinari(); }

function importaPdfMacchineMie() {
  if (S.auth.guest || !S.auth.token) { alert(t('stato.ospiteAccedi', { azione: t('azione.importareListino') })); return; }
  ImportPdf.avvia({ entita: 'macchina', lato: 'mie', alFine: () => renderMacchinari() });
}

async function importaPdfMacchineConcorrente() {
  if (S.auth.guest || !S.auth.token) { alert(t('stato.ospiteAccedi', { azione: t('azione.importareListino') })); return; }
  // Con l'elenco vuoto si rilegge prima di dare un verdetto: se il caricamento
  // all'apertura della pagina e' fallito, l'archivio sembrerebbe vuoto senza
  // esserlo, e l'operatore leggerebbe un motivo sbagliato.
  if (!S.concorrenti || !S.concorrenti.length) {
    try { await loadConcorrenti(); }
    catch (e) { alert(`${t('macchinari.erroreLetturaConcorrenti')}: ${e.message}`); return; }
  }
  if (!S.concorrenti.length) {
    alert(t('macchinari.nessunConcorrenteArchivio', { sezione: t('menu.concorrenti') }));
    return;
  }
  ImportPdf.avvia({ entita: 'macchina', lato: 'concorrente', alFine: () => renderMacchinari() });
}

async function eliminaListinoUI(id) {
  const l = (S.listiniMacchine || []).find(x => x.id === id);
  const quante = l ? l.nMacchine : 0;
  const chiave = quante === 1 ? 'macchinari.confermaEliminaListino.uno' : 'macchinari.confermaEliminaListino.molti';
  if (!confirm(t(chiave, { nome: l ? l.nome : '', n: quante }))) return;
  try {
    await api(`/api/listini-macchine/${id}`, { method: 'DELETE' });
    renderMacchinari();
  } catch (e) { alert(`${t('stato.errore')}: ${e.message}`); }
}

// Le macchine del listino aperto. L'aggiunta a mano serve a correggere o
// completare un import, quindi la riga nuova appartiene a questo listino: la
// provenienza non si richiede di nuovo, la eredita.
async function renderListinoMacchine(id) {
  let dettaglio;
  try { dettaglio = await api(`/api/listini-macchine/${id}`); }
  catch (e) { alert(`${t('stato.errore')}: ${e.message}`); return; }

  // La ricerca appartiene al listino aperto: aprendone un altro si ricomincia da
  // un elenco intero. Si azzera solo al cambio di listino, non a ogni disegno,
  // altrimenti salvare una macchina cancellerebbe la ricerca in corso.
  if (!S.listinoAperto || S.listinoAperto.id !== dettaglio.id) S.filtroMacchine = '';

  S.listinoAperto = dettaglio;
  const wrap = el('listino-macchine-wrap');
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">
        ${escHtml(dettaglio.nome)} —
        ${dettaglio.concorrenteNome ? escHtml(dettaglio.concorrenteNome) : t('macchinari.mylavMie')}
      </div>
      <div class="dett-toolbar" style="margin-bottom:12px">
        <button class="btn-outline" onclick="nuovaMacchina(${id})">${t('macchinari.aggiungiMacchina')}</button>
        <input class="roi-input dett-search" id="macc-search" placeholder="${escHtml(t('macchinari.cercaMacchinaPlaceholder'))}"
               value="${escHtml(S.filtroMacchine || '')}" oninput="filtraMacchine(this.value)" autocomplete="off">
        <button class="btn-ghost" onclick="chiudiListinoMacchine()">${t('comune.chiudi')}</button>
      </div>
      <div class="table-scroll" style="max-height:420px;overflow-y:auto">
        <table>
          <thead><tr><th>${t('macchinari.tabella.macchina')}</th><th style="width:120px">${t('macchinari.tabella.prezzo')}</th><th style="width:170px"></th></tr></thead>
          <tbody id="macc-tbody"></tbody>
        </table>
      </div>
    </div>`;
  renderListinoMacchineBody();
}

function renderListinoMacchineBody() {
  const dettaglio = S.listinoAperto;
  const tbody = el('macc-tbody');
  if (!tbody || !dettaglio) return;
  const inMod = S.macchinaInModifica;
  const filtro = S.filtroMacchine || '';
  // Le altre righe (quella in modifica, se c'e', resta sempre visibile a parte).
  const altre = dettaglio.macchine.filter(m => !inMod || m.id !== inMod.id);
  const altreFiltrate = altre.filter(m => Ricerca.corrisponde(m.nome, filtro));

  tbody.innerHTML = `
    ${inMod ? `<tr class="macc-riga-modifica">
      <td><input class="roi-input" id="macc-nome" value="${escHtml(inMod.nome)}"
                 placeholder="${escHtml(t('macchinari.placeholderNomeEsempio'))}" autocomplete="off"></td>
      <td><input class="roi-input roi-num" id="macc-prezzo" inputmode="decimal"
                 value="${inMod.prezzo === '' ? '' : escHtml(String(inMod.prezzo))}" placeholder="0,00"></td>
      <td style="display:flex;gap:6px">
        <button class="btn-primary" onclick="salvaMacchinaUI()">${t('comune.salva')}</button>
        <button class="btn-outline" onclick="annullaModificaMacchina()">${t('comune.annulla')}</button>
      </td>
    </tr>` : ''}
    ${altreFiltrate.map(m => `<tr>
      <td>${escHtml(m.nome)}</td>
      <td class="td-num">${fmtEuro(m.prezzo)}</td>
      <td style="display:flex;gap:6px">
        <button class="btn-outline" onclick="modificaMacchina(${m.id})">${t('comune.modifica')}</button>
        <button class="btn-outline" onclick="eliminaMacchinaUI(${m.id})" style="color:var(--red);border-color:var(--red)">${t('comune.elimina')}</button>
      </td>
    </tr>`).join('')}
    ${!altre.length && !inMod ? `<tr><td colspan="3" class="td-muted" style="text-align:center;padding:22px">
      ${t('macchinari.nessunaMacchinaListino')}</td></tr>` : ''}
    ${altre.length && !altreFiltrate.length ? `<tr><td colspan="3" class="td-muted" style="text-align:center;padding:22px">
      ${t('macchinari.nessunaMacchinaRicerca')}</td></tr>` : ''}
  `;
}

function filtraMacchine(v) {
  S.filtroMacchine = v;
  renderListinoMacchineBody();
}

function chiudiListinoMacchine() {
  S.listinoAperto = null;
  S.macchinaInModifica = null;
  const wrap = el('listino-macchine-wrap');
  if (wrap) wrap.innerHTML = '';
}

function nuovaMacchina(listinoId) {
  S.macchinaInModifica = { id: null, listinoId, nome: '', prezzo: '' };
  renderListinoMacchine(listinoId);
}

function modificaMacchina(id) {
  const l = S.listinoAperto;
  if (!l) return;
  const m = l.macchine.find(x => x.id === id);
  if (!m) return;
  S.macchinaInModifica = { id: m.id, listinoId: l.id, nome: m.nome, prezzo: m.prezzo };
  renderListinoMacchine(l.id);
}

function annullaModificaMacchina() {
  const l = S.listinoAperto;
  S.macchinaInModifica = null;
  if (l) renderListinoMacchine(l.id);
}

async function salvaMacchinaUI() {
  if (S.salvataggioMacchinaInCorso) return;
  const inMod = S.macchinaInModifica;
  if (!inMod) return;
  const nome = (el('macc-nome') || {}).value || '';
  const prezzoTesto = (el('macc-prezzo') || {}).value || '';
  const prezzo = parseFloat(String(prezzoTesto).replace(/\./g, '').replace(',', '.'));
  if (!nome.trim()) { alert(t('macchinari.inserisciNomeMacchina')); return; }
  if (!Number.isFinite(prezzo) || prezzo < 0) { alert(t('macchinari.inserisciPrezzoValido')); return; }

  S.salvataggioMacchinaInCorso = true;
  const corpo = JSON.stringify({ listinoId: inMod.listinoId, nome: nome.trim(), prezzo });
  try {
    if (inMod.id) {
      await api(`/api/macchine/${inMod.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: corpo });
    } else {
      await api('/api/macchine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
    }
    S.macchinaInModifica = null;
    await renderMacchinari();
    renderListinoMacchine(inMod.listinoId);
  } catch (e) { alert(`${t('stato.errore')}: ${e.message}`); }
  finally { S.salvataggioMacchinaInCorso = false; }
}

async function eliminaMacchinaUI(id) {
  const l = S.listinoAperto;
  const m = l ? l.macchine.find(x => x.id === id) : null;
  if (!confirm(t('macchinari.confermaEliminaMacchina', { nome: m ? m.nome : t('macchinari.questaMacchina') }))) return;
  try {
    await api(`/api/macchine/${id}`, { method: 'DELETE' });
    await renderMacchinari();
    if (l) renderListinoMacchine(l.id);
  } catch (e) { alert(`${t('stato.errore')}: ${e.message}`); }
}

// ── Confronto macchine ──
// Sezione propria, con la stessa barra di comandi del simulatore esami.
// L'accoppiamento fra una macchina propria e una del concorrente e' scelto a
// mano riga per riga: nessuna mappatura salvata, nessun algoritmo di somiglianza.
async function renderConfrontoMacchine() {
  const loggato = !!(S.auth && S.auth.token && !S.auth.guest);
  let elenco = [];
  if (loggato) {
    try { elenco = await api('/api/macchine'); }
    catch (e) {
      setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
        <div class="empty-title">${t('stato.errore')}</div><div class="empty-sub">${escHtml(e.message)}</div></div>`);
      return;
    }
  }
  S.macchine = elenco;
  const mie = elenco.filter(m => !m.concorrenteId);
  const loro = elenco.filter(m => m.concorrenteId);

  // La riga di default nasce solo qui, al primo ingresso nella sezione (mai in
  // renderCorpoConfrontoMacchine, che ridisegna a ogni modifica): altrimenti
  // "Rimuovi tutto" verrebbe vanificato dal ridisegno immediato che segue.
  if (S.confrontoMacchine == null && mie.length && loro.length) {
    S.confrontoMacchine = [{ mia: mie[0].id, sua: loro[0].id }];
  }

  setMain(`
    <div class="page-header">
      <div><div class="page-title">${t('pagina.confrontoMacchine.titolo')}</div>
        <div class="page-subtitle">${t('pagina.confrontoMacchine.sottotitolo', { mie: mie.length, loro: loro.length })}</div>
      </div>
    </div>
    <div class="page-body">
      <div class="section-card">
        <div class="roi-toolbar" style="justify-content:flex-end">
          <div class="roi-toolbar-controls">
            ${mie.length && loro.length ? `<button class="btn-outline" onclick="aggiungiConfrontoMacchina()" style="font-size:12px">${t('confronto.aggiungiRiga')}</button>
            <button class="btn-outline" onclick="rimuoviTuttoConfrontoMacchine()" style="font-size:12px">${t('confronto.rimuoviTutto')}</button>` : ''}
            <button class="btn-outline" onclick="navigate('macchinari')" style="font-size:12px">${t('confronto.gestisciMacchinari')}</button>
          </div>
        </div>
        <div id="confronto-macchine-corpo"></div>
      </div>
    </div>
  `);
  renderCorpoConfrontoMacchine();
}

function renderCorpoConfrontoMacchine() {
  const wrap = el('confronto-macchine-corpo');
  if (!wrap) return;
  const loggato = !!(S.auth && S.auth.token && !S.auth.guest);
  const mie = (S.macchine || []).filter(m => !m.concorrenteId);
  const loro = (S.macchine || []).filter(m => m.concorrenteId);

  if (!mie.length || !loro.length) {
    const manca = !loggato
      ? t('confronto.mancaOspite')
      : !mie.length && !loro.length
        ? t('confronto.mancaEntrambe')
        : !mie.length
          ? t('confronto.mancaMie')
          : t('confronto.mancaLoro');
    wrap.innerHTML = `
      <div class="td-muted" style="padding:6px 0;line-height:1.5">${manca}</div>
      <button class="btn-primary" style="margin-top:12px" onclick="navigate('macchinari')">${loggato ? t('confronto.vaiMacchinari') : t('comune.accedi')}</button>`;
    return;
  }

  // Una riga che punta a una macchina non piu' esistente direbbe una cosa
  // diversa da quella scelta: si scarta invece di ripiegare su un'altra. Non
  // viene ricreata una riga di ripiego: quella di default nasce solo al primo
  // ingresso nella sezione, in renderConfrontoMacchine.
  const righe = Array.isArray(S.confrontoMacchine)
    ? S.confrontoMacchine.filter(r => mie.some(m => m.id === r.mia) && loro.some(m => m.id === r.sua))
    : [];
  S.confrontoMacchine = righe;

  if (!righe.length) {
    wrap.innerHTML = `
      <div class="td-muted" style="padding:16px 0;line-height:1.5;text-align:center">
        ${t('confronto.nessunaRiga')}
      </div>`;
    return;
  }

  const opzioni = (lista, sel) => lista
    .map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${escHtml(m.nome)}</option>`).join('');

  let totMia = 0, totSua = 0;
  const righeHtml = righe.map((r, i) => {
    const a = mie.find(m => m.id === r.mia);
    const b = loro.find(m => m.id === r.sua);
    totMia += a.prezzo; totSua += b.prezzo;
    const diff = a.prezzo - b.prezzo;
    return `<tr>
      <td><select class="roi-input" onchange="cambiaConfrontoMacchina(${i},'mia',this.value)">${opzioni(mie, a.id)}</select></td>
      <td><select class="roi-input" onchange="cambiaConfrontoMacchina(${i},'sua',this.value)">${opzioni(loro, b.id)}</select></td>
      <td class="td-num">${fmtEuro(a.prezzo)}</td>
      <td class="td-num">${fmtEuro(b.prezzo)}</td>
      <td class="td-num ${diff <= 0 ? 'macc-meglio' : 'macc-peggio'}">${diff <= 0 ? '−' : '+'}${fmtEuro(Math.abs(diff))}</td>
      <td>${righe.length > 1 ? `<button class="imp-x-riga" onclick="togliConfrontoMacchina(${i})" title="Togli riga">✕</button>` : ''}</td>
    </tr>`;
  }).join('');

  const diffTot = totMia - totSua;
  wrap.innerHTML = `
    <div class="table-scroll">
      <table class="macc-confronto">
        <thead><tr>
          <th>${t('confronto.tabella.miaMacchina')}</th><th>${t('confronto.tabella.concorrenzaMacchina')}</th>
          <th style="width:110px">${t('confronto.tabella.mylav')}</th><th style="width:110px">${t('confronto.tabella.concorrenza')}</th>
          <th style="width:120px">${t('confronto.tabella.differenza')}</th><th style="width:40px"></th>
        </tr></thead>
        <tbody>${righeHtml}</tbody>
        <tfoot><tr>
          <td colspan="2"><b>${t('confronto.totale')}</b></td>
          <td class="td-num"><b>${fmtEuro(totMia)}</b></td>
          <td class="td-num"><b>${fmtEuro(totSua)}</b></td>
          <td class="td-num ${diffTot <= 0 ? 'macc-meglio' : 'macc-peggio'}"><b>${diffTot <= 0 ? '−' : '+'}${fmtEuro(Math.abs(diffTot))}</b></td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>`;
}

function cambiaConfrontoMacchina(i, lato, valore) {
  if (!S.confrontoMacchine || !S.confrontoMacchine[i]) return;
  S.confrontoMacchine[i][lato] = Number(valore);
  renderCorpoConfrontoMacchine();
}

function aggiungiConfrontoMacchina() {
  const mie = (S.macchine || []).filter(m => !m.concorrenteId);
  const loro = (S.macchine || []).filter(m => m.concorrenteId);
  if (!mie.length || !loro.length) return;
  if (!Array.isArray(S.confrontoMacchine)) S.confrontoMacchine = [];
  S.confrontoMacchine.push({ mia: mie[0].id, sua: loro[0].id });
  renderCorpoConfrontoMacchine();
}

function togliConfrontoMacchina(i) {
  if (!S.confrontoMacchine) return;
  S.confrontoMacchine.splice(i, 1);
  renderCorpoConfrontoMacchine();
}

function rimuoviTuttoConfrontoMacchine() {
  if (!confirm(t('confronto.confermaSvuota'))) return;
  S.confrontoMacchine = [];
  renderCorpoConfrontoMacchine();
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
        <div class="page-subtitle">${t('pagina.concorrenti.sottotitolo', { n: elenco.length })}</div>
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
    if (!resp.ok) throw new Error((await resp.json()).error);
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
  // I listini di analizzatori di questo concorrente (e le loro macchine)
  // vengono eliminati insieme a lui: l'operatore deve saperlo prima di
  // confermare, non scoprirlo dopo.
  const nEsami = c && c.n_esami != null ? c.n_esami : null;
  const chiave = nEsami == null
    ? 'concorrenti.confermaElimina.senzaConteggio'
    : (nEsami === 1 ? 'concorrenti.confermaElimina.uno' : 'concorrenti.confermaElimina.molti');
  if (!confirm(t(chiave, { nome, n: nEsami }))) return;
  try {
    await api(`/api/concorrenti/${id}`, { method: 'DELETE' });
    await loadConcorrenti();
    renderConcorrentiAdmin();
  } catch (e) { alert(`${t('stato.errore')}: ${e.message}`); }
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
  let dettaglio;
  try { dettaglio = await api(`/api/concorrenti/${id}`); }
  catch (e) { alert(`${t('stato.errore')}: ${e.message}`); return; }

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
  } catch (e) { alert(`${t('stato.errore')}: ${e.message}`); }
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
  } catch (e) { alert(`${t('stato.errore')}: ${e.message}`); }
}

// ══════════════════════════════════════════════════
// ROI CALCOLATORE
// ══════════════════════════════════════════════════

function buildRoiSectionHtml() {
  const struttureOpts = S.strutture.map(s => `<option value="${escHtml(s.nome)}">`).join('');

  return `
    <datalist id="roi-strutture-list">${struttureOpts}</datalist>
    <div class="roi-toolbar">
      <div>
        <div class="roi-toolbar-title">Calcolatore ROI</div>
        <div class="roi-toolbar-sub">Confronto risparmio Mylav vs concorrenza</div>
      </div>
      <div class="roi-toolbar-controls">
        <div style="position:relative">
          <button class="btn-outline roi-piano-btn roi-pill-myl" id="roi-piano-btn"
                  onclick="togglePianoPanel()" title="${escHtml(pianoSelezionatoNome() || '')}">
            Piano: ${escHtml(pianoSelezionatoNome() || 'Nessuno')} ▾
          </button>
          <div id="roi-piano-panel" class="roi-piano-panel" style="display:none"></div>
        </div>
        <div style="position:relative">
          <button class="btn-outline roi-piano-btn roi-pill-conc" id="roi-concorrente-btn"
                  onclick="toggleConcorrentePanel()" title="${escHtml(concorrenteSelezionatoNome() || '')}">
            Concorrente: ${escHtml(concorrenteSelezionatoNome() || 'Nessuno')} ▾
          </button>
          <div id="roi-concorrente-panel" class="roi-piano-panel" style="display:none"></div>
        </div>
      </div>
    </div>
    <div id="roi-table-wrap" style="overflow-x:auto">${buildRoiTableHtml()}</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn-outline" onclick="addRigaRoi()" style="font-size:12px">+ Aggiungi esame</button>
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
      <button class="btn-outline" onclick="salvaCalcolo()" style="color:var(--blue);border-color:var(--blue)">💾 Salva come file</button>
      <button class="btn-outline" onclick="esportaExcelRoi()">📥 Esporta Excel</button>
      <button class="btn-outline" onclick="navigate('piani')" style="color:var(--blue);border-color:var(--blue)">+ Aggiungi piano MYL</button>
      <button class="btn-outline" onclick="navigate('concorrenti')" style="color:var(--red);border-color:var(--red)">+ Aggiungi piano concorrenza</button>
    </div>
    <button class="roi-clear-all-btn" onclick="rimuoviTuttoRoi()">🗑️ Rimuovi tutto</button>
    <div id="roi-classifica"></div>`;
}

// Azzera completamente il calcolatore ROI: righe, struttura, piano, concorrente.
function rimuoviTuttoRoi() {
  if (!confirm('Rimuovere tutto dal calcolatore? Righe, struttura, piano e concorrente selezionati verranno azzerati.')) return;
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

  let html = `<input class="roi-input" id="roi-piano-search" placeholder="🔍 Cerca piano..."
    value="${escHtml(filtro)}" oninput="renderPianoPanel(this.value)"
    style="width:100%;box-sizing:border-box;margin-bottom:8px;border:1px solid #e8e9eb">`;
  html += `<div class="roi-piano-item" onclick="selezionaPiano(null)" style="font-style:italic">— Nessun piano —</div>`;
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
    btn.textContent = `Piano: ${pianoSelezionatoNome() || 'Nessuno'} ▾`;
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

  let html = `<input class="roi-input" id="roi-concorrente-search" placeholder="🔍 Cerca concorrente..."
    value="${escHtml(filtro)}" oninput="renderConcorrentePanel(this.value)"
    style="width:100%;box-sizing:border-box;margin-bottom:8px;border:1px solid #e8e9eb">`;
  html += `<div class="roi-piano-item" onclick="selezionaConcorrente(null)" style="font-style:italic">— Nessun concorrente —</div>`;
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
    btn.textContent = `Concorrente: ${concorrenteSelezionatoNome() || 'Nessuno'} ▾`;
    btn.title = concorrenteSelezionatoNome() || '';
  }
  const tbody = el('roi-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaMatchConcorrente(tr));
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
      🔗 <strong>${escHtml(esame)}</strong> non ha corrispondenza nel listino concorrente.<br>
      <span style="font-size:11px;color:#6b7280">Clicca per mappare a mano tutti gli esami mancanti</span>
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
      💡 Forse corrisponde a <strong>${escHtml(m.nomeOriginale)}</strong> nel listino concorrente — ${fmtE(m.prezzo)}<br>
      <span style="font-size:11px;color:#6b7280">Clicca per confermare</span>
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

function buildRoiTableHtml() {
  const righe = S.roi.righe;

  const header1 = `
    <tr>
      <th colspan="4"></th>
      <th colspan="4" class="roi-grp roi-grp-conc">Concorrenza</th>
      <th></th>
      <th colspan="4" class="roi-grp roi-grp-myl">Mylav</th>
      <th></th><th></th>
    </tr>`;

  const header2 = `
    <tr>
      <th style="width:130px">Struttura</th>
      <th style="width:12px"></th>
      <th style="width:170px">ESAMI</th>
      <th style="width:60px">N.</th>
      <th style="width:95px;background:rgba(206,24,30,0.04)">Listino conc.</th>
      <th style="width:65px;background:rgba(206,24,30,0.04)">Sconto%</th>
      <th style="width:95px;background:rgba(206,24,30,0.04)">Tot. conc.</th>
      <th style="width:95px;background:rgba(206,24,30,0.04)">Scontato conc.</th>
      <th style="width:12px"></th>
      <th style="width:95px;background:rgba(15,118,188,0.06)">Listino MYL</th>
      <th style="width:95px;background:rgba(15,118,188,0.06)">Tot. MYL</th>
      <th style="width:95px;background:rgba(15,118,188,0.06)">Piano MYL</th>
      <th style="width:95px;background:rgba(15,118,188,0.06)">Tot. sc. MYL</th>
      <th style="width:95px">Risparmio</th>
      <th style="width:28px"></th>
    </tr>`;

  const bodyRows = righe.map((r, i) => buildRoiRigaHtml(r, i)).join('');

  const tots = calcolaRoiTotali();
  const totRow = `<tr class="roi-totals-row">
    <td colspan="4"><strong>TOTALE</strong></td>
    <td class="roi-calc" style="background:rgba(206,24,30,0.04)">${fmtE(tots.tot_listino_conc)}</td>
    <td style="background:rgba(206,24,30,0.04)"></td>
    <td class="roi-calc" style="background:rgba(206,24,30,0.04)">${fmtE(tots.tot_conc)}</td>
    <td class="roi-calc" style="background:rgba(206,24,30,0.04)">${fmtE(tots.tot_prezzo_conc)}</td>
    <td></td>
    <td class="roi-calc" style="background:rgba(15,118,188,0.06)">${fmtE(tots.tot_listino_lav)}</td>
    <td class="roi-calc" style="background:rgba(15,118,188,0.06)">${fmtE(tots.tot_tot_lav)}</td>
    <td class="roi-calc" style="background:rgba(15,118,188,0.06)">${fmtE(tots.tot_prezzo_lav_sc)}</td>
    <td class="roi-calc" style="background:rgba(15,118,188,0.06)">${fmtE(tots.tot_tot_prezzo_lav)}</td>
    <td class="roi-calc" style="${tots.differenziale >= 0 ? 'color:#0f76bc' : 'color:#ce181e'};font-weight:600">${fmtE(tots.differenziale)}</td>
    <td></td>
  </tr>`;
  const diffRow = `<tr class="roi-diff-row">
    <td colspan="13" style="text-align:right;font-size:13px;font-weight:500">
      <span id="roi-diff-note" style="display:${tots.differenziale < 0 ? 'inline' : 'none'};color:#ce181e;font-weight:600;font-size:11.5px;margin-right:14px">⚠ Con questo piano il dottore NON risparmia rispetto alla concorrenza</span>
      Differenziale totale:
    </td>
    <td colspan="2" style="font-size:15px;font-weight:700;color:${tots.differenziale >= 0 ? '#0f76bc' : '#ce181e'}">${fmtE(tots.differenziale)}</td>
  </tr>`;

  return `<table class="roi-editable-table roi-compare">
    <thead>${header1}${header2}</thead>
    <tbody id="roi-tbody">${bodyRows}</tbody>
    <tfoot>${totRow}${diffRow}</tfoot>
  </table>`;
}

function calcPrezConc(lc, sc, n) {
  const mult = sc > 0 ? (1 - sc / 100) : 1;
  return parseFloat((lc * mult).toFixed(2));
}

function buildRoiRigaHtml(r, i) {
  const n  = r.n_esami || 1;
  const lc = parseFloat(r.listino_concorrenza) || 0;
  const sc = parseFloat(r.sconto_concorrenza)  || 0;
  const ll = parseFloat(r.listino_lav) || 0;
  const pl = parseFloat(r.prezzo_scontato_lav) || 0;

  const totConc  = lc * n;
  const prezConc = calcPrezConc(totConc, sc, 1);
  const totLL    = ll * n;
  const totPL    = pl * n;
  // Costo Mylav effettivo: prezzo di piano se c'e', altrimenti il listino (senza piano
  // il dottore paga il listino) -> evita un falso "risparmio" positivo quando manca il piano.
  const mylavCost = totPL > 0 ? totPL : totLL;
  const risp     = prezConc - mylavCost;

  const rispColor = risp >= 0 ? '#0f76bc' : '#ce181e';
  const scPlaceholder = sc > 0 ? String(sc) : '';

  const strutturaCell = i === 0
    ? `<td><input class="roi-input roi-struttura-inp" list="roi-strutture-list" value="${escHtml(S.roi.struttura)}" placeholder="Struttura…" autocomplete="off" oninput="S.roi.struttura=this.value" style="width:120px"></td>`
    : `<td></td>`;

  return `<tr data-idx="${i}" data-tipo="Platinum">
    ${strutturaCell}
    <td></td>
    <td style="position:relative"><input class="roi-input" data-col="esame" value="${escHtml(r.esame)}" placeholder="Esame…" autocomplete="off" style="width:160px"></td>
    <td><input class="roi-input roi-num" data-col="n_esami" value="${r.n_esami}" placeholder="1" style="width:50px"></td>
    <td style="background:rgba(206,24,30,0.04)"><input class="roi-input roi-num" data-col="listino_concorrenza" value="${r.listino_concorrenza || ''}" placeholder="0.00"></td>
    <td style="background:rgba(206,24,30,0.04)"><input class="roi-input roi-num" data-col="sconto_concorrenza" value="${scPlaceholder}" placeholder="%" style="width:55px"></td>
    <td class="roi-calc" style="background:rgba(206,24,30,0.04)" data-col="tot_conc">${fmtE(totConc)}</td>
    <td class="roi-calc" style="background:rgba(206,24,30,0.04)" data-col="prezzo_conc">${fmtE(prezConc)}</td>
    <td></td>
    <td style="background:rgba(15,118,188,0.06)"><input class="roi-input roi-num" data-col="listino_lav" value="${r.listino_lav || ''}" placeholder="0.00"></td>
    <td class="roi-calc" style="background:rgba(15,118,188,0.06)" data-col="tot_listino_lav">${fmtE(totLL)}</td>
    <td style="background:rgba(15,118,188,0.06)"><input class="roi-input roi-num" data-col="prezzo_scontato_lav" value="${r.prezzo_scontato_lav || ''}" placeholder="0.00"></td>
    <td class="roi-calc" style="background:rgba(15,118,188,0.06)" data-col="tot_prezzo_lav">${fmtE(totPL)}</td>
    <td class="roi-calc" data-col="risparmio" style="color:${rispColor};font-weight:500">${fmtE(risp)}</td>
    <td><button class="roi-del-btn" onclick="removeRigaRoi(${i})" title="Rimuovi">×</button></td>
  </tr>`;
}

function fmtE(n) {
  if (!n && n !== 0) return '—';
  const v = Number(n) || 0;
  return '€ ' + v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function calcolaRoiTotali() {
  const righe = S.roi.righe;
  let t = { tot_listino_conc:0, tot_conc:0, tot_prezzo_conc:0, tot_listino_lav:0, tot_tot_lav:0, tot_prezzo_lav_sc:0, tot_tot_prezzo_lav:0, differenziale:0 };
  for (const r of righe) {
    const n  = r.n_esami || 1;
    const lc = parseFloat(r.listino_concorrenza) || 0;
    const sc = parseFloat(r.sconto_concorrenza)  || 0;
    const ll = parseFloat(r.listino_lav) || 0;
    const pl = parseFloat(r.prezzo_scontato_lav) || 0;
    const tc  = lc * n;
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

function reRenderRoiTable() {
  const wrap = el('roi-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = buildRoiTableHtml();
  initRoiEvents();
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
    ['listino_concorrenza', 'sconto_concorrenza', 'listino_lav', 'prezzo_scontato_lav'].forEach(col => {
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
      const titolo = pResp.fonte === 'piano' ? 'Prezzo automatico dal piano'
        : pResp.fonte === 'custom' ? 'Prezzo personalizzato salvato in precedenza'
        : 'Prezzo del piano non disponibile per questo esame — mostrato il prezzo base';
      if (force || campoFillabile(plInp)) {
        plInp.value = pResp.prezzo;
        plInp.dataset.auto = '1';
        plInp.title = titolo;
      } else {
        plInp.title = `${titolo} (non applicato: modifica manuale in corso)`;
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

  const titolo = `<div class="section-card-title">Piani più convenienti per questi esami</div>`;

  if (conConc && !mostrati.length) {
    box.innerHTML = `<div class="section-card roi-classifica-card">${titolo}
      <div class="roi-classifica-empty">Nessun piano batte la concorrenza per questi esami</div></div>`;
    return;
  }

  const righe = mostrati.map(p => {
    const attivo = p.pianoId === S.roi.pianoId;
    const risp = conConc
      ? `<td class="roi-classifica-risp">${fmtE(totConc - p.totale)}</td>` : '';
    return `<tr class="${attivo ? 'riga-attiva' : ''}" onclick="selezionaPiano(${p.pianoId})">
      <td>${escHtml(p.pianoNome)}${attivo ? ' <span class="roi-classifica-badge">selezionato</span>' : ''}</td>
      <td class="roi-classifica-tot">${fmtE(p.totale)}</td>${risp}</tr>`;
  }).join('');

  box.innerHTML = `<div class="section-card roi-classifica-card">${titolo}
    <table class="roi-classifica-table">
      <thead><tr><th>Piano</th><th>Totale MYLAV</th>${conConc ? '<th>Risparmio vs concorrenza</th>' : ''}</tr></thead>
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
    ? `<br><span style="font-size:11px;color:#6b7280">${resp.nSaltati} esami non a listino esclusi</span>` : '';
  let messaggio;
  if (stesso) {
    messaggio = `✓ Stai già usando il piano più conveniente per questi ${resp.nEsami} esami: <strong>${escHtml(resp.pianoNome)}</strong> (${fmtE(resp.totale)})${saltati}`;
  } else {
    const risparmio = (resp.totaleAttuale != null && resp.totaleAttuale > resp.totale)
      ? `<br><span style="font-size:11px;color:#6b7280">Risparmi ${fmtE(resp.totaleAttuale - resp.totale)} rispetto al piano attuale</span>` : '';
    messaggio = `💡 Per questi ${resp.nEsami} esami conviene <strong>${escHtml(resp.pianoNome)}</strong> — ${fmtE(resp.totale)}${risparmio}<br><span style="font-size:11px;color:#6b7280">Clicca per selezionare questo piano</span>${saltati}`;
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
    ? `✓ Stai già usando il piano più conveniente per <strong>${escHtml(esame)}</strong>: <strong>${escHtml(consiglio.pianoNome)}</strong> (${fmtE(consiglio.prezzo)})`
    : `💡 Per <strong>${escHtml(esame)}</strong> conviene <strong>${escHtml(consiglio.pianoNome)}</strong> — ${fmtE(consiglio.prezzo)}<br><span style="font-size:11px;color:#6b7280">Clicca per selezionare questo piano</span>`;

  banner.innerHTML = `
    <span class="roi-consiglio-close" onclick="event.stopPropagation(); this.parentElement.style.display='none'">×</span>
    <div ${stessoPiano ? '' : `onclick="selezionaPiano(${consiglio.pianoId})" style="cursor:pointer"`}>${messaggio}</div>
  `;
  banner.style.display = 'block';
}

function aggiornaRigaDOM(tr) {
  const idx = parseInt(tr.dataset.idx);

  const get = col => {
    const inp = tr.querySelector(`[data-col="${col}"]`);
    return inp ? (parseFloat(inp.value) || 0) : 0;
  };
  const getStr = col => {
    const inp = tr.querySelector(`[data-col="${col}"]`);
    return inp ? inp.value : '';
  };

  // Sync state
  const r = S.roi.righe[idx];
  if (!r) return;
  r.esame               = getStr('esame');
  r.n_esami             = get('n_esami') || 1;
  r.listino_concorrenza = get('listino_concorrenza');
  r.sconto_concorrenza  = get('sconto_concorrenza');
  r.listino_lav         = get('listino_lav');
  r.prezzo_scontato_lav = get('prezzo_scontato_lav');

  const n  = r.n_esami;
  const lc = r.listino_concorrenza;
  const sc = r.sconto_concorrenza;
  const ll = r.listino_lav;
  const pl = r.prezzo_scontato_lav;

  const tc  = lc * n;
  const pc  = calcPrezConc(tc, sc, 1);
  const tll = ll * n;
  const tpl = pl * n;
  const risp = pc - (tpl > 0 ? tpl : tll); // senza piano usa il listino Mylav
  setText(tr, 'tot_conc',         fmtE(tc));
  setText(tr, 'prezzo_conc',      fmtE(pc));
  setText(tr, 'tot_listino_lav',  fmtE(tll));
  setText(tr, 'tot_prezzo_lav',   fmtE(tpl));

  const rispEl = tr.querySelector('[data-col="risparmio"]');
  if (rispEl) {
    rispEl.textContent = fmtE(risp);
    rispEl.style.color = risp >= 0 ? '#0f76bc' : '#ce181e';
  }

  aggiornaTotaliDOM();
}

function setText(tr, col, val) {
  const td = tr.querySelector(`[data-col="${col}"]`);
  if (td) td.textContent = val;
}

function aggiornaTotaliDOM() {
  const tfoot = el('roi-table-wrap')?.querySelector('tfoot');
  if (!tfoot) return;
  const tots = calcolaRoiTotali();
  const totRow = tfoot.querySelector('.roi-totals-row');
  const diffRow = tfoot.querySelector('.roi-diff-row');
  if (!totRow || !diffRow) return;

  const tds = totRow.querySelectorAll('.roi-calc');
  const vals = [tots.tot_listino_conc, tots.tot_conc, tots.tot_prezzo_conc, tots.tot_listino_lav, tots.tot_tot_lav, tots.tot_prezzo_lav_sc, tots.tot_tot_prezzo_lav, tots.differenziale];
  tds.forEach((td, i) => {
    td.textContent = fmtE(vals[i]);
    if (i === vals.length - 1) td.style.color = tots.differenziale >= 0 ? '#0f76bc' : '#ce181e';
  });

  const diffVal = diffRow.querySelectorAll('td');
  const lastTd = diffVal[diffVal.length - 1];
  if (lastTd) { lastTd.textContent = fmtE(tots.differenziale); lastTd.style.color = tots.differenziale >= 0 ? '#0f76bc' : '#ce181e'; }
  const note = el('roi-diff-note');
  if (note) note.style.display = tots.differenziale < 0 ? 'inline' : 'none';
  updateDashRisparmio();
}

let _acTimeout = null;

function initRoiEvents() {
  const wrap = el('roi-table-wrap');
  if (!wrap) return;

  // Snapshot del nome esame renderizzato: serve a capire quando l'identità cambia.
  wrap.querySelectorAll('[data-col="esame"]').forEach(inp => {
    inp.dataset.lastEsame = (inp.value || '').trim();
  });

  wrap.addEventListener('input', e => {
    const inp = e.target;
    if (!inp.matches('.roi-input')) return;
    const tr = inp.closest('tr');
    if (tr && tr.dataset.tipo) aggiornaRigaDOM(tr);

    if (inp.dataset.col === 'esame') {
      clearTimeout(_acTimeout);
      _acTimeout = setTimeout(() => roiAutocomplete(inp), 200);
    }
  });

  wrap.addEventListener('blur', async e => {
    const inp = e.target;
    if (!inp.matches || !inp.matches('.roi-input')) return;
    const tr = inp.closest('tr');
    if (!tr) return;

    if (inp.dataset.col === 'esame') {
      await aggiornaPrezziAutomatici(tr);
    }

    if (inp.dataset.col === 'prezzo_scontato_lav' && S.roi.pianoId && inp.dataset.auto !== '1' && inp.value.trim()) {
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
        inp.title = 'Prezzo personalizzato salvato';
      }
    }
  }, true);

  wrap.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      const inp = e.target;
      if (!inp.matches('.roi-input')) return;
      const tr = inp.closest('tr');
      if (!tr) return;
      const tbody = el('roi-tbody');
      if (tbody && tr === tbody.lastElementChild) {
        const inputs = tr.querySelectorAll('.roi-input');
        if (inp === inputs[inputs.length - 1]) {
          e.preventDefault();
          addRigaRoi();
        }
      }
    }
    if (e.key === 'Escape') hideAc();
    if (e.key === 'Enter') {
      const inp = e.target;
      if (!inp.matches('.roi-input')) return;
      e.preventDefault();
      hideAc();
      inp.blur(); // Invio non genera blur di suo: lo forziamo per far partire la cascata prezzo
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.matches('.roi-ac-item') && !e.target.matches('[data-col="esame"]')) hideAc();
  }, { once: false });
}

async function roiAutocomplete(inp) {
  const q = inp.value.trim();
  if (q.length < 1) return hideAc();
  const items = await fetch(`/api/esami/autocomplete?q=${encodeURIComponent(q)}`, { headers: authHeaders() }).then(r => r.json()).catch(() => []);
  const ac = el('roi-ac');
  if (!items.length || !ac) return hideAc();
  const rect = inp.getBoundingClientRect();
  ac.style.display  = 'block';
  ac.style.position = 'fixed';
  ac.style.left     = rect.left + 'px';
  ac.style.top      = (rect.bottom + 4) + 'px';
  ac.style.zIndex   = '9999';
  ac.innerHTML = items.map(s => `<div class="roi-ac-item" onclick="selezionaEsame(this,'${escHtml(s)}')">${s}</div>`).join('');
  ac._targetInput = inp;
}

async function selezionaEsame(itemEl, nome) {
  const ac = el('roi-ac');
  const inp = ac?._targetInput;
  if (!inp) return hideAc();
  inp.value = nome;
  hideAc();
  const tr = inp.closest('tr');
  if (!tr) return;
  aggiornaRigaDOM(tr);
  await aggiornaPrezziAutomatici(tr);

  // Pre-popola solo i prezzi Mylav storici. Il listino concorrenza NON si prende
  // mai dallo storico: l'esame ha un prezzo concorrenza solo se esiste una
  // mappatura col concorrente selezionato (gestita da aggiornaMatchConcorrente).
  const prezzi = await fetch(`/api/esami/prezzi?nome=${encodeURIComponent(nome)}`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({}));
  if (prezzi.listino_lav) {
    const llInp = tr.querySelector('[data-col="listino_lav"]');
    if (llInp && !llInp.value) llInp.value = prezzi.listino_lav;
  }
  if (prezzi.prezzo_scontato_lav) {
    const plInp = tr.querySelector('[data-col="prezzo_scontato_lav"]');
    if (plInp && !plInp.value) plInp.value = prezzi.prezzo_scontato_lav;
  }
  aggiornaRigaDOM(tr);
}

function hideAc() {
  const ac = el('roi-ac');
  if (ac) { ac.style.display = 'none'; ac.innerHTML = ''; }
}

function syncRoiStateFromDOM() {
  const tbody = el('roi-tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaRigaDOM(tr));
}

function addRigaRoi() {
  syncRoiStateFromDOM();
  S.roi.righe.push(roiRigaVuota());
  reRenderRoiTable();
  // Focus sulla cella ESAMI dell'ultima riga
  const tbody = el('roi-tbody');
  if (tbody) {
    const lastRow = tbody.lastElementChild;
    lastRow?.querySelector('[data-col="esame"]')?.focus();
  }
}

function removeRigaRoi(idx) {
  syncRoiStateFromDOM();
  if (S.roi.righe.length > 1) {
    S.roi.righe.splice(idx, 1);
  } else {
    S.roi.righe = [roiRigaVuota()];
  }
  reRenderRoiTable();
  mostraConsiglioTotale();
  mostraClassificaPiani();
}

function getRoiRigheValide() {
  syncRoiStateFromDOM();
  return S.roi.righe.filter(r => r.esame && r.esame.trim());
}

async function salvaCalcolo() {
  if (S.auth.guest || !S.auth.token) { roiMsg('Accedi per salvare i dati', 'error'); return; }
  const righe    = getRoiRigheValide();
  const struttura = (document.querySelector('.roi-struttura-inp')?.value || S.roi.struttura || '').trim();

  if (!struttura) return roiMsg('Scrivi il nome della struttura nella prima colonna', 'error');
  if (!righe.length) return roiMsg('Nessun esame con nome compilato', 'error');

  const nomeFile = `Calcolo_${new Date().toLocaleDateString('it-IT').replace(/\//g, '-')}`;
  try {
    const resp = await api('/api/calcolo/salva', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ struttura, foglio: 'Platinum', righe, nomeFile, piano_id: S.roi.pianoId })
    });
    roiMsg('✓ Salvato! Trovi il file nella Cronologia.', 'ok');
    await loadStrutture();
    buildSidebar();
  } catch(e) {
    roiMsg('Errore: ' + e.message, 'error');
  }
}

async function esportaExcelRoi() {
  syncRoiStateFromDOM();
  const righe     = getRoiRigheValide();
  const struttura = (document.querySelector('.roi-struttura-inp')?.value || S.roi.struttura || '').trim();

  if (!righe.length) return roiMsg('Nessun esame compilato', 'error');
  try {
    const res = await fetch('/api/export-excel', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ foglio: 'Platinum', struttura: struttura || 'Struttura', righe })
    });
    if (res.status === 401) {
      if (S.auth && S.auth.token) authLogout(true);
      throw new Error('Sessione scaduta');
    }
    if (!res.ok) throw new Error((await res.json()).error);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `mylav_roi.xlsx`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch(e) { roiMsg('Errore export: ' + e.message, 'error'); }
}

function roiMsg(msg, tipo) {
  const d = el('roi-msg');
  if (!d) return;
  d.textContent = msg;
  d.style.color = tipo === 'error' ? '#ce181e' : '#0f76bc';
  setTimeout(() => { if (d) d.textContent = ''; }, 4000);
}

// ── Init ───────────────────────────────────────────
async function avviaApp() {
  // Chiamata a ogni login/registrazione/accesso ospite e a ogni avvio con
  // sessione valida: una riga macchina in modifica catturata dall'account
  // precedente (o da un avvio interrotto) non appartiene a questa sessione,
  // e se sopravvivesse un "Salva" successivo scriverebbe dati vecchi sopra
  // al catalogo dell'account ora attivo.
  S.macchinaInModifica = null;
  S.listinoAperto = null;
  // Le coppie del confronto macchine sono accoppiate per id, e gli id sono
  // globali ma appartengono al catalogo di un account: quelli salvati
  // dall'account precedente quasi certamente non esistono in questo catalogo.
  // Il redraw scarta da solo le righe che puntano a macchine non piu'
  // esistenti, ma azzerare qui evita di trascinarsi dietro un confronto
  // dell'account precedente: la sezione ripartira' dalla riga di default
  // sulle macchine del nuovo account, alla prossima visita.
  S.confrontoMacchine = null;
  // loadStrutture/loadConcorrenti richiedono un account (dati privati per utente):
  // in modalita' ospite falliscono con 401, atteso. Non deve bloccare il boot.
  await loadStrutture().catch(() => { S.strutture = []; });
  await loadPiani().catch(() => { S.piani = []; });
  await loadConcorrenti().catch(() => { S.concorrenti = []; });
  buildSidebar();
  initDropzone();
  navigate('dashboard');
}

async function boot() {
  document.documentElement.lang = I18n.lingua();
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
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Login fallito');
  salvaSessione(d.token, d.email, d.isAdmin); nascondiAuthScreen(); avviaApp();
}

async function authRegister(email, password) {
  const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Registrazione fallita');
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
  // La riga in modifica appartiene all'account che sta uscendo: valori
  // catturati prima del logout non devono ripresentarsi (e finire salvati)
  // sotto l'account che accedera' dopo.
  S.macchinaInModifica = null;
  S.listinoAperto = null;
  // Stesso motivo: gli id delle macchine accoppiate nel confronto sono del
  // catalogo dell'account che esce e non hanno senso per quello successivo.
  S.confrontoMacchine = null;
  mostraAuthScreen();
}

async function authRequestReset(email) {
  const r = await fetch('/api/auth/request-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Richiesta fallita');
  return d;
}

async function authResetPassword(email, code, newPassword) {
  const r = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, newPassword }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Reset fallito');
  return d;
}

async function authRecoverFull(recoveryCode, newEmail, newPassword) {
  const r = await fetch('/api/auth/recover-full', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryCode, newEmail, newPassword }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Recupero fallito');
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
  const ov = el('auth-overlay');
  ov.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">MYL<svg viewBox="0 0 100 100" width="26" height="30">
        <polygon points="6,94 40,10 52,10 22,94" fill="#ce181e"/>
        <polygon points="94,94 60,10 48,10 78,94" fill="#0f76bc"/></svg>V<span class="auth-reg">®</span></div>
      <div class="auth-rule"></div>
      <div class="auth-tabs" id="auth-tabs">
        <button class="auth-tab ${vista === 'login' ? 'active' : ''}" onclick="mostraAuthScreen('login')">${t('comune.accedi')}</button>
        <button class="auth-tab ${vista === 'register' ? 'active' : ''}" onclick="mostraAuthScreen('register')">${t('auth.registrati')}</button>
      </div>
      <div id="auth-err" class="auth-err" style="display:none"></div>
      <div id="auth-body"></div>
      <div class="auth-links">
        <a onclick="authGuest()">${t('auth.ospiteEntra')}</a>
        <a onclick="mostraAuthScreen('reset')">${t('auth.passwordDimenticata')}</a>
        <a onclick="mostraAuthScreen('recover')">${t('auth.recuperoCompleto')}</a>
      </div>
    </div>`;
  ov.style.display = 'flex';
  renderAuthBody(vista);
}

function nascondiAuthScreen() {
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
          <li data-rule="lunghezza">Almeno 8 caratteri</li>
          <li data-rule="cifra">Almeno un numero</li>
          <li data-rule="speciale">Almeno un carattere speciale</li>
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
      if (!passwordOk(pass)) return authErr('La password non rispetta i requisiti richiesti');
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
        <div class="auth-form-title">Recupera la password</div>
        <label class="auth-label">Email</label>
        <input class="auth-input" type="email" id="auth-reset-email" required autocomplete="username">
        <button type="submit" class="btn-primary auth-submit">Invia codice</button>
        <div class="auth-back"><a onclick="mostraAuthScreen('login')">&larr; Torna al login</a></div>
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
        <div class="auth-form-title">Recupero completo account</div>
        <label class="auth-label">Codice di recupero</label>
        <input class="auth-input" type="text" id="auth-rec-code" required placeholder="XXXX-XXXX-XXXX">
        <label class="auth-label">Nuova email</label>
        <input class="auth-input" type="email" id="auth-rec-email" required autocomplete="username">
        <label class="auth-label">Nuova password</label>
        <input class="auth-input" type="password" id="auth-rec-pass" required autocomplete="new-password">
        <ul class="auth-rules" id="auth-rec-rules">
          <li data-rule="lunghezza">Almeno 8 caratteri</li>
          <li data-rule="cifra">Almeno un numero</li>
          <li data-rule="speciale">Almeno un carattere speciale</li>
        </ul>
        <button type="submit" class="btn-primary auth-submit">Recupera account</button>
        <div class="auth-back"><a onclick="mostraAuthScreen('login')">&larr; Torna al login</a></div>
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
      if (!passwordOk(newPassword)) return authErr('La password non rispetta i requisiti richiesti');
      try {
        await authRecoverFull(code, newEmail, newPassword);
        authErr('');
        const body2 = el('auth-body');
        body2.innerHTML = `<div class="auth-ok">Account recuperato. Ora puoi accedere con la nuova email e password.</div>`;
        setTimeout(() => mostraAuthScreen('login'), 1800);
      } catch (err) { authErr(err.message); }
    });
    return;
  }
}

function renderResetStep2(email) {
  const body = el('auth-body');
  authErr('');
  body.innerHTML = `
    <form id="auth-form-reset2" class="auth-form">
      <div class="auth-form-title">Controlla la tua email</div>
      <div class="auth-hint">Abbiamo inviato un codice a ${escHtml(email)} (se l'account esiste).</div>
      <label class="auth-label">Codice ricevuto</label>
      <input class="auth-input" type="text" id="auth-reset-code" required>
      <label class="auth-label">Nuova password</label>
      <input class="auth-input" type="password" id="auth-reset-newpass" required autocomplete="new-password">
      <ul class="auth-rules" id="auth-reset-rules">
        <li data-rule="lunghezza">Almeno 8 caratteri</li>
        <li data-rule="cifra">Almeno un numero</li>
        <li data-rule="speciale">Almeno un carattere speciale</li>
      </ul>
      <button type="submit" class="btn-primary auth-submit">Reimposta password</button>
      <div class="auth-back"><a onclick="mostraAuthScreen('login')">&larr; Torna al login</a></div>
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
    if (!passwordOk(newPassword)) return authErr('La password non rispetta i requisiti richiesti');
    try {
      await authResetPassword(email, code, newPassword);
      const body2 = el('auth-body');
      body2.innerHTML = `<div class="auth-ok">Password reimpostata. Ora puoi accedere.</div>`;
      setTimeout(() => mostraAuthScreen('login'), 1500);
    } catch (err) { authErr(err.message); }
  });
}

function renderCodiceRecupero(recoveryCode) {
  const tabs = el('auth-tabs');
  if (tabs) tabs.style.display = 'none';
  authErr('');
  const body = el('auth-body');
  body.innerHTML = `
    <div class="auth-form-title">Salva il tuo codice di recupero</div>
    <div class="auth-hint">Questo codice è l'unico modo per recuperare l'account se perdi email e password. Conservalo in un posto sicuro: non verrà mostrato di nuovo.</div>
    <div class="auth-code">${escHtml(recoveryCode)}</div>
    <button type="button" class="btn-primary auth-submit" id="auth-code-continua">Ho salvato il codice, continua</button>`;
  el('auth-code-continua').addEventListener('click', () => {
    nascondiAuthScreen();
    avviaApp();
  });
}
