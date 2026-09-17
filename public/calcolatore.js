'use strict';

/* ════════════════════════════════════════════════════
   Mylav ROI Dashboard — calcolatore.js
   ════════════════════════════════════════════════════
   Motore comune alle tabelle di confronto concorrenza/Mylav. Non contiene
   niente di specifico di UN calcolatore: quello che cambia da un calcolatore
   all'altro (formule, cascate di prezzo, salvataggio, banner) resta nel file
   che usa il motore e viene passato dentro un "descrittore" a Calcolatore.crea().

   Questo file va caricato dopo i18n.js (usa t()) e prima di app.js (che lo
   usa). Le funzioni escHtml/fmtE restano in app.js: sono utility generiche
   usate in tutta l'app, non solo qui, e vengono risolte a runtime (i due file
   condividono lo stesso scope globale, quindi l'ordine di caricamento non
   crea un problema finche' le chiamate avvengono dopo che entrambi gli script
   sono stati eseguiti).

   Il descrittore ha questa forma (vedi anche task-2-brief.md):
   {
     chiave, idTbody, idTableWrap, idMsg, idAc,
     stato, rigaVuota, colonne,
     calcolaRiga, totali, suCampoUscito,
     rigaValida, colonnaAutocomplete, suggerimenti, suSelezioneAutocomplete,
     dopoTotali, dopoInizializzaEventi, tipoRiga,
     etichettaTotaleRiga, etichettaDifferenziale, avvisoNegativo
   }
   Una colonna: { col, intestazione, tipo, larghezza, gruppo, segnaposto, elenco,
     larghezzaCampo, valore, fallbackSuZero, extra, contenutoVuoto,
     posizioneRelativa, totale, coloreCondizionale }
   ════════════════════════════════════════════════════ */

