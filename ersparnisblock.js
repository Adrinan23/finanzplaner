// Block "Immobilien" im Blatt "Ersparnisse - Rücklagen": je Kredit aus dem Blatt "Finanzierung" eine Zeile
// mit echter Ersparnis (Tilgungskonto beim endfälligen Darlehen) bzw. gedachter Ersparnis (getilgter Teil beim
// Annuitätendarlehen). Alles Formeln, rechnet also mit dem aktuellen Monat weiter. Spalten wie die Sparziele (B-I),
// dazu J (Zinsen pro Monat) und K (Restschuld).
(function (global) {
  const MARKE = 'Immobilien: Ersparnis und gedachte Ersparnis';
  const MAX = 6;
  const KOPF = ['Kredit', 'Art der Ersparnis', 'Monatliche Sparrate', 'Aktueller Stand', 'Zielbestand (Kreditsumme)', 'Fortschritt',
    'Verbleibende Monate', 'Kommentare', 'Zinsen pro Monat (Kosten)', 'Restschuld heute'];

  // z0: Zeile der Überschrift; gesamt: Zeile "Gesamtsumme" der Sparziele (oder 0)
  function zellen(z0, gesamt) {
    const z = [];
    const setz = (a1, inhalt, extra) => z.push(Object.assign(typeof inhalt === 'string' && inhalt.charAt(0) === '=' ? { a1, f: inhalt } : { a1, v: inhalt }, extra || {}));
    setz('B' + z0, MARKE, { fett: true });
    setz('B' + (z0 + 1), 'Wird automatisch aus dem Blatt „Finanzierung“ berechnet (Eingabe in der App unter „Immobilien“). Gedachte Ersparnis = der schon getilgte Teil des Kredits.', { grau: true });
    const kz = z0 + 2;
    KOPF.forEach((t, i) => setz(String.fromCharCode(66 + i) + kz, t, { kopf: true }));
    const JETZT = '(YEAR(TODAY())*12+MONTH(TODAY())-1)';
    const idx = c => 'IF(ISNUMBER(' + c + '),YEAR(' + c + ')*12+MONTH(' + c + ')-1,VALUE(LEFT(' + c + ',4))*12+VALUE(MID(' + c + ',6,2))-1)';
    for (let k = 0; k < MAX; k++) {
      const r = kz + 1 + k, fz = k + 2, F = c => "'Finanzierung'!" + c + fz;
      const leer = F('A') + '=""';
      const endf = F('D') + '="Endfälliges Darlehen"';
      const zr = '(' + F('G') + '/1200)', rate = 'IF(' + F('I') + '>0,' + F('I') + ',' + F('F') + '*(' + F('G') + '+' + F('H') + ')/1200)';
      const start = idx(F('J')), kk = 'MAX(0,' + JETZT + '-' + start + ')';
      const rest = 'MAX(0,-FV(' + zr + ',' + kk + ',-' + rate + ',' + F('F') + '))';
      const sz = '(' + F('R') + '/1200)', stand = 'IF(' + F('P') + '="",' + JETZT + ',' + idx(F('P')) + ')';
      const konto = n => 'FV(' + sz + ',MAX(0,' + n + '),-' + F('Q') + ',-' + F('O') + ')';
      const ende = '(' + start + '+' + F('K') + '*12-1)';
      const kontoEnde = konto(ende + '-' + stand);
      const vorbei = JETZT + '>' + ende;
      const w = (a, b) => '=IF(' + leer + ',"",IF(' + endf + ',' + a + ',' + b + '))';
      setz('B' + r, '=IF(' + leer + ',"",' + F('A') + '&" · "&' + F('D') + ')');
      setz('C' + r, w('"Tilgungskonto (echte Ersparnis)"', '"Getilgt (gedachte Ersparnis)"'));
      setz('D' + r, w('IF(' + vorbei + ',0,' + F('Q') + ')', 'IF(' + JETZT + '<' + start + ',0,MIN(' + rest + ',' + rate + '-' + rest + '*' + zr + '))'));
      setz('E' + r, w(konto(JETZT + '-' + stand), F('F') + '-' + rest));
      setz('F' + r, '=IF(' + leer + ',"",' + F('F') + ')');
      setz('G' + r, '=IF(OR(' + leer + ',N(F' + r + ')=0),"",E' + r + '/F' + r + ')');
      setz('H' + r, w('MAX(0,' + ende + '-' + JETZT + ')',
        'IF(' + rest + '=0,0,ROUNDUP(ROUND(IF(' + zr + '=0,' + rest + '/' + rate + ',NPER(' + zr + ',-' + rate + ',' + rest + ')),6),0))'));
      setz('I' + r, w('IF(N(' + F('K') + ')=0,"Laufzeit fehlt",IF(' + kontoEnde + '>=' + F('F') + '-1,"Tilgungskonto reicht voraussichtlich","Tilgungskonto reicht voraussichtlich nicht"))',
        'IF(' + rate + '<=' + F('F') + '*' + zr + ',"Rate deckt die Zinsen nicht","")'));
      setz('J' + r, w('IF(' + vorbei + ',0,' + F('F') + '*' + zr + ')', 'IF(' + JETZT + '<' + start + ',0,' + rest + '*' + zr + ')'));
      setz('K' + r, w('IF(' + vorbei + ',0,' + F('F') + ')', 'IF(' + JETZT + '<' + start + ',0,' + rest + ')'));
    }
    const s = kz + MAX + 1, von = kz + 1, bis = kz + MAX;
    setz('B' + s, 'Summe Immobilien', { fett: true });
    ['D', 'E', 'F', 'J', 'K'].forEach(c => setz(c + s, '=SUM(' + c + von + ':' + c + bis + ')', { fett: true }));
    setz('G' + s, '=IF(F' + s + '>0,E' + s + '/F' + s + ',"")', { fett: true });
    if (gesamt) {
      setz('B' + (s + 1), 'Alle Ersparnisse inkl. Immobilien', { fett: true });
      setz('D' + (s + 1), '=N(D' + gesamt + ')+D' + s, { fett: true });
      setz('E' + (s + 1), '=N(E' + gesamt + ')+E' + s, { fett: true });
    }
    return z;
  }

  // Zeile im Sparbereich der Monatsübersicht: Ersparnis aller Kredite im Monat der Spalte X
  // (Tilgung beim Annuitätendarlehen, Sparrate aufs Tilgungskonto beim endfälligen Darlehen).
  const ZEILE_MONAT = 'Tilgung Immobilie (automatisch)';
  const ZEILE_ZINSEN = 'Zinsen Immobilienkredit (automatisch)';
  const MARKE_MONAT_ALT = 'IMMOBILIEN: ERSPARNIS UND GEDACHTE ERSPARNIS';
  // zinsen=true: stattdessen die Zinsen aller Kredite im Monat (für die Fixkosten)
  function monatsFormel(X, datum, zinsen) {
    const idx = c => 'IF(ISNUMBER(' + c + '),YEAR(' + c + ')*12+MONTH(' + c + ')-1,VALUE(LEFT(' + c + ',4))*12+VALUE(MID(' + c + ',6,2))-1)';
    const M = '(YEAR(' + X + '$' + datum + ')*12+MONTH(' + X + '$' + datum + ')-1)';
    const teile = [];
    for (let k = 0; k < MAX; k++) {
      const fz = k + 2, F = c => "'Finanzierung'!" + c + fz;
      const zr = '(' + F('G') + '/1200)', rate = 'IF(' + F('I') + '>0,' + F('I') + ',' + F('F') + '*(' + F('G') + '+' + F('H') + ')/1200)';
      const start = idx(F('J')), kk = '(' + M + '-' + start + ')', ende = '(' + start + '+N(' + F('K') + ')*12-1)';
      const rest = 'MAX(0,-FV(' + zr + ',' + kk + ',-' + rate + ',' + F('F') + '))';
      const endf = zinsen ? F('F') + '*' + zr : 'N(' + F('Q') + ')';
      const annu = zinsen ? rest + '*' + zr : 'IF(' + rest + '=0,0,MIN(' + rest + ',' + rate + '-' + rest + '*' + zr + '))';
      teile.push('IF(' + F('A') + '="",0,IF(' + F('D') + '="Endfälliges Darlehen",IF(AND(' + M + '>=' + start + ',' + M + '<=' + ende + '),' + endf + ',0),IF(' + kk + '<0,0,' + annu + ')))');
    }
    return '=ROUND(' + teile.join('+') + ',2)';
  }

  global.ErsparnisBlock = { MARKE, MAX, KOPF, zellen, ZEILEN: 2 + 1 + MAX + 2, ZEILE_MONAT, ZEILE_ZINSEN, MARKE_MONAT_ALT, monatsFormel };
})(typeof window !== 'undefined' ? window : globalThis);
