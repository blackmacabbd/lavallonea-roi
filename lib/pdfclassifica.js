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
// Sempre due decimali: senza decimali un numero e' un anno, un codice o una
// quantita', non un prezzo (es. "Listino 2026", "Pagina 1 di 2").
const IMPORTO = /(?:€\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?!\d)/g;

// Intestazione di colonne: la riga e' composta solo da nomi di colonna.
const INTESTAZIONE_COLONNE =
  /^(esam[ei]|test|descrizione|prestazione|voce)([\s|]+(materiale|tempi|prezzo|prezzi|importo|tariffa|listino|iva|codice|note))+$/i;

// Espressione di tempo di refertazione dentro il nome: segno che la riga porta
// anche le colonne intermedie del listino (materiale, tempi) e non solo il nome.
// Solo espressioni temporali: i materiali no, perche' "urine", "sangue", "feci"
// fanno legittimamente parte di molti nomi esame ("Esame urine completo").
const TEMPI_NEL_NOME = /\b(in giornata|giorn[oi]|settiman[ae]|gg|\d+\s?(h|ore))\b/i;

const NOME_MIN = 3;          // sotto i 3 caratteri non e' un nome esame
const NOME_MAX = 90;         // sopra, e' probabilmente un paragrafo con un importo dentro
const SIGLA_MAX = 5;         // parola sola fino a 5 caratteri: sigla, nome dubbio
const PREZZO_MAX = 2000;     // oltre, prezzo fuori scala per un esame di laboratorio
const MAX_IMPORTI = 3;       // oltre, non e' ovvio quale importo sia il prezzo

function toNum(grezzo) {
  const t = String(grezzo).replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d+,\d{2}$/.test(t)) return parseFloat(t.replace(',', '.'));
  if (/^\d{1,3}(,\d{3})+\.\d{2}$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  return parseFloat(t);
}

function trovaImporti(testo) {
  IMPORTO.lastIndex = 0;
  const out = [];
  let m;
  while ((m = IMPORTO.exec(testo)) !== null) {
    out.push({ valore: toNum(m[1]), inizio: m.index, fine: m.index + m[0].length });
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
function motivoDubbio(nome, prezzo, importi) {
  if (!(prezzo > 0)) return `prezzo non plausibile (${prezzo}): da verificare`;
  if (prezzo > PREZZO_MAX) return `prezzo fuori scala (${prezzo}): da verificare`;
  if (importi.length > MAX_IMPORTI) {
    return `${importi.length} importi sulla riga: scelto il primo, da verificare`;
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

  if (/^\s*%/.test(testo.slice(primo.fine))) {
    // Una percentuale non e' un prezzo: non si conserva come tale.
    return { ...tab, motivo: 'percentuale, non un prezzo' };
  }

  // Da qui l'importo e' un prezzo plausibile, quindi si conserva anche se la
  // riga viene scartata per il nome: chi recupera la riga in revisione non deve
  // ridigitare un dato che l'analisi ha gia' letto correttamente.
  tab.prezzo = primo.valore;

  const nome = pulisciNome(testo.slice(0, primo.inizio));
  if (!nome) return { ...tab, motivo: 'nessun nome prima del prezzo' };
  if (nome.length < NOME_MIN) return { ...tab, motivo: `nome troppo corto: "${nome}"` };
  if (eIntestazione(nome)) return { ...tab, motivo: 'intestazione di tabella' };

  const dubbio = motivoDubbio(nome, primo.valore, importi);
  return {
    ...tab,
    nome,
    prezzo: primo.valore,
    confidenza: dubbio ? 'incerta' : 'alta',
    scartata: false,
    motivo: dubbio
  };
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
  const righe = grezze.map((g, i) => ({ ...classificaRiga(g), indice: i }));

  const totaliTabellari = righe.filter(r => r.tabellare).length;
  const alta = righe.filter(r => !r.scartata && r.confidenza === 'alta').length;
  const incerte = righe.filter(r => !r.scartata && r.confidenza === 'incerta').length;
  const classificate = alta + incerte;
  const scartate = righe.filter(r => r.scartata).length;
  const confidenzaComplessiva = totaliTabellari
    ? Math.round(((alta + 0.5 * incerte) / totaliTabellari) * 100) / 100
    : 0;

  return { righe, totaliTabellari, classificate, alta, incerte, scartate, confidenzaComplessiva };
}

module.exports = { classificaRighe };