window.Calcolatore = (function () {

  // Il gruppo decide il colore (concorrenza=rosso tenue, mylav=blu tenue,
  // nessuno=trasparente) e, in testata, l'etichetta raggruppata. E' un'unica
  // tabella dei 3 valori ammessi, non qualcosa che il descrittore configura:
  // 'concorrenza' e 'mylav' sono il vocabolario stesso di un calcolatore di
  // confronto.
  const SFONDO_GRUPPO = {
    concorrenza: 'rgba(206,24,30,0.04)',
    mylav: 'rgba(15,118,188,0.06)'
  };
  const ETICHETTA_GRUPPO = {
    concorrenza: 'confronto.tabella.concorrenza',
    mylav: 'confronto.tabella.mylav'
  };
  const CLASSE_GRUPPO = {
    concorrenza: 'roi-grp roi-grp-conc',
    mylav: 'roi-grp roi-grp-myl'
  };

  function el(id) { return document.getElementById(id); }

  function crea(descrittore) {
    const {
      idTbody, idTableWrap, idMsg, idAc,
      stato, rigaVuota, colonne, calcolaRiga, totali: calcolaTotali,
      suCampoUscito, rigaValida, colonnaAutocomplete, suggerimenti,
      suSelezioneAutocomplete, dopoTotali, dopoInizializzaEventi, tipoRiga,
      etichettaTotaleRiga, etichettaDifferenziale, avvisoNegativo
    } = descrittore;

    function sfondoDi(col) {
      return col.gruppo && col.gruppo !== 'nessuno' ? `background:${SFONDO_GRUPPO[col.gruppo]}` : '';
    }
    function segnapostoDi(col, r) {
      return typeof col.segnaposto === 'function' ? (col.segnaposto(r) || '') : (col.segnaposto || '');
    }
    function valoreDi(col, r) {
      const v = typeof col.valore === 'function' ? col.valore(r) : r[col.col];
      return (v === undefined || v === null) ? '' : v;
    }
    function stileCella(col) {
      const parti = [];
      if (col.posizioneRelativa) parti.push('position:relative');
      const bg = sfondoDi(col);
      if (bg) parti.push(bg);
      return parti.length ? ` style="${parti.join(';')}"` : '';
    }

    // ── Testata ────────────────────────────────────────
    function costruisciTestata1() {
      let html = '<tr>';
      let i = 0;
      while (i < colonne.length) {
        const g = colonne[i].gruppo || 'nessuno';
        let n = 1;
        // Le colonne consecutive dello stesso gruppo si fondono in una cella
        // sola, tranne quelle marcate 'separaInTestata', che nella tabella
        // originale avevano una cella propria. Fonderle toglieva una linea di
        // bordo, e un'estrazione non deve cambiare nemmeno quello.
        if (!colonne[i].separaInTestata) {
          while (i + n < colonne.length
                 && (colonne[i + n].gruppo || 'nessuno') === g
                 && !colonne[i + n].separaInTestata) n++;
        }
        html += (g === 'nessuno')
          ? `<th colspan="${n}"></th>`
          : `<th colspan="${n}" class="${CLASSE_GRUPPO[g]}">${t(ETICHETTA_GRUPPO[g])}</th>`;
        i += n;
      }
      return html + '</tr>';
    }

    function costruisciTestata2() {
      const celle = colonne.map(col => {
        const stile = [`width:${col.larghezza}px`];
        const bg = sfondoDi(col);
        if (bg) stile.push(bg);
        const testo = col.intestazione ? t(col.intestazione) : '';
        return `<th style="${stile.join(';')}">${testo}</th>`;
      }).join('');
      return `<tr>${celle}</tr>`;
    }

    // ── Corpo ────────────────────────────────────────────
    function cellaVuota(col, r, i) {
      const contenuto = col.contenutoVuoto ? col.contenutoVuoto(r, i) : '';
      return `<td${stileCella(col)}>${contenuto}</td>`;
    }

    function cellaInput(col, r, i) {
      const valore = escHtml(valoreDi(col, r));
      const segnaposto = escHtml(segnapostoDi(col, r));
      const classi = col.tipo === 'numero' ? 'roi-input roi-num' : 'roi-input';
      const listAttr = col.elenco ? ` list="${col.elenco}"` : '';
      const stileInput = col.larghezzaCampo ? ` style="width:${col.larghezzaCampo}px"` : '';
      const autocompleteAttr = col.tipo === 'testo' ? ' autocomplete="off"' : '';
      const input = `<input class="${classi}" data-col="${col.col}"${listAttr} value="${valore}" placeholder="${segnaposto}"${autocompleteAttr}${stileInput}>`;
      const extra = col.extra ? col.extra(r, i) : '';
      return `<td${stileCella(col)}>${input}${extra}</td>`;
    }

    function cellaCalcolata(col, valori) {
      const v = valori[col.col];
      const parti = [];
      const bg = sfondoDi(col);
      if (bg) parti.push(bg);
      if (col.coloreCondizionale) {
        parti.push(`color:${(Number(v) || 0) >= 0 ? '#0f76bc' : '#ce181e'}`);
        parti.push('font-weight:500');
      }
      const stile = parti.length ? ` style="${parti.join(';')}"` : '';
      return `<td class="roi-calc" data-col="${col.col}"${stile}>${fmtE(v)}</td>`;
    }

    function costruisciRiga(r, i) {
      const valoriCalcolati = calcolaRiga(r);
      const celle = colonne.map(col => {
        if (col.tipo === 'vuota') return cellaVuota(col, r, i);
        if (col.tipo === 'calcolato') return cellaCalcolata(col, valoriCalcolati);
        return cellaInput(col, r, i);
      }).join('');
      return `<tr data-idx="${i}" data-tipo="${tipoRiga || ''}">${celle}</tr>`;
    }

    // ── Piede (totali + differenziale) ──────────────────
    function costruisciPiede(righe) {
      const tots = calcolaTotali(righe);

      let primaConTotale = colonne.findIndex(c => c.totale);
      if (primaConTotale === -1) primaConTotale = colonne.length;

      let riga = `<td colspan="${primaConTotale}"><strong>${t(etichettaTotaleRiga)}</strong></td>`;
      for (let i = primaConTotale; i < colonne.length; i++) {
        const col = colonne[i];
        const bg = sfondoDi(col);
        if (col.totale) {
          const v = tots[col.totale];
          const parti = [];
          if (bg) parti.push(bg);
          if (col.coloreCondizionale) {
            parti.push(`color:${(Number(v) || 0) >= 0 ? '#0f76bc' : '#ce181e'}`);
            parti.push('font-weight:600');
          }
          riga += `<td class="roi-calc"${parti.length ? ` style="${parti.join(';')}"` : ''}>${fmtE(v)}</td>`;
        } else {
          riga += `<td${bg ? ` style="${bg}"` : ''}></td>`;
        }
      }
      const totRow = `<tr class="roi-totals-row">${riga}</tr>`;

      const colDifferenziale = colonne.find(c => c.coloreCondizionale);
      const valDiff = colDifferenziale ? (tots[colDifferenziale.totale] || 0) : 0;
      const colspanNota = Math.max(colonne.length - 2, 1);
      const diffRow = `<tr class="roi-diff-row">
        <td colspan="${colspanNota}" style="text-align:right;font-size:13px;font-weight:500">
          <span id="${idTbody}-diff-note" style="display:${valDiff < 0 ? 'inline' : 'none'};color:#ce181e;font-weight:600;font-size:11.5px;margin-right:14px">${avvisoNegativo ? t(avvisoNegativo) : ''}</span>
          ${t(etichettaDifferenziale)}
        </td>
        <td colspan="2" style="font-size:15px;font-weight:700;color:${valDiff >= 0 ? '#0f76bc' : '#ce181e'}">${fmtE(valDiff)}</td>
      </tr>`;

      return { totRow, diffRow, tots };
    }

    function costruisciHtmlTabella() {
      const righe = stato().righe;
      const corpo = righe.map((r, i) => costruisciRiga(r, i)).join('');
      const { totRow, diffRow } = costruisciPiede(righe);
      return `<table class="roi-editable-table roi-compare">
        <thead>${costruisciTestata1()}${costruisciTestata2()}</thead>
        <tbody id="${idTbody}">${corpo}</tbody>
        <tfoot>${totRow}${diffRow}</tfoot>
      </table>`;
    }

    // ── Sincronizzazione DOM → stato ────────────────────
    function aggiornaRiga(tr) {
      const idx = parseInt(tr.dataset.idx, 10);
      const r = stato().righe[idx];
      if (!r) return;

      colonne.forEach(col => {
        if (col.tipo !== 'testo' && col.tipo !== 'numero') return;
        const inp = tr.querySelector(`[data-col="${col.col}"]`);
        if (!inp) return;
        if (col.tipo === 'numero') {
          const grezzo = parseFloat(inp.value) || 0;
          r[col.col] = grezzo || (col.fallbackSuZero !== undefined ? col.fallbackSuZero : 0);
        } else {
          r[col.col] = inp.value;
        }
      });

      const valori = calcolaRiga(r);
      colonne.forEach(col => {
        if (col.tipo !== 'calcolato') return;
        const td = tr.querySelector(`[data-col="${col.col}"]`);
        if (!td) return;
        td.textContent = fmtE(valori[col.col]);
        if (col.coloreCondizionale) td.style.color = (Number(valori[col.col]) || 0) >= 0 ? '#0f76bc' : '#ce181e';
      });

      totali();
    }

    function sincronizza() {
      const tbody = el(idTbody);
      if (!tbody) return;
      tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaRiga(tr));
    }

    function righeValide() {
      sincronizza();
      return stato().righe.filter(rigaValida);
    }

    function totali() {
      const righe = stato().righe;
      const { totRow, diffRow, tots } = costruisciPiede(righe);
      const wrap = el(idTableWrap);
      const tfoot = wrap && wrap.querySelector('tfoot');
      if (tfoot) tfoot.innerHTML = totRow + diffRow;
      if (dopoTotali) dopoTotali(tots);
      return tots;
    }

    function disegnaTabella() {
      return costruisciHtmlTabella();
    }

    function ridisegna() {
      const wrap = el(idTableWrap);
      if (!wrap) return;
      wrap.innerHTML = costruisciHtmlTabella();
      inizializzaEventi();
    }

    function aggiungiRiga() {
      sincronizza();
      stato().righe.push(rigaVuota());
      ridisegna();
      const tbody = el(idTbody);
      if (tbody) {
        const ultima = tbody.lastElementChild;
        const target = colonnaAutocomplete && ultima ? ultima.querySelector(`[data-col="${colonnaAutocomplete}"]`) : null;
        if (target) target.focus();
      }
    }

    function rimuoviRiga(idx) {
      sincronizza();
      const s = stato();
      if (s.righe.length > 1) s.righe.splice(idx, 1);
      else s.righe = [rigaVuota()];
      ridisegna();
    }

    // ── Tendina dei suggerimenti (colonna configurata via colonnaAutocomplete) ──
    let acTimeout = null;

    function nascondiAc() {
      const ac = el(idAc);
      if (ac) { ac.style.display = 'none'; ac.innerHTML = ''; }
    }

    async function selezionaSuggerimento(nome, inp) {
      inp.value = nome;
      nascondiAc();
      const tr = inp.closest('tr');
      if (!tr) return;
      aggiornaRiga(tr);
      if (suSelezioneAutocomplete) await suSelezioneAutocomplete(tr, nome);
      aggiornaRiga(tr);
    }

    async function eseguiAutocomplete(inp) {
      const q = inp.value.trim();
      if (q.length < 1) return nascondiAc();
      const items = suggerimenti ? await suggerimenti(q).catch(() => []) : [];
      const ac = el(idAc);
      if (!items.length || !ac) return nascondiAc();
      const rect = inp.getBoundingClientRect();
      ac.style.display = 'block';
      ac.style.position = 'fixed';
      ac.style.left = rect.left + 'px';
      ac.style.top = (rect.bottom + 4) + 'px';
      ac.style.zIndex = '9999';
      ac.innerHTML = items.map(s => `<div class="roi-ac-item">${s}</div>`).join('');
      [...ac.querySelectorAll('.roi-ac-item')].forEach((voce, idx) => {
        voce.addEventListener('click', () => selezionaSuggerimento(items[idx], inp));
      });
    }

    function messaggio(msg, tipo) {
      const d = el(idMsg);
      if (!d) return;
      d.textContent = msg;
      d.style.color = tipo === 'error' ? '#ce181e' : '#0f76bc';
      setTimeout(() => { if (d) d.textContent = ''; }, 4000);
    }

    function inizializzaEventi() {
      const wrap = el(idTableWrap);
      if (!wrap) return;

      wrap.addEventListener('input', e => {
        const inp = e.target;
        if (!inp.matches('.roi-input')) return;
        const tr = inp.closest('tr');
        if (tr && tr.dataset.tipo) aggiornaRiga(tr);

        if (colonnaAutocomplete && inp.dataset.col === colonnaAutocomplete) {
          clearTimeout(acTimeout);
          acTimeout = setTimeout(() => eseguiAutocomplete(inp), 200);
        }
      });

      wrap.addEventListener('blur', async e => {
        const inp = e.target;
        if (!inp.matches || !inp.matches('.roi-input')) return;
        const tr = inp.closest('tr');
        if (!tr) return;
        if (suCampoUscito) await suCampoUscito(tr, inp.dataset.col);
      }, true);

      wrap.addEventListener('keydown', e => {
        if (e.key === 'Tab') {
          const inp = e.target;
          if (!inp.matches('.roi-input')) return;
          const tr = inp.closest('tr');
          if (!tr) return;
          const tbody = el(idTbody);
          if (tbody && tr === tbody.lastElementChild) {
            const inputs = tr.querySelectorAll('.roi-input');
            if (inp === inputs[inputs.length - 1]) {
              e.preventDefault();
              aggiungiRiga();
            }
          }
        }
        if (e.key === 'Escape') nascondiAc();
        if (e.key === 'Enter') {
          const inp = e.target;
          if (!inp.matches('.roi-input')) return;
          e.preventDefault();
          nascondiAc();
          inp.blur();
        }
      });

      document.addEventListener('click', e => {
        const suTendina = e.target.matches('.roi-ac-item');
        const suCampoAc = colonnaAutocomplete && e.target.matches(`[data-col="${colonnaAutocomplete}"]`);
        if (!suTendina && !suCampoAc) nascondiAc();
      }, { once: false });

      if (dopoInizializzaEventi) dopoInizializzaEventi();
    }

    return {
      disegnaTabella, aggiornaRiga, totali, aggiungiRiga, rimuoviRiga,
      righeValide, sincronizza, inizializzaEventi, messaggio
    };
  }

  return { crea };
})();
