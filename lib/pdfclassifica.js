// Stadio 2 dell'import PDF: classificazione delle righe grezze.
//
// Prende le righe posizionate prodotte da lib/pdfestrazione.js e decide, per
// ognuna, se e' un esame con prezzo, se e' dubbia, o se e' rumore da scartare.
// Le righe scartate NON vengono rimosse: restano nel risultato con un motivo
// leggibile, perche' la garanzia di completezza si misura confrontando le
// righe tabellari trovate con quelle effettivamente classificate.
//
// Nota di progetto: la classificazione lavora sul testo della riga, non sulle
// colonne. Le coordinate dei singoli frammenti servirebbero a separare le
// colonne intermedie (materiale, tempi) dal nome, ma i listini reali non hanno
// colonne stabili e la tabella di revisione permette all'operatore di
// correggere: riconoscere le colonne sarebbe complessita' senza garanzia.

// Prefissi di intestazione e rumore imparati dai listini reali (IDEXX): non
// sono mai nomi di esame. NB: 'esame' da solo non va incluso, molti nomi
// cominciano cosi ("Esame istologico", "Esame urine completo").
const INTESTAZIONI = [
  'profili', 'test o profili', 'tutti i prezzi',
  'listino prezzi', 'indice', 'idexx laboratorio', 'idexx gli analizzatori'
];

// Importi in formato italiano (1.234,56 / 18,50) e anglosassone (1,234.56 / 18.50).
// Uno o due decimali: molti listini stampano "18,5". Servono comunque dei
// decimali, altrimenti un numero e' un anno, un codice o una quantita'
// (es. "Listino 2026", "Pagina 1 di 2").
const IMPORTO = /(?:€\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d{1,3}(?:,\d{3})+\.\d{1,2}|\d+\.\d{1,2})(?!\d)/g;

// Unita' di misura subito dopo l'importo: allora quel numero e' una quantita'
// nella descrizione ("prelievo 2,5 ml"), non un prezzo. Serve soprattutto da
// quando basta un decimale: senza questa regola quelle righe diventerebbero
// esami inventati.
// Il confine di parola vale solo per le unita alfabetiche: dopo '%' non c'e'
// mai un carattere di parola, quindi "%\b" non matcherebbe mai.
const UNITA_DOPO_IMPORTO = /^\s*(?:%|(?:ml|mg|kg|µl|ul|ui|cm|mm|[lg])\b)/i;

// Intestazione di colonne: la riga e' composta solo da nomi di colonna.
const INTESTAZIONE_COLONNE =
  /^(esam[ei]|test|descrizione|prestazione|voce)([\s|]+(materiale|tempi|prezzo|prezzi|importo|tariffa|listino|iva|codice|note))+$/i;

// Espressione di tempo di refertazione dentro il nome: segno che la riga porta
// anche le colonne intermedie del listino (materiale, tempi) e non solo il nome.
// Solo espressioni temporali: i materiali no, perche' "urine", "sangue", "feci"
// fanno legittimamente parte di molti nomi esame ("Esame urine completo").
const TEMPI_NEL_NOME = /\b(in giornata|giorn[oi]|settiman[ae]|gg|\d+\s?(h|ore))\b/i;

// Coda tipica della colonna "tempi di refertazione" di un listino, appiccicata
// in fondo al nome dall'estrazione: "4 h", "7 gg", "5/7 gg", "in giornata",
// e i segnaposto testuali che quella colonna usa al posto di un tempo.
const CODA_COLONNA_TEMPI =
  /\s*(?:\d+(?:\s*[\/-]\s*\d+)?\s*(?:h|ore|gg|giorni?|settimane?|sett\.?)|in giornata|vedi singole analisi|su richiesta|su prenotazione)\s*$/i;

// Una colonna si riconosce dal documento, non dalla singola riga: va tolta solo
// se ricorre in una quota consistente delle righe. Cosi un listino che ha
// davvero la colonna viene ripulito, mentre un esame che si chiama "... 24 h"
// in un listino senza quella colonna resta intatto e viene segnalato.
const QUOTA_COLONNA = 0.25;
const MIN_RIGHE_COLONNA = 5;

const NOME_MIN = 3;          // sotto i 3 caratteri non e' un nome esame
const NOME_MAX = 90;         // sopra, e' probabilmente un paragrafo con un importo dentro
const SIGLA_MAX = 5;         // parola sola fino a 5 caratteri: sigla, nome dubbio
const PREZZO_MAX = 2000;     // oltre, prezzo fuori scala per un esame di laboratorio
const MAX_IMPORTI = 3;       // oltre, non e' ovvio quale importo sia il prezzo

