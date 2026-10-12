// Dashboard ("Übersicht"): Kennzahlen und Grafiken fuer einen gewaehlten Monat,
// verglichen mit dem Vormonat. Berechnet alles aus der Monatsuebersicht der Tabelle.
(function () {
  const ARTEN = [
    { key: 'fix', name: 'Fixkosten', farbe: 'var(--viz-fix)' },
    { key: 'variabel', name: 'Variable Kosten', farbe: 'var(--viz-var)' },
    { key: 'sparen', name: 'Sparen', farbe: 'var(--viz-spar)' }
  ];
  const KURZ = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  const euro = (n, nachkomma) => Number(n).toLocaleString('de-DE', {
    minimumFractionDigits: nachkomma === false ? 0 : 2, maximumFractionDigits: nachkomma === false ? 0 : 2
  }) + ' €';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const prozent = n => (Math.round(n * 10) / 10).toLocaleString('de-DE') + ' %';

  function veraenderung(jetzt, vorher) {
    if (!vorher) return jetzt ? 'neu' : '–';
    const p = (jetzt - vorher) / Math.abs(vorher) * 100;
    if (Math.abs(p) < 0.05) return '± 0 %';
    return (p > 0 ? '▲ ' : '▼ ') + prozent(Math.abs(p));
  }

  // Summen je Art (einnahmen, fix, variabel, sparen) fuer Monat m (1-12)
  function summen(daten, art, m) {
    const s = { einnahmen: 0, fix: 0, variabel: 0, sparen: 0 };
    if (m < 1) return null;
    daten.bereiche.forEach(b => { const a = art(b); b.posten.forEach(p => { s[a] += p.werte[m - 1] || 0; }); });
    s.ausgaben = s.fix + s.variabel;
    s.saldo = s.einnahmen - s.fix - s.variabel - s.sparen;
    return s;
  }

  // 1. Kennzahl-Kacheln
  function kacheln(jetzt, vorher, vormonat) {
    const k = [
      ['Einnahmen', 'einnahmen'], ['Ausgaben', 'ausgaben'], ['Sparen', 'sparen'], ['Freier Saldo', 'saldo']
    ];
    return '<div class="kacheln">' + k.map(([titel, key]) =>
      '<div class="kachel"><div class="sub">' + titel + '</div>' +
      '<div class="wert' + (key === 'saldo' && jetzt.saldo < 0 ? ' minus' : '') + '">' + euro(jetzt[key]) + '</div>' +
      '<div class="sub">' + (vorher ? veraenderung(jetzt[key], vorher[key]) + ' ggü. ' + vormonat : 'kein Vormonat') + '</div></div>'
    ).join('') + '</div>';
  }

  // 2. Ring: Anteile von Fixkosten, Variabel, Sparen (und frei) an den Einnahmen
  function ring(jetzt) {
    const teile = ARTEN.map(a => ({ name: a.name, farbe: a.farbe, wert: Math.max(0, jetzt[a.key]) }));
    const verbraucht = teile.reduce((x, t) => x + t.wert, 0);
    const basis = jetzt.einnahmen > 0 ? Math.max(jetzt.einnahmen, verbraucht) : verbraucht;
    if (jetzt.einnahmen > verbraucht) teile.push({ name: 'Frei', farbe: 'var(--viz-frei)', wert: jetzt.einnahmen - verbraucht });
    if (!basis) return '<div class="sub">Für diesen Monat ist noch nichts eingetragen.</div>';
    const r = 54, u = 2 * Math.PI * r;
    let start = 0;
    const boegen = teile.filter(t => t.wert > 0).map(t => {
      const laenge = t.wert / basis * u;
      const luecke = Math.min(2, laenge / 2);
      const s = '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + t.farbe + '" stroke-width="18" ' +
        'stroke-dasharray="' + Math.max(0, laenge - luecke) + ' ' + (u - laenge + luecke) + '" stroke-dashoffset="' + (-start) + '" ' +
        'transform="rotate(-90 70 70)"><title>' + esc(t.name + ': ' + euro(t.wert) + ' (' + prozent(t.wert / basis * 100) + ')') + '</title></circle>';
      start += laenge;
      return s;
    }).join('');
    const mitte = jetzt.einnahmen > 0 ? ['Einnahmen', euro(jetzt.einnahmen, false)] : ['Ausgaben', euro(verbraucht, false)];
    const hinweis = jetzt.einnahmen > 0 && verbraucht > jetzt.einnahmen
      ? '<div class="sub warnung">⚠ Ausgaben und Sparen liegen ' + euro(verbraucht - jetzt.einnahmen) + ' über den Einnahmen.</div>' : '';
    return '<div class="ring"><svg viewBox="0 0 140 140" role="img" aria-label="Aufteilung der Einnahmen">' +
      '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="18"/>' + boegen +
      '<text x="70" y="66" text-anchor="middle" class="t-klein">' + mitte[0] + '</text>' +
      '<text x="70" y="84" text-anchor="middle" class="t-gross">' + mitte[1] + '</text></svg>' +
      '<ul class="legende">' + teile.map(t =>
        '<li><span class="punkt" style="background:' + t.farbe + '"></span><span class="info">' + t.name + '</span>' +
        '<span class="betrag">' + euro(t.wert, false) + '</span><span class="sub anteil">' + prozent(t.wert / basis * 100) + '</span></li>').join('') +
      '</ul></div>' + hinweis;
  }

  // 3. Bereiche: Vormonat vs. aktueller Monat
  function bereichsVergleich(daten, art, m, vormonat, monatName) {
    const zeilen = daten.bereiche.filter(b => art(b) !== 'einnahmen').map(b => {
      const a = ARTEN.find(x => x.key === art(b));
      const summe = mm => mm < 1 ? 0 : b.posten.reduce((x, p) => x + (p.werte[mm - 1] || 0), 0);
      return { name: b.name.replace(/^\d+\.\s*/, '').replace(/^(FIXKOSTEN|VARIABLE KOSTEN):\s*/i, ''), farbe: a.farbe, jetzt: summe(m), vorher: summe(m - 1) };
    });
    const max = Math.max(1, ...zeilen.map(z => Math.max(z.jetzt, z.vorher)));
    return '<div class="vergleich-legende sub"><span><span class="punkt grau"></span>' + (vormonat || 'Vormonat') + '</span>' +
      '<span><span class="punkt" style="background:var(--text)"></span>' + monatName + ' (Farbe = Art)</span></div>' +
      zeilen.map(z => {
        const w = v => Math.max(v > 0 ? 1.5 : 0, v / max * 100);
        return '<div class="vzeile"><div class="vkopf"><span class="vname">' + esc(z.name) + '</span>' +
          '<span class="sub">' + (m > 1 ? veraenderung(z.jetzt, z.vorher) : '') + '</span></div>' +
          '<div class="balken grau" style="width:' + w(z.vorher) + '%" title="' + esc((vormonat || 'Vormonat') + ': ' + euro(z.vorher)) + '"></div>' +
          '<div class="balken" style="width:' + w(z.jetzt) + '%;background:' + z.farbe + '" title="' + esc(monatName + ': ' + euro(z.jetzt)) + '"></div>' +
          '<div class="sub vwerte">' + euro(z.vorher, false) + ' → <b>' + euro(z.jetzt, false) + '</b></div></div>';
      }).join('');
  }

  // 4. Top 5 Ausgaben des Monats
  function top5(daten, art, m) {
    const liste = [];
    daten.bereiche.forEach(b => {
      const a = art(b); if (a === 'einnahmen') return;
      const farbe = ARTEN.find(x => x.key === a).farbe;
      b.posten.forEach(p => { if ((p.werte[m - 1] || 0) > 0) liste.push({ name: p.bezeichnung, kat: p.kategorie, wert: p.werte[m - 1], farbe }); });
    });
    liste.sort((x, y) => y.wert - x.wert);
    const top = liste.slice(0, 5);
    if (!top.length) return '<div class="sub">Für diesen Monat ist noch nichts eingetragen.</div>';
    const max = top[0].wert;
    return top.map((t, i) =>
      '<div class="tzeile"><div class="vkopf"><span class="vname">' + (i + 1) + '. ' + esc(t.name) + ' <span class="sub">(' + esc(t.kat) + ')</span></span>' +
      '<span class="betrag">' + euro(t.wert) + '</span></div>' +
      '<div class="balken" style="width:' + Math.max(1.5, t.wert / max * 100) + '%;background:' + t.farbe + '"></div></div>').join('');
  }

  // 5. Jahresverlauf: gestapelte Saeulen (Fix, Variabel, Sparen) + Linie Einnahmen
  function jahr(daten, art, m) {
    const s = [];
    for (let i = 1; i <= 12; i++) s.push(summen(daten, art, i));
    const max = Math.max(1, ...s.map(x => Math.max(x.einnahmen, x.fix + x.variabel + x.sparen)));
    const schritt = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find(x => max / x <= 4) || Math.ceil(max / 4);
    const oben = Math.ceil(max / schritt) * schritt;
    const W = 340, H = 180, L = 40, R = 6, T = 8, B = 22, pw = W - L - R, ph = H - T - B;
    const y = v => T + ph - v / oben * ph;
    const bx = i => L + pw / 12 * i + pw / 12 * 0.18, bw = pw / 12 * 0.64;
    let svg = '';
    for (let v = 0; v <= oben; v += schritt) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="gitter"/>' +
        '<text x="' + (L - 4) + '" y="' + (y(v) + 3) + '" text-anchor="end" class="t-achse">' + (v >= 1000 ? (v / 1000).toLocaleString('de-DE') + 'k' : v) + '</text>';
    }
    s.forEach((x, i) => {
      let basis = 0;
      const tip = daten.monate[i].name + '\nEinnahmen: ' + euro(x.einnahmen) + '\nFixkosten: ' + euro(x.fix) +
        '\nVariable Kosten: ' + euro(x.variabel) + '\nSparen: ' + euro(x.sparen) + '\nSaldo: ' + euro(x.saldo);
      svg += '<g class="saeule' + (i + 1 === m ? ' aktiv' : '') + '"><title>' + esc(tip) + '</title>' +
        '<rect x="' + (L + pw / 12 * i) + '" y="' + T + '" width="' + (pw / 12) + '" height="' + ph + '" fill="transparent"/>';
      ARTEN.forEach(a => {
        const v = Math.max(0, x[a.key]); if (!v) return;
        const h = v / oben * ph;
        svg += '<rect x="' + bx(i) + '" y="' + (y(basis + v) + 1) + '" width="' + bw + '" height="' + Math.max(0.5, h - 1) + '" rx="1.5" fill="' + a.farbe + '"/>';
        basis += v;
      });
      svg += '<text x="' + (bx(i) + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" class="t-achse' + (i + 1 === m ? ' t-aktiv' : '') + '">' + KURZ[i] + '</text></g>';
    });
    const punkte = s.map((x, i) => [bx(i) + bw / 2, y(x.einnahmen)]);
    svg += '<polyline points="' + punkte.map(p => p.join(',')).join(' ') + '" class="linie"/>' +
      punkte.map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" class="linienpunkt"/>').join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="jahr" role="img" aria-label="Jahresverlauf">' + svg + '</svg>' +
      '<div class="vergleich-legende sub">' + ARTEN.map(a => '<span><span class="punkt" style="background:' + a.farbe + '"></span>' + a.name + '</span>').join('') +
      '<span><span class="punkt linie-punkt"></span>Einnahmen</span></div>' +
      '<div class="sub">Tippe auf einen Monat für die Details.</div>';
  }

  // 6. Sparziele
  function sparziele(ziele) {
    if (!ziele) return '<div class="sub">Lade Sparziele …</div>';
    if (!ziele.length) return '<div class="sub">Keine Sparziele in der Tabelle gefunden.</div>';
    return ziele.map(z => {
      const anteil = z.ziel > 0 ? Math.min(100, z.stand / z.ziel * 100) : 0;
      return '<div class="tzeile"><div class="vkopf"><span class="vname">' + esc(z.name) + (z.verwendung ? ' <span class="sub">(' + esc(z.verwendung) + ')</span>' : '') + '</span>' +
        '<span class="sub">' + prozent(anteil) + '</span></div>' +
        '<div class="fortschritt"><div class="balken" style="width:' + Math.max(anteil > 0 ? 1.5 : 0, anteil) + '%;background:var(--viz-spar)"></div></div>' +
        '<div class="sub vwerte">' + euro(z.stand, false) + ' von ' + euro(z.ziel, false) + (z.rate ? ' · ' + euro(z.rate, false) + ' pro Monat' : '') + '</div></div>';
    }).join('');
  }

  function karte(titel, inhalt) { return '<div class="card"><h2>' + titel + '</h2>' + inhalt + '</div>'; }

  window.Dashboard = {
    render(ziel, daten, art, m, ziele) {
      const jetzt = summen(daten, art, m), vorher = m > 1 ? summen(daten, art, m - 1) : null;
      const monatName = daten.monate[m - 1].name, vormonat = m > 1 ? daten.monate[m - 2].name : '';
      ziel.innerHTML =
        kacheln(jetzt, vorher, vormonat) +
        karte('Wofür ging das Geld drauf?', ring(jetzt)) +
        karte('Bereiche: ' + (vormonat || '–') + ' → ' + monatName, m > 1 ? bereichsVergleich(daten, art, m, vormonat, monatName) : '<div class="sub">Für Januar gibt es in dieser Datei keinen Vormonat.</div>' + bereichsVergleich(daten, art, m, '', monatName)) +
        karte('Top 5 Ausgaben im ' + monatName, top5(daten, art, m)) +
        karte('Jahresverlauf', jahr(daten, art, m)) +
        karte('Sparziele', sparziele(ziele));
    }
  };
})();
