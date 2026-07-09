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
    righe: [roiRigaVuota()]
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
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
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
}

function buildSidebar() {
  const nav = el('sidebar-nav');
  if (!nav) return;

  let html = `
    <div class="nav-upload" onclick="openUploadModal()">
      <span class="nav-icon">+</span> Carica file Excel
    </div>
    <div class="nav-item ${isActive('dashboard')}" onclick="navigate('dashboard')">
      <span class="nav-icon">📊</span> Dashboard
    </div>
    <div class="nav-divider">Strutture</div>
  `;

  if (S.strutture.length === 0) {
    html += `<div style="padding:8px 16px;font-size:12px;color:#9ca3af">Nessuna struttura</div>`;
  }

  for (const s of S.strutture) {
    const open = S.expanded[s.id] ? 'open' : '';
    html += `
      <div class="struttura-group">
        <div class="struttura-header ${open}" onclick="toggleStruttura(${s.id})">
          <span class="sname">▼ ${s.nome}</span>
          <span class="struttura-del" title="Elimina struttura" onclick="event.stopPropagation(); eliminaStrutturaUI(${s.id})">×</span>
          <span class="struttura-chevron">›</span>
        </div>
        <div class="struttura-children ${open}" id="sc-${s.id}">
    `;

    const fogliOrder = ['Foglio 1', 'Platinum', 'Gold'];
    for (const foglio of fogliOrder) {
      if (s.fogli.includes(foglio)) {
        html += `
          <div class="struttura-child ${isActiveFoglio(s.id, foglio)}"
               onclick="navigateToStruttura(${s.id}, '${foglio}')">
            ${foglio}
          </div>
        `;
      }
    }

    if (s.file_count >= 2) {
      html += `<div class="struttura-sep"></div>
        <div class="struttura-child ${isActive('totali', s.id)}"
             onclick="navigate('totali', { strutturaId: ${s.id}, nome: '${s.nome.replace(/'/g,"\\'")}' })">
          Totali struttura
        </div>`;
    }

    html += `</div></div>`;
  }

  html += `
    <div class="nav-divider" style="margin-top:8px">Gestione</div>
    <div class="nav-item ${isActive('piani')}" onclick="navigate('piani')">
      <span class="nav-icon">💰</span> Gestione piani
    </div>
    <div class="nav-item ${isActive('concorrenti')}" onclick="navigate('concorrenti')">
      <span class="nav-icon">🏷️</span> Gestione concorrenti
    </div>
  `;

  if (S.strutture.length >= 2) {
    html += `
      <div class="nav-item ${isActive('confronto')}" onclick="navigate('confronto')">
        <span class="nav-icon">⚖️</span> Confronto strutture
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
        <div class="struttura-child ${isActive('cronologia')}" onclick="navigate('cronologia')">Cronologia file</div>
        <div class="struttura-child ${isActive('debug')}" onclick="navigate('debug')">Debug Excel</div>
      </div>
    </div>
  `;

  nav.innerHTML = html;
}

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
  window._currentStrutturaId = params.strutturaId || null;
  window._currentFoglio      = params.foglio      || null;

  setMain('<div class="page-loading"><div class="spinner"></div></div>');

  switch (view) {
    case 'dashboard':  renderDashboard();                              break;
    case 'foglio':     renderFoglio(params.fileId, params.foglio);     break;
    case 'totali':     renderTotali(params.strutturaId, params.nome);  break;
    case 'cronologia': renderCronologia();                             break;
    case 'confronto':  renderConfronto();                              break;
    case 'debug':      renderDebug();                                  break;
    case 'piani':      renderPiani();                                  break;
    case 'concorrenti': renderConcorrentiAdmin();                      break;
  }
  buildSidebar();
}

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
        <div><div class="page-title">Dashboard</div></div>
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
        <div class="kpi-card kpi-risparmio">
          <div class="kpi-label">Risparmio totale dottori</div>
          <div class="kpi-value">${euro(differenziale_totale)}</div>
          <div class="kpi-sub">vs concorrenza</div>
        </div>
        ${per_struttura.length >= 2 ? `
        <div class="section-card">
          <div class="section-card-title">Riepilogo per struttura</div>
          <div class="chart-canvas-wrap">
            <canvas id="chart-confronto-dash" height="180"></canvas>
          </div>
        </div>` : ''}
      </div>
      ${buildRoiActionsHtml()}
    </div>
  `);

  // Calcolatore ROI — eroe in cima alla dashboard
  el('roi-hero').innerHTML = buildRoiSectionHtml();
  initRoiEvents();

  if (per_struttura.length >= 2) {
    const ctx = el('chart-confronto-dash');
    if (ctx) {
      S.charts.dash = new Chart(ctx, {
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
          📄 PDF dottore
        </button>
        <button class="btn-outline" onclick="downloadPdf(${fileId},'${foglio}','completo')">
          📄 PDF completo
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
    { label: 'Prezzo Mylav al dottore', color: '#5fa8db' },
    { label: 'Sconto Mylav applicato',  color: '#a9d0ec' },
    { label: 'Risparmio dottore vs concorrenza', color: '#0f76bc' },
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
        backgroundColor: ['#5fa8db', '#a9d0ec', '#0f76bc', '#ce181e'],
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
    { label: 'Risparmio vs mercato', color: '#0f76bc' }
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
        backgroundColor: ['#0f76bc', '#0f76bc'],
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
    { label: 'Risparmio dottore',    color: '#0f76bc' }
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
          backgroundColor: '#0f76bc',
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
    { label: 'Risparmio vs mercato', color: '#0f76bc' }
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
          backgroundColor: '#0f76bc',
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
      <div><div class="page-title">Cronologia file</div>
        <div class="page-subtitle">Tutti i file caricati</div>
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

  return rows.map(r => `
    <tr class="clickable" onclick="navigateFromCrono(${r.id}, ${r.struttura_id}, '${(r.fogli||'').split(',')[0]}')">
      <td class="td-muted">${fmtDate(r.data_carico)}</td>
      <td>${r.nome_file}</td>
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
    await fetch(`/api/cronologia/${id}`, { method: 'DELETE' });
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
      <div><div class="page-title">Confronto strutture</div>
        <div class="page-subtitle">${data.length} strutture nel database</div>
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
  showStatus('loading', '<div class="spinner" style="width:18px;height:18px"></div> Elaborazione...');

  const fd = new FormData();
  fd.append('file', file);
  if (force) fd.append('force', '1');

  let resp;
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
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

  let res;
  try {
    res = await fetch(`/api/pdf/${tipo}/${fileId}/${encodeURIComponent(foglio)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ donutImg, barreImg })
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
    const res  = await fetch('/api/debug', { method: 'POST', body: fd });
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
      <div class="empty-title">Errore</div><div class="empty-sub">${escHtml(e.message)}</div></div>`);
    return;
  }

  S.pianiAdmin = elenco;
  setMain(`
    <div class="page-header">
      <div><div class="page-title">Gestione piani di scontistica</div>
        <div class="page-subtitle">${elenco.length} piani (attivi e disattivati)</div>
      </div>
      <div class="page-actions">
        <label class="btn-outline" for="piani-import-input">📥 Importa listino JSON</label>
        <input type="file" id="piani-import-input" accept=".json" style="display:none" onchange="importaPianiJson(this)">
      </div>
    </div>
    <div class="page-body">
      <div class="dett-toolbar" style="margin-bottom:14px">
        <input class="roi-input dett-search" id="piani-search" placeholder="🔍 Cerca piano per nome o categoria…"
               value="${escHtml(S.pianiFiltro || '')}" oninput="filtraPiani(this.value)" autocomplete="off">
      </div>
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Nome</th><th>Categoria</th><th>Anno</th><th>Attivo</th><th></th></tr></thead>
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
  const q = (S.pianiFiltro || '').trim().toLowerCase();
  const list = (S.pianiAdmin || []).filter(p =>
    !q || p.nome.toLowerCase().includes(q) || (p.categoria || '').toLowerCase().includes(q));
  tb.innerHTML = list.map(p => `<tr>
    <td>${escHtml(p.nome)}</td>
    <td class="td-muted">${escHtml(p.categoria)}</td>
    <td class="td-muted">${p.anno || '—'}</td>
    <td>${p.attivo ? '✅' : '❌'}</td>
    <td style="display:flex;gap:6px">
      <button class="btn-outline" onclick="togglePianoAttivo(${p.id}, ${p.attivo ? 0 : 1})">${p.attivo ? 'Disattiva' : 'Attiva'}</button>
      <button class="btn-outline" onclick="renderPianoEdit(${p.id})">Modifica prezzi</button>
    </td>
  </tr>`).join('') || '<tr><td colspan="5" class="td-muted" style="text-align:center;padding:16px">Nessun piano trovato</td></tr>';
}

function filtraPiani(v) {
  S.pianiFiltro = v;
  renderPianiBody();
}

async function togglePianoAttivo(id, attivo) {
  try {
    await api(`/api/piani/${id}/attivo`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attivo })
    });
    await loadPiani();
    renderPiani();
  } catch (e) {
    alert('Errore: ' + e.message);
  }
}

async function renderPianoEdit(id) {
  let data;
  try {
    data = await api(`/api/piani/${id}`);
  } catch (e) {
    alert('Errore: ' + e.message);
    return;
  }
  const wrap = el('piano-edit-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">Prezzi — ${escHtml(data.piano.nome)}</div>
      <table class="roi-editable-table">
        <thead><tr><th>Esame</th><th>Prezzo base</th><th>Prezzo per questo piano</th></tr></thead>
        <tbody>
          ${data.prezzi.map(p => `<tr>
            <td>${escHtml(p.esame_nome)}</td>
            <td class="td-muted">${fmtE(p.prezzo_base)}</td>
            <td><input class="roi-input roi-num" data-esame-id="${p.esame_id}" value="${p.prezzo != null ? p.prezzo : ''}" placeholder="0.00"></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <button class="btn-primary mt-4" onclick="salvaPianoPrezzi(${id})">Salva prezzi</button>
    </div>
  `;
}

async function salvaPianoPrezzi(id) {
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
    alert('Prezzi salvati.');
  } catch (e) {
    alert('Errore: ' + e.message);
  }
}

async function importaPianiJson(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { alert('File JSON non valido'); return; }
  try {
    const resp = await fetch('/api/piani/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!resp.ok) throw new Error((await resp.json()).error);
    await loadPiani();
    renderPiani();
    alert('Import completato.');
  } catch (e) { alert('Errore import: ' + e.message); }
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
      <div class="empty-title">Errore</div><div class="empty-sub">${escHtml(e.message)}</div></div>`);
    return;
  }

  setMain(`
    <div class="page-header">
      <div><div class="page-title">Gestione concorrenti</div>
        <div class="page-subtitle">${elenco.length} concorrenti importati</div>
      </div>
      <div class="page-actions">
        <label class="btn-outline" for="concorrenti-import-input">📥 Importa listino Excel</label>
        <input type="file" id="concorrenti-import-input" accept=".xlsx,.xls" style="display:none" onchange="avviaImportConcorrente(this)">
        <label class="btn-outline" for="concorrenti-import-pdf">📄 Importa listino PDF</label>
        <input type="file" id="concorrenti-import-pdf" accept=".pdf" style="display:none" onchange="avviaImportPdf(this)">
      </div>
    </div>
    <div class="page-body">
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Nome</th><th>Data import</th><th>Esami</th><th>Mappati</th><th></th></tr></thead>
            <tbody>
              ${elenco.map(c => `<tr>
                <td>${escHtml(c.nome)}</td>
                <td class="td-muted">${fmtDate(c.data_import)}</td>
                <td class="td-muted">${c.n_esami}</td>
                <td class="td-muted">${c.n_mappati} / ${c.n_esami}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn-outline" onclick="renderConcorrenteDettaglio(${c.id})">Vedi esami</button>
                  <button class="btn-outline" onclick="eliminaConcorrenteUI(${c.id})" style="color:var(--red);border-color:var(--red)">Elimina</button>
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
    const resp = await fetch('/api/concorrenti/import', { method: 'POST', body: formData });
    if (!resp.ok) throw new Error((await resp.json()).error);
    parsed = await resp.json();
  } catch (e) {
    alert('Errore lettura file: ' + e.message);
    inputEl.value = '';
    return;
  }
  inputEl.value = '';

  if (!parsed.headers.length || !parsed.rows.length) {
    alert('Non sono riuscito a trovare una riga di intestazione con almeno 2 colonne in questo file.');
    return;
  }

  window._importConcorrenteRows = parsed.rows;
  renderImportConcorrenteForm(parsed);
}