/**
 * Interpreta un prezzo scritto in formato italiano o anglosassone.
 * Usato sia sugli importi letti dal PDF sia su quelli digitati a mano in
 * revisione: "1.234,56" deve valere 1234.56, non 1.234.
 *
 * @param {string|number} grezzo
 * @returns {number} NaN se non e' un numero
 */
function parsePrezzo(grezzo) {
  if (typeof grezzo === 'number') return Number.isFinite(grezzo) ? grezzo : NaN;
  let t = String(grezzo == null ? '' : grezzo).replace(/[\s €]/g, '');
  if (!t) return NaN;

  const ultimaVirgola = t.lastIndexOf(',');
  const ultimoPunto = t.lastIndexOf('.');
  if (ultimaVirgola >= 0 && ultimoPunto >= 0) {
    // Con entrambi i separatori, quello piu' a destra e' il decimale.
    t = ultimaVirgola > ultimoPunto
      ? t.replace(/\./g, '').replace(',', '.')
      : t.replace(/,/g, '');
  } else if (ultimaVirgola >= 0) {
    // Piu' virgole = separatori di migliaia; una sola = decimale.
    t = (t.match(/,/g) || []).length > 1 ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (ultimoPunto >= 0 && /^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // 1.234 sono migliaia, non uno virgola due tre quattro
  }
  return parseFloat(t);
}

function trovaImporti(testo) {
  IMPORTO.lastIndex = 0;
  const out = [];
  let m;
  while ((m = IMPORTO.exec(testo)) !== null) {
    out.push({ valore: parsePrezzo(m[1]), inizio: m.index, fine: m.index + m[0].length });
  }
  return out;
}

// Il nome e' cio' che precede il primo importo, ripulito dai riempitivi che i
// listini usano per allineare le colonne (punti di guida, trattini, pipe).
function pulisciNome(grezzo) {
  return String(grezzo)
    .replace(/\s+/g, ' ')
    .replace(/^[\s•·*|\-–—]+/, '')
    .replace(/[\s.:;,|\-–—_]+$/, '')
    .trim();
}

function eIntestazione(nome) {
  const r = nome.toLowerCase();
  if (INTESTAZIONI.some(p => r.startsWith(p))) return true;
  // Riga di intestazione colonne del listino IDEXX ("Esame Materiale Tempi …").
  if (r.includes('materiale') && r.includes('tempi')) return true;
  return INTESTAZIONE_COLONNE.test(nome);
}

// Perche' una riga con prezzo resta dubbia. null = nessun dubbio.
function motivoDubbio(nome, prezzo, nImporti) {
  if (!(prezzo > 0)) return `prezzo non plausibile (${prezzo}): da verificare`;
  if (prezzo > PREZZO_MAX) return `prezzo fuori scala (${prezzo}): da verificare`;
  if (nImporti > MAX_IMPORTI) {
    return `${nImporti} importi sulla riga: scelto il primo, da verificare`;
  }
  if (TEMPI_NEL_NOME.test(nome)) {
    return 'nel nome sembra esserci una colonna del listino (tempi): da ripulire';
  }
  if (nome.length > NOME_MAX) return 'nome molto lungo: forse un paragrafo, non un esame';
  if (!nome.includes(' ') && nome.length <= SIGLA_MAX) return 'sigla isolata: nome dubbio';
  return null;
}

function classificaRiga(grezza) {
  const base = {
    ...grezza,
    nome: null,
    prezzo: null,
    confidenza: null,
    tabellare: false,
    scartata: true,
    motivo: null
  };
  const testo = String(grezza.testo || '').trim();
  if (!testo) return { ...base, motivo: 'riga vuota' };

  const importi = trovaImporti(testo);
  if (importi.length === 0) {
    return { ...base, motivo: 'nessun importo: non e una riga di prezzo' };
  }

  // Da qui la riga e' tabellare: contiene un importo, quindi entra nel
  // conteggio di completezza anche se poi viene scartata.
  const tab = { ...base, tabellare: true };
  const primo = importi[0];

  const coda = testo.slice(primo.fine);
  if (UNITA_DOPO_IMPORTO.test(coda)) {
    // Percentuale o quantita': non e' un prezzo, quindi non si conserva.
    const unita = coda.trim().split(/\s/)[0];
    return { ...tab, motivo: unita.startsWith('%') ? 'percentuale, non un prezzo' : `quantita in ${unita}, non un prezzo` };
  }

  // Da qui l'importo e' un prezzo plausibile, quindi si conserva anche se la
  // riga viene scartata per il nome: chi recupera la riga in revisione non deve
  // ridigitare un dato che l'analisi ha gia' letto correttamente.
  tab.prezzo = primo.valore;

  const nome = pulisciNome(testo.slice(0, primo.inizio));
  if (!nome) return { ...tab, motivo: 'nessun nome prima del prezzo' };
  if (nome.length < NOME_MIN) return { ...tab, motivo: `nome troppo corto: "${nome}"` };
  if (eIntestazione(nome)) return { ...tab, motivo: 'intestazione di tabella' };

  const dubbio = motivoDubbio(nome, primo.valore, importi.length);
  return {
    ...tab,
    nome,
    prezzo: primo.valore,
    confidenza: dubbio ? 'incerta' : 'alta',
    scartata: false,
    motivo: dubbio,
    nImporti: importi.length // serve per rivalutare il dubbio dopo la pulizia
  };
}

/**
 * Toglie dai nomi la colonna dei tempi, se il documento dimostra di averne una.
 *
 * Senza questo passaggio un listino con la colonna "tempi" manda in revisione
 * quasi ogni riga ("CORTISOLO/CREATININA URINARI 4 h"), e una revisione da
 * millesettecento righe non la fa nessuno: la segnalazione, diventando la
 * regola invece che l'eccezione, smette di informare.
 */
function togliColonnaTempi(righe) {
  const conNome = righe.filter(r => !r.scartata && r.nome);
  const conCoda = conNome.filter(r => CODA_COLONNA_TEMPI.test(r.nome));
  if (conCoda.length < MIN_RIGHE_COLONNA || conCoda.length < conNome.length * QUOTA_COLONNA) {
    return { righe, ripuliti: 0 };
  }

  let ripuliti = 0;
  const pulite = righe.map(r => {
    if (r.scartata || !r.nome || !CODA_COLONNA_TEMPI.test(r.nome)) return r;
    const nome = r.nome.replace(CODA_COLONNA_TEMPI, '').trim();
    // Se togliendo la coda non resta un nome, meglio tenerlo sporco che perderlo.
    if (nome.length < NOME_MIN) return r;
    ripuliti++;
    const dubbio = motivoDubbio(nome, r.prezzo, r.nImporti || 1);
    return { ...r, nome, confidenza: dubbio ? 'incerta' : 'alta', motivo: dubbio };
  });
  return { righe: pulite, ripuliti };
}

/**
 * Classifica le righe grezze dello stadio 1.
 *
 * @param {Array|Object} input righe grezze, o il risultato di estraiRigheGrezze
 * @returns {{
 *   righe: Array<Object>,      // ogni riga grezza + nome, prezzo, confidenza, tabellare, scartata, motivo, indice
 *   totaliTabellari: number,   // righe che contengono un importo
 *   classificate: number,      // righe accettate come esame
 *   alta: number,
 *   incerte: number,
 *   scartate: number,
 *   confidenzaComplessiva: number  // 0..1, le incerte pesano meta
 * }}
 */
function classificaRighe(input) {
  const grezze = Array.isArray(input) ? input : (input && input.righe) || [];
  const primaPassata = grezze.map((g, i) => ({ ...classificaRiga(g), indice: i }));
  const { righe, ripuliti } = togliColonnaTempi(primaPassata);

  const totaliTabellari = righe.filter(r => r.tabellare).length;
  const alta = righe.filter(r => !r.scartata && r.confidenza === 'alta').length;
  const incerte = righe.filter(r => !r.scartata && r.confidenza === 'incerta').length;
  const classificate = alta + incerte;
  const scartate = righe.filter(r => r.scartata).length;
  const confidenzaComplessiva = totaliTabellari
    ? Math.round(((alta + 0.5 * incerte) / totaliTabellari) * 100) / 100
    : 0;

  return {
    righe, totaliTabellari, classificate, alta, incerte, scartate,
    confidenzaComplessiva,
    nomiRipuliti: ripuliti // nomi a cui e' stata tolta la colonna dei tempi
  };
}

module.exports = { classificaRighe, parsePrezzo };
