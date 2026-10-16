// Oberflaeche der Finanzplaner-App.
(function () {
  const G = window.Google;
  const $ = id => document.getElementById(id);
  const merke = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  const hole = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const euro = n => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

  let dateien = {};   // { '2026': {id, name, webViewLink} }
  let jahr = null;    // gewaehltes Jahr
  let daten = null;   // Struktur der Tabelle des gewaehlten Jahres
  let modus = 'variabel';

  function meldung(text, klasse, ziel) { const m = $(ziel || 'meldung'); m.textContent = text || ''; m.className = 'meldung ' + (klasse || ''); }
  function zeige(bereiche) {
    ['anmeldung', 'einrichten', 'formular', 'verlauf', 'fuss'].forEach(id => { $(id).hidden = bereiche.indexOf(id) < 0; });
    if (bereiche.indexOf('formular') < 0) { $('hinweisVorlage').hidden = true; $('uebersicht').hidden = true; $('finanzierung').hidden = true; }
    const app = bereiche.indexOf('formular') >= 0;
    $('leiste').hidden = !app; $('jahr').hidden = !app;
    document.body.classList.toggle('mit-leiste', app);
  }

  // ---------- Offline ----------
  // Ohne Internet: zuletzt geladener Stand (Posten, Verlauf) aus dem Speicher, neue Eintraege in eine
  // Warteschlange. Sobald wieder Internet da ist, werden sie der Reihe nach eingetragen.
  // Live und Test teilen sich die Adresse adrinan23.github.io, deshalb getrennte Schluessel.
  const NR = G.TEST ? '.test' : '';
  const STAND = 'kosten.stand' + NR, WS = 'kosten.warteschlange' + NR;
  const offline = () => navigator.onLine === false;
  const netzFehler = err => offline() || (err instanceof TypeError && /fetch|network|load failed/i.test(err.message));
  function warteschlange() { try { return JSON.parse(hole(WS) || '[]'); } catch (e) { return []; } }
  function setzeWarteschlange(l) { merke(WS, JSON.stringify(l)); }
  let letzterVerlauf = [];
  let offlineGestartet = false;

  function merkeStand() {
    merke(STAND, JSON.stringify({ email: hole('kosten.email'), dateien: dateien, jahr: jahr, daten: daten, verlauf: letzterVerlauf }));
  }

  function zeigeOffline() { $('offlineBalken').hidden = !offline(); }
  window.addEventListener('offline', zeigeOffline);
  window.addEventListener('online', async () => {
    zeigeOffline();
    if (!daten) return;
    if (offlineGestartet) {
      // Die App lief bisher nur mit dem gespeicherten Stand: jetzt richtig laden.
      if (!G.token()) { fehler(new G.NichtAngemeldet()); return; }
      try {
        await G.nutzer();
        dateien = await G.meineDateien();
        offlineGestartet = false;
        await ladeJahr(dateien[jahr] ? jahr : standardJahr());
      } catch (err) { fehler(err); return; }
    }
    synchronisiere();
  });

  function inWarteschlange(eintrag) {
    const l = warteschlange();
    l.push(Object.assign({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), email: hole('kosten.email'), jahr: jahr, dateiId: dateien[jahr].id, zeit: new Date().toISOString() }, eintrag));
    setzeWarteschlange(l);
  }

  let synchronLaeuft = false;
  async function synchronisiere() {
    if (synchronLaeuft || offline() || offlineGestartet) return;
    const email = hole('kosten.email');
    const offen = warteschlange().filter(e => e.email === email && !e.fehler);
    if (!offen.length) return;
    if (!G.token()) { fehler(new G.NichtAngemeldet()); return; }
    synchronLaeuft = true;
    let fertig = 0, probleme = 0;
    for (const e of offen) {
      if (offline()) break;
      meldung('Trage wartende Einträge ein (' + (fertig + 1) + ' von ' + offen.length + ') …');
      const status = {};
      try {
        await G.hinzufuegen(e.dateiId, e, status);
        setzeWarteschlange(warteschlange().filter(x => x.id !== e.id));
        fertig++;
      } catch (err) {
        if (err instanceof G.NichtAngemeldet) { synchronLaeuft = false; fehler(err); return; }
        if (netzFehler(err) && !status.geschrieben) break;
        // Bleibt mit Fehler in der Liste, damit nichts doppelt eingetragen wird.
        setzeWarteschlange(warteschlange().map(x => x.id === e.id ? Object.assign(x, {
          fehler: netzFehler(err) ? 'Verbindung abgebrochen. Bitte in der Tabelle prüfen, ob der Betrag schon drinsteht.' : (err.message || String(err))
        }) : x));
        probleme++;
      }
    }
    synchronLaeuft = false;
    try {
      if (fertig) {
        const id = dateien[jahr].id;
        aktualisiere(await G.struktur(id), await G.verlauf(id));
      } else zeigeVerlauf(letzterVerlauf);
    } catch (err) { console.warn('Nach dem Eintragen nicht neu geladen', err); zeigeVerlauf(letzterVerlauf); }
    const rest = warteschlange().filter(e => e.email === email && !e.fehler).length;
    meldung((fertig ? fertig + (fertig === 1 ? ' wartender Eintrag wurde' : ' wartende Einträge wurden') + ' eingetragen.' : '') +
      (probleme ? (fertig ? '\n' : '') + probleme + ' Eintrag/Einträge konnten nicht eingetragen werden, siehe „Letzte Einträge“.' : '') +
      (rest && !probleme ? (fertig ? '\n' : '') + rest + ' Eintrag/Einträge warten noch auf Internet.' : ''), probleme ? 'fehler' : 'ok');
  }

  // Neue Struktur und Verlauf uebernehmen, ohne die Auswahl im Formular zu verlieren.
  function aktualisiere(struktur, verlauf) {
    const pi = $('posten').value, bi = $('bereich').value;
    daten = struktur;
    if (modus === 'uebersicht') { zeigeDashboard(); zeigeVerlauf(verlauf); return; }
    fuelleBereiche(); $('bereich').value = bi; fuellePosten(); $('posten').value = pi; zeigeBisher();
    zeigeVerlauf(verlauf);
  }

  // Bei abgelaufener Anmeldung: Eingabe merken und kurz zu Google und zurueck.
  function fehler(err, ziel) {
    if (netzFehler(err) && !(err instanceof G.NichtAngemeldet)) {
      meldung('Keine Internetverbindung. Neue Einträge werden gespeichert und später eingetragen; anderes geht erst wieder mit Internet.', 'fehler', ziel);
      $('speichern').disabled = false;
      return;
    }
    if (err instanceof G.NichtAngemeldet) {
      if (offline()) { meldung('Keine Internetverbindung.', 'fehler', ziel); $('speichern').disabled = false; return; }
      try { sessionStorage.setItem('kosten.entwurf', JSON.stringify({ betrag: $('betrag').value, jahr: jahr })); } catch (e) { }
      G.anmelden(true);
      return;
    }
    console.error(err);
    meldung(err.message || String(err), 'fehler', ziel);
    $('speichern').disabled = false;
  }

  // ---------- Bereiche, Tabs, Posten ----------

  function art(b) {
    if (/EINNAHMEN/i.test(b.name)) return 'einnahmen';
    if (/FIXKOSTEN/i.test(b.name)) return 'fix';
    if (/VARIABLE/i.test(b.name)) return 'variabel';
    return 'sparen';
  }
  const MODI = {
    einnahmen: { titel: 'Einnahmen', knopf: 'Einnahme hinzufügen' },
    fix: { titel: 'Fixkosten', knopf: 'Fixkosten hinzufügen' },
    variabel: { titel: 'Variable Kosten', knopf: 'Kosten hinzufügen' },
    sparen: { titel: 'Sparen', knopf: 'Sparbetrag hinzufügen' }
  };
  const tabs = document.querySelectorAll('#leiste button');

  function bereich() { return daten.bereiche[$('bereich').value]; }
  function posten() { const b = bereich(); return b ? b.posten[$('posten').value] : null; }

  function zeigeBisher() {
    const p = posten(); if (!p) { $('bisher').textContent = ''; return; }
    const m = Number($('monat').value);
    $('bisher').textContent = 'Bisher im ' + daten.monate[m - 1].name + ': ' + euro(p.werte[m - 1]);
  }

  function fuellePosten() {
    const b = bereich(), sel = $('posten');
    sel.innerHTML = '';
    // Zeilen mit „(automatisch)“ rechnen sich selbst und werden nicht zum Eintragen angeboten
    b.posten.forEach((p, i) => { if (!p.auto) sel.add(new Option(p.bezeichnung + ' (' + p.kategorie + ')', i)); });
    const gemerkt = hole('posten:' + b.name);
    if (gemerkt !== null && gemerkt < b.posten.length && !b.posten[gemerkt].auto) sel.value = gemerkt;
    zeigeBisher();
  }

  function fuelleBereiche() {
    const sel = $('bereich'); sel.innerHTML = '';
    daten.bereiche.forEach((b, i) => { if (art(b) === modus) sel.add(new Option(b.name.replace(/^\d+\.\s*/, ''), i)); });
    const gemerkt = hole('bereich:' + modus);
    if (gemerkt !== null && [].some.call(sel.options, o => o.value === gemerkt)) sel.value = gemerkt;
    $('bereichFeld').hidden = sel.options.length <= 1;
    if (sel.options.length) fuellePosten(); else { $('posten').innerHTML = ''; $('bisher').textContent = ''; }
  }

  function setzeModus(m) {
    const gibt = x => x === 'uebersicht' || x === 'finanzierung' || daten.bereiche.some(b => art(b) === x);
    modus = (MODI[m] || m === 'uebersicht' || m === 'finanzierung') && gibt(m) ? m : 'variabel';
    merke('modus', modus);
    tabs.forEach(t => { t.classList.toggle('aktiv', t.dataset.modus === modus); t.hidden = !gibt(t.dataset.modus); });
    const dash = modus === 'uebersicht', fin = modus === 'finanzierung';
    $('formular').hidden = dash || fin; $('verlauf').hidden = dash || fin; $('uebersicht').hidden = !dash; $('finanzierung').hidden = !fin;
    if (dash) { $('titel').textContent = 'Übersicht'; zeigeDashboard(); return; }
    if (fin) { $('titel').textContent = 'Immobilien'; window.Finanzierung.zeige($('finanzierung'), dateien[jahr].id); return; }
    $('titel').textContent = MODI[modus].titel;
    $('speichern').textContent = MODI[modus].knopf;
    meldung('');
    fuelleBereiche();
  }
  tabs.forEach(t => { t.onclick = () => { setzeModus(t.dataset.modus); window.scrollTo(0, 0); }; });

  // ---------- Uebersicht (Dashboard) ----------

  let ziele = null, zieleJahr = null;
  function zeigeDashboard() {
    const sel = $('dashMonat');
    if (sel.options.length !== 12 || sel.dataset.jahr !== jahr) {
      sel.innerHTML = '';
      daten.monate.forEach((m, i) => sel.add(new Option(m.name, i + 1)));
      sel.value = $('monat').value;
      sel.dataset.jahr = jahr;
    }
    const zeichnen = () => window.Dashboard.render($('dashInhalt'), daten, art, Number(sel.value), ziele);
    zeichnen();
    if (zieleJahr !== jahr) {
      zieleJahr = jahr; ziele = null;
      G.sparziele(dateien[jahr].id).then(z => { ziele = z; if (modus === 'uebersicht') zeichnen(); })
        .catch(err => { ziele = []; console.warn('Sparziele nicht geladen', err); if (modus === 'uebersicht') zeichnen(); });
    }
  }
  $('dashMonat').onchange = zeigeDashboard;

  $('bereich').onchange = function () { merke('bereich:' + modus, this.value); fuellePosten(); };
  $('posten').onchange = function () { merke('posten:' + bereich().name, this.value); zeigeBisher(); };

  function fuelleBisMonat() {
    const von = Number($('monat').value), sel = $('bisMonat'), alt = Number(sel.value) || 12;
    sel.innerHTML = '';
    for (let m = von + 1; m <= 12; m++) sel.add(new Option(daten.monate[m - 1].name, m));
    if (sel.options.length) sel.value = String(Math.max(von + 1, alt));
    $('wiederholen').disabled = !sel.options.length;
    if (!sel.options.length) $('wiederholen').checked = false;
    $('bisFeld').hidden = !$('wiederholen').checked;
  }
  $('wiederholen').onchange = function () { $('bisFeld').hidden = !this.checked; };
  $('monat').onchange = () => { zeigeBisher(); fuelleBisMonat(); };

  // ---------- Verlauf ----------

  function zeigeVerlauf(liste) {
    letzterVerlauf = liste;
    merkeStand();
    const ul = $('liste'); ul.innerHTML = '';
    const einnahme = {};
    daten.bereiche.forEach(b => { if (art(b) === 'einnahmen') b.posten.forEach(p => { einnahme[p.name] = true; }); });
    const email = hole('kosten.email');
    const wartend = warteschlange().filter(e => e.email === email && e.jahr === jahr).reverse();
    if (!liste.length && !wartend.length) { ul.innerHTML = '<li class="sub">Noch nichts erfasst.</li>'; return; }
    wartend.forEach(e => {
      const li = document.createElement('li');
      li.className = 'wartend' + (e.fehler ? ' problem' : '');
      li.innerHTML = '<div class="info"><div class="posten"></div><div class="sub"></div></div><div class="betrag"></div>';
      li.querySelector('.posten').textContent = e.posten;
      const bis = e.bisMonat > e.monat ? ' bis ' + daten.monate[e.bisMonat - 1].name : '';
      li.querySelector('.sub').textContent = daten.monate[e.monat - 1].name + bis + ' · ' + (e.fehler ? 'Nicht eingetragen: ' + e.fehler : 'wartet auf Internet');
      li.querySelector('.betrag').textContent = (einnahme[e.posten] ? '+ ' : '− ') + euro(e.betrag);
      const b = document.createElement('button'); b.className = 'undo'; b.textContent = 'Löschen';
      b.onclick = () => {
        if (!confirm('Wartenden Eintrag ' + euro(e.betrag) + ' bei „' + e.posten + '“ löschen? Er wird dann nicht eingetragen.')) return;
        setzeWarteschlange(warteschlange().filter(x => x.id !== e.id));
        zeigeVerlauf(letzterVerlauf);
      };
      li.appendChild(b);
      ul.appendChild(li);
    });
    liste.forEach(e => {
      const li = document.createElement('li');
      if (e.storniert) li.className = 'storniert';
      li.innerHTML = '<div class="info"><div class="posten"></div><div class="sub"></div></div><div class="betrag"></div>';
      li.querySelector('.posten').textContent = e.posten;
      const zeit = new Date(String(e.zeit).replace(' ', 'T'));
      li.querySelector('.sub').textContent = e.monat + (isNaN(zeit) ? '' : ' · ' + zeit.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
      const plus = einnahme[e.posten];
      li.querySelector('.betrag').textContent = (plus ? '+ ' : '− ') + euro(e.betrag);
      if (plus) li.querySelector('.betrag').classList.add('plus');
      if (!e.storniert) {
        const b = document.createElement('button'); b.className = 'undo'; b.textContent = 'Rückgängig';
        b.onclick = async () => {
          if (!confirm('Eintrag ' + euro(e.betrag) + ' bei „' + e.posten + '“ rückgängig machen?')) return;
          b.disabled = true; meldung('Mache rückgängig …');
          try {
            const r = await G.rueckgaengig(dateien[jahr].id, e.logZeile);
            aktualisiere(r.struktur, r.verlauf);
            meldung('Eintrag rückgängig gemacht.', 'ok');
          } catch (err) { b.disabled = false; fehler(err); }
        };
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
  }

  // ---------- Speichern ----------

  function leseBetrag() {
    return parseFloat($('betrag').value.replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  }

  $('speichern').onclick = async () => {
    const betrag = leseBetrag();
    if (!betrag || !isFinite(betrag)) { meldung('Bitte einen gültigen Betrag eingeben, z. B. 12,50', 'fehler'); return; }
    const p = posten(), m = Number($('monat').value);
    if (!p) return;
    const bis = $('wiederholen').checked ? Number($('bisMonat').value) : m;
    if (bis > m) {
      const belegt = [];
      for (let i = m; i <= bis; i++) if (p.werte[i - 1]) belegt.push(daten.monate[i - 1].name);
      let text = euro(betrag) + ' bei „' + p.name + '“ in jedem Monat von ' + daten.monate[m - 1].name + ' bis ' + daten.monate[bis - 1].name + ' eintragen?';
      if (belegt.length) text += '\n\nAchtung: In ' + belegt.join(', ') + ' ist schon etwas eingetragen. Der Betrag wird dort dazugerechnet.';
      if (!confirm(text)) return;
    }
    const eintrag = { monat: m, bisMonat: bis, zeile: p.zeile, posten: p.name, betrag: betrag };
    const vormerken = () => {
      inWarteschlange(eintrag);
      $('betrag').value = ''; $('wiederholen').checked = false; $('bisFeld').hidden = true;
      meldung('Offline gespeichert: ' + euro(betrag) + ' · ' + p.name + '. Wird eingetragen, sobald du wieder Internet hast.', 'ok');
      zeigeVerlauf(letzterVerlauf);
      $('speichern').disabled = false;
    };
    if (offline() || offlineGestartet) { vormerken(); return; }
    $('speichern').disabled = true; meldung('Speichere …');
    const status = {};
    try {
      const r = await G.hinzufuegen(dateien[jahr].id, eintrag, status);
      Object.keys(r.neueWerte).forEach(k => { p.werte[k - 1] = r.neueWerte[k]; });
      $('betrag').value = ''; $('wiederholen').checked = false; $('bisFeld').hidden = true;
      zeigeBisher();
      const zeitraum = bis > m ? ' · ' + daten.monate[m - 1].name + ' bis ' + daten.monate[bis - 1].name : '';
      meldung('Gespeichert: ' + euro(betrag) + ' · ' + p.name + zeitraum, 'ok');
      zeigeVerlauf(r.verlauf);
    } catch (err) {
      if (netzFehler(err) && !(err instanceof G.NichtAngemeldet)) {
        if (!status.geschrieben) { vormerken(); return; }
        meldung('Die Verbindung ist beim Speichern abgebrochen. Bitte in der Tabelle prüfen, ob der Betrag eingetragen wurde.', 'fehler');
      } else fehler(err);
    }
    $('speichern').disabled = false;
  };
  $('betrag').onkeydown = ev => { if (ev.key === 'Enter') $('speichern').click(); };

  // ---------- Jahre ----------

  function fuelleJahre() {
    const sel = $('jahr'); sel.innerHTML = '';
    const vorhanden = Object.keys(dateien).map(Number).sort((a, b) => a - b);
    vorhanden.forEach(j => sel.add(new Option(j, j)));
    const heute = new Date().getFullYear();
    [heute, Math.max(vorhanden[vorhanden.length - 1], heute) + 1].forEach(j => {
      if (vorhanden.indexOf(j) < 0 && ![].some.call(sel.options, o => Number(o.value) === j)) sel.add(new Option(j + ' (neu)', j));
    });
    sel.value = String(jahr);
  }

  $('jahr').onchange = async function () {
    const j = this.value, sel = this;
    if (offline() || offlineGestartet) { sel.value = jahr; meldung('Ohne Internet kannst du das Jahr nicht wechseln.', 'fehler'); return; }
    if (!dateien[j]) {
      if (!confirm('Finanzplaner für ' + j + ' anlegen?\n\nEr wird aus deinem Vorjahr erstellt: gleiche Posten, alle Beträge leer. Deine bisherigen Jahre bleiben unverändert.')) { sel.value = jahr; return; }
      sel.disabled = true; meldung('Lege Finanzplaner ' + j + ' an …');
      try {
        await G.jahrAnlegen(Number(j));
        dateien = await G.meineDateien();
      } catch (err) { sel.disabled = false; sel.value = jahr; fehler(err); return; }
    }
    sel.disabled = false;
    await ladeJahr(j);
  };

  async function ladeJahr(j) {
    jahr = String(j);
    meldung('Lade ' + jahr + ' …');
    $('speichern').disabled = true;
    try {
      const id = dateien[jahr].id;
      const info = await G.blaetter(id);
      daten = await G.struktur(id, info);
      const verlauf = await G.verlauf(id, info);
      zeigeJahr(verlauf);
      merke('jahr', jahr);
      pruefeVorlage();
    } catch (err) { fehler(err); }
  }

  // Zeigt das Formular fuer "jahr" mit den Daten in "daten" (auch offline aus dem gespeicherten Stand).
  function zeigeJahr(verlauf) {
      const id = dateien[jahr].id;
      zeige(['formular', 'verlauf', 'fuss']);
      fuelleJahre();
      $('tabelleLink').href = dateien[jahr].webViewLink || ('https://docs.google.com/spreadsheets/d/' + id + '/edit');
      $('tabelleLink').textContent = (dateien[jahr].name || 'Tabelle') + ' öffnen';
      $('monat').innerHTML = '';
      daten.monate.forEach((m, i) => $('monat').add(new Option(m.name, i + 1)));
      const heute = new Date();
      $('monat').value = Number(jahr) === heute.getFullYear() ? heute.getMonth() + 1 : (Number(jahr) < heute.getFullYear() ? 12 : 1);
      fuelleBisMonat();
      setzeModus(hole('modus') || 'variabel');
      zeigeVerlauf(verlauf);
      $('speichern').disabled = false;
  }

  // Start ohne Internet mit dem zuletzt gespeicherten Stand.
  function starteOffline() {
    let stand = null;
    try { stand = JSON.parse(hole(STAND) || 'null'); } catch (e) { }
    if (!stand || !stand.daten || !stand.dateien || !stand.dateien[stand.jahr]) {
      zeige(['anmeldung']);
      meldung('Keine Internetverbindung. Öffne die App einmal mit Internet, danach kannst du auch offline eintragen.', 'fehler', 'meldungAnmeldung');
      return;
    }
    offlineGestartet = true;
    if (stand.email) merke('kosten.email', stand.email);
    dateien = stand.dateien; jahr = String(stand.jahr); daten = stand.daten;
    zeigeJahr(stand.verlauf || []);
    meldung('Du bist offline. Neue Einträge werden gespeichert und eingetragen, sobald du wieder Internet hast.');
  }

  function standardJahr() {
    const heute = String(new Date().getFullYear());
    if (dateien[heute]) return heute;
    const v = Object.keys(dateien).sort();
    return v[v.length - 1];
  }

  // ---------- Erster Start ----------

  async function einrichten(user) {
    zeige(['einrichten']);
    $('titel').textContent = 'Finanzplaner';
    $('name').value = (user.displayName || '').split(' ')[0];
    try {
      const liste = await G.kandidaten();
      $('kandidatenBox').hidden = !liste.length;
      const ul = $('kandidaten'); ul.innerHTML = '';
      liste.forEach(f => {
        const li = document.createElement('li');
        li.innerHTML = '<div class="info"><div class="posten"></div><div class="sub"></div></div>';
        li.querySelector('.posten').textContent = f.name;
        li.querySelector('.sub').textContent = 'Zuletzt geändert ' + new Date(f.modifiedTime).toLocaleDateString('de-DE');
        const b = document.createElement('button'); b.className = 'waehlen'; b.textContent = G.TEST ? 'Testkopie anlegen' : 'Verbinden';
        b.onclick = async () => {
          b.disabled = true; meldung('Verbinde …', '', 'meldungEinrichten');
          try {
            const j = await G.verbinden(f.id);
            dateien = await G.meineDateien();
            const weitere = Object.keys(dateien).length;
            li.remove();
            meldung(G.TEST ? 'Testkopie von „' + f.name + '“ angelegt.' : '„' + f.name + '“ ist jetzt dein Finanzplaner ' + j + '.', 'ok', 'meldungEinrichten');
            if (weitere) await ladeJahr(j);
          } catch (err) { b.disabled = false; fehler(err, 'meldungEinrichten'); }
        };
        li.appendChild(b);
        ul.appendChild(li);
      });
    } catch (err) { fehler(err, 'meldungEinrichten'); }
  }

  $('neuAnlegen').onclick = async function () {
    const name = $('name').value.trim();
    if (!name) { meldung('Bitte einen Namen eingeben.', 'fehler', 'meldungEinrichten'); return; }
    this.disabled = true; meldung('Lege Finanzplaner an …', '', 'meldungEinrichten');
    try {
      const j = await G.ersterFinanzplaner(name);
      dateien = await G.meineDateien();
      await ladeJahr(j);
    } catch (err) { this.disabled = false; fehler(err, 'meldungEinrichten'); }
  };

  // ---------- Vorlage abgleichen, Abmelden ----------

  // Beim Laden im Hintergrund pruefen, ob die Vorlage neue Posten hat, und dann einen Hinweis zeigen.
  async function pruefeVorlage() {
    $('hinweisVorlage').hidden = true;
    try {
      const fehlend = await G.fehlendeAusVorlage(dateien[jahr].id);
      let weg = null;
      try { weg = sessionStorage.getItem('kosten.hinweisWeg'); } catch (e) { }
      if (!fehlend.length || weg === fehlend.join('|')) return;
      $('hinweisText').textContent = 'Neue Posten verfügbar: ' + fehlend.join(', ') +
        '. Du kannst sie jetzt in deine Tabelle übernehmen. Deine Einträge und Beträge bleiben dabei vollständig erhalten.';
      $('hinweisVorlage').dataset.fehlend = fehlend.join('|');
      $('hinweisVorlage').hidden = false;
    } catch (err) { console.warn('Vorlage nicht geprüft', err); }
    // Hinweise zum Bearbeiten einmal je Tabelle hineinschreiben
    const hk = 'kosten.hinweise:' + dateien[jahr].id;
    if (hole(hk) !== '1') G.hinweiseSchreiben(dateien[jahr].id).then(() => merke(hk, '1')).catch(err => console.warn('Hinweise nicht geschrieben', err));
  }
  $('hinweisJetzt').onclick = () => { $('hinweisVorlage').hidden = true; abgleichen(true); };
  $('hinweisSpaeter').onclick = () => {
    $('hinweisVorlage').hidden = true;
    try { sessionStorage.setItem('kosten.hinweisWeg', $('hinweisVorlage').dataset.fehlend || ''); } catch (e) { }
  };

  $('vorlageAbgleich').onclick = () => abgleichen(false);

  async function abgleichen(ohneFrage) {
    const jahre = Object.keys(dateien).sort();
    if (!ohneFrage && !confirm('Fehlende Posten aus der Vorlage in deine Finanzplaner (' + jahre.join(', ') + ') übernehmen?\n\nVorhandene Zeilen und Beträge werden nicht verändert.')) return;
    $('vorlageAbgleich').disabled = true;
    const texte = [];
    try {
      for (const j of jahre) {
        meldung('Gleiche ' + j + ' mit der Vorlage ab …');
        const r = await G.vorlageAbgleichen(dateien[j].id);
        texte.push(j + ': ' + (r.neu.length ? r.neu.length + ' neue Zeile(n): ' + r.neu.join(', ') : 'alles aktuell') +
          (r.fehlendeBereiche.length ? '\n   Bitte von Hand ergänzen (ganzer Bereich fehlt): ' + r.fehlendeBereiche.join(', ') : ''));
      }
      await ladeJahr(jahr);
      meldung(texte.join('\n'), 'ok');
    } catch (err) { fehler(err); }
    $('vorlageAbgleich').disabled = false;
  }

  $('abmelden').onclick = () => {
    if (!confirm('Abmelden?')) return;
    G.abmelden();
    location.reload();
  };
  $('anmelden').onclick = () => G.anmelden(false);

  // Kurz vor Ablauf der Anmeldung (nach ca. 1 Stunde) still erneuern, wenn die App wieder geoeffnet wird.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !offline() && G.token() && G.restMinuten() < 5) G.anmelden(true);
  });

  // ---------- Neuigkeiten ----------

  // Zeigt einmal die Neuigkeiten seit dem letzten Besuch. Wer die App zum ersten Mal auf diesem Geraet nutzt,
  // sieht nur den neuesten Eintrag.
  function zeigeNeuigkeiten() {
    const liste = window.NEUIGKEITEN || [];
    if (!liste.length) return;
    const gesehen = hole('kosten.neuigkeiten');
    const neu = gesehen ? liste.filter(n => n.id > gesehen) : liste.slice(0, 1);
    if (!neu.length) return;
    const ul = $('neuigkeitenListe');
    ul.innerHTML = '';
    neu.forEach(n => n.punkte.forEach(p => { const li = document.createElement('li'); li.textContent = p; ul.appendChild(li); }));
    $('neuigkeiten').hidden = false;
    $('neuigkeitenOk').onclick = () => { $('neuigkeiten').hidden = true; merke('kosten.neuigkeiten', liste[0].id); };
  }

  // ---------- Start ----------

  async function start() {
    if (G.TEST) {
      $('testBalken').hidden = false;
      $('kandidatenText').textContent = 'TESTVERSION: Wähle die Tabelle, von der eine Testkopie angelegt werden soll. Das Original bleibt unverändert.';
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
    const rueck = G.tokenAusAdresse();
    zeigeOffline();
    if (offline()) { starteOffline(); return; }
    if (!G.token()) {
      // Schon einmal angemeldet: still erneuern (einmal pro Sitzung), sonst Anmelde-Knopf zeigen
      let versucht = null;
      try { versucht = sessionStorage.getItem('kosten.still'); } catch (e) { }
      if (hole('kosten.email') && !versucht && !(rueck && rueck.fehler)) {
        try { sessionStorage.setItem('kosten.still', '1'); } catch (e) { }
        G.anmelden(true);
        return;
      }
      zeige(['anmeldung']);
      if (rueck && rueck.fehler && rueck.fehler !== 'interaction_required' && rueck.fehler !== 'login_required') {
        meldung('Anmeldung fehlgeschlagen: ' + rueck.fehler, 'fehler', 'meldungAnmeldung');
      }
      return;
    }
    try { sessionStorage.removeItem('kosten.still'); } catch (e) { }
    try {
      const user = await G.nutzer();
      dateien = await G.meineDateien();
      if (!Object.keys(dateien).length) { await einrichten(user); return; }
      let entwurf = null;
      try { entwurf = JSON.parse(sessionStorage.getItem('kosten.entwurf') || 'null'); sessionStorage.removeItem('kosten.entwurf'); } catch (e) { }
      const gemerkt = entwurf && dateien[entwurf.jahr] ? entwurf.jahr : null;
      await ladeJahr(gemerkt || standardJahr());
      if (entwurf && entwurf.betrag) { $('betrag').value = entwurf.betrag; meldung('Anmeldung erneuert. Bitte noch einmal auf Hinzufügen tippen.'); }
      zeigeNeuigkeiten();
      synchronisiere();
    } catch (err) {
      if (netzFehler(err)) { starteOffline(); return; }
      if (err instanceof G.NichtAngemeldet) { zeige(['anmeldung']); return; }
      zeige(['anmeldung']);
      meldung(err.message, 'fehler', 'meldungAnmeldung');
    }
  }

  start();
})();