function renderImportConcorrenteForm(parsed) {
  const wrap = el('concorrente-import-wrap');
  if (!wrap) return;
  const opts = parsed.headers.map((h, i) => `<option value="${i}">[${i}] ${escHtml(h || '(vuota)')}</option>`).join('');
  const optsConSconto = `<option value="-1">— nessuna colonna sconto —</option>` + opts;

  const anteprima = parsed.rows.slice(0, 5).map(r =>
    `<tr>${parsed.headers.map((_, i) => `<td>${escHtml(r[i])}</td>`).join('')}</tr>`
  ).join('');

  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">Conferma colonne — ${parsed.rows.length} righe trovate</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <label>Nome concorrente<br>
          <input class="roi-input" id="import-nome-concorrente" placeholder="Es. IDEXX 2026" style="width:200px">
        </label>
        <label>Colonna nome esame<br>
          <select class="roi-input" id="import-col-esame" style="width:200px">${opts}</select>
        </label>
        <label>Colonna prezzo<br>
          <select class="roi-input" id="import-col-prezzo" style="width:200px">${opts}</select>
        </label>
        <label>Colonna sconto<br>
          <select class="roi-input" id="import-col-sconto" style="width:200px">${optsConSconto}</select>
        </label>
      </div>
      <div class="table-scroll" style="margin-bottom:12px">
        <table><thead><tr>${parsed.headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${anteprima}</tbody></table>
      </div>
      <button class="btn-primary" onclick="confermaImportConcorrente()">Conferma import</button>
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
  const nomeConcorrente = el('import-nome-concorrente')?.value.trim();
  const colEsame  = Number(el('import-col-esame')?.value);
  const colPrezzo = Number(el('import-col-prezzo')?.value);
  const colSconto = Number(el('import-col-sconto')?.value);
  const rows = window._importConcorrenteRows || [];

  if (!nomeConcorrente) return alert('Inserisci il nome del concorrente');
  if (!rows.length) return alert('Nessuna riga da importare');

  try {
    await api('/api/concorrenti/import/conferma', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeConcorrente, colEsame, colPrezzo, colSconto, rows })
    });
    await loadConcorrenti();
    renderConcorrentiAdmin();
    alert('Import completato.');
  } catch (e) {
    alert('Errore import: ' + e.message);
  }
}

