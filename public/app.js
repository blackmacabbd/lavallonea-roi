'use strict';

/* ════════════════════════════════════════════════════
   Mylav ROI Dashboard — app.js
   ════════════════════════════════════════════════════ */

const S = {
  strutture: [],
  expanded:  {},
  vistaMia:  true,
  charts:    {},
  piani:     [],
  foglio: { dati: null, totali: null, file: null, foglio: null, fileId: null },
  roi: {
    tab: 'Platinum',
    struttura: '',
    pianoId: null,
    righe: {
      'Foglio 1': [roiRigaVuota()],
      'Platinum': [roiRigaVuota()],
      'Gold':     [roiRigaVuota()]
    }
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
    <div class="nav-divider" style="margin-top:8px">Storico</div>
    <div class="nav-item ${isActive('cronologia')}" onclick="navigate('cronologia')">
      <span class="nav-icon">📋</span> Cronologia file
    </div>
    <div class="nav-item ${isActive('debug')}" onclick="navigate('debug')" style="color:#f5a800">
      <span class="nav-icon">🔍</span> Debug Excel
    </div>
  `;

  if (S.strutture.length >= 2) {
    html += `
      <div class="nav-item ${isActive('confronto')}" onclick="navigate('confronto')">
        <span class="nav-icon">⚖️</span> Confronto strutture
      </div>
    `;
  }

  nav.innerHTML = html;
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
    initRoiEvents();
    return;
  }

  setMain(`
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">Panoramica generale</div>
      </div>
      <div class="page-actions">
        <button class="btn-outline" onclick="openUploadModal()">+ Carica file</button>
      </div>
    </div>
    <div class="page-body">
      <div class="kpi-grid kpi-grid-3">
        <div class="kpi-card">
          <div class="kpi-label">Strutture attive</div>
          <div class="kpi-value">${strutture_count}</div>
          <div class="kpi-sub">Nel database</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">File caricati</div>
          <div class="kpi-value">${file_count}</div>
          <div class="kpi-sub">Totale upload</div>
        </div>
        <div class="kpi-card kpi-green">
          <div class="kpi-label">Risparmio totale dottori</div>
          <div class="kpi-value">${euro(differenziale_totale)}</div>
          <div class="kpi-sub">vs concorrenza</div>
        </div>
      </div>

      ${per_struttura.length >= 2 ? `
      <div class="section-card">
        <div class="section-card-title">Riepilogo per struttura</div>
        <div class="chart-canvas-wrap">
          <canvas id="chart-confronto-dash" height="180"></canvas>
        </div>
      </div>` : ''}

      <div class="table-card">
        <div class="table-header">
          <div class="table-title">Ultimi file caricati</div>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Data</th><th>File</th><th>Struttura</th>
            </tr></thead>
            <tbody>
              ${ultimi_file.map(f => `<tr>
                <td class="td-muted">${fmtDate(f.data_carico)}</td>
                <td>${f.nome_file}</td>
                <td>${f.struttura_nome}</td>
              </tr>`).join('') || '<tr><td colspan="3" class="td-muted text-center">Nessun file</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `);

  // Calcolatore ROI — sempre visibile in fondo alla dashboard
  const roiSection = document.createElement('div');
  roiSection.className = 'section-card';
  roiSection.style.marginTop = '24px';
  roiSection.innerHTML = buildRoiSectionHtml();
  el('main-content').querySelector('.page-body').appendChild(roiSection);
  initRoiEvents();

  if (per_struttura.length >= 2) {
    const ctx = el('chart-confronto-dash');
    if (ctx) {
      S.charts.dash = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: per_struttura.map(s => s.nome),
          datasets: [
            { label: 'Concorrenza scontata', data: per_struttura.map(s => s.fatturato), backgroundColor: '#e74c3c', borderRadius: 4 },
            { label: 'Mylav scontata',  data: per_struttura.map(s => s.costo),    backgroundColor: '#f5a800', borderRadius: 4 }
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
    { label: 'Prezzo Mylav al dottore', color: '#f5a800' },
    { label: 'Sconto Mylav applicato',  color: '#ffd166' },
    { label: 'Risparmio dottore vs concorrenza', color: '#1a7a4a' },
    { label: 'Sconto concorrenza applicato', color: '#e74c3c' }
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
        backgroundColor: ['#f5a800', '#ffd166', '#1a7a4a', '#e74c3c'],
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
    { label: 'Paghi con Mylav', color: '#f5a800' },
    { label: 'Risparmio vs mercato', color: '#1a7a4a' }
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
        backgroundColor: ['#f5a800', '#1a7a4a'],
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
    { label: 'Paghi con Mylav', color: '#f5a800' },
    { label: 'Risparmio dottore',    color: '#1a7a4a' }
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
          backgroundColor: '#f5a800',
          borderRadius: 0
        },
        {
          label: 'Risparmio dottore',
          data: dati.map(d => Math.max(0, d.risparmio_dottore || 0)),
          backgroundColor: '#1a7a4a',
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
    { label: 'Paghi con Mylav', color: '#f5a800' },
    { label: 'Risparmio vs mercato', color: '#1a7a4a' }
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
          backgroundColor: '#f5a800',
          borderRadius: 0
        },
        {
          label: 'Risparmio vs mercato',
          data: dati.map(d => Math.max(0, d.risparmio_dottore || 0)),
          backgroundColor: '#1a7a4a',
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
        <td style="color:#c0392b">${euro(d.prezzo_scontato_concorrenza)}</td>
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
        <td style="color:#c0392b">${euro(d.prezzo_scontato_concorrenza)}</td>
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
  const foglioColors = { 'Foglio 1': '#6b7280', 'Platinum': '#1a7a4a', 'Gold': '#f5a800' };

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
      <td style="color:#c0392b">${euro(r.totale_dottore)}</td>
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
                <td style="color:#c0392b">${euro(s.prezzo_scontato_concorrenza)}</td>
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
    { label: 'Concorrenza scontata', color: '#e74c3c' },
    { label: 'Mylav scontata',  color: '#f5a800' },
    { label: 'Risparmio dottore',    color: '#1a7a4a' }
  ]);

  S.charts.conf = new Chart(el('chart-conf'), {
    type: 'bar',
    data: {
      labels: data.map(s => s.nome),
      datasets: [
        { label: 'Concorrenza scontata', data: data.map(s => s.prezzo_scontato_concorrenza), backgroundColor: '#e74c3c', borderRadius: 4 },
        { label: 'Mylav scontata',  data: data.map(s => s.totale_scontato_lav),         backgroundColor: '#f5a800', borderRadius: 4 },
        { label: 'Risparmio dottore',    data: data.map(s => s.risparmio_totale),              backgroundColor: '#1a7a4a', borderRadius: 4 }
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
        <div style="font-weight:500;font-size:14px;margin-bottom:8px;color:#1a7a4a">
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

// ══════════════════════════════════════════════════
// ROI CALCOLATORE
// ══════════════════════════════════════════════════

function buildRoiSectionHtml() {
  const tab = S.roi.tab;
  const tabs = ['Platinum', 'Gold', 'Foglio 1'];
  const tabHtml = tabs.map(t => `
    <button class="roi-tab-btn ${tab === t ? 'active' : ''}" onclick="switchRoiTab('${t}')">${t}</button>
  `).join('');

  const struttureOpts = S.strutture.map(s => `<option value="${escHtml(s.nome)}">`).join('');

  return `
    <datalist id="roi-strutture-list">${struttureOpts}</datalist>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;font-weight:500;color:#1a1a1a">Calcolatore ROI</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="roi-tabs-wrap">${tabHtml}</div>
        <div style="position:relative">
          <button class="btn-outline roi-piano-btn" id="roi-piano-btn"
                  onclick="togglePianoPanel()" title="${escHtml(pianoSelezionatoNome() || '')}">
            Piano: ${escHtml(pianoSelezionatoNome() || 'Nessuno')} ▾
          </button>
          <div id="roi-piano-panel" class="roi-piano-panel" style="display:none"></div>
        </div>
      </div>
    </div>
    <div id="roi-table-wrap" style="overflow-x:auto">${buildRoiTableHtml(tab)}</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn-outline" onclick="addRigaRoi()" style="font-size:12px">+ Aggiungi esame</button>
      <button class="btn-outline" onclick="salvaCalcolo()" style="font-size:12px;color:#1a7a4a;border-color:#1a7a4a">💾 Salva come file</button>
      <button class="btn-outline" onclick="esportaExcelRoi()" style="font-size:12px">📥 Esporta Excel</button>
      ${tab === 'Gold' ? `<button class="btn-outline" onclick="copiaDaPlatinum()" style="font-size:12px;color:#f5a800;border-color:#f5a800">Copia da Platinum</button>` : ''}
    </div>
    <div id="roi-msg" style="margin-top:8px;font-size:12px;min-height:18px"></div>
    <div id="roi-ac" class="roi-autocomplete" style="display:none"></div>
  `;
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

function buildRoiTableHtml(tipo) {
  const isFoglio1 = tipo === 'Foglio 1';
  const righe = S.roi.righe[tipo];

  const header1 = isFoglio1 ? `
    <tr>
      <th colspan="3"></th>
      <th colspan="3" style="background:rgba(231,76,60,0.07);color:#c0392b;text-align:center">Concorrenza</th>
      <th></th>
      <th colspan="2" style="background:rgba(245,168,0,0.09);color:#b37a00;text-align:center">Mylav</th>
      <th></th><th></th>
    </tr>` : `
    <tr>
      <th colspan="4"></th>
      <th colspan="4" style="background:rgba(231,76,60,0.07);color:#c0392b;text-align:center">Concorrenza</th>
      <th></th>
      <th colspan="4" style="background:rgba(245,168,0,0.09);color:#b37a00;text-align:center">Mylav</th>
      <th></th><th></th>
    </tr>`;

  const header2 = isFoglio1 ? `
    <tr>
      <th style="width:130px">Struttura</th>
      <th style="width:12px"></th>
      <th style="width:170px">ESAMI</th>
      <th style="width:95px;background:rgba(231,76,60,0.04)">Listino conc.</th>
      <th style="width:65px;background:rgba(231,76,60,0.04)">Sconto%</th>
      <th style="width:95px;background:rgba(231,76,60,0.04)">Prezzo conc.</th>
      <th style="width:12px"></th>
      <th style="width:95px;background:rgba(245,168,0,0.06)">Listino Lav</th>
      <th style="width:95px;background:rgba(245,168,0,0.06)">Prezzo Lav</th>
      <th style="width:95px">Risparmio</th>
      <th style="width:28px"></th>
    </tr>` : `
    <tr>
      <th style="width:130px">Struttura</th>
      <th style="width:12px"></th>
      <th style="width:170px">ESAMI</th>
      <th style="width:60px">N.</th>
      <th style="width:95px;background:rgba(231,76,60,0.04)">Listino conc.</th>
      <th style="width:65px;background:rgba(231,76,60,0.04)">Sconto%</th>
      <th style="width:95px;background:rgba(231,76,60,0.04)">Tot. conc.</th>
      <th style="width:95px;background:rgba(231,76,60,0.04)">Scontato conc.</th>
      <th style="width:12px"></th>
      <th style="width:95px;background:rgba(245,168,0,0.06)">Listino Lav</th>
      <th style="width:95px;background:rgba(245,168,0,0.06)">Tot. Lav</th>
      <th style="width:95px;background:rgba(245,168,0,0.06)">Prezzo Lav</th>
      <th style="width:95px;background:rgba(245,168,0,0.06)">Tot. sc. Lav</th>
      <th style="width:95px">Risparmio</th>
      <th style="width:28px"></th>
    </tr>`;

  const bodyRows = righe.map((r, i) => buildRoiRigaHtml(r, i, tipo)).join('');

  // Totals
  const tots = calcolaRoiTotali(tipo);
  let totRow, diffRow;
  if (isFoglio1) {
    totRow = `<tr class="roi-totals-row">
      <td colspan="3"><strong>TOTALE</strong></td>
      <td class="roi-calc" style="background:rgba(231,76,60,0.04)">${fmtE(tots.tot_listino_conc)}</td>
      <td style="background:rgba(231,76,60,0.04)"></td>
      <td class="roi-calc" style="background:rgba(231,76,60,0.04)">${fmtE(tots.tot_prezzo_conc)}</td>
      <td></td>
      <td class="roi-calc" style="background:rgba(245,168,0,0.06)">${fmtE(tots.tot_listino_lav)}</td>
      <td class="roi-calc" style="background:rgba(245,168,0,0.06)">${fmtE(tots.tot_prezzo_lav_sc)}</td>
      <td class="roi-calc" style="${tots.differenziale >= 0 ? 'color:#1a7a4a' : 'color:#c0392b'};font-weight:600">${fmtE(tots.differenziale)}</td>
      <td></td>
    </tr>`;
    diffRow = `<tr class="roi-diff-row">
      <td colspan="9" style="text-align:right;font-size:13px;font-weight:500">Differenziale totale:</td>
      <td colspan="2" style="font-size:15px;font-weight:700;color:${tots.differenziale >= 0 ? '#1a7a4a' : '#c0392b'}">${fmtE(tots.differenziale)}</td>
    </tr>`;
  } else {
    totRow = `<tr class="roi-totals-row">
      <td colspan="4"><strong>TOTALE</strong></td>
      <td class="roi-calc" style="background:rgba(231,76,60,0.04)">${fmtE(tots.tot_listino_conc)}</td>
      <td style="background:rgba(231,76,60,0.04)"></td>
      <td class="roi-calc" style="background:rgba(231,76,60,0.04)">${fmtE(tots.tot_conc)}</td>
      <td class="roi-calc" style="background:rgba(231,76,60,0.04)">${fmtE(tots.tot_prezzo_conc)}</td>
      <td></td>
      <td class="roi-calc" style="background:rgba(245,168,0,0.06)">${fmtE(tots.tot_listino_lav)}</td>
      <td class="roi-calc" style="background:rgba(245,168,0,0.06)">${fmtE(tots.tot_tot_lav)}</td>
      <td class="roi-calc" style="background:rgba(245,168,0,0.06)">${fmtE(tots.tot_prezzo_lav_sc)}</td>
      <td class="roi-calc" style="background:rgba(245,168,0,0.06)">${fmtE(tots.tot_tot_prezzo_lav)}</td>
      <td class="roi-calc" style="${tots.differenziale >= 0 ? 'color:#1a7a4a' : 'color:#c0392b'};font-weight:600">${fmtE(tots.differenziale)}</td>
      <td></td>
    </tr>`;
    diffRow = `<tr class="roi-diff-row">
      <td colspan="13" style="text-align:right;font-size:13px;font-weight:500">Differenziale totale:</td>
      <td colspan="2" style="font-size:15px;font-weight:700;color:${tots.differenziale >= 0 ? '#1a7a4a' : '#c0392b'}">${fmtE(tots.differenziale)}</td>
    </tr>`;
  }

  return `<table class="roi-editable-table">
    <thead>${header1}${header2}</thead>
    <tbody id="roi-tbody">${bodyRows}</tbody>
    <tfoot>${totRow}${diffRow}</tfoot>
  </table>`;
}

function calcPrezConc(lc, sc, n) {
  const mult = sc > 0 ? (1 - sc / 100) : 1;
  return parseFloat((lc * mult).toFixed(2));
}

function buildRoiRigaHtml(r, i, tipo) {
  const isFoglio1 = tipo === 'Foglio 1';
  const n  = r.n_esami || 1;
  const lc = parseFloat(r.listino_concorrenza) || 0;
  const sc = parseFloat(r.sconto_concorrenza)  || 0;
  const ll = parseFloat(r.listino_lav) || 0;
  const pl = parseFloat(r.prezzo_scontato_lav) || 0;

  let risp, totConc, prezConc, totLL, totPL;
  if (isFoglio1) {
    prezConc = calcPrezConc(lc, sc, 1);
    risp     = prezConc - pl;
  } else {
    totConc  = lc * n;
    prezConc = calcPrezConc(totConc, sc, 1);
    totLL    = ll * n;
    totPL    = pl * n;
    risp     = prezConc - totPL;
  }

  const rispColor = risp >= 0 ? '#1a7a4a' : '#c0392b';
  const scPlaceholder = sc > 0 ? String(sc) : '';

  const strutturaCell = i === 0
    ? `<td><input class="roi-input roi-struttura-inp" list="roi-strutture-list" value="${escHtml(S.roi.struttura)}" placeholder="Struttura…" autocomplete="off" oninput="S.roi.struttura=this.value" style="width:120px"></td>`
    : `<td></td>`;

  if (isFoglio1) {
    return `<tr data-idx="${i}" data-tipo="${tipo}">
      ${strutturaCell}
      <td></td>
      <td style="position:relative"><input class="roi-input" data-col="esame" value="${escHtml(r.esame)}" placeholder="Esame…" autocomplete="off" style="width:160px"></td>
      <td style="background:rgba(231,76,60,0.04)"><input class="roi-input roi-num" data-col="listino_concorrenza" value="${r.listino_concorrenza}" placeholder="0.00"></td>
      <td style="background:rgba(231,76,60,0.04)"><input class="roi-input roi-num" data-col="sconto_concorrenza" value="${scPlaceholder}" placeholder="%" style="width:55px"></td>
      <td class="roi-calc" style="background:rgba(231,76,60,0.04)" data-col="prezzo_conc">${fmtE(prezConc)}</td>
      <td></td>
      <td style="background:rgba(245,168,0,0.06)"><input class="roi-input roi-num" data-col="listino_lav" value="${r.listino_lav}" placeholder="0.00"></td>
      <td style="background:rgba(245,168,0,0.06)"><input class="roi-input roi-num" data-col="prezzo_scontato_lav" value="${r.prezzo_scontato_lav}" placeholder="0.00"></td>
      <td class="roi-calc" data-col="risparmio" style="color:${rispColor};font-weight:500">${fmtE(risp)}</td>
      <td><button class="roi-del-btn" onclick="removeRigaRoi(${i},'${tipo}')" title="Rimuovi">×</button></td>
    </tr>`;
  } else {
    return `<tr data-idx="${i}" data-tipo="${tipo}">
      ${strutturaCell}
      <td></td>
      <td style="position:relative"><input class="roi-input" data-col="esame" value="${escHtml(r.esame)}" placeholder="Esame…" autocomplete="off" style="width:160px"></td>
      <td><input class="roi-input roi-num" data-col="n_esami" value="${r.n_esami}" placeholder="1" style="width:50px"></td>
      <td style="background:rgba(231,76,60,0.04)"><input class="roi-input roi-num" data-col="listino_concorrenza" value="${r.listino_concorrenza}" placeholder="0.00"></td>
      <td style="background:rgba(231,76,60,0.04)"><input class="roi-input roi-num" data-col="sconto_concorrenza" value="${scPlaceholder}" placeholder="%" style="width:55px"></td>
      <td class="roi-calc" style="background:rgba(231,76,60,0.04)" data-col="tot_conc">${fmtE(totConc)}</td>
      <td class="roi-calc" style="background:rgba(231,76,60,0.04)" data-col="prezzo_conc">${fmtE(prezConc)}</td>
      <td></td>
      <td style="background:rgba(245,168,0,0.06)"><input class="roi-input roi-num" data-col="listino_lav" value="${r.listino_lav}" placeholder="0.00"></td>
      <td class="roi-calc" style="background:rgba(245,168,0,0.06)" data-col="tot_listino_lav">${fmtE(totLL)}</td>
      <td style="background:rgba(245,168,0,0.06)"><input class="roi-input roi-num" data-col="prezzo_scontato_lav" value="${r.prezzo_scontato_lav}" placeholder="0.00"></td>
      <td class="roi-calc" style="background:rgba(245,168,0,0.06)" data-col="tot_prezzo_lav">${fmtE(totPL)}</td>
      <td class="roi-calc" data-col="risparmio" style="color:${rispColor};font-weight:500">${fmtE(risp)}</td>
      <td><button class="roi-del-btn" onclick="removeRigaRoi(${i},'${tipo}')" title="Rimuovi">×</button></td>
    </tr>`;
  }
}

function fmtE(n) {
  if (!n && n !== 0) return '—';
  const v = Number(n) || 0;
  return '€ ' + v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function calcolaRoiTotali(tipo) {
  const isFoglio1 = tipo === 'Foglio 1';
  const righe = S.roi.righe[tipo];
  let t = { tot_listino_conc:0, tot_conc:0, tot_prezzo_conc:0, tot_listino_lav:0, tot_tot_lav:0, tot_prezzo_lav_sc:0, tot_tot_prezzo_lav:0, differenziale:0 };
  for (const r of righe) {
    const n  = r.n_esami || 1;
    const lc = parseFloat(r.listino_concorrenza) || 0;
    const sc = parseFloat(r.sconto_concorrenza)  || 0;
    const ll = parseFloat(r.listino_lav) || 0;
    const pl = parseFloat(r.prezzo_scontato_lav) || 0;
    if (isFoglio1) {
      const pc = calcPrezConc(lc, sc, 1);
      t.tot_listino_conc  += lc;
      t.tot_prezzo_conc   += pc;
      t.tot_listino_lav   += ll;
      t.tot_prezzo_lav_sc += pl;
      t.differenziale     += pc - pl;
    } else {
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
  }
  return t;
}

function reRenderRoiTable(tipo) {
  const wrap = el('roi-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = buildRoiTableHtml(tipo || S.roi.tab);
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
}

function aggiornaRigaDOM(tr) {
  const tipo = tr.dataset.tipo;
  const idx  = parseInt(tr.dataset.idx);
  const isFoglio1 = tipo === 'Foglio 1';

  const get = col => {
    const inp = tr.querySelector(`[data-col="${col}"]`);
    return inp ? (parseFloat(inp.value) || 0) : 0;
  };
  const getStr = col => {
    const inp = tr.querySelector(`[data-col="${col}"]`);
    return inp ? inp.value : '';
  };

  // Sync state
  const r = S.roi.righe[tipo][idx];
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

  let risp;
  if (isFoglio1) {
    const pc = calcPrezConc(lc, sc, 1);
    risp = pc - pl;
    setText(tr, 'prezzo_conc', fmtE(pc));
  } else {
    const tc  = lc * n;
    const pc  = calcPrezConc(tc, sc, 1);
    const tll = ll * n;
    const tpl = pl * n;
    risp = pc - tpl;
    setText(tr, 'tot_conc',         fmtE(tc));
    setText(tr, 'prezzo_conc',      fmtE(pc));
    setText(tr, 'tot_listino_lav',  fmtE(tll));
    setText(tr, 'tot_prezzo_lav',   fmtE(tpl));
  }

  const rispEl = tr.querySelector('[data-col="risparmio"]');
  if (rispEl) {
    rispEl.textContent = fmtE(risp);
    rispEl.style.color = risp >= 0 ? '#1a7a4a' : '#c0392b';
  }

  aggiornaTotaliDOM(tipo);
}

function setText(tr, col, val) {
  const td = tr.querySelector(`[data-col="${col}"]`);
  if (td) td.textContent = val;
}

function aggiornaTotaliDOM(tipo) {
  const tfoot = el('roi-table-wrap')?.querySelector('tfoot');
  if (!tfoot) return;
  const tots = calcolaRoiTotali(tipo);
  const isFoglio1 = tipo === 'Foglio 1';
  const totRow = tfoot.querySelector('.roi-totals-row');
  const diffRow = tfoot.querySelector('.roi-diff-row');
  if (!totRow || !diffRow) return;

  if (isFoglio1) {
    const tds = totRow.querySelectorAll('.roi-calc');
    if (tds[0]) tds[0].textContent = fmtE(tots.tot_listino_conc);
    if (tds[1]) tds[1].textContent = fmtE(tots.tot_prezzo_conc);
    if (tds[2]) tds[2].textContent = fmtE(tots.tot_listino_lav);
    if (tds[3]) tds[3].textContent = fmtE(tots.tot_prezzo_lav_sc);
    if (tds[4]) { tds[4].textContent = fmtE(tots.differenziale); tds[4].style.color = tots.differenziale >= 0 ? '#1a7a4a' : '#c0392b'; }
  } else {
    const tds = totRow.querySelectorAll('.roi-calc');
    const vals = [tots.tot_listino_conc, tots.tot_conc, tots.tot_prezzo_conc, tots.tot_listino_lav, tots.tot_tot_lav, tots.tot_prezzo_lav_sc, tots.tot_tot_prezzo_lav, tots.differenziale];
    tds.forEach((td, i) => {
      td.textContent = fmtE(vals[i]);
      if (i === vals.length - 1) td.style.color = tots.differenziale >= 0 ? '#1a7a4a' : '#c0392b';
    });
  }
  const diffVal = diffRow.querySelectorAll('td');
  const lastTd = diffVal[diffVal.length - 1];
  if (lastTd) { lastTd.textContent = fmtE(tots.differenziale); lastTd.style.color = tots.differenziale >= 0 ? '#1a7a4a' : '#c0392b'; }
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

  // Pre-popola prezzi storici
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

function switchRoiTab(tipo) {
  syncRoiStateFromDOM();
  S.roi.tab = tipo;
  const wrap = el('roi-table-wrap');
  if (wrap) wrap.innerHTML = buildRoiTableHtml(tipo);
  document.querySelectorAll('.roi-tab-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === tipo);
  });
  // aggiorna pulsante "Copia da Platinum" se Gold
  const actionsDiv = wrap?.closest('.section-card')?.querySelector('[style*="display:flex"]');
  if (actionsDiv) {
    let copyBtn = actionsDiv.querySelector('.roi-copy-btn');
    if (tipo === 'Gold') {
      if (!copyBtn) {
        copyBtn = document.createElement('button');
        copyBtn.className = 'btn-outline roi-copy-btn';
        copyBtn.style.cssText = 'font-size:12px;color:#f5a800;border-color:#f5a800';
        copyBtn.textContent = 'Copia da Platinum';
        copyBtn.onclick = copiaDaPlatinum;
        actionsDiv.appendChild(copyBtn);
      }
    } else {
      copyBtn?.remove();
    }
  }
  initRoiEvents();
}

function syncRoiStateFromDOM() {
  const tbody = el('roi-tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaRigaDOM(tr));
}

function addRigaRoi() {
  syncRoiStateFromDOM();
  const tipo = S.roi.tab;
  S.roi.righe[tipo].push(roiRigaVuota());
  reRenderRoiTable(tipo);
  // Focus sulla cella ESAMI dell'ultima riga
  const tbody = el('roi-tbody');
  if (tbody) {
    const lastRow = tbody.lastElementChild;
    lastRow?.querySelector('[data-col="esame"]')?.focus();
  }
}

function removeRigaRoi(idx, tipo) {
  syncRoiStateFromDOM();
  if (S.roi.righe[tipo].length > 1) {
    S.roi.righe[tipo].splice(idx, 1);
  } else {
    S.roi.righe[tipo] = [roiRigaVuota()];
  }
  reRenderRoiTable(tipo);
}

function getRoiRigheValide(tipo) {
  syncRoiStateFromDOM();
  return S.roi.righe[tipo].filter(r => r.esame && r.esame.trim());
}

async function salvaCalcolo() {
  const tipo     = S.roi.tab;
  const righe    = getRoiRigheValide(tipo);
  const struttura = (document.querySelector('.roi-struttura-inp')?.value || S.roi.struttura || '').trim();

  if (!struttura) return roiMsg('Scrivi il nome della struttura nella prima colonna', 'error');
  if (!righe.length) return roiMsg('Nessun esame con nome compilato', 'error');

  const nomeFile = `Calcolo_${tipo}_${new Date().toLocaleDateString('it-IT').replace(/\//g, '-')}`;
  try {
    const resp = await api('/api/calcolo/salva', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ struttura, foglio: tipo, righe, nomeFile })
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
  const tipo      = S.roi.tab;
  const righe     = getRoiRigheValide(tipo);
  const struttura = (document.querySelector('.roi-struttura-inp')?.value || S.roi.struttura || '').trim();

  if (!righe.length) return roiMsg('Nessun esame compilato', 'error');
  try {
    const res = await fetch('/api/export-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foglio: tipo, struttura: struttura || 'Struttura', righe })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `mylav_${tipo}.xlsx`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch(e) { roiMsg('Errore export: ' + e.message, 'error'); }
}

function copiaDaPlatinum() {
  syncRoiStateFromDOM();
  S.roi.righe['Gold'] = S.roi.righe['Platinum'].map(r => ({
    esame: r.esame,
    n_esami: r.n_esami,
    listino_concorrenza: '',
    listino_lav: r.listino_lav,
    prezzo_scontato_lav: ''
  }));
  reRenderRoiTable('Gold');
  roiMsg('Esami copiati da Platinum.', 'ok');
}

function roiMsg(msg, tipo) {
  const d = el('roi-msg');
  if (!d) return;
  d.textContent = msg;
  d.style.color = tipo === 'error' ? '#c0392b' : '#1a7a4a';
  setTimeout(() => { if (d) d.textContent = ''; }, 4000);
}

// ── Init ───────────────────────────────────────────
async function init() {
  await loadStrutture();
  await loadPiani();
  buildSidebar();
  initDropzone();
  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
