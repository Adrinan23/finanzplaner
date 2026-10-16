// Finanzierung: Immobilienkredite erfassen und Restschuld, Zins-/Tilgungsanteil und Laufzeit berechnen.
// Gespeichert wird im Blatt "Finanzierung" der Tabelle (eine Zeile pro Darlehen).
(function () {
  const ARTEN = [
    { name: 'Annuitätendarlehen', typ: 'annuitaet', info: 'Gleichbleibende Rate, der Zinsanteil sinkt, der Tilgungsanteil steigt.' },
    { name: 'KfW-Förderdarlehen', typ: 'annuitaet', info: 'Wie ein Annuitätendarlehen, oft mit tilgungsfreien Anlaufjahren.' },
    { name: 'Tilgungsdarlehen', typ: 'tilgung', info: 'Gleichbleibende Tilgung, die Rate sinkt mit der Zeit.' },
    { name: 'Endfälliges Darlehen', typ: 'endfaellig', info: 'Nur Zinsen, die ganze Summe wird am Ende (z. B. über einen Sparvertrag) zurückgezahlt.' },
    { name: 'Bauspardarlehen', typ: 'annuitaet', info: 'Darlehen aus einem Bausparvertrag, gleichbleibende Rate.' },
    { name: 'Forward-Darlehen', typ: 'annuitaet', info: 'Anschlussfinanzierung, die erst zu einem späteren Datum beginnt.' },
    { name: 'Privatdarlehen / Sonstiges', typ: 'annuitaet', info: '' }
  ];
  const typ = d => (ARTEN.find(a => a.name === d.art) || ARTEN[0]).typ;
  // Annuität für eine gewünschte Laufzeit in Jahren
  function annuitaetAus(summe, zins, jahre) {
    const r = zins / 1200, n = Math.round(jahre * 12);
    if (!(summe > 0) || !(n > 0)) return 0;
    return r ? summe * r / (1 - Math.pow(1 + r, -n)) : summe / n;
  }
  // Zur Auswahl stehen nur noch diese beiden; ältere Einträge mit anderer Art werden weiter berechnet.
  const AUSWAHL = ['Annuitätendarlehen', 'Endfälliges Darlehen'];
  const jetztIndex = () => { const h = new Date(); return h.getFullYear() * 12 + h.getMonth(); };
  const monatWert = idx => Math.floor(idx / 12) + '-' + String(idx % 12 + 1).padStart(2, '0');

  // Tilgungskonto (endfälliges Darlehen): Guthaben n Monate nach dem Stand, Sparrate am Monatsende, Zinsen monatlich.
  function konto(d, n) {
    const i = (d.sparzins || 0) / 1200, g = d.guthaben || 0, s = d.sparrate || 0;
    if (n <= 0) return g;
    if (!i) return g + s * n;
    const f = Math.pow(1 + i, n);
    return g * f + s * (f - 1) / i;
  }
  // Sparrate, mit der das Konto in n Monaten die Summe erreicht
  function noetigeRate(d, n) {
    if (n <= 0) return null;
    const i = (d.sparzins || 0) / 1200, g = d.guthaben || 0;
    if (!i) return Math.max(0, (d.summe - g) / n);
    const f = Math.pow(1 + i, n);
    return Math.max(0, (d.summe - g * f) * i / (f - 1));
  }

  const euro = (n, nk) => Number(n).toLocaleString('de-DE', { minimumFractionDigits: nk === false ? 0 : 2, maximumFractionDigits: nk === false ? 0 : 2 }) + ' €';
  const pz = n => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' %';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const zahl = v => { const n = Number(String(v || '').replace(/\s|€|%/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const monatText = idx => MONATE[((idx % 12) + 12) % 12] + ' ' + Math.floor(idx / 12);
  // "JJJJ-MM" (so speichert die App) oder eine Datumszahl der Tabelle (Tage seit 30.12.1899), falls direkt dort eingetippt
  const monatIndex = s => {
    const t = String(s === undefined || s === null ? '' : s).trim();
    const m = /^(\d{4})-(\d{1,2})/.exec(t);
    if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
    if (/^\d{4,6}(\.\d+)?$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
    return null;
  };

  // Monatsrate: eingetragen, sonst aus Zins + anfänglicher Tilgung berechnet.
  function rateVon(d) {
    if (d.rate > 0) return d.rate;
    if (typ(d) === 'endfaellig') return d.summe * d.zins / 100 / 12;
    if (typ(d) === 'tilgung') return d.summe * (d.zins + d.tilgung) / 100 / 12;
    return d.summe * (d.zins + d.tilgung) / 100 / 12;
  }

  // Monatlicher Tilgungsplan bis zur Rückzahlung (max. 60 Jahre).
  function plan(d) {
    const r = d.zins / 100 / 12, rate = rateVon(d), t = typ(d);
    const tilgFix = t === 'tilgung' ? (d.tilgung > 0 ? d.summe * d.tilgung / 100 / 12 : Math.max(0, rate - d.summe * r)) : 0;
    const zeilen = [];
    let rest = d.summe;
    for (let i = 0; i < 720 && rest > 0.005; i++) {
      const zins = rest * r;
      let tilg;
      if (t === 'endfaellig') tilg = (d.bindung > 0 && i === d.bindung * 12 - 1) ? rest : 0;
      else if (t === 'tilgung') tilg = Math.min(rest, tilgFix);
      else tilg = Math.min(rest, rate - zins);
      if (tilg <= 0 && t !== 'endfaellig') return { zeilen, rate, deckt: false };
      rest -= tilg;
      zeilen.push({ zins, tilg, rest });
      if (t === 'endfaellig' && !(d.bindung > 0) && i >= 359) break;
    }
    return { zeilen, rate, deckt: true };
  }

  function auswertung(d) {
    const p = plan(d), start = monatIndex(d.beginn), heute = new Date();
    const jetzt = heute.getFullYear() * 12 + heute.getMonth();
    // bezahlte Raten: Monate seit Beginn (die Rate des laufenden Monats zählt erst ab dem nächsten)
    const bezahlt = start === null ? 0 : Math.max(0, Math.min(p.zeilen.length, jetzt - start));
    const bisher = p.zeilen.slice(0, bezahlt);
    const startetNoch = start !== null && start > jetzt;
    // Noch nicht begonnene Darlehen (z. B. Forward) zählen heute nicht als Schuld
    const restHeute = startetNoch ? 0 : (bezahlt ? bisher[bezahlt - 1].rest : d.summe);
    const naechste = p.zeilen[bezahlt] || null;
    const bindEnde = d.bindung > 0 ? Math.min(p.zeilen.length, d.bindung * 12) : 0;
    const restBindung = bindEnde ? p.zeilen[bindEnde - 1].rest : null;
    const fertig = p.deckt && p.zeilen.length && p.zeilen[p.zeilen.length - 1].rest <= 0.005;
    // Tilgungskonto: Guthaben heute und am Rückzahlungsmonat
    let tk = null;
    if (typ(d) === 'endfaellig' && (d.guthaben > 0 || d.sparrate > 0)) {
      const stand = monatIndex(d.guthabenStand);
      const ab = stand === null ? jetzt : stand;
      const endeIdx = start !== null && d.bindung > 0 ? start + d.bindung * 12 - 1 : null;
      const heuteWert = konto(d, jetzt - ab);
      const nEnde = endeIdx === null ? null : endeIdx - ab;
      const endeWert = nEnde === null ? null : konto(d, nEnde);
      tk = { heute: heuteWert, ende: endeWert, reicht: endeWert !== null && endeWert >= d.summe - 0.5,
        fehlt: endeWert === null ? null : Math.max(0, d.summe - endeWert), noetig: nEnde === null ? null : noetigeRate(d, nEnde) };
    }
    return {
      konto: tk,
      rate: p.rate, deckt: p.deckt,
      rateAktuell: naechste && typ(d) === 'tilgung' ? naechste.zins + naechste.tilg : p.rate, restHeute, getilgt: startetNoch ? 0 : d.summe - restHeute,
      zinsenBisher: bisher.reduce((s, z) => s + z.zins, 0),
      zinsenGesamt: p.zeilen.reduce((s, z) => s + z.zins, 0),
      naechste, restBindung,
      bindungEnde: start !== null && d.bindung > 0 ? start + d.bindung * 12 - 1 : null,
      ende: start !== null && fertig ? start + p.zeilen.length - 1 : null,
      laufzeit: fertig ? p.zeilen.length : null,
      startetNoch
    };
  }

  function immobilien(liste) {
    const g = [];
    liste.forEach(d => {
      let i = g.find(x => x.name === d.immobilie);
      if (!i) { i = { name: d.immobilie, kaufpreis: d.kaufpreis, eigenkapital: d.eigenkapital, darlehen: [] }; g.push(i); }
      i.darlehen.push(d);
    });
    return g;
  }

  const zeile = (k, v, extra) => '<div class="fzeile' + (extra ? ' ' + extra : '') + '"><span class="sub">' + k + '</span><span>' + v + '</span></div>';
  const jahreText = m => { const j = Math.floor(m / 12), r = m % 12; return j + ' Jahre' + (r ? ' ' + r + ' Mon.' : ''); };

  function darlehenHtml(d) {
    const a = auswertung(d), endf = typ(d) === 'endfaellig';
    const anteil = d.summe > 0 ? Math.min(100, (endf ? (a.konto ? a.konto.heute : 0) : a.getilgt) / d.summe * 100) : 0;
    let h = '<div class="darlehen"><div class="vkopf"><span class="vname"><b>' + esc(d.art || 'Darlehen') + '</b>' + (d.bank ? ' <span class="sub">' + esc(d.bank) + '</span>' : '') + '</span>' +
      '<span class="betrag">' + euro(a.rateAktuell + (endf ? d.sparrate || 0 : 0)) + ' / Monat</span></div>';
    if (!a.deckt) h += '<div class="sub warnung">⚠ Die Rate deckt die Zinsen nicht. Bitte Rate oder Tilgung prüfen.</div>';
    // Aufteilung der Monatszahlung: Zinsen (Kosten) und Tilgung bzw. Sparrate (Ersparnis)
    const zinsM = a.startetNoch ? d.summe * d.zins / 1200 : (a.naechste ? a.naechste.zins : 0);
    const sparM = endf ? (d.sparrate || 0) : (a.naechste && !a.startetNoch ? a.naechste.tilg : 0);
    if (zinsM + sparM > 0) {
      const zq = zinsM / (zinsM + sparM) * 100;
      h += '<div class="sub">' + (a.startetNoch ? 'Ab ' + monatText(monatIndex(d.beginn)) : 'Diesen Monat') + ':</div>' +
        '<div class="aufteilung"><div class="balken" style="width:' + zq + '%;background:var(--viz-var)"></div><div class="balken" style="width:' + (100 - zq) + '%;background:var(--viz-spar)"></div></div>' +
        '<div class="vergleich-legende sub"><span><span class="punkt" style="background:var(--viz-var)"></span>Zinsen ' + euro(zinsM) + ' (Kosten)</span>' +
        '<span><span class="punkt" style="background:var(--viz-spar)"></span>' + (endf ? 'Sparrate ' + euro(sparM) + ' (Ersparnis)' : 'Tilgung ' + euro(sparM) + ' (gedachte Ersparnis)') + '</span></div>';
    }
    h += '<div class="fortschritt"><div class="balken" style="width:' + Math.max(anteil > 0 ? 1.5 : 0, anteil) + '%;background:var(--viz-spar)"></div></div>' +
      '<div class="sub vwerte">' + pz(anteil) + (endf ? ' auf dem Tilgungskonto angespart' : ' getilgt') + (a.startetNoch ? ' · beginnt ' + monatText(monatIndex(d.beginn)) : '') + '</div>';
    if (endf) {
      const k = a.konto;
      h += '<div class="fraster">' +
        zeile('Darlehenssumme', euro(d.summe, false)) +
        zeile('Sollzins', pz(d.zins)) +
        zeile('Tilgungskonto heute', '<b>' + euro(k ? k.heute : 0, false) + '</b>') +
        zeile('Sparrate', euro(d.sparrate || 0) + (d.sparzins ? ' <span class="sub">(' + pz(d.sparzins) + ' Zinsen)</span>' : '')) +
        zeile('Rückzahlung', a.bindungEnde !== null ? monatText(a.bindungEnde) : '–') +
        zeile('Konto dann', k && k.ende !== null ? euro(k.ende, false) : '–') +
        zeile('Bisher gezahlte Zinsen', euro(a.zinsenBisher, false)) +
        zeile('Zinsen gesamt', d.bindung > 0 ? euro(a.zinsenGesamt, false) : '–') +
        '</div>';
      if (k && k.ende !== null) {
        h += k.reicht
          ? '<div class="ampel gut">✓ Das Tilgungskonto reicht voraussichtlich' + (k.ende - d.summe >= 1 ? ', es bleiben etwa ' + euro(k.ende - d.summe, false) + ' übrig' : '') + '.</div>'
          : '<div class="ampel schlecht">⚠ Am Ende fehlen voraussichtlich ' + euro(k.fehlt, false) + '. Dafür bräuchtest du ' + euro(k.noetig) + ' Sparrate pro Monat statt ' + euro(d.sparrate || 0) + '.</div>';
      } else if (!(d.bindung > 0)) h += '<div class="sub">Trage die Laufzeit bis zur Rückzahlung ein, dann prüft die App, ob das Tilgungskonto reicht.</div>';
      else h += '<div class="sub">Trage Guthaben und Sparrate des Tilgungskontos ein, dann prüft die App, ob es am Ende reicht.</div>';
    } else {
      h += '<div class="fraster">' +
        zeile('Darlehenssumme', euro(d.summe, false)) +
        zeile('Restschuld heute', '<b>' + euro(a.restHeute, false) + '</b>') +
        zeile('Sollzins', pz(d.zins)) +
        zeile('Gedachte Ersparnis', '<b>' + euro(a.getilgt, false) + '</b>') +
        (a.bindungEnde !== null ? zeile('Zinsbindung bis', monatText(a.bindungEnde)) + zeile('Restschuld dann', a.deckt && a.restBindung !== null ? euro(a.restBindung, false) : '–') : '') +
        zeile('Bisher gezahlte Zinsen', euro(a.zinsenBisher, false)) +
        zeile('Zinsen gesamt', a.laufzeit ? euro(a.zinsenGesamt, false) : '–') +
        zeile('Abbezahlt', a.ende !== null ? monatText(a.ende) + ' <span class="sub">(' + jahreText(a.laufzeit) + ')</span>' : '–', 'breit') +
        (d.sonder ? zeile('Sondertilgung erlaubt', pz(d.sonder) + ' pro Jahr = ' + euro(d.summe * d.sonder / 100, false)) : '') +
        '</div>';
    }
    if (a.startetNoch) h += '<div class="sub">Zählt erst ab ' + monatText(monatIndex(d.beginn)) + ' zur Restschuld.</div>';
    if (d.notiz) h += '<div class="sub">' + esc(d.notiz) + '</div>';
    h += '<div class="faktionen"><button class="undo" data-bearbeiten="' + esc(d.id) + '">Bearbeiten</button>' +
      '<button class="undo" data-loeschen="' + esc(d.id) + '">Löschen</button></div></div>';
    return h;
  }

  function ansicht(liste) {
    if (!liste.length) {
      return '<div class="card"><h2>Noch keinen Kredit eingetragen</h2>' +
        '<div class="sub">Trage hier dein Annuitätendarlehen oder endfälliges Darlehen ein. Die App teilt jede Rate in Zinsen (Kosten) und Tilgung bzw. Sparrate (Ersparnis) und zeigt, wie viel dir schon gehört.</div>' +
        '<button class="haupt" id="finNeu">Kredit eintragen</button></div>';
    }
    const ims = immobilien(liste);
    const ausw = liste.map(auswertung);
    const summe = f => liste.reduce((s, d, i) => s + f(d, ausw[i]), 0);
    const endf = d => typ(d) === 'endfaellig';
    const laeuft = (d, a) => !a.startetNoch && (endf(d) ? a.bindungEnde === null || a.bindungEnde >= jetztIndex() : !!a.naechste);
    const echt = summe((d, a) => a.konto ? a.konto.heute : 0);
    const echtM = summe((d, a) => endf(d) ? d.sparrate || 0 : 0);
    const gedacht = summe((d, a) => endf(d) ? 0 : a.getilgt);
    const gedachtM = summe((d, a) => !endf(d) && laeuft(d, a) ? a.naechste.tilg : 0);
    const zinsM = summe((d, a) => laeuft(d, a) && a.naechste ? a.naechste.zins : 0);
    const zinsBisher = summe((d, a) => a.zinsenBisher);
    const fk = summe((d, a) => a.startetNoch ? 0 : d.summe), spaeter = summe((d, a) => a.startetNoch ? d.summe : 0), rest = summe((d, a) => a.restHeute);
    let h = '<div class="kacheln">' +
      '<div class="kachel"><div class="sub">Ersparnis (Tilgungskonten)</div><div class="wert">' + euro(echt, false) + '</div><div class="sub">+ ' + euro(echtM, false) + ' pro Monat</div></div>' +
      '<div class="kachel"><div class="sub">Gedachte Ersparnis (getilgt)</div><div class="wert">' + euro(gedacht, false) + '</div><div class="sub">+ ' + euro(gedachtM, false) + ' pro Monat</div></div>' +
      '<div class="kachel"><div class="sub">Zinsen pro Monat</div><div class="wert">' + euro(zinsM, false) + '</div><div class="sub">bisher ' + euro(zinsBisher, false) + ' gezahlt</div></div>' +
      '<div class="kachel"><div class="sub">Restschuld heute</div><div class="wert">' + euro(rest, false) + '</div><div class="sub">von ' + euro(fk, false) + (spaeter ? ', dazu ' + euro(spaeter, false) + ' später' : '') + '</div></div>' +
      '</div>';
    ims.forEach(i => {
      const ds = i.darlehen, aw = ds.map(auswertung);
      const fkI = ds.reduce((s, d) => s + d.summe, 0), gesamt = i.kaufpreis || (i.eigenkapital + fkI);
      const get = ds.reduce((s, d, k) => s + (endf(d) ? 0 : aw[k].getilgt), 0);
      const kto = aw.reduce((s, a) => s + (a.konto ? a.konto.heute : 0), 0);
      const basis = Math.max(gesamt, i.eigenkapital + fkI, 1);
      const teile = [
        ['Eigenkapital', i.eigenkapital, 'var(--viz-fix)'],
        ['Getilgt', get, 'var(--viz-spar)'],
        ['Tilgungskonto', kto, 'var(--viz-spar);opacity:.5']
      ].filter(t => t[1] > 0);
      const meins = teile.reduce((s, t) => s + t[1], 0);
      h += '<div class="card"><h2>' + esc(i.name) + '</h2>' +
        '<div class="sub">Was dir schon gehört: <b>' + euro(meins, false) + '</b> von ' + euro(basis, false) + ' (' + pz(Math.min(100, meins / basis * 100)) + ')</div>' +
        '<div class="aufteilung">' + teile.map(t => '<div class="balken" style="width:' + Math.min(100, t[1] / basis * 100) + '%;background:' + t[2] + '"></div>').join('') + '</div>' +
        '<div class="vergleich-legende sub">' + teile.map(t => '<span><span class="punkt" style="background:' + t[2] + '"></span>' + t[0] + ' ' + euro(t[1], false) + '</span>').join('') +
        '<span><span class="punkt" style="background:var(--viz-frei)"></span>Noch offen ' + euro(Math.max(0, basis - meins), false) + '</span></div>' +
        (i.kaufpreis ? '<div class="sub">Kaufpreis inkl. Nebenkosten: ' + euro(i.kaufpreis, false) + (Math.abs(i.kaufpreis - i.eigenkapital - fkI) > 1 ? ' · Differenz zu Eigenkapital + Kredit: ' + euro(i.kaufpreis - i.eigenkapital - fkI, false) : '') + '</div>' : '') +
        ds.map(darlehenHtml).join('') + '</div>';
    });
    if (liste.length > 6) h += '<div class="sub">In der Tabelle werden die ersten 6 Kredite berücksichtigt.</div>';
    h += '<button class="haupt" id="finNeu">Weiteren Kredit eintragen</button>' +
      '<button class="zweit" id="finBlatt">Tabelle aktualisieren</button>';
    return h;
  }

  function formular(d, liste) {
    const namen = immobilien(liste).map(i => i.name);
    const zahlText = w => w === 0 || w === undefined || w === '' ? '' : String(Math.round(w * 100) / 100).replace('.', ',');
    const feld = (id, label, wert, extra) => '<label for="' + id + '">' + label + '</label><input id="' + id + '" value="' + esc(zahlText(wert)) + '" ' + (extra || 'inputmode="decimal" autocomplete="off"') + '>';
    const arten = AUSWAHL.indexOf(d.art) < 0 && d.art ? AUSWAHL.concat([d.art]) : AUSWAHL;
    // Annuität und Laufzeit vorbelegen (bei älteren Einträgen aus Tilgung % berechnet)
    const annu = { rate: d.rate, laufzeit: d.laufzeit };
    if (typ(d) !== 'endfaellig' && d.summe > 0 && (d.rate || d.tilgung || d.laufzeit)) {
      annu.rate = Math.round((d.rate > 0 ? d.rate : (d.laufzeit > 0 && !d.tilgung ? annuitaetAus(d.summe, d.zins, d.laufzeit) : rateVon(d))) * 100) / 100;
      if (!(d.laufzeit > 0)) { const p = plan(Object.assign({}, d, { rate: annu.rate })); annu.laufzeit = p.deckt ? Math.round(p.zeilen.length / 12 * 10) / 10 : ''; }
    }
    const kHeute = d.id && typ(d) === 'endfaellig' ? (auswertung(d).konto || { heute: d.guthaben }).heute : d.guthaben;
    return '<div class="card"><h2>' + (d.id ? 'Kredit bearbeiten' : 'Kredit eintragen') + '</h2>' +
      '<label for="fArt">Kreditart</label><select id="fArt">' + arten.map(a => '<option' + (a === d.art ? ' selected' : '') + '>' + a + '</option>').join('') + '</select>' +
      '<div class="sub" id="fArtInfo"></div>' +
      '<label for="fImmo">Immobilie</label><input id="fImmo" list="fImmoListe" placeholder="z. B. Wohnung Hauptstraße" value="' + esc(d.immobilie || '') + '" autocomplete="off">' +
      '<datalist id="fImmoListe">' + namen.map(n => '<option value="' + esc(n) + '">').join('') + '</datalist>' +
      '<div class="zweispaltig"><div>' + feld('fKauf', 'Kaufpreis inkl. NK (€)', d.kaufpreis) + '</div><div>' + feld('fEk', 'Eigenkapital (€)', d.eigenkapital) + '</div></div>' +
      '<label for="fBank">Bank / Kreditgeber</label><input id="fBank" value="' + esc(d.bank || '') + '" autocomplete="off">' +
      '<div class="zweispaltig"><div>' + feld('fSumme', 'Kreditsumme (€)', d.summe) + '</div><div>' + feld('fZins', 'Sollzins (% p.a.)', d.zins) + '</div></div>' +
      '<div id="fNurAnnu"><div class="zweispaltig"><div>' + feld('fLaufzeit', 'Laufzeit (Jahre)', annu.laufzeit, 'inputmode="decimal" autocomplete="off"') + '</div><div>' + feld('fRate', 'Annuität / Monat (€)', annu.rate) + '</div></div>' +
      '<div class="sub" id="fAnnuHinweis">Die Annuität rechnet die App aus Kreditsumme, Sollzins und Laufzeit. Steht in deinem Vertrag eine andere Rate, trag sie ein, dann rechnet die App die Laufzeit aus.</div></div>' +
      '<div class="sub" id="fRateInfo"></div>' +
      '<div class="zweispaltig"><div><label for="fBeginn">Erste Rate (Monat)</label><input id="fBeginn" type="month" value="' + esc(d.beginn || '') + '"></div>' +
      '<div>' + feld('fBind', 'Zinsbindung (Jahre)', d.bindung, 'inputmode="numeric" autocomplete="off"') + '</div></div>' +
      '<div id="fNurEndf"><h3>Tilgungskonto</h3><div class="sub">Hier sparst du parallel an, um den Kredit am Ende auf einmal zurückzuzahlen.</div>' +
      '<div class="zweispaltig"><div>' + feld('fGuthaben', 'Guthaben heute (€)', kHeute) + '</div><div>' + feld('fSparrate', 'Sparrate / Monat (€)', d.sparrate) + '</div></div>' +
      feld('fSparzins', 'Verzinsung des Kontos (% p.a., optional)', d.sparzins) +
      '<div class="sub" id="fKontoInfo"></div></div>' +
      '<div id="fSonderBox">' + feld('fSonder', 'Sondertilgung erlaubt (% p.a., optional)', d.sonder) + '</div>' +
      '<label for="fNotiz">Notiz (optional)</label><input id="fNotiz" value="' + esc(d.notiz || '') + '" autocomplete="off">' +
      '<button class="haupt" id="fSpeichern">Speichern</button><button class="zweit" id="fAbbrechen">Abbrechen</button>' +
      '<div class="meldung" id="fMeldung"></div></div>';
  }

  let liste = [], dateiId = null, ziel = null, laedt = false;
  const $ = id => document.getElementById(id);
  function meldung(t, k) { const m = $('fMeldung') || $('finMeldung'); if (m) { m.textContent = t || ''; m.className = 'meldung ' + (k || ''); } }

  function zeichne() {
    ziel.innerHTML = ansicht(liste) + '<div class="meldung" id="finMeldung"></div>';
    const neu = $('finNeu'); if (neu) neu.onclick = () => bearbeite({});
    const bl = $('finBlatt');
    if (bl) bl.onclick = async () => {
      bl.disabled = true; meldung('Aktualisiere die Tabelle …');
      try { await window.Google.altesBlattEntfernen(dateiId); await window.Google.immobilienErsparnis(dateiId); meldung('Die Immobilien-Zeilen in „Ersparnisse - Rücklagen“ und in der Monatsübersicht sind aktualisiert.', 'ok'); }
      catch (err) { meldung(err.message || String(err), 'fehler'); if (err instanceof window.Google.NichtAngemeldet) window.Google.anmelden(true); }
      bl.disabled = false;
    };
    ziel.querySelectorAll('[data-bearbeiten]').forEach(b => { b.onclick = () => bearbeite(Object.assign({}, liste.find(d => d.id === b.dataset.bearbeiten))); });
    ziel.querySelectorAll('[data-loeschen]').forEach(b => {
      b.onclick = async () => {
        const d = liste.find(x => x.id === b.dataset.loeschen);
        if (!confirm('Darlehen „' + (d.art || '') + (d.bank ? ' ' + d.bank : '') + '“ von „' + d.immobilie + '“ löschen?')) return;
        await speichere(liste.filter(x => x.id !== d.id), 'Gelöscht.');
      };
    });
  }

  function bearbeite(d) {
    ziel.innerHTML = formular(d, liste);
    window.scrollTo(0, 0);
    let quelle = d.laufzeit > 0 && !(d.rate > 0 && Math.abs(d.rate - annuitaetAus(d.summe, d.zins, d.laufzeit)) > 0.01) ? 'laufzeit' : 'rate';
    const info = () => {
      const a = ARTEN.find(x => x.name === $('fArt').value);
      const v = werte(), endf = typ(v) === 'endfaellig';
      $('fArtInfo').textContent = endf
        ? 'Du zahlst jeden Monat nur Zinsen und sparst parallel auf ein Tilgungskonto. Am Ende wird der Kredit damit auf einmal zurückgezahlt.'
        : (v.art === 'Annuitätendarlehen' ? 'Feste Monatsrate (Annuität). Sie teilt sich in Zinsen und Tilgung: Der Zinsanteil sinkt, die Tilgung steigt. Die Tilgung zählt als gedachte Ersparnis.' : (a ? a.info : ''));
      $('fNurAnnu').hidden = endf; $('fNurEndf').hidden = !endf; $('fSonderBox').hidden = endf;
      $('fBind').previousElementSibling.textContent = endf ? 'Laufzeit (Jahre)' : 'Zinsbindung (Jahre)';
      if (!endf && v.summe > 0) {
        // Was zuletzt eingetippt wurde, gilt; das andere Feld rechnet die App aus
        if (quelle === 'laufzeit' && v.laufzeit > 0) {
          v.rate = Math.ceil(annuitaetAus(v.summe, v.zins, v.laufzeit) * 100 - 1e-6) / 100;
          $('fRate').value = v.rate.toFixed(2).replace('.', ',');
        } else if (quelle === 'rate' && v.rate > 0) {
          const p = plan(Object.assign({}, v));
          $('fLaufzeit').value = p.deckt ? String(Math.round(p.zeilen.length / 12 * 10) / 10).replace('.', ',') : '';
        }
      }
      if (endf) {
        $('fRateInfo').textContent = v.summe && v.zins ? 'Zinsen pro Monat: ' + euro(v.summe * v.zins / 1200) : '';
        const p = Object.assign({}, v, { guthabenStand: monatWert(jetztIndex()) });
        const s = monatIndex(v.beginn);
        if (v.summe && v.bindung > 0 && s !== null && (v.guthaben || v.sparrate)) {
          const n = s + v.bindung * 12 - 1 - jetztIndex(), e = konto(p, n);
          $('fKontoInfo').textContent = 'Bis ' + monatText(s + v.bindung * 12 - 1) + ' voraussichtlich ' + euro(e, false) + ' auf dem Konto. ' +
            (e >= v.summe - 0.5 ? 'Das reicht für die Rückzahlung.' : 'Es fehlen ' + euro(v.summe - e, false) + ', nötig wären ' + euro(noetigeRate(p, n)) + ' pro Monat.');
        } else $('fKontoInfo').textContent = '';
      } else {
        const r = v.summe && (v.zins || v.tilgung || v.rate) ? rateVon(Object.assign({}, v)) : 0;
        const z = v.summe * v.zins / 1200;
        const p = r ? plan(Object.assign({}, v, { rate: r })) : null;
        const lz = p && p.deckt ? p.zeilen.length : 0;
        $('fRateInfo').textContent = r ? 'Davon am Anfang ' + euro(z) + ' Zinsen und ' + euro(Math.max(0, r - z)) + ' Tilgung' +
          (v.summe ? ' (' + pz(Math.max(0, r * 12 / v.summe * 100 - v.zins)) + ' Tilgung p.a.)' : '') + (lz ? '. Abbezahlt nach ' + jahreText(lz).replace(/\.$/, '') + '.' : '. Die Rate deckt die Zinsen nicht.') : '';
      }
    };
    const fImmo = $('fImmo');
    fImmo.onchange = () => {
      const i = immobilien(liste).find(x => x.name === fImmo.value.trim());
      if (i) { $('fKauf').value = i.kaufpreis ? String(i.kaufpreis).replace('.', ',') : ''; $('fEk').value = i.eigenkapital ? String(i.eigenkapital).replace('.', ',') : ''; }
    };
    $('fRate').addEventListener('input', () => { quelle = 'rate'; });
    $('fLaufzeit').addEventListener('input', () => { quelle = 'laufzeit'; });
    ziel.querySelectorAll('input, select').forEach(e => e.addEventListener('input', info));
    info();
    $('fAbbrechen').onclick = zeichne;
    $('fSpeichern').onclick = async () => {
      const v = werte(), endf = typ(v) === 'endfaellig';
      if (!v.immobilie) return meldung('Bitte einen Namen für die Immobilie eintragen.', 'fehler');
      if (!(v.summe > 0)) return meldung('Bitte die Kreditsumme eintragen.', 'fehler');
      if (!v.beginn) return meldung('Bitte den Monat der ersten Rate wählen.', 'fehler');
      if (endf) {
        if (!(v.zins > 0)) return meldung('Bitte den Sollzins eintragen.', 'fehler');
        if (!(v.bindung > 0)) return meldung('Bitte die Laufzeit bis zur Rückzahlung eintragen.', 'fehler');
        v.rate = 0; v.tilgung = 0; v.sonder = 0; v.laufzeit = 0;
      } else {
        if (!(v.rate > 0)) return meldung('Bitte die Laufzeit oder die Annuität eintragen.', 'fehler');
        // Laufzeit nur merken, wenn sie eingetragen (nicht aus der Rate berechnet) wurde
        if (quelle !== 'laufzeit') v.laufzeit = 0;
        v.guthaben = 0; v.sparrate = 0; v.sparzins = 0; v.guthabenStand = '';
        if (!(v.laufzeit > 0)) v.laufzeit = 0;
      }
      v.id = d.id || Date.now().toString(36);
      let neu = d.id ? liste.map(x => x.id === d.id ? v : x) : liste.concat([v]);
      // Kaufpreis und Eigenkapital gelten für alle Darlehen derselben Immobilie
      neu = neu.map(x => x.immobilie === v.immobilie ? Object.assign({}, x, { kaufpreis: v.kaufpreis, eigenkapital: v.eigenkapital }) : x);
      $('fSpeichern').disabled = true;
      await speichere(neu, 'Gespeichert.');
    };
  }

  function werte() {
    return {
      immobilie: $('fImmo').value.trim(), kaufpreis: zahl($('fKauf').value), eigenkapital: zahl($('fEk').value),
      art: $('fArt').value, bank: $('fBank').value.trim(), summe: zahl($('fSumme').value), zins: zahl($('fZins').value),
      tilgung: 0, rate: zahl($('fRate').value), beginn: $('fBeginn').value,
      bindung: zahl($('fBind').value), sonder: zahl($('fSonder').value), notiz: $('fNotiz').value.trim(),
      laufzeit: zahl($('fLaufzeit').value), guthaben: zahl($('fGuthaben').value), sparrate: zahl($('fSparrate').value), sparzins: zahl($('fSparzins').value),
      // Das Guthaben gilt ab dem aktuellen Monat; danach rechnet die App mit Sparrate und Zinsen weiter
      guthabenStand: monatWert(jetztIndex())
    };
  }

  async function speichere(neu, text) {
    meldung('Speichere …');
    try {
      await window.Google.finanzierungSpeichern(dateiId, neu);
      liste = neu;
      try { await window.Google.altesBlattEntfernen(dateiId); } catch (err) { console.warn('Altes Arbeitsblatt nicht entfernt', err); }
      // Block "Immobilien" im Blatt "Ersparnisse - Rücklagen"
      try { if (await window.Google.immobilienErsparnis(dateiId)) text += ' Im Blatt „Ersparnisse - Rücklagen“ steht jetzt der Block „Immobilien“.'; }
      catch (err) { console.warn('Ersparnis-Block nicht angelegt', err); text += ' Achtung: ' + (err.message || err); }
      zeichne();
      meldung(text, 'ok');
    } catch (err) {
      const b = $('fSpeichern'); if (b) b.disabled = false;
      meldung(err.message || String(err), 'fehler');
      if (err instanceof window.Google.NichtAngemeldet) window.Google.anmelden(true);
    }
  }

  window.Finanzierung = {
    async zeige(container, id) {
      ziel = container;
      if (id !== dateiId) { liste = []; dateiId = id; }
      if (!navigator.onLine) { ziel.innerHTML = '<div class="card"><div class="sub">Der Bereich Immobilien braucht eine Internetverbindung.</div></div>'; return; }
      if (laedt) return;
      laedt = true;
      ziel.innerHTML = '<div class="card"><div class="sub">Lade Immobilien …</div></div>';
      try { liste = await window.Google.finanzierungLaden(id); zeichne(); }
      catch (err) {
        ziel.innerHTML = '<div class="card"><div class="meldung fehler">' + esc(err.message || String(err)) + '</div></div>';
        if (err instanceof window.Google.NichtAngemeldet) window.Google.anmelden(true);
      } finally { laedt = false; }
    },
    _test: { auswertung, plan, rateVon, ansicht, formular }
  };
})();