async function eliminaConcorrenteUI(id) {
  const c = S.concorrenti.find(x => x.id === id);
  const nome = c ? c.nome : 'questo concorrente';
  if (!confirm(`Eliminare "${nome}" e tutti i suoi esami? L'operazione non è reversibile.`)) return;
  try {
    await api(`/api/concorrenti/${id}`, { method: 'DELETE' });
    await loadConcorrenti();
    renderConcorrentiAdmin();
  } catch (e) { alert('Errore: ' + e.message); }
}

// ── Import PDF (best-effort + revisione) ──
async function avviaImportPdf(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const nomeDefault = file.name.replace(/\.pdf$/i, '');
  const formData = new FormData();
  formData.append('file', file);

  let parsed;
  try {
    const resp = await fetch('/api/concorrenti/import-pdf', { method: 'POST', body: formData });
    if (!resp.ok) throw new Error((await resp.json()).error);
    parsed = await resp.json();
  } catch (e) {
    alert('Errore lettura PDF: ' + e.message);
    inputEl.value = '';
    return;
  }
  inputEl.value = '';

  if (!parsed.righe.length) {
    alert('Nessuna riga con prezzo riconosciuta in questo PDF.');
    return;
  }
  window._importPdfRows = parsed.righe;
  renderImportPdfForm(parsed, nomeDefault);
}

