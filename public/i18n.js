/* Traduzioni dell'interfaccia: italiano, inglese, francese, spagnolo.
 *
 * Nessuna libreria: un dizionario per lingua e una funzione che risolve una
 * chiave. Le frasi restano intere e i valori variabili entrano per
 * sostituzione ({n}, {nome}): concatenare pezzi produrrebbe frasi
 * sgrammaticate, perche' l'ordine delle parole cambia da lingua a lingua.
 *
 * I dati dell'operatore non compaiono qui: nomi di esami, macchine,
 * concorrenti e importi restano come li ha inseriti lui.
 */
(function () {
  'use strict';

  const LINGUE = ['it', 'en', 'fr', 'es'];
  const NOMI = { it: 'Italiano', en: 'English', fr: 'Français', es: 'Español' };
  const CHIAVE_MEMORIA = 'lingua';

  const DIZIONARIO = {
    it: {
      // Menu laterale (voci di navigazione)
      'menu.upload': 'Carica file Excel',
      'menu.dashboard': 'Dashboard',
      'menu.piani': 'Gestione piani',
      'menu.concorrenti': 'Gestione concorrenti',
      'menu.macchinari': 'Macchinari',
      'menu.confrontoMacchine': 'Confronto macchine',
      'menu.confrontoStrutture': 'Confronto strutture',
      'menu.cronologia': 'Cronologia file',

      // Titoli e sottotitoli di pagina
      'pagina.dashboard.titolo': 'Dashboard',
      'pagina.piani.titolo': 'Gestione piani di scontistica',
      'pagina.piani.sottotitolo': '{n} piani (attivi e disattivati)',
      'pagina.concorrenti.titolo': 'Gestione concorrenti',
      'pagina.concorrenti.sottotitolo': '{n} concorrenti importati',
      'pagina.macchinari.titolo': 'Macchinari',
      'pagina.macchinari.sottotitolo': '{mie} tuoi · {loro} della concorrenza',
      'pagina.confrontoMacchine.titolo': 'Confronto macchine',
      'pagina.confrontoMacchine.sottotitolo': '{mie} tue · {loro} della concorrenza',
      'pagina.confrontoStrutture.titolo': 'Confronto strutture',
      'pagina.confrontoStrutture.sottotitolo': '{n} strutture nel database',
      'pagina.cronologia.titolo': 'Cronologia file',
      'pagina.cronologia.sottotitolo': 'Tutti i file caricati',

      // Stati comuni
      'stato.caricamento': 'Caricamento...',
      'stato.nessunDato': 'Nessun dato ancora',
      'stato.errore': 'Errore',
      'stato.erroreCaricamento': 'Errore caricamento',
      // {azione} deve ricevere una stringa gia' tradotta, cioe' il risultato di
      // un'altra t(): passare l'infinito italiano produrrebbe frasi meta'
      // tradotte come "Sign in to modificare i tuoi piani".
      'stato.ospiteAccedi': 'Accedi per {azione}',

      // Comandi ricorrenti
      'comune.salva': 'Salva',
      'comune.annulla': 'Annulla',
      'comune.elimina': 'Elimina',
      'comune.modifica': 'Modifica',
      'comune.chiudi': 'Chiudi',
      'comune.conferma': 'Conferma',
      'comune.accedi': 'Accedi',
      'comune.esci': 'Esci'
    },
    en: {
      'menu.upload': 'Upload Excel file',
      'menu.dashboard': 'Dashboard',
      'menu.piani': 'Manage discount plans',
      'menu.concorrenti': 'Manage competitors',
      'menu.macchinari': 'Equipment',
      'menu.confrontoMacchine': 'Equipment comparison',
      'menu.confrontoStrutture': 'Practice comparison',
      'menu.cronologia': 'File history',

      'pagina.dashboard.titolo': 'Dashboard',
      'pagina.piani.titolo': 'Discount plan management',
      'pagina.piani.sottotitolo': '{n} plans (active and disabled)',
      'pagina.concorrenti.titolo': 'Competitor management',
      'pagina.concorrenti.sottotitolo': '{n} competitors imported',
      'pagina.macchinari.titolo': 'Equipment',
      'pagina.macchinari.sottotitolo': '{mie} yours · {loro} from the competition',
      'pagina.confrontoMacchine.titolo': 'Equipment comparison',
      'pagina.confrontoMacchine.sottotitolo': '{mie} yours · {loro} from the competition',
      'pagina.confrontoStrutture.titolo': 'Practice comparison',
      'pagina.confrontoStrutture.sottotitolo': '{n} practices in the database',
      'pagina.cronologia.titolo': 'File history',
      'pagina.cronologia.sottotitolo': 'All uploaded files',

      'stato.caricamento': 'Loading...',
      'stato.nessunDato': 'No data yet',
      'stato.errore': 'Error',
      'stato.erroreCaricamento': 'Loading error',
      'stato.ospiteAccedi': 'Sign in to {azione}',

      'comune.salva': 'Save',
      'comune.annulla': 'Cancel',
      'comune.elimina': 'Delete',
      'comune.modifica': 'Edit',
      'comune.chiudi': 'Close',
      'comune.conferma': 'Confirm',
      'comune.accedi': 'Sign in',
      'comune.esci': 'Log out'
    },
    fr: {
      'menu.upload': 'Importer un fichier Excel',
      'menu.dashboard': 'Tableau de bord',
      'menu.piani': 'Gestion des plans de remises',
      'menu.concorrenti': 'Gestion des concurrents',
      'menu.macchinari': 'Équipements',
      'menu.confrontoMacchine': 'Comparaison des équipements',
      'menu.confrontoStrutture': 'Comparaison des cliniques',
      'menu.cronologia': 'Historique des fichiers',

      'pagina.dashboard.titolo': 'Tableau de bord',
      'pagina.piani.titolo': 'Gestion des plans de remises',
      'pagina.piani.sottotitolo': '{n} plans (actifs et désactivés)',
      'pagina.concorrenti.titolo': 'Gestion des concurrents',
      'pagina.concorrenti.sottotitolo': '{n} concurrents importés',
      'pagina.macchinari.titolo': 'Équipements',
      'pagina.macchinari.sottotitolo': '{mie} à vous · {loro} de la concurrence',
      'pagina.confrontoMacchine.titolo': 'Comparaison des équipements',
      'pagina.confrontoMacchine.sottotitolo': '{mie} à vous · {loro} de la concurrence',
      'pagina.confrontoStrutture.titolo': 'Comparaison des cliniques',
      'pagina.confrontoStrutture.sottotitolo': '{n} cliniques dans la base de données',
      'pagina.cronologia.titolo': 'Historique des fichiers',
      'pagina.cronologia.sottotitolo': 'Tous les fichiers importés',

      'stato.caricamento': 'Chargement...',
      'stato.nessunDato': 'Aucune donnée pour le moment',
      'stato.errore': 'Erreur',
      'stato.erroreCaricamento': 'Erreur de chargement',
      'stato.ospiteAccedi': 'Connectez-vous pour {azione}',

      'comune.salva': 'Enregistrer',
      'comune.annulla': 'Annuler',
      'comune.elimina': 'Supprimer',
      'comune.modifica': 'Modifier',
      'comune.chiudi': 'Fermer',
      'comune.conferma': 'Confirmer',
      'comune.accedi': 'Se connecter',
      'comune.esci': 'Se déconnecter'
    },
    es: {
      'menu.upload': 'Subir archivo Excel',
      'menu.dashboard': 'Panel',
      'menu.piani': 'Gestión de planes de descuentos',
      'menu.concorrenti': 'Gestión de competidores',
      'menu.macchinari': 'Equipos',
      'menu.confrontoMacchine': 'Comparación de equipos',
      'menu.confrontoStrutture': 'Comparación de clínicas',
      'menu.cronologia': 'Historial de archivos',

      'pagina.dashboard.titolo': 'Panel',
      'pagina.piani.titolo': 'Gestión de planes de descuentos',
      'pagina.piani.sottotitolo': '{n} planes (activos y desactivados)',
      'pagina.concorrenti.titolo': 'Gestión de competidores',
      'pagina.concorrenti.sottotitolo': '{n} competidores importados',
      'pagina.macchinari.titolo': 'Equipos',
      'pagina.macchinari.sottotitolo': '{mie} tuyos · {loro} de la competencia',
      'pagina.confrontoMacchine.titolo': 'Comparación de equipos',
      'pagina.confrontoMacchine.sottotitolo': '{mie} tuyas · {loro} de la competencia',
      'pagina.confrontoStrutture.titolo': 'Comparación de clínicas',
      'pagina.confrontoStrutture.sottotitolo': '{n} clínicas en la base de datos',
      'pagina.cronologia.titolo': 'Historial de archivos',
      'pagina.cronologia.sottotitolo': 'Todos los archivos subidos',

      'stato.caricamento': 'Cargando...',
      'stato.nessunDato': 'Aún no hay datos',
      'stato.errore': 'Error',
      'stato.erroreCaricamento': 'Error de carga',
      'stato.ospiteAccedi': 'Inicia sesión para {azione}',

      'comune.salva': 'Guardar',
      'comune.annulla': 'Cancelar',
      'comune.elimina': 'Eliminar',
      'comune.modifica': 'Editar',
      'comune.chiudi': 'Cerrar',
      'comune.conferma': 'Confirmar',
      'comune.accedi': 'Iniciar sesión',
      'comune.esci': 'Cerrar sesión'
    }
  };

  let corrente = LINGUE.includes(localStorage.getItem(CHIAVE_MEMORIA))
    ? localStorage.getItem(CHIAVE_MEMORIA)
    : 'it';

  // Chiave mancante in una lingua: si ricade sull'italiano, non sulla chiave
  // grezza. Un testo nella lingua sbagliata e' un difetto; una chiave a schermo
  // e' una rottura.
  function t(chiave, sostituzioni) {
    const testo = (DIZIONARIO[corrente] && DIZIONARIO[corrente][chiave])
      || DIZIONARIO.it[chiave];
    if (testo == null) {
      console.warn('i18n: chiave mancante', chiave);
      return chiave;
    }
    if (!sostituzioni) return testo;
    return testo.replace(/\{(\w+)\}/g, (intero, nome) =>
      sostituzioni[nome] == null ? intero : String(sostituzioni[nome]));
  }

  function impostaLingua(codice) {
    if (!LINGUE.includes(codice) || codice === corrente) return;
    corrente = codice;
    localStorage.setItem(CHIAVE_MEMORIA, codice);
    document.documentElement.lang = codice;
    // Il bottone mostra il codice lingua attivo: va ridisegnato qui, non solo
    // alla chiusura del menu (che avviene con la lingua ancora precedente).
    renderSelettoreLingua();
    if (typeof window.ridisegnaTutto === 'function') window.ridisegnaTutto();
  }

  // ── Selettore lingua ───────────────────────────────
  // Comando compatto (codice in maiuscolo) che apre un elenco con i nomi
  // completi delle quattro lingue. Stato di apertura tenuto qui dentro,
  // ridisegnato a ogni cambio con lo stesso schema di renderSelettoreLingua().
  let menuLinguaAperto = false;

  function selettoreHtml() {
    const voci = LINGUE.map(l => `<div class="${l === corrente ? 'attiva' : ''}" onclick="event.stopPropagation(); sceglieLingua('${l}')">${NOMI[l]}</div>`).join('');
    return `
      <button type="button" class="lang-btn" onclick="apriMenuLingua(event)">🌐 ${corrente.toUpperCase()}</button>
      <div class="lang-menu" ${menuLinguaAperto ? '' : 'hidden'}>${voci}</div>
    `;
  }

  function renderSelettoreLingua() {
    const cont = document.getElementById('selettore-lingua');
    if (cont) cont.innerHTML = selettoreHtml();
  }

  function apriMenuLingua(evento) {
    if (evento) evento.stopPropagation();
    menuLinguaAperto = !menuLinguaAperto;
    renderSelettoreLingua();
  }

  function chiudiMenuLingua() {
    if (!menuLinguaAperto) return;
    menuLinguaAperto = false;
    renderSelettoreLingua();
  }

  function sceglieLingua(codice) {
    chiudiMenuLingua();
    impostaLingua(codice);
  }

  // Un clic fuori dal selettore chiude l'elenco aperto, come il menu account.
  document.addEventListener('click', e => {
    if (!menuLinguaAperto) return;
    if (e.target.closest('#selettore-lingua')) return;
    chiudiMenuLingua();
  });

  window.I18n = { LINGUE, NOMI, t, lingua: () => corrente, impostaLingua, selettoreHtml };
  window.t = t;
  window.apriMenuLingua = apriMenuLingua;
  window.sceglieLingua = sceglieLingua;
})();
