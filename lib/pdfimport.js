'use strict';
const pdf = require('pdf-parse');

const PREZZO = String.raw`\d{1,3}(?:\.\d{3})*,\d{2}`;
const RIGA_PREZZO = new RegExp(`(${PREZZO})(${PREZZO})([A-Z][A-Z0-9]*)\\s*$`);

// Prefissi di intestazione/rumore: mai usati come nome esame.
// NB: non includere 'esame' — molti nomi esame iniziano con "Esame ..." (es. "Esame istologico").
const INTESTAZIONI = [
  'profili', 'test o profili', 'tutti i prezzi',
  'listino prezzi', 'indice', 'idexx laboratorio', 'idexx gli analizzatori'
];

function isIntestazione(riga) {
  const r = riga.toLowerCase();
  if (INTESTAZIONI.some(p => r.startsWith(p))) return true;
  // riga di intestazione colonne (es. "Esame  Materiale  Tempi  Prezzo Vet...")
  if (r.includes('materiale') && r.includes('tempi')) return true;
  return false;
}

function toNum(s) {
  return parseFloat(s.replace(/\./g, '').replace(',', '.'));
}

// Parser a blocchi: il nome e' la prima riga del blocco, la riga-prezzo lo chiude.
function parseRigheDaTesto(testo) {
  const lines = String(testo || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const righe = [];
  let scartate = 0;
  let nome = null;

  for (const line of lines) {
    const m = line.match(RIGA_PREZZO);
    if (m) {
      if (nome && nome.length >= 3 && !isIntestazione(nome)) {
        righe.push({ nome_originale: nome.replace(/\s+/g, ' ').trim(), prezzo: toNum(m[1]), code: m[3] });
      } else {
        scartate++;
      }
      nome = null;
    } else if (nome === null && !isIntestazione(line)) {
      nome = line; // prima riga del blocco = nome candidato
    }
    // altrimenti: descrizione/materiale/intestazione -> ignora
  }

  return { righe, scartate };
}

async function estraiTestoPdf(buffer) {
  const data = await pdf(buffer);
  return data.text;
}

module.exports = { parseRigheDaTesto, estraiTestoPdf };
