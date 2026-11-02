// Finanzplaner: Turnus automatisch verteilen (Version 3)
// Traegst du in einer Zeile einen Betrag in einen Monat ein, schreibt dieses Skript denselben Betrag
// je nach Turnus (Spalte D) in die Folgemonate bis Dezember:
//   Monatlich = jeden Monat, alle 2 Monate, Quartalsweise = alle 3, alle 4 Monate, Halbjährlich = alle 6.
//   Variabel und Jährlich verteilen nichts.
// Vom Skript eingetragene Zellen bekommen die Notiz "Automatisch (Turnus)". Wechselst du den Turnus
// oder aenderst/loeschst du einen Betrag, werden diese Zellen geleert und neu verteilt.
// Ein selbst eingetragener Betrag gilt ab seinem Monat bis zum naechsten selbst eingetragenen Monat
// (z. B. Januar 1000, Mai 1500: Februar-April 1000, Juni-Dezember 1500).
// Selbst eingetragene Monate werden nie ueberschrieben.

const AUTO_NOTIZ_ = 'Automatisch (Turnus)';

function abstandAusTurnus_(text) {
  const t = String(text || '').toLowerCase();
  if (/variabel/.test(t)) return 0;
  if (/zweimonat|alle 2 monat/.test(t)) return 2;
  if (/quartal|viertelj/.test(t)) return 3;
  if (/alle 4 monat/.test(t)) return 4;
  if (/halbj/.test(t)) return 6;
  if (/^\s*monatlich/.test(t)) return 1;
  return 0;
}

function onEdit(e) {
  if (!e || !e.range) return;
  const blatt = e.range.getSheet();
  if (!/^Monats/i.test(blatt.getName())) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  // Kopfzeile mit "Januar" suchen (wie die App)
  const kopf = blatt.getRange(1, 1, 15, 30).getDisplayValues();
  let kopfZeile = -1, jan = -1;
  for (let r = 0; r < kopf.length && kopfZeile < 0; r++) {
    const c = kopf[r].findIndex(v => String(v).trim() === 'Januar');
    if (c >= 0) { kopfZeile = r + 1; jan = c + 1; }
  }
  if (kopfZeile < 0) return;
  const zeile = e.range.getRow(), spalte = e.range.getColumn();
  if (zeile <= kopfZeile + 1) return;
  const turnusSpalte = jan - 1; // Spalte D, direkt links von Januar
  const istMonat = spalte >= jan && spalte < jan + 12;
  if (spalte !== turnusSpalte && !istMonat) return;
  // Zeilen, die sich selbst rechnen, nicht anfassen
  if (/\(automatisch\)\s*$/.test(String(blatt.getRange(zeile, turnusSpalte - 1).getValue()))) return;

  // Selbst ueberschriebene Zelle gilt nicht mehr als automatisch
  if (istMonat && e.range.getNote() === AUTO_NOTIZ_) e.range.clearNote();

  const monate = blatt.getRange(zeile, jan, 1, 12);
  const werte = monate.getValues()[0], formeln = monate.getFormulas()[0], notizen = monate.getNotes()[0];
  const abstand = abstandAusTurnus_(blatt.getRange(zeile, turnusSpalte).getValue());

  // Bisher automatisch verteilte Werte entfernen
  notizen.forEach((n, m) => {
    if (n !== AUTO_NOTIZ_) return;
    blatt.getRange(zeile, jan + m).clearContent().clearNote();
    werte[m] = ''; formeln[m] = '';
  });
  if (!abstand) return;

  // Jeder selbst eingetragene Betrag gilt ab seinem Monat im Rhythmus weiter,
  // bis zum naechsten selbst eingetragenen Monat (z. B. Gehaltserhoehung ab Mai)
  const selbst = [];
  werte.forEach((w, m) => { if (w !== '' || formeln[m] !== '') selbst.push(m); });
  selbst.forEach((start, i) => {
    const betrag = werte[start];
    if (typeof betrag !== 'number' || !betrag) return;
    const ende = i + 1 < selbst.length ? selbst[i + 1] : 12;
    for (let m = start + abstand; m < ende; m += abstand) {
      blatt.getRange(zeile, jan + m).setValue(betrag).setNote(AUTO_NOTIZ_);
    }
  });
}