function renderImportPdfForm(parsed, nomeDefault) {
  const wrap = el('concorrente-import-wrap');
  if (!wrap) return;
  const righe = parsed.righe.map((r, i) => `
    <tr>
      <td style="text-align:center"><input type="checkbox" data-pdf-incl="${i}" checked></td>
      <td><input class="roi-input" data-pdf-nome="${i}" value="${escHtml(r.nome_originale)}" style="width:320px"></td>
      <td><input class="roi-input roi-num" data-pdf-prezzo="${i}" value="${r.prezzo}" style="width:90px"></td>
      <td class="td-muted">${escHtml(r.code || '')}</td>
    </tr>`).join('');

  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">Revisione import PDF — ${parsed.righe.length} esami rilevati · ${parsed.scartate} righe scartate</div>
      <div style="margin-bottom:12px">
        <label>Nome concorrente<br>
          <input class="roi-input" id="import-pdf-nome" value="${escHtml(nomeDefault || '')}" placeholder="Es. IDEXX 2026" style="width:260px">
        </label>
      </div>
      <div class="table-scroll" style="max-height:420px;overflow-y:auto;margin-bottom:12px">
        <table class="roi-editable-table">
          <thead><tr><th style="width:40px">Incl.</th><th>Nome esame</th><th>Prezzo</th><th>Code</th></tr></thead>
          <tbody>${righe}</tbody>
        </table>
      </div>
      <button class="btn-primary" onclick="confermaImportPdf()">Conferma import</button>
    </div>
  `;
}

async function confermaImportPdf() {
  const nomeConcorrente = el('import-pdf-nome')?.value.trim();
  if (!nomeConcorrente) return alert('Inserisci il nome del concorrente');
  const wrap = el('concorrente-import-wrap');
  const rows = window._importPdfRows || [];
  const righe = rows
    .map((r, i) => ({
      incl: wrap.querySelector(`[data-pdf-incl="${i}"]`)?.checked,
      nome_originale: wrap.querySelector(`[data-pdf-nome="${i}"]`)?.value.trim(),
      prezzo: parseFloat(wrap.querySelector(`[data-pdf-prezzo="${i}"]`)?.value)
    }))
    .filter(r => r.incl && r.nome_originale && !isNaN(r.prezzo) && r.prezzo > 0)
    .map(r => ({ nome_originale: r.nome_originale, prezzo: r.prezzo, sconto: null }));

  if (!righe.length) return alert('Nessuna riga selezionata valida');

  try {
    await api('/api/concorrenti/import-pdf/conferma', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeConcorrente, righe })
    });
    await loadConcorrenti();
    renderConcorrentiAdmin();
    alert('Import PDF completato.');
  } catch (e) {
    alert('Errore import: ' + e.message);
  }
}

async function renderConcorrenteDettaglio(id) {
  let dettaglio;
  try { dettaglio = await api(`/api/concorrenti/${id}`); }
  catch (e) { alert('Errore: ' + e.message); return; }

  const wrap = el('concorrente-dettaglio-wrap');
  if (!wrap) return;

  // Stato locale della vista (ricerca + ordinamento) — il body si ri-renderizza senza ricaricare.
  S.concDett = { id, esami: dettaglio.esami, nome: dettaglio.concorrente.nome, filtro: '', dir: 1 };

  const hint = S.mappingDaRoi;   // eventuale esame Mylav in mappatura, arrivato dal Calcolatore ROI
  S.mappingDaRoi = null;         // consuma (una volta sola)

  wrap.innerHTML = `
    <div class="section-card" data-concorrente-id="${id}">
      <div class="section-card-title">Esami — ${escHtml(dettaglio.concorrente.nome)}</div>
      ${hint ? `<div class="dett-maphint">Stai mappando l'esame Mylav <strong>«${escHtml(hint)}»</strong></div>` : ''}
      <div class="dett-maplabel">Inserisci il nome dell'esame della concorrenza che vuoi mappare</div>
      <div class="dett-toolbar">
        <input class="roi-input dett-search" id="conc-search" placeholder="🔍 Nome esame concorrenza…"
               oninput="filtraDettaglio(this.value)" autocomplete="off">
        <button class="btn-outline" id="conc-sort" onclick="toggleSortDettaglio()">Ordina A → Z</button>
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
    <td>${e.esame_mylav_nome ? (e.confermato ? '✅ confermato' : '🔎 auto') : '— non mappato'}</td>
    <td><input class="roi-input" data-esame-concorrente-id="${e.id}" value="${escHtml(e.esame_mylav_nome || '')}" placeholder="nome esame Mylav" style="width:180px"></td>
    <td style="display:flex;gap:6px">
      <button class="btn-outline" onclick="salvaMappaturaManuale(${st.id}, ${e.id})">Salva</button>
      ${e.esame_mylav_nome ? `<button class="btn-outline" onclick="rimuoviMappaturaManuale(${st.id}, ${e.id})">Rimuovi</button>` : ''}
    </td>
  </tr>`;

  const tabella = (lista) => `
    <table class="roi-editable-table" style="margin-bottom:8px">
      <thead><tr><th>Nome originale</th><th>Prezzo</th><th>Sconto</th><th>Stato</th><th>Nome Mylav</th><th></th></tr></thead>
      <tbody>${lista.map(rigaHtml).join('')}</tbody>
    </table>`;

  const gruppo = (titolo, cls, lista) => `
    <div class="grp-title ${cls}">${titolo} (${lista.length})</div>
    ${lista.length ? tabella(lista) : '<div class="td-muted" style="padding:4px 0">Nessuno</div>'}`;

  body.innerHTML = gruppo('✅ Mappati', 'grp-map', mappati) + gruppo('Da mappare', 'grp-nomap', nonMappati);
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
  if (btn) btn.textContent = S.concDett.dir === 1 ? 'Ordina A → Z' : 'Ordina Z → A';
  renderDettaglioBody();
}

async function salvaMappaturaManuale(concorrenteId, esameConcorrenteId) {
  const inp = document.querySelector(`[data-esame-concorrente-id="${esameConcorrenteId}"]`);
  const esameMylavNome = inp ? inp.value.trim() : '';
  if (!esameMylavNome) return alert('Scrivi il nome esame Mylav corrispondente');
  try {
    await api(`/api/concorrenti/${concorrenteId}/conferma-match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ esameConcorrenteId, esameMylavNome })
    });
    alert('Mappatura salvata.');
  } catch (e) { alert('Errore: ' + e.message); }
}

