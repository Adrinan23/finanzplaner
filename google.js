// Anmeldung bei Google und Zugriff auf die Finanzplaner-Tabellen (Drive + Sheets API).
// Jeder Nutzer arbeitet mit seinem eigenen Konto; die Dateien liegen in seinem Drive.
// Die Dateien der App sind in Drive mit appProperties { kostenApp: '1', jahr: '2026' } markiert.

(function () {
  const CFG = window.KOSTEN_CONFIG;
  const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets';
  // Nur fuer die Turnus-Automatik, wird erst beim Einrichten zusaetzlich angefragt
  const SKRIPT_SCOPE = 'https://www.googleapis.com/auth/script.projects';
  const LOG_BLATT = 'Eingaben';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  // Testversion (Adresse .../finanzplaner-test/): arbeitet nur mit eigenen Testkopien,
  // die mit einem anderen Merkmal markiert sind und "(Test)" im Namen tragen.
  const TEST = /finanzplaner-test/.test(location.pathname);
  const MARK = TEST ? 'kostenAppTest' : 'kostenApp';
  const ZUSATZ = TEST ? ' (Test)' : '';
  const markierung = jahr => ({ [MARK]: '1', jahr: String(jahr) });
  // "Finanzplanung 2026 (Test)" -> "Finanzplanung"
  const grundname = n => n.replace(/\s*\(Test\)\s*$/, '').replace(/\s*20\d\d\s*$/, '').trim();

  function lies(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function schreib(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }

  // ---------- Anmeldung (OAuth-Weiterleitung, funktioniert auch als installierte App auf dem iPhone) ----------

  function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

  function anmelden(still, zusatz) {
    const p = new URLSearchParams({
      client_id: CFG.CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: zusatz ? SCOPES + ' ' + zusatz : SCOPES,
      include_granted_scopes: 'true',
      state: 'kosten'
    });
    const hint = lies('kosten.email');
    if (hint) p.set('login_hint', hint);
    if (still) p.set('prompt', 'none');
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
  }

  // Nimmt das Token aus der Adresse nach der Rueckkehr von Google entgegen.
  function tokenAusAdresse() {
    if (!location.hash || location.hash.indexOf('access_token') < 0 && location.hash.indexOf('error') < 0) return null;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    if (p.get('error')) return { fehler: p.get('error') };
    const ablauf = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000;
    schreib('kosten.token', p.get('access_token'));
    schreib('kosten.ablauf', String(ablauf));
    return { ok: true };
  }

  function token() {
    const t = lies('kosten.token'), a = Number(lies('kosten.ablauf'));
    return t && a > Date.now() + 60000 ? t : null;
  }
  function restMinuten() { return (Number(lies('kosten.ablauf')) - Date.now()) / 60000; }

  function abmelden() {
    const t = lies('kosten.token');
    schreib('kosten.token', null); schreib('kosten.ablauf', null); schreib('kosten.email', null);
    if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }).catch(() => {});
  }

  class NichtAngemeldet extends Error {}

  async function api(url, opts) {
    const t = token();
    if (!t) throw new NichtAngemeldet('Anmeldung abgelaufen.');
    opts = opts || {};
    const headers = Object.assign({ Authorization: 'Bearer ' + t }, opts.body ? { 'Content-Type': 'application/json' } : {});
    const r = await fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (r.status === 401) { schreib('kosten.token', null); throw new NichtAngemeldet('Anmeldung abgelaufen.'); }
    const text = await r.text();
    const daten = text ? JSON.parse(text) : {};
    if (!r.ok) throw new Error((daten.error && daten.error.message) || ('Google-Fehler ' + r.status));
    return daten;
  }

  async function nutzer() {
    const d = await api(DRIVE + '/about?fields=user(emailAddress,displayName)');
    schreib('kosten.email', d.user.emailAddress);
    return d.user;
  }

  // ---------- Hilfen fuer Tabellen ----------

  const q = s => "'" + s.replace(/'/g, "''") + "'";
  function spaltenBuchstabe(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function zelle(blatt, zeile, spalte) { return q(blatt) + '!' + spaltenBuchstabe(spalte) + zeile; }
  // Zahl als Text; sep ist das Dezimalzeichen, mit dem die Tabelle Formeln liest ('.' oder ',').
  function zahl(n, sep) { return String(Math.round(n * 100) / 100).replace('.', sep || '.'); }
  // Dezimalzeichen der Tabellen-Sprache, z.B. de_DE -> ','
  function dezimalzeichen(locale) {
    try { return (1.5).toLocaleString(String(locale || 'en_US').replace('_', '-')).indexOf(',') >= 0 ? ',' : '.'; }
    catch (e) { return '.'; }
  }
  // Datum als Tabellen-Seriennummer (Tage seit 30.12.1899)
  function serial(jahr, monat) { return Math.round((Date.UTC(jahr, monat, 1) - Date.UTC(1899, 11, 30)) / 86400000); }
  function ausSerial(n) { return new Date(Date.UTC(1899, 11, 30) + n * 86400000); }

  async function blaetter(id) {
    const d = await api(SHEETS + '/' + id + '?fields=properties(title,locale),sheets.properties');
    return { titel: d.properties.title, locale: d.properties.locale || '', blaetter: d.sheets.map(s => s.properties) };
  }

  function monatsBlatt(info) {
    const b = info.blaetter.find(s => /^Monats/i.test(s.title));
    if (!b) throw new Error('Blatt "Monatsübersicht" nicht gefunden.');
    return b;
  }

  async function werteHolen(id, bereiche, art) {
    const p = new URLSearchParams({ valueRenderOption: art || 'FORMATTED_VALUE', majorDimension: 'ROWS' });
    bereiche.forEach(b => p.append('ranges', b));
    const d = await api(SHEETS + '/' + id + '/values:batchGet?' + p.toString());
    return d.valueRanges.map(v => v.values || []);
  }

  // Liest Monate, Bereiche und Posten (wie bisher im Apps Script).
  async function struktur(id, info) {
    info = info || await blaetter(id);
    const blatt = monatsBlatt(info);
    const bereich = q(blatt.title) + '!A1:Z300';
    const [[anzeige], [roh]] = await Promise.all([
      werteHolen(id, [bereich], 'FORMATTED_VALUE'),
      werteHolen(id, [bereich], 'UNFORMATTED_VALUE')
    ]);
    const t = (r, c) => String((anzeige[r] || [])[c] || '').trim();
    let kopf = -1, jan = -1;
    for (let r = 0; r < Math.min(15, anzeige.length) && kopf < 0; r++) {
      const c = (anzeige[r] || []).findIndex(v => String(v).trim() === 'Januar');
      if (c >= 0) { kopf = r; jan = c; }
    }
    if (kopf < 0) throw new Error('Kopfzeile mit den Monaten nicht gefunden.');
    const monate = [];
    for (let i = 0; i < 12; i++) monate.push({ name: t(kopf, jan + i), spalte: jan + i + 1 });
    const datum = (roh[kopf + 1] || [])[jan];
    const jahr = typeof datum === 'number' ? ausSerial(datum).getUTCFullYear() : null;

    const bereiche = [];
    let aktuell = null;
    for (let r = kopf + 1; r < anzeige.length; r++) {
      const b = t(r, 1), c = t(r, 2);
      if (/^\d+\.\s/.test(b)) { aktuell = { name: b, posten: [], zwischensumme: null }; bereiche.push(aktuell); }
      else if (/^MONATLICHE GESAMT/.test(b)) break;
      else if (aktuell && b === 'Zwischensumme') aktuell.zwischensumme = r + 1;
      else if (aktuell && b && c) {
        aktuell.posten.push({
          name: b + ' - ' + c, kategorie: b, bezeichnung: c, turnus: t(r, 3), zeile: r + 1, auto: /\(automatisch\)$/.test(c),
          werte: monate.map(m => Number((roh[r] || [])[m.spalte - 1]) || 0)
        });
      }
    }
    return { blatt: blatt, monate: monate, bereiche: bereiche, kopfZeile: kopf + 1, jahr: jahr, titel: info.titel };
  }

  async function formelHolen(id, ref) {
    const [w] = await werteHolen(id, [ref], 'FORMULA');
    return w.length && w[0].length ? w[0][0] : '';
  }

  // Schreibt Formel oder Zahl sprachunabhaengig ueber updateCells.
  function zellWert(inhalt) {
    if (inhalt === '' || inhalt === null || inhalt === undefined) return {};
    if (typeof inhalt === 'number') return { numberValue: inhalt };
    if (String(inhalt).charAt(0) === '=') return { formulaValue: String(inhalt) };
    return { numberValue: Number(inhalt) };
  }
  // Formeln aus der App sind mit Komma geschrieben. Die Sheets-API liest sie in der Sprache der Tabelle;
  // bei Komma als Dezimalzeichen (z. B. Deutsch) trennt dort das Semikolon die Argumente.
  function lokal(formel, locale) {
    let komma = false;
    try { komma = (1.5).toLocaleString(String(locale || 'en').replace('_', '-')).indexOf(',') >= 0; } catch (e) { komma = false; }
    if (!komma) return formel;
    let aus = '', inText = false, inName = false;
    for (const ch of formel) {
      if (ch === '"' && !inName) inText = !inText;
      else if (ch === "'" && !inText) inName = !inName;
      aus += ch === ',' && !inText && !inName ? ';' : ch;
    }
    return aus;
  }
  // Turnus (Spalte D) <-> Abstand in Monaten; gleiche Regeln wie das Turnus-Skript der Tabelle
  const AUTO_NOTIZ = 'Automatisch (Turnus)';
  const TURNUS_TEXT = { 1: 'Monatlich', 2: 'alle 2 Monate', 3: 'Quartalsweise', 4: 'alle 4 Monate', 6: 'Halbjährlich' };
  function taktAusTurnus(text) {
    const t = String(text || '').toLowerCase();
    if (/variabel/.test(t)) return 0;
    if (/zweimonat|alle 2 monat/.test(t)) return 2;
    if (/quartal|viertelj/.test(t)) return 3;
    if (/alle 4 monat/.test(t)) return 4;
    if (/halbj/.test(t)) return 6;
    if (/^\s*monatlich/.test(t)) return 1;
    return 0;
  }
  function updateText(sheetId, zeile, spalte, text) {
    return {
      updateCells: {
        range: { sheetId: sheetId, startRowIndex: zeile - 1, endRowIndex: zeile, startColumnIndex: spalte - 1, endColumnIndex: spalte },
        rows: [{ values: [{ userEnteredValue: { stringValue: text } }] }],
        fields: 'userEnteredValue'
      }
    };
  }
  function notiz(sheetId, zeile, spalte, text) {
    return {
      updateCells: {
        range: { sheetId: sheetId, startRowIndex: zeile - 1, endRowIndex: zeile, startColumnIndex: spalte - 1, endColumnIndex: spalte },
        rows: [{ values: [{ note: text }] }],
        fields: 'note'
      }
    };
  }

  function updateZelle(sheetId, zeile, spalte, inhalt) {
    return {
      updateCells: {
        range: { sheetId: sheetId, startRowIndex: zeile - 1, endRowIndex: zeile, startColumnIndex: spalte - 1, endColumnIndex: spalte },
        rows: [{ values: [{ userEnteredValue: zellWert(inhalt) }] }],
        fields: 'userEnteredValue'
      }
    };
  }
  function batch(id, requests) { return api(SHEETS + '/' + id + ':batchUpdate', { method: 'POST', body: { requests: requests } }); }

  // ---------- Dateien des Nutzers ----------

  async function meineDateien() {
    const p = new URLSearchParams({
      q: "appProperties has { key='" + MARK + "' and value='1' } and trashed=false and 'me' in owners",
      fields: 'files(id,name,appProperties,webViewLink)', pageSize: '100'
    });
    const d = await api(DRIVE + '/files?' + p.toString());
    const jahre = {};
    d.files.forEach(f => { const j = f.appProperties && f.appProperties.jahr; if (j && !jahre[j]) jahre[j] = f; });
    return jahre;
  }

  // Tabellen, die wie ein Finanzplaner aussehen (fuer den ersten Start / Umzug von der alten App).
  async function kandidaten() {
    const p = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and name contains 'Finanzplan' and 'me' in owners and trashed=false",
      fields: 'files(id,name,modifiedTime,appProperties)', orderBy: 'modifiedTime desc', pageSize: '20'
    });
    const d = await api(DRIVE + '/files?' + p.toString());
    const ap = f => f.appProperties || {};
    if (TEST) return d.files.filter(f => f.id !== CFG.VORLAGE_ID && !ap(f).kostenAppTest && !/\(Test\)/.test(f.name));
    return d.files.filter(f => f.id !== CFG.VORLAGE_ID && !ap(f).kostenApp && !ap(f).kostenAppTest && !/\(Test\)/.test(f.name));
  }

  async function jahrDerDatei(id) {
    const s = await struktur(id);
    if (s.jahr) return s.jahr;
    const m = (s.titel + ' ' + s.blatt.title).match(/20\d\d/);
    return m ? Number(m[0]) : new Date().getFullYear();
  }

  // Bestehende Tabelle als Finanzplaner markieren (Jahr erkennen, Jahr an den Namen haengen).
  // In der Testversion wird stattdessen eine Testkopie angelegt; das Original bleibt unberuehrt.
  async function verbinden(id) {
    const jahr = await jahrDerDatei(id);
    const meine = await meineDateien();
    if (meine[jahr] && meine[jahr].id !== id) throw new Error('Für ' + jahr + ' ist schon ein Finanzplaner verbunden.');
    const f = await api(DRIVE + '/files/' + id + '?fields=name');
    if (TEST) {
      const kopie = await api(DRIVE + '/files/' + id + '/copy?fields=id', {
        method: 'POST', body: { name: grundname(f.name) + ' ' + jahr + ZUSATZ }
      });
      await api(DRIVE + '/files/' + kopie.id, { method: 'PATCH', body: { appProperties: Object.assign({ kostenApp: null }, markierung(jahr)) } });
      return jahr;
    }
    const name = f.name.indexOf(String(jahr)) >= 0 ? f.name : f.name.trim() + ' ' + jahr;
    await api(DRIVE + '/files/' + id, { method: 'PATCH', body: { name: name, appProperties: markierung(jahr) } });
    return jahr;
  }

  // Kopiert eine Datei und stellt sie auf ein neues Jahr ein.
  // leeren=true: alle Monatsbetraege und das Eingabe-Protokoll entfernen (fuer das Vorjahr als Vorlage).
  async function kopieFuerJahr(quelleId, name, jahr, leeren) {
    const kopie = await api(DRIVE + '/files/' + quelleId + '/copy?fields=id', {
      method: 'POST', body: { name: name }
    });
    const id = kopie.id;
    // Merkmal getrennt setzen (Kopien uebernehmen sonst das Merkmal der Quelle, z.B. ihr Jahr)
    await api(DRIVE + '/files/' + id, { method: 'PATCH', body: { appProperties: Object.assign({ kostenApp: null, kostenAppTest: null }, markierung(jahr)) } });
    const info = await blaetter(id);
    const s = await struktur(id, info);
    const anfragen = [];
    // Datumszeile unter den Monatsnamen auf das neue Jahr setzen
    if (s.jahr) {
      anfragen.push({
        updateCells: {
          range: { sheetId: s.blatt.sheetId, startRowIndex: s.kopfZeile, endRowIndex: s.kopfZeile + 1, startColumnIndex: s.monate[0].spalte - 1, endColumnIndex: s.monate[0].spalte + 11 },
          rows: [{ values: s.monate.map((m, i) => ({ userEnteredValue: { numberValue: serial(jahr, i) } })) }],
          fields: 'userEnteredValue'
        }
      });
    }
    if (leeren) {
      s.bereiche.forEach(b => b.posten.forEach(p => anfragen.push({
        updateCells: {
          range: { sheetId: s.blatt.sheetId, startRowIndex: p.zeile - 1, endRowIndex: p.zeile, startColumnIndex: s.monate[0].spalte - 1, endColumnIndex: s.monate[0].spalte + 11 },
          fields: 'userEnteredValue'
        }
      })));
      const log = info.blaetter.find(b => b.title === LOG_BLATT);
      if (log) anfragen.push({ deleteSheet: { sheetId: log.sheetId } });
    }
    // Jahreszahl im Blattnamen anpassen (Formeln auf das Blatt passt Google automatisch an)
    if (/20\d\d/.test(s.blatt.title)) {
      anfragen.push({ updateSheetProperties: { properties: { sheetId: s.blatt.sheetId, title: s.blatt.title.replace(/20\d\d/, String(jahr)) }, fields: 'title' } });
    }
    if (anfragen.length) await batch(id, anfragen);
    return id;
  }

  async function ersterFinanzplaner(name) {
    const jahr = new Date().getFullYear();
    await kopieFuerJahr(CFG.VORLAGE_ID, 'Finanzplaner - ' + name + ' ' + jahr + ZUSATZ, jahr, false);
    return jahr;
  }

  // Neues Jahr: Kopie des eigenen Vorjahres (bzw. des naechstliegenden Jahres) mit geleerten Betraegen.
  async function jahrAnlegen(jahr) {
    const meine = await meineDateien();
    if (meine[jahr]) return jahr;
    const vorhanden = Object.keys(meine).map(Number).sort((a, b) => a - b);
    if (!vorhanden.length) throw new Error('Noch kein Finanzplaner vorhanden.');
    const vorher = vorhanden.filter(j => j < jahr);
    const quelle = meine[vorher.length ? vorher[vorher.length - 1] : vorhanden[0]];
    await kopieFuerJahr(quelle.id, grundname(quelle.name) + ' ' + jahr + ZUSATZ, jahr, true);
    return jahr;
  }

  // ---------- Eintraege ----------

  async function logBlatt(id, info) {
    let log = info.blaetter.find(b => b.title === LOG_BLATT);
    if (log) return log;
    const r = await batch(id, [{ addSheet: { properties: { title: LOG_BLATT, gridProperties: { frozenRowCount: 1 } } } }]);
    log = r.replies[0].addSheet.properties;
    await api(SHEETS + '/' + id + '/values/' + encodeURIComponent(q(LOG_BLATT) + '!A1:I1') + '?valueInputOption=RAW', {
      method: 'PUT', body: { values: [['Zeitpunkt', 'Monat', 'Posten', 'Betrag', 'Zeile', 'Spalte', 'Formel vorher', 'Formel nachher', 'Status']] }
    });
    return log;
  }

  async function verlauf(id, info) {
    info = info || await blaetter(id);
    if (!info.blaetter.find(b => b.title === LOG_BLATT)) return [];
    const [z] = await werteHolen(id, [q(LOG_BLATT) + '!A2:I'], 'UNFORMATTED_VALUE');
    const start = Math.max(0, z.length - 10);
    // Wie oft jeder Posten benutzt wurde (ein Eintrag mit Wiederholen zaehlt einmal, rueckgaengig gemachte nicht)
    const nutzung = {}, gesehen = {};
    z.forEach(r => {
      if (!r[2] || r[8] === 'rueckgaengig') return;
      const k = r[0] + '|' + r[2];
      if (gesehen[k]) return;
      gesehen[k] = true;
      nutzung[r[2]] = (nutzung[r[2]] || 0) + 1;
    });
    const liste = z.slice(start).map((r, i) => ({
      logZeile: start + i + 2,
      zeit: typeof r[0] === 'number' ? ausSerial(r[0]).toISOString() : String(r[0] || ''),
      monat: r[1], posten: r[2], betrag: Number(r[3]), storniert: r[8] === 'rueckgaengig'
    })).filter(e => e.posten).reverse();
    liste.nutzung = nutzung;
    return liste;
  }

  // ---------- Konten-Auswahl ----------
  // Welche Posten der Nutzer ausgeschaltet hat, steht in der Tabelle selbst (Developer-Metadaten),
  // damit es auf allen Geraeten gilt und beim Kopieren fuer ein neues Jahr mitwandert.
  const AUSWAHL_MERKMAL = 'finanzplanerKontenAuswahl';
  async function kontenAuswahl(id) {
    const d = await api(SHEETS + '/' + id + '?fields=developerMetadata(metadataId,metadataKey,metadataValue)');
    const m = (d.developerMetadata || []).find(x => x.metadataKey === AUSWAHL_MERKMAL);
    if (!m) return { aus: [], tabelle: false };
    try { const v = JSON.parse(m.metadataValue); return { aus: v.aus || [], tabelle: !!v.tabelle }; }
    catch (e) { return { aus: [], tabelle: false }; }
  }
  // aus: Liste von Posten-Namen ("Kategorie - Bezeichnung"); tabelle: Zeilen auch in der Tabelle ausblenden
  async function kontenAuswahlSpeichern(id, aus, tabelle, warTabelle) {
    const [s, d] = await Promise.all([struktur(id), api(SHEETS + '/' + id + '?fields=developerMetadata(metadataId,metadataKey)')]);
    const anfragen = (d.developerMetadata || []).filter(x => x.metadataKey === AUSWAHL_MERKMAL).map(x => (
      { deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: { metadataId: x.metadataId } } } }));
    anfragen.push(
      { createDeveloperMetadata: { developerMetadata: {
        metadataKey: AUSWAHL_MERKMAL, metadataValue: JSON.stringify({ aus: aus, tabelle: !!tabelle }), location: { spreadsheet: true }, visibility: 'DOCUMENT'
      } } });
    // Zeilen ein- bzw. ausblenden (Summen rechnen trotzdem weiter). War es vorher an und jetzt aus, alles wieder einblenden.
    if (tabelle || warTabelle) {
      const weg = {}; aus.forEach(n => { weg[normName(n)] = true; });
      s.bereiche.forEach(b => b.posten.forEach(p => {
        if (p.auto) return;
        anfragen.push({ updateDimensionProperties: {
          range: { sheetId: s.blatt.sheetId, dimension: 'ROWS', startIndex: p.zeile - 1, endIndex: p.zeile },
          properties: { hiddenByUser: !!(tabelle && weg[normName(p.name)]) }, fields: 'hiddenByUser'
        } });
      }));
    }
    await batch(id, anfragen);
  }

  function jetztText() {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
  }

  // Haengt den Betrag an die Monatszellen von "monat" bis "bisMonat" an, mit e.takt = 3 nur in jedem dritten Monat.
  // status.geschrieben wird gesetzt, sobald die Tabelle veraendert wird (fuer die Offline-Warteschlange).
  async function hinzufuegen(id, e, status) {
    const betrag = Math.round(Number(e.betrag) * 100) / 100;
    if (!betrag || !isFinite(betrag)) throw new Error('Ungültiger Betrag.');
    const info = await blaetter(id);
    const s = await struktur(id, info);
    const von = Number(e.monat), bis = Math.max(von, Math.min(12, Number(e.bisMonat) || von));
    const takt = Math.max(1, Number(e.takt) || 1), liste = [];
    for (let m = von; m <= bis; m += takt) liste.push(m);
    const alle = [].concat.apply([], s.bereiche.map(b => b.posten));
    const p = alle.find(x => x.zeile === Number(e.zeile) && x.name === e.posten) || alle.find(x => x.name === e.posten);
    if (!p) throw new Error('Posten nicht gefunden. Bitte App neu laden.');

    const refs = [];
    liste.forEach(m => refs.push(zelle(s.blatt.title, p.zeile, s.monate[m - 1].spalte)));
    const formeln = await werteHolen(id, refs, 'FORMULA');

    // Formel bauen. Je nach Sprache der Tabelle wird "12.5" oder "12,5" als Zahl gelesen;
    // deshalb mit dem passenden Dezimalzeichen schreiben, pruefen und notfalls das andere versuchen.
    function bauePlan(sep) {
      const plan = [];
      liste.forEach((m, i) => {
        const roh = formeln[i].length ? formeln[i][0][0] : '';
        const dazu = betrag < 0 ? zahl(betrag, sep) : '+' + zahl(betrag, sep);
        let vorher, nachher;
        if (roh === '' || roh === null || roh === undefined) { vorher = ''; nachher = betrag; }
        else if (typeof roh === 'number') { vorher = roh; nachher = '=' + zahl(roh, sep) + dazu; }
        else if (String(roh).charAt(0) === '=') { vorher = roh; nachher = roh + dazu; }
        else throw new Error('Die Zelle im ' + s.monate[m - 1].name + ' enthält Text und wird nicht verändert.');
        plan.push({ m: m, spalte: s.monate[m - 1].spalte, vorher: vorher, nachher: nachher, erwartet: (p.werte[m - 1] || 0) + betrag });
      });
      return plan;
    }

    const erstes = dezimalzeichen(info.locale);
    let plan = null, neueWerte = {}, gefunden = null;
    for (const sep of [erstes, erstes === ',' ? '.' : ',']) {
      plan = bauePlan(sep);
      if (status) status.geschrieben = true;
      await batch(id, plan.map(x => updateZelle(s.blatt.sheetId, p.zeile, x.spalte, x.nachher)));
      // Kontrolle: stimmt der neue Wert? Sonst zuruecksetzen.
      const neu = await werteHolen(id, refs, 'UNFORMATTED_VALUE');
      const werte = {};
      let falsch = false;
      plan.forEach((x, i) => {
        const w = Number(neu[i].length ? neu[i][0][0] : 0) || 0;
        werte[x.m] = w;
        if (Math.abs(w - x.erwartet) > 0.005) falsch = true;
      });
      if (!falsch) { neueWerte = werte; gefunden = sep; break; }
      await batch(id, plan.map(x => updateZelle(s.blatt.sheetId, p.zeile, x.spalte, x.vorher)));
      console.warn('Kontrolle fehlgeschlagen', sep, plan, werte);
    }
    if (!gefunden) {
      throw new Error('Der Betrag konnte nicht korrekt eingetragen werden. Es wurde nichts geändert.' +
        '\n(Erwartet ' + plan[0].erwartet + ', Formel ' + plan[0].nachher + ', Tabellensprache ' + (info.locale || '?') + ')');
    }

    // Zusammenspiel mit dem Turnus-Skript der Tabelle: beim Wiederholen den Turnus in Spalte D setzen und
    // die Folgemonate, die vorher leer waren, als automatisch markieren (Notiz wie beim Skript).
    // Alle anderen beschriebenen Zellen gelten als selbst eingetragen (Notiz weg).
    const extra = plan.map((x, i) => notiz(s.blatt.sheetId, p.zeile, x.spalte, e.turnus && i > 0 && x.vorher === '' ? AUTO_NOTIZ : ''));
    const neuerTurnus = e.turnus && (taktAusTurnus(p.turnus) !== takt || !p.turnus) ? (TURNUS_TEXT[takt] || 'Monatlich') : null;
    if (neuerTurnus) extra.push(updateText(s.blatt.sheetId, p.zeile, s.monate[0].spalte - 1, neuerTurnus));
    await batch(id, extra);

    await logBlatt(id, info);
    await api(SHEETS + '/' + id + '/values/' + encodeURIComponent(q(LOG_BLATT) + '!A:I') + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', {
      method: 'POST',
      body: { values: plan.map(x => [jetztText(), s.monate[x.m - 1].name, p.name, betrag, p.zeile, x.spalte, "'" + x.vorher, "'" + String(x.nachher), '']) }
    });
    return { neueWerte: neueWerte, turnus: neuerTurnus, verlauf: await verlauf(id) };
  }

  async function rueckgaengig(id, logZeile) {
    const info = await blaetter(id);
    const s = await struktur(id, info);
    const [z] = await werteHolen(id, [q(LOG_BLATT) + '!A' + logZeile + ':I' + logZeile], 'UNFORMATTED_VALUE');
    const r = z[0] || [];
    if (r[8] === 'rueckgaengig') throw new Error('Schon rückgängig gemacht.');
    const zeile = Number(r[4]), spalte = Number(r[5]), vorher = String(r[6] === undefined ? '' : r[6]), nachher = String(r[7]);
    const aktuell = await formelHolen(id, zelle(s.blatt.title, zeile, spalte));
    const passt = nachher.charAt(0) === '=' ? String(aktuell) === nachher : Number(aktuell) === Number(nachher);
    if (!passt) throw new Error('Die Zelle wurde inzwischen weiter geändert. Bitte direkt in der Tabelle korrigieren.');
    const zurueck = [updateZelle(s.blatt.sheetId, zeile, spalte, vorher === '' ? '' : (vorher.charAt(0) === '=' ? vorher : Number(vorher)))];
    if (vorher === '') zurueck.push(notiz(s.blatt.sheetId, zeile, spalte, ''));
    await batch(id, zurueck);
    await api(SHEETS + '/' + id + '/values/' + encodeURIComponent(q(LOG_BLATT) + '!I' + logZeile) + '?valueInputOption=RAW', { method: 'PUT', body: { values: [['rueckgaengig']] } });
    return { verlauf: await verlauf(id), struktur: await struktur(id) };
  }

  // ---------- Neue Zeilen aus der Vorlage uebernehmen ----------
  // Ergaenzt fehlende Posten (gleicher Bereich, gleiche Kategorie + Bezeichnung) am Ende ihres Bereichs.
  // Betraege werden nicht angefasst. Fehlende ganze Bereiche werden nur gemeldet.
  // Sparziele aus dem Blatt "Ersparnisse - Rücklagen" (Spalten ueber die Kopfzeile erkannt).
  async function sparziele(id, info) {
    info = info || await blaetter(id);
    const blatt = info.blaetter.find(b => /^Ersparnis/i.test(b.title));
    if (!blatt) return [];
    const [z] = await werteHolen(id, [q(blatt.title) + '!A1:Z60'], 'UNFORMATTED_VALUE');
    const kopf = z.findIndex(r => r.some(v => /Zielbestand/i.test(String(v))));
    if (kopf < 0) return [];
    const spalte = re => z[kopf].findIndex(v => re.test(String(v)));
    const cName = spalte(/Sparziel|Rücklage/i), cVerw = spalte(/Verwendung/i), cRate = spalte(/Sparrate/i),
      cStand = spalte(/Stand/i), cZiel = spalte(/Zielbestand/i);
    const ziele = [];
    for (let r = kopf + 1; r < z.length; r++) {
      const name = String((z[r] || [])[cName] || '').trim();
      if (!name) continue;
      if (/^Gesamt/i.test(name)) break;
      const n = c => c < 0 ? 0 : Number((z[r] || [])[c]) || 0;
      ziele.push({ name, verwendung: cVerw < 0 ? '' : String(z[r][cVerw] || '').trim(), rate: n(cRate), stand: n(cStand), ziel: n(cZiel) });
    }
    return ziele;
  }

  // Umbenannte Posten der Vorlage (alter Name -> neuer Name, jeweils "Kategorie - Bezeichnung").
  // Beim Abgleich gelten alter und neuer Name als derselbe Posten, damit keine doppelten Zeilen entstehen.
  // Neue Umbenennungen hier eintragen, BEVOR die Zeile in der Vorlage umbenannt wird.
  const UMBENENNUNGEN = [
    ['Sonstiges - Verkäufe / Rückerstattungen / Boni', 'Sonstiges - Verkäufe / Rückerstattungen'],
    ['Lebensmittel - Supplements, Protein, Creatin', 'Lebensmittel - Supplements / Protein / Creatin'],
    ['Gesundheit - Apotheke, Zuzahlungen & Nahrungsergänzung', 'Gesundheit - Apotheke & Zuzahlungen']
  ];
  const normName = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  function kanon(name) {
    const n = normName(name);
    const u = UMBENENNUNGEN.find(x => normName(x[0]) === n);
    return u ? normName(u[1]) : n;
  }

  // Bringt alte Posten-Namen in der Datei auf den neuen Stand. Gibt es den neuen Namen schon
  // (doppelte Zeile), wird die alte Zeile nur entfernt, wenn sie in allen Monaten leer ist.
  // Betraege werden nie geloescht.
  async function namenAktualisieren(id) {
    const s = await struktur(id);
    const alle = [].concat.apply([], s.bereiche.map(b => b.posten));
    const umbenennen = [], loeschen = [], ergebnis = { umbenannt: [], entfernt: [], doppelt: [] };
    UMBENENNUNGEN.forEach(([alt, neu]) => {
      const p = alle.find(x => normName(x.name) === normName(alt));
      if (!p) return;
      const schonDa = alle.some(x => x !== p && normName(x.name) === normName(neu));
      if (!schonDa) {
        const bez = neu.slice(neu.indexOf(' - ') + 3);
        umbenennen.push(updateText(s.blatt.sheetId, p.zeile, 3, bez));
        ergebnis.umbenannt.push(p.bezeichnung + ' → ' + bez);
      } else if (p.werte.every(w => !w)) {
        loeschen.push(p.zeile);
        ergebnis.entfernt.push(p.bezeichnung);
      } else ergebnis.doppelt.push(p.bezeichnung);
    });
    const anfragen = umbenennen.concat(loeschen.sort((a, b) => b - a).map(z => ({
      deleteDimension: { range: { sheetId: s.blatt.sheetId, dimension: 'ROWS', startIndex: z - 1, endIndex: z } }
    })));
    if (anfragen.length) await batch(id, anfragen);
    return ergebnis;
  }

  // Nur pruefen: welche Posten der Vorlage fehlen in dieser Datei? (fuer den Hinweis beim Start)
  async function fehlendeAusVorlage(id) {
    const norm = kanon;
    const [vorlage, eigene] = await Promise.all([struktur(CFG.VORLAGE_ID), struktur(id)]);
    const fehlend = [];
    vorlage.bereiche.forEach(vb => {
      const b = eigene.bereiche.find(x => norm(x.name) === norm(vb.name));
      if (!b) return;
      vb.posten.forEach(vp => { if (!b.posten.some(x => norm(x.name) === norm(vp.name))) fehlend.push(vp.name); });
    });
    return fehlend;
  }

  async function vorlageAbgleichen(id) {
    await namenAktualisieren(id);
    const vorlage = await struktur(CFG.VORLAGE_ID);
    const vorlageZeilen = await werteHolen(CFG.VORLAGE_ID, [q(vorlage.blatt.title) + '!A1:Z300'], 'FORMULA');
    const ergebnis = { neu: [], fehlendeBereiche: [] };
    const norm = kanon;

    for (const vb of vorlage.bereiche) {
      let s = await struktur(id);
      const b = s.bereiche.find(x => norm(x.name) === norm(vb.name));
      if (!b) { ergebnis.fehlendeBereiche.push(vb.name); continue; }
      for (const vp of vb.posten) {
        if (b.posten.some(x => norm(x.name) === norm(vp.name))) continue;
        s = await struktur(id);
        const bb = s.bereiche.find(x => norm(x.name) === norm(vb.name));
        const letzte = bb.posten.length ? bb.posten[bb.posten.length - 1].zeile : null;
        if (!letzte) { ergebnis.fehlendeBereiche.push(vb.name + ' (leer)'); break; }
        const neueZeile = letzte + 1;
        const quelle = vorlageZeilen[0][vp.zeile - 1] || [];
        const anfragen = [{
          insertDimension: { range: { sheetId: s.blatt.sheetId, dimension: 'ROWS', startIndex: neueZeile - 1, endIndex: neueZeile }, inheritFromBefore: true }
        }];
        // Texte (Kategorie, Bezeichnung, Turnus, Anmerkungen) und Formeln ausserhalb der Monate uebernehmen
        const monatsSpalten = s.monate.map(m => m.spalte);
        const werte = [];
        for (let c = 1; c <= Math.max(quelle.length, 18); c++) {
          let v = quelle[c - 1];
          if (monatsSpalten.indexOf(c) >= 0 || v === undefined || v === '') { werte.push({}); continue; }
          if (typeof v === 'string' && v.charAt(0) === '=') {
            // Zeilenbezuege der Vorlagenzeile auf die neue Zeile umschreiben, z.B. SUM(E41:P41)
            v = v.replace(new RegExp('([A-Z]{1,2})' + vp.zeile + '(?![0-9])', 'g'), '$1' + neueZeile);
            werte.push({ userEnteredValue: { formulaValue: v } });
          } else if (typeof v === 'number') werte.push({ userEnteredValue: { numberValue: v } });
          else werte.push({ userEnteredValue: { stringValue: String(v) } });
        }
        anfragen.push({
          updateCells: {
            range: { sheetId: s.blatt.sheetId, startRowIndex: neueZeile - 1, endRowIndex: neueZeile, startColumnIndex: 0, endColumnIndex: werte.length },
            rows: [{ values: werte }], fields: 'userEnteredValue'
          }
        });
        await batch(id, anfragen);
        // Zwischensumme des Bereichs um die neue Zeile erweitern (z.B. SUM(E39:E45) -> SUM(E39:E46))
        if (bb.zwischensumme) {
          const zs = bb.zwischensumme + 1; // durch das Einfuegen eine Zeile tiefer
          const [zr] = await werteHolen(id, [q(s.blatt.title) + '!A' + zs + ':Z' + zs], 'FORMULA');
          const zeileFormeln = zr[0] || [];
          const updates = [];
          zeileFormeln.forEach((f, i) => {
            if (typeof f !== 'string' || f.charAt(0) !== '=') return;
            const neuF = f.replace(new RegExp(':([A-Z]{1,2})' + letzte + '(?![0-9])', 'g'), ':$1' + neueZeile);
            if (neuF !== f) updates.push(updateZelle(s.blatt.sheetId, zs, i + 1, neuF));
          });
          if (updates.length) await batch(id, updates);
        }
        b.posten.push(vp);
        ergebnis.neu.push(vp.name);
      }
    }
    return ergebnis;
  }

  // ---------- Turnus-Automatik (Apps Script in der Tabelle) ----------
  // Das Skript (turnus-skript.gs) verteilt Betraege bei Eingaben direkt in der Tabelle nach dem Turnus.
  // Die App legt es ueber die Apps-Script-API als an die Tabelle gebundenes Projekt an. Ein Merkmal
  // (Developer Metadata) in der Tabelle zeigt, dass es eingerichtet ist; es wandert bei Kopien
  // (neues Jahr) zusammen mit dem Skript mit.
  const SKRIPT_MERKMAL = 'finanzplanerTurnusSkript';
  const SKRIPT_VERSION = '3';
  const SCRIPT_API = 'https://script.googleapis.com/v1/projects';
  const TURNUS_LISTE = ['Variabel', 'Monatlich', 'alle 2 Monate', 'Quartalsweise', 'alle 4 Monate', 'Halbjährlich', 'Jährlich'];

  async function turnusSkriptVersion(id) {
    const d = await api(SHEETS + '/' + id + '?fields=developerMetadata(metadataKey,metadataValue)');
    const m = (d.developerMetadata || []).find(x => x.metadataKey === SKRIPT_MERKMAL);
    return m ? m.metadataValue : null;
  }

  // Merkmal setzen, ohne ein Skript anzulegen (wenn es schon von Hand eingefuegt wurde)
  async function turnusSkriptMerken(id) {
    await batch(id, [{ createDeveloperMetadata: { developerMetadata: {
      metadataKey: SKRIPT_MERKMAL, metadataValue: SKRIPT_VERSION, location: { spreadsheet: true }, visibility: 'DOCUMENT'
    } } }]);
  }

  async function turnusSkriptEinrichten(id) {
    const code = await (await fetch('turnus-skript.gs', { cache: 'no-cache' })).text();
    if (code.indexOf('function onEdit') < 0) throw new Error('Skript-Datei nicht gefunden.');
    const projekt = await api(SCRIPT_API, { method: 'POST', body: { title: 'Turnus-Automatik', parentId: id } });
    await api(SCRIPT_API + '/' + projekt.scriptId + '/content', {
      method: 'PUT',
      body: { files: [
        { name: 'appsscript', type: 'JSON', source: JSON.stringify({ timeZone: 'Europe/Berlin', runtimeVersion: 'V8', exceptionLogging: 'STACKDRIVER' }) },
        { name: 'Turnus', type: 'SERVER_JS', source: code }
      ] }
    });
    // Auswahlliste in Spalte D fuer alle Posten; variable Kosten auf „Variabel“ stellen,
    // damit „Monatlich“ dort nicht jeden Einkauf in alle Monate kopiert
    const s = await struktur(id);
    const spalte = s.monate[0].spalte - 1;
    const regel = { condition: { type: 'ONE_OF_LIST', values: TURNUS_LISTE.map(v => ({ userEnteredValue: v })) }, strict: false, showCustomUi: true };
    const anfragen = [];
    s.bereiche.forEach(b => b.posten.forEach(p => {
      if (p.auto) return;
      const bereich = { sheetId: s.blatt.sheetId, startRowIndex: p.zeile - 1, endRowIndex: p.zeile, startColumnIndex: spalte - 1, endColumnIndex: spalte };
      anfragen.push({ setDataValidation: { range: bereich, rule: regel } });
      const schwankend = /VARIABLE/i.test(b.name) ||
        (/EINNAHMEN/i.test(b.name) && /dividend|zinsen|verkäuf|rückerstatt|bonus|sonderzahl|freelance|selbstständ|geldgeschenk|cashback|prämie/i.test(p.bezeichnung));
      if (schwankend && /^\s*monatlich\s*$|^\s*$/i.test(p.turnus || '')) {
        anfragen.push({ updateCells: { range: bereich, rows: [{ values: [{ userEnteredValue: { stringValue: 'Variabel' } }] }], fields: 'userEnteredValue' } });
      }
    }));
    anfragen.push({ createDeveloperMetadata: { developerMetadata: {
      metadataKey: SKRIPT_MERKMAL, metadataValue: SKRIPT_VERSION, location: { spreadsheet: true }, visibility: 'DOCUMENT'
    } } });
    await batch(id, anfragen);
  }

  // ---------- Finanzierung (Immobilienkredite) ----------
  // Eigenes Blatt "Finanzierung": eine Zeile pro Darlehen. Wird beim Anlegen eines neuen Jahres mitkopiert.
  const FIN_BLATT = 'Finanzierung';
  const FIN_KOPF = ['Immobilie', 'Kaufpreis inkl. Nebenkosten', 'Eigenkapital', 'Kreditart', 'Bank', 'Darlehenssumme',
    'Sollzins % p.a.', 'Anfängliche Tilgung % p.a.', 'Monatsrate', 'Beginn (JJJJ-MM)', 'Zinsbindung (Jahre)', 'Sondertilgung % p.a.', 'Notiz', 'ID',
    'Tilgungskonto Guthaben', 'Guthaben Stand (JJJJ-MM)', 'Tilgungskonto Sparrate / Monat', 'Tilgungskonto Zinsen % p.a.', 'Laufzeit (Jahre)'];
  const FIN_FELDER = ['immobilie', 'kaufpreis', 'eigenkapital', 'art', 'bank', 'summe', 'zins', 'tilgung', 'rate', 'beginn', 'bindung', 'sonder', 'notiz', 'id', 'guthaben', 'guthabenStand', 'sparrate', 'sparzins', 'laufzeit'];

  async function finanzierungLaden(id) {
    const info = await blaetter(id);
    if (!info.blaetter.find(b => b.title === FIN_BLATT)) return [];
    const [z] = await werteHolen(id, [q(FIN_BLATT) + '!A2:S200'], 'UNFORMATTED_VALUE');
    return z.filter(r => r && r[0]).map(r => {
      const d = {};
      FIN_FELDER.forEach((f, i) => { d[f] = r[i] === undefined ? '' : r[i]; });
      ['kaufpreis', 'eigenkapital', 'summe', 'zins', 'tilgung', 'rate', 'bindung', 'sonder', 'guthaben', 'sparrate', 'sparzins', 'laufzeit'].forEach(f => { d[f] = Number(String(d[f]).replace(',', '.')) || 0; });
      d.beginn = String(d.beginn); d.guthabenStand = String(d.guthabenStand); d.id = String(d.id || Math.random().toString(36).slice(2, 9));
      return d;
    });
  }

  async function finanzierungSpeichern(id, liste) {
    const info = await blaetter(id);
    if (!info.blaetter.find(b => b.title === FIN_BLATT)) {
      await batch(id, [{ addSheet: { properties: { title: FIN_BLATT, gridProperties: { frozenRowCount: 1 } } } }]);
    }
    await api(SHEETS + '/' + id + '/values/' + encodeURIComponent(q(FIN_BLATT) + '!A2:S200') + ':clear', { method: 'POST', body: {} });
    const zeilen = [FIN_KOPF].concat(liste.map(d => FIN_FELDER.map(f => d[f] === undefined ? '' : d[f])));
    await api(SHEETS + '/' + id + '/values/' + encodeURIComponent(q(FIN_BLATT) + '!A1:S' + zeilen.length) + '?valueInputOption=RAW', {
      method: 'PUT', body: { values: zeilen }
    });
  }

  // ---------- Hinweise in der Tabelle ----------
  // Was man in der Tabelle von Hand ändern darf: kurzer Text plus ausführliche Notiz (erscheint beim Darüberfahren).
  // Wird nur in leere Zellen oder über einen früheren Hinweis der App geschrieben.
  const HINWEIS = 'Hinweis zum Bearbeiten: Maus über diese Zelle halten (bzw. antippen) für die Notiz.';
  const NOTIZ_TABELLE = [
    'Was du in der Tabelle von Hand ändern darfst:',
    '• Beträge in den Monatsspalten (Januar bis Dezember) eintragen oder ändern, auch als Rechnung wie =12,50+3.',
    '• Texte in der Spalte mit den Anmerkungen.',
    '• Im Blatt „Ersparnisse - Rücklagen“: Sparrate, aktueller Stand und Zielbestand deiner Sparziele.',
    '• Im Blatt „Finanzierung“: die Werte deiner Kredite (einfacher in der App unter „Immobilien“).',
    '',
    'Bitte nicht:',
    '• Zeilen oder Spalten einfügen, löschen oder verschieben. Neue Posten übernimmt die App aus der Vorlage.',
    '• Blätter umbenennen oder Überschriften, Kategorien und Postennamen ändern. Die App findet alles über diese Namen.',
    '• Zellen mit Formeln überschreiben: Zwischensummen, Gesamtwerte, Fortschritt, verbleibende Monate und alle Zeilen mit „(automatisch)“.'
  ].join('\n');
  const NOTIZ_FINANZIERUNG = [
    'Blatt „Finanzierung“: Hier speichert die App deine Kredite, eine Zeile pro Kredit (berechnet werden die ersten 6).',
    '',
    'Erlaubt: Zahlen ändern (Darlehenssumme, Sollzins, Monatsrate, Zinsbindung, Tilgungskonto). Beginn als JJJJ-MM, z. B. 2026-01.',
    'Wichtig: Die Monatsrate gilt vor der Laufzeit. Wenn du die Laufzeit änderst, passe auch die Monatsrate an, am einfachsten in der App.',
    '',
    'Bitte nicht: Spalten einfügen oder verschieben, Überschriften oder die Spalte ID ändern, Leerzeilen zwischen Krediten lassen.',
    'Kreditart genau so schreiben: „Annuitätendarlehen“ oder „Endfälliges Darlehen“.'
  ].join('\n');
  const NOTIZ_AUTO = 'Rechnet sich automatisch aus dem Blatt „Finanzierung“. Bitte hier nichts eintippen; Kredite in der App unter „Immobilien“ ändern.';

  function notizZelle(sheetId, zeile, spalte, text, notiz, grau) {
    const zelle = { note: notiz };
    let felder = 'note';
    if (text !== null) {
      zelle.userEnteredValue = { stringValue: text };
      felder += ',userEnteredValue';
      if (grau) { zelle.userEnteredFormat = { textFormat: { italic: true, foregroundColor: { red: 0.42, green: 0.45, blue: 0.5 } } }; felder += ',userEnteredFormat.textFormat'; }
    }
    return { updateCells: { range: { sheetId, startRowIndex: zeile - 1, endRowIndex: zeile, startColumnIndex: spalte - 1, endColumnIndex: spalte }, rows: [{ values: [zelle] }], fields: felder } };
  }

  async function hinweiseSchreiben(id, info) {
    info = info || await blaetter(id);
    const anfragen = [];
    const frei = v => !String(v || '').trim() || String(v).indexOf('Hinweis') === 0;
    const monat = info.blaetter.find(s => /^Monats/i.test(s.title));
    const spar = info.blaetter.find(b => /^Ersparnis/i.test(b.title));
    const fin = info.blaetter.find(b => b.title === FIN_BLATT);
    const bereiche = [];
    if (monat) bereiche.push(q(monat.title) + '!B3');
    if (spar) bereiche.push(q(spar.title) + '!B3');
    if (fin) bereiche.push(q(fin.title) + '!U1');
    const w = bereiche.length ? await werteHolen(id, bereiche, 'FORMATTED_VALUE') : [];
    let i = 0;
    const wert = () => { const r = w[i++] || []; return (r[0] || [])[0]; };
    if (monat && frei(wert())) anfragen.push(notizZelle(monat.sheetId, 3, 2, HINWEIS, NOTIZ_TABELLE, true));
    if (spar && frei(wert())) anfragen.push(notizZelle(spar.sheetId, 3, 2, HINWEIS, NOTIZ_TABELLE, true));
    if (fin && frei(wert())) {
      anfragen.push(notizZelle(fin.sheetId, 1, 21, 'Hinweis: Notiz in dieser Zelle lesen, bevor du hier etwas änderst.', NOTIZ_FINANZIERUNG, true));
      anfragen.push(notizZelle(fin.sheetId, 1, 1, null, NOTIZ_FINANZIERUNG));
    }
    if (anfragen.length) await batch(id, anfragen);
    return anfragen.length > 0;
  }

  // Früheres Arbeitsblatt "Immobilienfinanzierung" (Test-Version bis 2026-10-16) entfernen, falls noch vorhanden.
  async function altesBlattEntfernen(id) {
    const info = await blaetter(id);
    const b = info.blaetter.find(x => x.title === 'Immobilienfinanzierung');
    if (!b) return false;
    await batch(id, [{ deleteSheet: { sheetId: b.sheetId } }]);
    return true;
  }

  // Block "Immobilien" im Blatt "Ersparnisse - Rücklagen" anlegen bzw. aktualisieren (Aufbau in ersparnisblock.js).
  // Steht unter den Sparzielen; Formate werden von der Sparziel-Tabelle übernommen.
  async function immobilienErsparnis(id) {
    const EB = window.ErsparnisBlock;
    const info = await blaetter(id);
    const blatt = info.blaetter.find(b => /^Ersparnis/i.test(b.title));
    if (!blatt || !info.blaetter.find(b => b.title === FIN_BLATT)) return false;
    const [z] = await werteHolen(id, [q(blatt.title) + '!A1:L300'], 'FORMATTED_VALUE');
    const text = (r, c) => String(((z[r] || [])[c]) || '').trim();
    let z0 = z.findIndex((r, i) => text(i, 1) === EB.MARKE) + 1;
    const neu = !z0;
    if (neu) z0 = z.length + 2;
    const kopf = z.findIndex((r, i) => i < z0 - 1 && (r || []).some(v => /Zielbestand/i.test(String(v)))) + 1;
    const gesamt = z.findIndex((r, i) => i < z0 - 1 && /^Gesamt/i.test(text(i, 1))) + 1;
    const sid = blatt.sheetId, g = blatt.gridProperties || {};
    const anfragen = [];
    const bisZeile = z0 + EB.ZEILEN;
    if ((g.rowCount || 0) < bisZeile) anfragen.push({ appendDimension: { sheetId: sid, dimension: 'ROWS', length: bisZeile - (g.rowCount || 0) } });
    if ((g.columnCount || 0) < 11) anfragen.push({ appendDimension: { sheetId: sid, dimension: 'COLUMNS', length: 11 - (g.columnCount || 0) } });
    const bereich = (z1, z2, s1, s2) => ({ sheetId: sid, startRowIndex: z1 - 1, endRowIndex: z2, startColumnIndex: s1 - 1, endColumnIndex: s2 });
    const formatVon = (quelle, ziel) => ({ copyPaste: { source: quelle, destination: ziel, pasteType: 'PASTE_FORMAT' } });
    const kz = z0 + 2, d1 = kz + 1, d2 = kz + EB.MAX + 2;
    if (kopf) {
      // Überschriftzeile und Datenzeilen wie die Sparziel-Tabelle formatieren (J und K wie die Euro-Spalte D)
      anfragen.push(formatVon(bereich(kopf, kopf, 2, 9), bereich(kz, kz, 2, 9)),
        formatVon(bereich(kopf, kopf, 4, 4), bereich(kz, kz, 10, 11)),
        formatVon(bereich(kopf + 1, kopf + 1, 2, 9), bereich(d1, d2, 2, 9)),
        formatVon(bereich(kopf + 1, kopf + 1, 4, 4), bereich(d1, d2, 10, 11)));
    }
    anfragen.push(notizZelle(sid, z0 + 1, 2, null, NOTIZ_AUTO));
    EB.zellen(z0, gesamt).forEach(c => {
      const m = /^([A-Z]+)(\d+)$/.exec(c.a1), spalte = m[1].charCodeAt(0) - 64, zeile = Number(m[2]);
      const zelle = { userEnteredValue: c.f !== undefined ? { formulaValue: lokal(c.f, info.locale) } : { stringValue: String(c.v) } };
      let felder = 'userEnteredValue';
      if (c.fett || c.grau || (c.kopf && !kopf)) {
        zelle.userEnteredFormat = { textFormat: { bold: !!(c.fett || c.kopf), italic: !!c.grau } };
        felder += ',userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.italic';
      }
      anfragen.push({ updateCells: { range: bereich(zeile, zeile, spalte, spalte), rows: [{ values: [zelle] }], fields: felder } });
    });
    await batch(id, anfragen);
    try { await hinweiseSchreiben(id, info); } catch (err) { console.warn('Hinweise nicht geschrieben', err); }
    try { await immobilienMonat(id, info); }
    catch (err) { console.warn('Immobilien-Zeilen in der Monatsübersicht nicht angelegt', err); throw new Error('Die Zeilen in der Monatsübersicht konnten nicht angelegt werden: ' + (err.message || err)); }
    return neu;
  }

  // Zeile "Tilgung Immobilie (automatisch)" im Sparbereich der Monatsübersicht: je Monat die Tilgung bzw. Sparrate
  // aller Kredite (Formel aus ersparnisblock.js). Zählt in die Zwischensumme der Sparbeiträge.
  async function immobilienMonat(id, info) {
    const EB = window.ErsparnisBlock;
    info = info || await blaetter(id);
    let s = await struktur(id, info);
    const sid = s.blatt.sheetId;
    // Früheren Block ganz unten (Version 2026-10-16f) wieder entfernen
    const [alt] = await werteHolen(id, [q(s.blatt.title) + '!B1:B400'], 'FORMATTED_VALUE');
    const altZeile = alt.findIndex(r => String((r || [])[0] || '').trim() === EB.MARKE_MONAT_ALT);
    if (altZeile >= 0) {
      await batch(id, [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: altZeile, endIndex: altZeile + 2 * EB.MAX + 6 } } }]);
      s = await struktur(id, info);
    }
    // Tilgung bei den Sparbeiträgen, Zinsen bei den Fixkosten (Wohnen)
    const zeilen = [
      { bereich: x => /SPAR/i.test(x.name), name: EB.ZEILE_MONAT, zinsen: false, notiz: 'Tilgung bzw. Sparrate aufs Tilgungskonto, rechnet sich aus deinen Krediten (Blatt „Finanzierung“)' },
      { bereich: x => /FIXKOSTEN/i.test(x.name) && /WOHNEN/i.test(x.name), name: EB.ZEILE_ZINSEN, zinsen: true, notiz: 'Zinsanteil deiner Kreditraten, rechnet sich aus deinen Krediten (Blatt „Finanzierung“)' }
    ];
    let geschrieben = false;
    const fehler = [];
    for (const def of zeilen) {
     try {
      const b = s.bereiche.find(def.bereich);
      if (!b) throw new Error('Bereich für „' + def.name + '“ nicht gefunden');
      if (!b || !b.posten.length) continue;
      let zeile = (b.posten.find(p => p.bezeichnung === def.name) || {}).zeile;
      if (!zeile) {
        zeile = b.posten[b.posten.length - 1].zeile + 1;
        await batch(id, [{ insertDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: zeile - 1, endIndex: zeile }, inheritFromBefore: true } }]);
        if (b.zwischensumme) {
          const zs = b.zwischensumme + 1, letzte = zeile - 1;
          const [zr] = await werteHolen(id, [q(s.blatt.title) + '!A' + zs + ':Z' + zs], 'FORMULA');
          const updates = [];
          (zr[0] || []).forEach((f, i) => {
            if (typeof f !== 'string' || f.charAt(0) !== '=') return;
            const neuF = f.replace(new RegExp(':([A-Z]{1,2})' + letzte + '(?![0-9])', 'g'), ':$1' + zeile);
            if (neuF !== f) updates.push(updateZelle(sid, zs, i + 1, neuF));
          });
          if (updates.length) await batch(id, updates);
        }
      }
      const datum = s.kopfZeile + 1, sp = n => String.fromCharCode(64 + n);
      const erste = s.monate[0].spalte, letzteSp = s.monate[11].spalte;
      const zellen = [[2, 'Immobilie'], [3, def.name], [4, 'Monatlich']];
      s.monate.forEach(m => zellen.push([m.spalte, lokal(EB.monatsFormel(sp(m.spalte), datum, def.zinsen), info.locale)]));
      zellen.push([letzteSp + 1, lokal('=SUM(' + sp(erste) + zeile + ':' + sp(letzteSp) + zeile + ')', info.locale)]);
      zellen.push([letzteSp + 2, def.notiz]);
      await batch(id, [notizZelle(sid, zeile, 3, null, NOTIZ_AUTO)].concat(zellen.map(([c, v]) => ({
        updateCells: {
          range: { sheetId: sid, startRowIndex: zeile - 1, endRowIndex: zeile, startColumnIndex: c - 1, endColumnIndex: c },
          rows: [{ values: [{ userEnteredValue: v.charAt(0) === '=' ? { formulaValue: v } : { stringValue: v } }] }], fields: 'userEnteredValue'
        }
      }))));
      geschrieben = true;
     } catch (err) {
      console.warn(def.name, err);
      fehler.push(def.name + ': ' + (err.message || err));
     }
      // Nach dem Einfügen verschieben sich die Zeilen darunter: Struktur neu lesen
      s = await struktur(id, info);
    }
    if (fehler.length) throw new Error(fehler.join(' | '));
    return geschrieben;
  }

  window.Google = {
    TEST, anmelden, abmelden, tokenAusAdresse, token, restMinuten, nutzer, NichtAngemeldet,
    meineDateien, kandidaten, verbinden, ersterFinanzplaner, jahrAnlegen,
    SKRIPT_SCOPE, struktur, verlauf, blaetter, hinzufuegen, taktAusTurnus, turnusSkriptVersion, turnusSkriptEinrichten, turnusSkriptMerken, rueckgaengig, vorlageAbgleichen, namenAktualisieren, kontenAuswahl, kontenAuswahlSpeichern, normName, fehlendeAusVorlage, sparziele, finanzierungLaden, finanzierungSpeichern, altesBlattEntfernen, immobilienErsparnis, hinweiseSchreiben
  };
})();
