'use strict';

/* ════════════════════════════════════════════════════
   Lavallonea ROI Dashboard — app.js
   Pure Vanilla JS, no frameworks
   ════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────
const S = {
  strutture:    [],
  expanded:     {},   // struttura_id -> bool
  vistaMia:     true,
  charts:       {},   // active Chart instances
  // current view data (for toggle re-render)
  foglio: {
    dati:   null,
    totali: null,
    file:   null,
    foglio: null
  }
};

// ── Utils ──────────────────────────────────────────
function euro(n) {
  return '€ ' + (Number(n) || 0).toLocaleString('it-IT', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function euroCompact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return '€ ' + (v / 1000).toFixed(1) + 'k';
  return '€ ' + v.toFixed(0);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
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

    // Show fogli available
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

    // "Totali struttura" only if ≥2 files
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
  // Get the most recent file for this struttura and foglio
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
    case 'dashboard': renderDashboard();                           break;
    case 'foglio':    renderFoglio(params.fileId, params.foglio);  break;
    case 'totali':    renderTotali(params.strutturaId, params.nome); break;
    case 'cronologia': renderCronologia();                         break;
    case 'confronto':  renderConfronto();                          break;
    case 'debug':      renderDebug();                              break;
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
    setMain(`<div class="empty-state">
      <div class="empty-icon">📂</div>
      <div class="empty-title">Nessun dato ancora</div>
      <div class="empty-sub">Carica il primo file Excel per iniziare.</div>
      <button class="btn-primary mt-4" onclick="openUploadModal()">+ Carica file Excel</button>
    </div>`);
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
        <div class="kpi-card kpi-blue">
          <div class="kpi-label">Differenziale totale</div>
          <div class="kpi-value">${euro(differenziale_totale)}</div>
          <div class="kpi-sub">Guadagno cumulativo</div>
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

  // Donut confronto strutture (se ci sono dati)
  if (per_struttura.length >= 2) {
    const ctx = el('chart-confronto-dash');
    if (ctx) {
      S.charts.dash = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: per_struttura.map(s => s.nome),
          datasets: [
            { label: 'Fatturato dottore', data: per_struttura.map(s => s.fatturato), backgroundColor: '#1a7a4a', borderRadius: 4 },
            { label: 'Tuo costo',        data: per_struttura.map(s => s.costo),    backgroundColor: '#f5a800', borderRadius: 4 }
          ]
        },
        options: {
          animation: { duration: 600 },
          plugins: { legend: { display: false },
            tooltip: tooltipDefaults()
          },
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

  // Sort by differenziale desc (mia: prezzo_vet_scontato - totale_prezzo_lav)
  const datiSorted = [...dati].sort((a, b) =>
    (b.prezzo_vet_scontato - b.totale_prezzo_lav) - (a.prezzo_vet_scontato - a.totale_prezzo_lav)
  );

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
      <!-- KPI -->
      <div class="kpi-grid kpi-grid-4">
        <div class="kpi-card">
          <div class="kpi-label">Listino pieno dottore</div>
          <div class="kpi-value">${euro(t.totale_listino)}</div>
          <div class="kpi-sub">Prezzo di listino</div>
        </div>
        <div class="kpi-card kpi-green">
          <div class="kpi-label">Prezzo scontato dottore</div>
          <div class="kpi-value">${euro(t.prezzo_vet_scontato)}</div>
          <div class="kpi-sub">Fattura al dottore</div>
        </div>
        <div class="kpi-card kpi-yellow">
          <div class="kpi-label">Tuo costo totale</div>
          <div class="kpi-value">${euro(t.totale_prezzo_lav)}</div>
          <div class="kpi-sub">Costo Lavallonea</div>
        </div>
        <div class="kpi-card kpi-blue">
          <div class="kpi-label">Differenziale</div>
          <div class="kpi-value">${euro(t.differenziale)}</div>
          <div class="kpi-sub">Guadagno netto</div>
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
          <div class="chart-title" id="donut-title">Ripartizione totale</div>
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
          <div class="chart-title" id="barre-title">Guadagno per esame</div>
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
      (b.prezzo_vet_scontato - b.totale_prezzo_lav) - (a.prezzo_vet_scontato - a.totale_prezzo_lav)
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

// Plugin: sfondo bianco sul canvas (necessario per PNG export e visibilità)
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

function makeDonutOptions(tooltipCb) {
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
        callbacks: { label: tooltipCb }
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

// Donut — vista MIA
function renderDonutMia(t) {
  const tuoCosto  = Math.max(0, t.totale_prezzo_lav   || 0);
  const guadagno  = Math.max(0, t.differenziale        || 0);
  const sconto    = Math.max(0, t.sconto_applicato     || 0);
  const totale    = tuoCosto + guadagno + sconto;

  el('donut-cv').textContent = euro(t.prezzo_vet_scontato);
  el('donut-cl').textContent = 'Fatturato dottore';
  el('donut-legend').innerHTML = legendHtml([
    { label: 'Tuo costo',        color: '#f5a800' },
    { label: 'Tuo guadagno',     color: '#2563a8' },
    { label: 'Sconto al dottore',color: '#1a7a4a' }
  ]);

  const canvas = el('chart-donut');
  if (!canvas) return;
  canvas.style.display = 'block';

  S.charts.donut = new Chart(canvas, {
    type: 'doughnut',
    plugins: [whiteBgPlugin],
    data: {
      labels: ['Tuo costo', 'Tuo guadagno', 'Sconto al dottore'],
      datasets: [{
        data: totale > 0 ? [tuoCosto, guadagno, sconto] : [1, 1, 1],
        backgroundColor: ['#f5a800', '#2563a8', '#1a7a4a'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: makeDonutOptions(ctx => {
      if (totale === 0) return '  Nessun dato';
      const v = ctx.raw;
      const pct = totale > 0 ? ((v / totale) * 100).toFixed(1) : 0;
      return `  ${ctx.label}: ${euro(v)} (${pct}%)`;
    })
  });
}

// Donut — vista DOTTORE
function renderDonutDottore(t) {
  const prezzo = Math.max(0, t.prezzo_vet_scontato || 0);
  const sconto = Math.max(0, t.sconto_applicato    || 0);
  const totale = prezzo + sconto;
  const pct    = t.risparmio_pct || 0;

  el('donut-cv').textContent = `${pct}%`;
  el('donut-cl').textContent = 'Risparmio';
  el('donut-legend').innerHTML = legendHtml([
    { label: 'Prezzo per te',  color: '#1a7a4a' },
    { label: 'Sconto ottenuto',color: '#d1fae5' }
  ]);

  const canvas = el('chart-donut');
  if (!canvas) return;
  canvas.style.display = 'block';

  S.charts.donut = new Chart(canvas, {
    type: 'doughnut',
    plugins: [whiteBgPlugin],
    data: {
      labels: ['Prezzo per te', 'Sconto ottenuto'],
      datasets: [{
        data: totale > 0 ? [prezzo, sconto] : [1, 1],
        backgroundColor: ['#1a7a4a', '#d1fae5'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: makeDonutOptions(ctx => {
      if (totale === 0) return '  Nessun dato';
      return ctx.dataIndex === 0
        ? `  Paghi: ${euro(ctx.raw)}`
        : `  Risparmi: ${euro(ctx.raw)} (${pct}%)`;
    })
  });
}

function makeBarreOptions(dati, tooltipLabelCb) {
  return {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    scales: {
      x: {
        stacked: true,
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { font: { size: 11 }, callback: v => euroCompact(v) }
      },
      y: {
        stacked: true,
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
        callbacks: {
          title: items => items[0]?.label || '',
          label: tooltipLabelCb
        }
      }
    }
  };
}

// Barre — vista MIA
function renderBarreMia(dati) {
  el('barre-legend').innerHTML = legendHtml([
    { label: 'Tuo costo',     color: '#f5a800' },
    { label: 'Guadagno netto',color: '#2563a8' }
  ]);

  const canvas = el('chart-barre');
  if (!canvas) return;

  const h = Math.max(220, dati.length * 38);
  canvas.parentElement.style.height = h + 'px';
  canvas.style.display = 'block';

  S.charts.barre = new Chart(canvas, {
    type: 'bar',
    plugins: [whiteBgPlugin],
    data: {
      labels: dati.map(d => d.esame),
      datasets: [
        {
          label: 'Tuo costo',
          data: dati.map(d => Math.max(0, d.totale_prezzo_lav || 0)),
          backgroundColor: '#f5a800',
          borderRadius: { topLeft: 4, bottomLeft: 4 }
        },
        {
          label: 'Guadagno netto',
          data: dati.map(d => Math.max(0, (d.prezzo_vet_scontato - d.totale_prezzo_lav) || 0)),
          backgroundColor: '#2563a8',
          borderRadius: { topRight: 4, bottomRight: 4 }
        }
      ]
    },
    options: makeBarreOptions(dati, ctx => {
      const d = dati[ctx.dataIndex];
      if (!d) return '';
      if (ctx.datasetIndex === 0) return [
        `  Prezzo dottore: ${euro(d.prezzo_vet_scontato)}`,
        `  Tuo costo:      ${euro(d.totale_prezzo_lav)}`
      ];
      return `  Guadagno: ${euro(d.prezzo_vet_scontato - d.totale_prezzo_lav)}`;
    })
  });
}

// Barre — vista DOTTORE
function renderBarreDottore(dati) {
  el('barre-legend').innerHTML = legendHtml([
    { label: 'Prezzo tuo', color: '#1a7a4a' },
    { label: 'Sconto',     color: '#d1d5db' }
  ]);

  const canvas = el('chart-barre');
  if (!canvas) return;

  const h = Math.max(220, dati.length * 38);
  canvas.parentElement.style.height = h + 'px';
  canvas.style.display = 'block';

  S.charts.barre = new Chart(canvas, {
    type: 'bar',
    plugins: [whiteBgPlugin],
    data: {
      labels: dati.map(d => d.esame),
      datasets: [
        {
          label: 'Prezzo tuo',
          data: dati.map(d => Math.max(0, d.prezzo_vet_scontato || 0)),
          backgroundColor: '#1a7a4a',
          borderRadius: { topLeft: 4, bottomLeft: 4 }
        },
        {
          label: 'Sconto',
          data: dati.map(d => Math.max(0, (d.costo_listino - d.prezzo_vet_scontato) || 0)),
          backgroundColor: '#d1d5db',
          borderRadius: { topRight: 4, bottomRight: 4 }
        }
      ]
    },
    options: makeBarreOptions(dati, ctx => {
      const d = dati[ctx.dataIndex];
      if (!d) return '';
      return [
        `  Listino:    ${euro(d.costo_listino)}`,
        `  Prezzo tuo: ${euro(d.prezzo_vet_scontato)}`,
        `  Risparmio:  ${euro(d.costo_listino - d.prezzo_vet_scontato)}`
      ];
    })
  });
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
      <th>Esame</th><th>N.</th><th>Listino vet</th>
      <th>Prezzo scontato</th><th>Listino Lav</th>
      <th>Tuo costo</th><th>Differenziale</th><th>%</th>
    </tr>`;
    body.innerHTML = dati.map(d => {
      const diff = d.prezzo_vet_scontato - d.totale_prezzo_lav;
      const pct  = d.prezzo_vet_scontato > 0
        ? ((diff / d.prezzo_vet_scontato) * 100).toFixed(1) : '0.0';
      return `<tr>
        <td>${d.esame}</td>
        <td class="text-center">${d.n_esami}</td>
        <td>${euro(d.costo_listino)}</td>
        <td class="td-green">${euro(d.prezzo_vet_scontato)}</td>
        <td class="td-muted">${euro(d.listino_lav)}</td>
        <td class="td-yellow">${euro(d.prezzo_lav)}</td>
        <td class="td-blue">${euro(diff)}</td>
        <td class="td-blue">${pct}%</td>
      </tr>`;
    }).join('');
  } else {
    head.innerHTML = `<tr>
      <th>Esame</th><th>N.</th><th>Listino</th>
      <th>Prezzo tuo</th><th>Risparmio €</th><th>Risparmio %</th>
    </tr>`;
    body.innerHTML = dati.map(d => {
      const risp  = d.costo_listino - d.prezzo_vet_scontato;
      const rispP = d.costo_listino > 0
        ? ((risp / d.costo_listino) * 100).toFixed(1) : '0.0';
      return `<tr>
        <td>${d.esame}</td>
        <td class="text-center">${d.n_esami}</td>
        <td class="td-muted">${euro(d.costo_listino)}</td>
        <td class="td-green">${euro(d.prezzo_vet_scontato)}</td>
        <td class="td-green">${euro(risp)}</td>
        <td class="td-green">${rispP}%</td>
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

  // Cumulative totals
  const cum = files.reduce((acc, f) => {
    for (const [foglio, t] of Object.entries(f.fogli)) {
      acc.totale_listino      += t.totale_listino;
      acc.prezzo_vet_scontato += t.prezzo_vet_scontato;
      acc.totale_prezzo_lav   += t.totale_prezzo_lav;
      acc.differenziale       += t.differenziale;
    }
    return acc;
  }, { totale_listino: 0, prezzo_vet_scontato: 0, totale_prezzo_lav: 0, differenziale: 0 });

  // Labels = dates of files
  const labels    = files.map(f => fmtDate(f.file.data_carico));
  const foglioSet = ['Foglio 1', 'Platinum', 'Gold'];
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
          <div class="kpi-label">Listino pieno</div>
          <div class="kpi-value">${euro(cum.totale_listino)}</div>
        </div>
        <div class="kpi-card kpi-green">
          <div class="kpi-label">Fatturato dottore</div>
          <div class="kpi-value">${euro(cum.prezzo_vet_scontato)}</div>
        </div>
        <div class="kpi-card kpi-yellow">
          <div class="kpi-label">Tuo costo</div>
          <div class="kpi-value">${euro(cum.totale_prezzo_lav)}</div>
        </div>
        <div class="kpi-card kpi-blue">
          <div class="kpi-label">Differenziale cumulativo</div>
          <div class="kpi-value">${euro(cum.differenziale)}</div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-title">Differenziale nel tempo</div>
        <div id="linea-legend" class="chart-legend" style="margin-bottom:12px"></div>
        <canvas id="chart-linea" height="220"></canvas>
      </div>

      <div class="section-card">
        <div class="section-card-title">Confronto file — Platinum vs Gold</div>
        <canvas id="chart-grouped" height="200"></canvas>
      </div>
    </div>
  `);

  // Line chart — differenziale per foglio nel tempo
  const lineDatasets = foglioSet
    .filter(fg => files.some(f => f.fogli[fg]))
    .map(fg => ({
      label: fg,
      data: files.map(f => f.fogli[fg]?.differenziale ?? null),
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

  // Grouped bar — Platinum vs Gold per file
  const pgDatasets = ['Platinum', 'Gold']
    .filter(fg => files.some(f => f.fogli[fg]))
    .map(fg => ({
      label: fg,
      data: files.map(f => f.fogli[fg]?.prezzo_vet_scontato ?? 0),
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
    [rows, strutture] = await Promise.all([
      api('/api/cronologia'),
      api('/api/strutture')
    ]);
  } catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">Errore</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  const optStrutture = strutture.map(s =>
    `<option value="${s.id}">${s.nome}</option>`
  ).join('');

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
              <th>Fatturato dottore</th><th>Tuo costo</th><th>Differenziale</th>
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
      <td class="td-green">${euro(r.totale_dottore)}</td>
      <td class="td-yellow">${euro(r.totale_costo)}</td>
      <td class="td-blue">${euro(r.differenziale)}</td>
    </tr>`).join('');
}

async function filterCronologia() {
  const sId = el('filter-struttura')?.value;
  const url = sId ? `/api/cronologia?struttura_id=${sId}` : '/api/cronologia';
  const rows = await api(url).catch(() => []);
  const tbody = el('crono-tbody');
  if (tbody) tbody.innerHTML = buildCronoRows(rows);
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
        <div class="section-card-title">Fatturato dottore vs Tuo costo vs Differenziale</div>
        <div class="chart-legend" id="conf-legend" style="margin-bottom:12px"></div>
        <canvas id="chart-conf" height="240"></canvas>
      </div>

      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Struttura</th><th>Listino pieno</th>
              <th>Fatturato dottore</th><th>Tuo costo</th><th>Differenziale</th>
            </tr></thead>
            <tbody>
              ${data.map(s => `<tr>
                <td><strong>${s.nome}</strong></td>
                <td class="td-muted">${euro(s.totale_listino)}</td>
                <td class="td-green">${euro(s.prezzo_scontato)}</td>
                <td class="td-yellow">${euro(s.costo_lav)}</td>
                <td class="td-blue">${euro(s.differenziale)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `);

  el('conf-legend').innerHTML = legendHtml([
    { label: 'Fatturato dottore', color: '#1a7a4a' },
    { label: 'Tuo costo',         color: '#f5a800' },
    { label: 'Differenziale',     color: '#2563a8' }
  ]);

  S.charts.conf = new Chart(el('chart-conf'), {
    type: 'bar',
    data: {
      labels: data.map(s => s.nome),
      datasets: [
        { label: 'Fatturato dottore', data: data.map(s => s.prezzo_scontato), backgroundColor: '#1a7a4a', borderRadius: 4 },
        { label: 'Tuo costo',         data: data.map(s => s.costo_lav),       backgroundColor: '#f5a800', borderRadius: 4 },
        { label: 'Differenziale',     data: data.map(s => s.differenziale),    backgroundColor: '#2563a8', borderRadius: 4 }
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
  el('upload-modal').hidden  = false;
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
      // Show confirm modal
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

  // Reload strutture and sidebar
  await loadStrutture();
  S.expanded[resp.struttura_id] = true;
  closeUploadModal();
  // Navigate directly to the first foglio of the uploaded file
  navigate('foglio', {
    fileId:      resp.file_id,
    foglio:      resp.fogli[0],
    strutturaId: resp.struttura_id
  });
}

async function downloadPdf(fileId, foglio, tipo) {
  // Capture live chart canvases as PNG data URLs
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
  const nome = `lavallonea_${foglio}_${tipo}.pdf`;
  a.href = url; a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Dropzone ──────────────────────────────────────
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

// ── Debug Excel ────────────────────────────────────
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
          Foglio: <strong>${sheet}</strong> — riga header rilevata: ${info.hRow}
        </div>
        <div style="font-family:monospace;font-size:12px;background:#f5f6f8;
                    padding:12px;border-radius:6px;overflow-x:auto;white-space:pre">${info.headers.join('\n')}</div>
        <div style="margin-top:8px;font-size:12px;color:#6b7280;font-weight:500">Prime 3 righe dati:</div>
        <div style="font-family:monospace;font-size:11px;background:#f5f6f8;
                    padding:10px;border-radius:6px;overflow-x:auto;white-space:pre;margin-top:4px">${
          info.sample.map((r,i) => `Riga ${i+1}: ${JSON.stringify(r)}`).join('\n')
        }</div>
      </div>`;
    }
    out.innerHTML = html || '<div style="color:#6b7280">Nessun foglio trovato</div>';
  });
}

// ── Init ──────────────────────────────────────────
async function init() {
  await loadStrutture();
  buildSidebar();
  initDropzone();
  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
