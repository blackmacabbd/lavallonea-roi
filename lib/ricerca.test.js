'use strict';
// La funzione di ricerca vive in public/ricerca.js perche' gira nel browser.
// Qui si carica quel file vero in una sandbox, invece di riscriverne una copia:
// un test su un duplicato non direbbe niente sul codice che gli utenti usano.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sorgente = fs.readFileSync(path.join(__dirname, '..', 'public', 'ricerca.js'), 'utf8');
const contesto = { window: {} };
vm.createContext(contesto);
vm.runInContext(sorgente, contesto);
// Controllo esplicito prima di destrutturare: se il file smettesse di assegnare
// window.Ricerca la ricerca non arriverebbe al browser, e senza questo si
// leggerebbe solo un TypeError su una destrutturazione.
if (!contesto.window.Ricerca) {
  throw new Error('public/ricerca.js non assegna window.Ricerca');
}
const { corrisponde, normalizza } = contesto.window.Ricerca;

test('normalizza toglie accenti, maiuscole e spazi in eccesso', () => {
  assert.equal(normalizza('  Esame  Citològico  '), 'esame citologico');
  assert.equal(normalizza('PU/CU'), 'pu/cu');
  assert.equal(normalizza(null), '');
});

test('query vuota: corrisponde sempre', () => {
  assert.equal(corrisponde('EMOCROMO COMPLETO', ''), true);
  assert.equal(corrisponde('EMOCROMO COMPLETO', '   '), true);
});

test('sottostringa semplice', () => {
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'emocromo'), true);
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'crom'), true);
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'leishmania'), false);
});

test('accenti e maiuscole ignorati', () => {
  assert.equal(corrisponde('Esame Citològico del sedimento', 'CITOLOGICO'), true);
  assert.equal(corrisponde('ESAME CITOLOGICO', 'citològico'), true);
});

// I nomi dei listini reali hanno le parole in ordine imprevedibile: cercare
// "urine completo" deve trovare "ESAME URINE, PU/CU, COMPLETO".
test('parole in qualsiasi ordine, tutte devono comparire', () => {
  const nome = 'ESAME URINE, PU/CU, COMPLETO';
  assert.equal(corrisponde(nome, 'urine completo'), true);
  assert.equal(corrisponde(nome, 'completo urine'), true);
  assert.equal(corrisponde(nome, 'urine feci'), false, 'feci non c e: non deve corrispondere');
});

// Le parole di 4-6 caratteri sono la fascia a un errore solo. Servono parole
// corte davvero: con "analizatore" (11 caratteri) si finisce nella fascia a due
// errori e questa regola non viene provata affatto.
test('tollera un errore di battitura su parole da 4 a 6 caratteri', () => {
  assert.equal(corrisponde('ESAME URINE COMPLETO', 'urane'), true, '5 caratteri, un errore');
  assert.equal(corrisponde('PROFILO FEGATO', 'fegatp'), true, '6 caratteri, un errore');
  assert.equal(corrisponde('PROFILO RENE', 'rone'), true, '4 caratteri, un errore');
});

// E il confine dall'altro lato: due errori su una parola corta non si tollerano,
// altrimenti la fascia sarebbe la stessa delle parole lunghe.
test('due errori su parole da 4 a 6 caratteri non bastano', () => {
  assert.equal(corrisponde('ESAME URINE COMPLETO', 'uxane'), false);
  assert.equal(corrisponde('PROFILO FEGATO', 'fexatp'), false);
});

test('tollera due errori su parole da 7 caratteri in su', () => {
  // Lettere invertite: per la distanza di modifica sono due operazioni, quindi
  // questo caso prova davvero la fascia a due errori.
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'emocormo'), true, '8 caratteri, distanza 2');
  assert.equal(corrisponde('Analizzatore biochimico', 'analizzatoer'), true, '12 caratteri, distanza 2');
  assert.equal(corrisponde('Coprologico completo', 'coprolgico'), true, 'distanza 1, dentro la fascia');
  assert.equal(corrisponde('Ematologico veterinario', 'veterinrio'), true);
});

// Oltre la fascia non si va: tre errori su una parola lunga non corrispondono.
test('tre errori non si tollerano nemmeno sulle parole lunghe', () => {
  assert.equal(corrisponde('Coprologico completo', 'copxolgixo'), false);
});

// Sotto i 4 caratteri la tolleranza produrrebbe piu' rumore che aiuto: con
// "TSH" a distanza 1 si troverebbe mezzo listino.
test('nessuna tolleranza sotto i 4 caratteri', () => {
  assert.equal(corrisponde('TSH CANINO', 'tsh'), true, 'esatto deve funzionare');
  assert.equal(corrisponde('TSH CANINO', 'tsx'), false, 'un errore su 3 lettere non si tollera');
  assert.equal(corrisponde('T4 TOTALE', 'tz'), false);
});

// La corrispondenza per sottostringa resta, ed e' voluta: "crom" deve trovare
// "EMOCROMO". Vale anche per query corte, quindi "ta" trova "toTAle": non e'
// tolleranza agli errori, e' una ricerca parziale.
test('sottostringa vale anche per query corte', () => {
  assert.equal(corrisponde('T4 TOTALE', 'ta'), true);
});

test('una parola sbagliata oltre la tolleranza non corrisponde', () => {
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'xyzabcde'), false);
  assert.equal(corrisponde('Analizzatore', 'frigorifero'), false);
});

test('la tolleranza vale su ogni parola del testo, non solo sulla prima', () => {
  assert.equal(corrisponde('PROFILO BIOCHIMICO COMPLETO', 'biochmico'), true);
});

test('piu parole con un errore ciascuna', () => {
  assert.equal(corrisponde('Analizzatore biochimico da banco', 'analizatore biochmico'), true);
});

test('testo vuoto non corrisponde a una query non vuota', () => {
  assert.equal(corrisponde('', 'emocromo'), false);
  assert.equal(corrisponde(null, 'emocromo'), false);
});