async function rimuoviMappaturaManuale(concorrenteId, esameConcorrenteId) {
  try {
    await api(`/api/concorrenti/${concorrenteId}/rimuovi-match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ esameConcorrenteId })
    });
    renderConcorrenteDettaglio(concorrenteId);
  } catch (e) { alert('Errore: ' + e.message); }
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
    </div>`;
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
    tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaPrezziAutomatici(tr));
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
  const m = await fetch(`/api/concorrenti/${requestedConcorrenteId}/match?esame=${encodeURIComponent(esame)}`)
    .then(r => r.json()).catch(() => ({ trovato: false }));
  if (S.roi.concorrenteId !== requestedConcorrenteId) return; // selezione concorrente cambiata nel frattempo

  if (m.trovato && m.sicuro) {
    if (banner) banner.style.display = 'none';
    if (lcInp.value === '' || lcInp.dataset.auto === '1') {
      lcInp.value = m.prezzo;
      lcInp.dataset.auto = '1';
    }
    if (m.sconto != null && (scInp.value === '' || scInp.dataset.auto === '1')) {
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
    <div onclick="mappaturaManualeDaRoi(${concorrenteId}, decodeURIComponent('${encodeURIComponent(esame)}'))" style="cursor:pointer">
      🔗 Nessuna corrispondenza per <strong>${escHtml(esame)}</strong> nel listino concorrente.<br>
      <span style="font-size:11px;color:#6b7280">Clicca per mapparlo a mano nel listino</span>
    </div>
  `;
  banner.style.display = 'block';
}

async function mappaturaManualeDaRoi(concorrenteId, esameMyl) {
  const banner = el('roi-match-banner');
  if (banner) banner.style.display = 'none';
  window._currentView = 'concorrenti';
  S.mappingDaRoi = esameMyl;   // mostrato come contesto nel dettaglio; l'utente cerca il nome CONCORRENTE
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
    headers: { 'Content-Type': 'application/json' },
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
    <td colspan="13" style="text-align:right;font-size:13px;font-weight:500">Differenziale totale:</td>
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
  const risp     = prezConc - totPL;

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
    <td style="background:rgba(206,24,30,0.04)"><input class="roi-input roi-num" data-col="listino_concorrenza" value="${r.listino_concorrenza}" placeholder="0.00"></td>
    <td style="background:rgba(206,24,30,0.04)"><input class="roi-input roi-num" data-col="sconto_concorrenza" value="${scPlaceholder}" placeholder="%" style="width:55px"></td>
    <td class="roi-calc" style="background:rgba(206,24,30,0.04)" data-col="tot_conc">${fmtE(totConc)}</td>
    <td class="roi-calc" style="background:rgba(206,24,30,0.04)" data-col="prezzo_conc">${fmtE(prezConc)}</td>
    <td></td>
    <td style="background:rgba(15,118,188,0.06)"><input class="roi-input roi-num" data-col="listino_lav" value="${r.listino_lav}" placeholder="0.00"></td>
    <td class="roi-calc" style="background:rgba(15,118,188,0.06)" data-col="tot_listino_lav">${fmtE(totLL)}</td>
    <td style="background:rgba(15,118,188,0.06)"><input class="roi-input roi-num" data-col="prezzo_scontato_lav" value="${r.prezzo_scontato_lav}" placeholder="0.00"></td>
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
    t.differenziale      += pc - tpl;
  }
  return t;
}

function reRenderRoiTable() {
  const wrap = el('roi-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = buildRoiTableHtml();
  initRoiEvents();
}

async function aggiornaPrezziAutomatici(tr) {
  const esameInp = tr.querySelector('[data-col="esame"]');
  const llInp    = tr.querySelector('[data-col="listino_lav"]');
  const plInp    = tr.querySelector('[data-col="prezzo_scontato_lav"]');
  if (!esameInp || !llInp || !plInp) return;
  const esame = esameInp.value.trim();
  if (!esame) return;

  const baseResp = await fetch(`/api/esami-riferimento/prezzo-base?nome=${encodeURIComponent(esame)}`)
    .then(r => r.json()).catch(() => ({}));
  if (baseResp.prezzo_base != null && (llInp.value === '' || llInp.dataset.auto === '1')) {
    llInp.value = baseResp.prezzo_base;
    llInp.dataset.auto = '1';
  }

  if (S.roi.pianoId) {
    const requestedPianoId = S.roi.pianoId;
    const pResp = await fetch(`/api/piani/${requestedPianoId}/prezzo?esame=${encodeURIComponent(esame)}`)
      .then(r => r.json()).catch(() => ({}));
    if (S.roi.pianoId !== requestedPianoId) return; // a newer plan selection superseded this in-flight request; discard
    plInp.classList.remove('roi-prezzo-nuovo');
    if (pResp.fonte === 'piano' || pResp.fonte === 'custom' || pResp.fonte === 'base_fallback') {
      const titolo = pResp.fonte === 'piano' ? 'Prezzo automatico dal piano'
        : pResp.fonte === 'custom' ? 'Prezzo personalizzato salvato in precedenza'
        : 'Prezzo del piano non disponibile per questo esame — mostrato il prezzo base';
      if (plInp.value === '' || plInp.dataset.auto === '1') {
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
  mostraConsiglioPiano(esame);
  aggiornaMatchConcorrente(tr);
}

async function mostraConsiglioPiano(esame) {
  const banner = el('roi-consiglio-banner');
  if (!banner) return;
  const consiglio = await fetch(`/api/piani/consiglio?esame=${encodeURIComponent(esame)}`)
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
  const risp = pc - tpl;
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
}

let _acTimeout = null;

function initRoiEvents() {
  const wrap = el('roi-table-wrap');
  if (!wrap) return;

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
          headers: { 'Content-Type': 'application/json' },
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
  const items = await fetch(`/api/esami/autocomplete?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => []);
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

  // Pre-popola prezzi storici (solo listino concorrenza, non coperto dal piano)
  const prezzi = await fetch(`/api/esami/prezzi?nome=${encodeURIComponent(nome)}`).then(r => r.json()).catch(() => ({}));
  if (prezzi.listino_concorrenza) {
    const lcInp = tr.querySelector('[data-col="listino_concorrenza"]');
    if (lcInp && !lcInp.value) lcInp.value = prezzi.listino_concorrenza;
  }
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
}

function getRoiRigheValide() {
  syncRoiStateFromDOM();
  return S.roi.righe.filter(r => r.esame && r.esame.trim());
}

async function salvaCalcolo() {
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foglio: 'Platinum', struttura: struttura || 'Struttura', righe })
    });
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
async function init() {
  await loadStrutture();
  await loadPiani();
  await loadConcorrenti();
  buildSidebar();
  initDropzone();
  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
