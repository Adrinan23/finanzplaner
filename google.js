// Anmeldung bei Google und Zugriff auf die Finanzplaner-Tabellen (Drive + Sheets API).
// Jeder Nutzer arbeitet mit seinem eigenen Konto; die Dateien liegen in seinem Drive.
// Die Dateien der App sind in Drive mit appProperties { kostenApp: '1', jahr: '2026' } markiert.

(function () {
  const CFG = window.KOSTEN_CONFIG;
  const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets';
  const LOG_BLATT = 'Eingaben';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

  function lies(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function schreib(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }

  // ---------- Anmeldung (OAuth-Weiterleitung, funktioniert auch als installierte App auf dem iPhone) ----------

  function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

  function anmelden(still) {
    const p = new URLSearchParams({
      client_id: CFG.CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: SCOPES,
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
          name: b + ' - ' + c, kategorie: b, bezeichnung: c, zeile: r + 1,
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
      q: "appProperties has { key='kostenApp' and value='1' } and trashed=false and 'me' in owners",
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
    return d.files.filter(f => f.id !== CFG.VORLAGE_ID && !(f.appProperties && f.appProperties.kostenApp));
  }

  async function jahrDerDatei(id) {
    const s = await struktur(id);
    if (s.jahr) return s.jahr;
    const m = (s.titel + ' ' + s.blatt.title).match(/20\d\d/);
    return m ? Number(m[0]) : new Date().getFullYear();
  }

  // Bestehende Tabelle als Finanzplaner markieren (Jahr erkennen, Jahr an den Namen haengen).
  async function verbinden(id) {
    const jahr = await jahrDerDatei(id);
    const meine = await meineDateien();
    if (meine[jahr] && meine[jahr].id !== id) throw new Error('Für ' + jahr + ' ist schon ein Finanzplaner verbunden.');
    const f = await api(DRIVE + '/files/' + id + '?fields=name');
    const name = f.name.indexOf(String(jahr)) >= 0 ? f.name : f.name.trim() + ' ' + jahr;
    await api(DRIVE + '/files/' + id, { method: 'PATCH', body: { name: name, appProperties: { kostenApp: '1', jahr: String(jahr) } } });
    return jahr;
  }

  // Kopiert eine Datei und stellt sie auf ein neues Jahr ein.
  // leeren=true: alle Monatsbetraege und das Eingabe-Protokoll entfernen (fuer das Vorjahr als Vorlage).
  async function kopieFuerJahr(quelleId, name, jahr, leeren) {
    const kopie = await api(DRIVE + '/files/' + quelleId + '/copy?fields=id', {
      method: 'POST', body: { name: name, appProperties: { kostenApp: '1', jahr: String(jahr) } }
    });
    const id = kopie.id;
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
    await kopieFuerJahr(CFG.VORLAGE_ID, 'Finanzplaner - ' + name + ' ' + jahr, jahr, false);
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
    const basis = quelle.name.replace(/\s*20\d\d\s*$/, '').trim();
    await kopieFuerJahr(quelle.id, basis + ' ' + jahr, jahr, true);
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
    const start = Math.max(0, z.length - 30);
    return z.slice(start).map((r, i) => ({
      logZeile: start + i + 2,
      zeit: typeof r[0] === 'number' ? ausSerial(r[0]).toISOString() : String(r[0] || ''),
      monat: r[1], posten: r[2], betrag: Number(r[3]), storniert: r[8] === 'rueckgaengig'
    })).filter(e => e.posten).reverse();
  }

  function jetztText() {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
  }

  // Haengt den Betrag an die Monatszellen von "monat" bis "bisMonat" an.
  async function hinzufuegen(id, e) {
    const betrag = Math.round(Number(e.betrag) * 100) / 100;
    if (!betrag || !isFinite(betrag)) throw new Error('Ungültiger Betrag.');
    const info = await blaetter(id);
    const s = await struktur(id, info);
    const von = Number(e.monat), bis = Math.max(von, Math.min(12, Number(e.bisMonat) || von));
    const alle = [].concat.apply([], s.bereiche.map(b => b.posten));
    const p = alle.find(x => x.zeile === Number(e.zeile) && x.name === e.posten) || alle.find(x => x.name === e.posten);
    if (!p) throw new Error('Posten nicht gefunden. Bitte App neu laden.');

    const refs = [];
    for (let m = von; m <= bis; m++) refs.push(zelle(s.blatt.title, p.zeile, s.monate[m - 1].spalte));
    const formeln = await werteHolen(id, refs, 'FORMULA');

    // Formel bauen. Je nach Sprache der Tabelle wird "12.5" oder "12,5" als Zahl gelesen;
    // deshalb mit dem passenden Dezimalzeichen schreiben, pruefen und notfalls das andere versuchen.
    function bauePlan(sep) {
      const plan = [];
      for (let m = von; m <= bis; m++) {
        const roh = formeln[m - von].length ? formeln[m - von][0][0] : '';
        const dazu = betrag < 0 ? zahl(betrag, sep) : '+' + zahl(betrag, sep);
        let vorher, nachher;
        if (roh === '' || roh === null || roh === undefined) { vorher = ''; nachher = betrag; }
        else if (typeof roh === 'number') { vorher = roh; nachher = '=' + zahl(roh, sep) + dazu; }
        else if (String(roh).charAt(0) === '=') { vorher = roh; nachher = roh + dazu; }
        else throw new Error('Die Zelle im ' + s.monate[m - 1].name + ' enthält Text und wird nicht verändert.');
        plan.push({ m: m, spalte: s.monate[m - 1].spalte, vorher: vorher, nachher: nachher, erwartet: (p.werte[m - 1] || 0) + betrag });
      }
      return plan;
    }

    const erstes = dezimalzeichen(info.locale);
    let plan = null, neueWerte = {}, gefunden = null;
    for (const sep of [erstes, erstes === ',' ? '.' : ',']) {
      plan = bauePlan(sep);
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

    await logBlatt(id, info);
    await api(SHEETS + '/' + id + '/values/' + encodeURIComponent(q(LOG_BLATT) + '!A:I') + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', {
      method: 'POST',
      body: { values: plan.map(x => [jetztText(), s.monate[x.m - 1].name, p.name, betrag, p.zeile, x.spalte, "'" + x.vorher, "'" + String(x.nachher), '']) }
    });
    return { neueWerte: neueWerte, verlauf: await verlauf(id) };
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
    await batch(id, [updateZelle(s.blatt.sheetId, zeile, spalte, vorher === '' ? '' : (vorher.charAt(0) === '=' ? vorher : Number(vorher)))]);
    await api(SHEETS + '/' + id + '/values/' + encodeURIComponent(q(LOG_BLATT) + '!I' + logZeile) + '?valueInputOption=RAW', { method: 'PUT', body: { values: [['rueckgaengig']] } });
    return { verlauf: await verlauf(id), struktur: await struktur(id) };
  }

  // ---------- Neue Zeilen aus der Vorlage uebernehmen ----------
  // Ergaenzt fehlende Posten (gleicher Bereich, gleiche Kategorie + Bezeichnung) am Ende ihres Bereichs.
  // Betraege werden nicht angefasst. Fehlende ganze Bereiche werden nur gemeldet.
  async function vorlageAbgleichen(id) {
    const vorlage = await struktur(CFG.VORLAGE_ID);
    const vorlageZeilen = await werteHolen(CFG.VORLAGE_ID, [q(vorlage.blatt.title) + '!A1:Z300'], 'FORMULA');
    const ergebnis = { neu: [], fehlendeBereiche: [] };
    const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase();

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

  window.Google = {
    anmelden, abmelden, tokenAusAdresse, token, restMinuten, nutzer, NichtAngemeldet,
    meineDateien, kandidaten, verbinden, ersterFinanzplaner, jahrAnlegen,
    struktur, verlauf, blaetter, hinzufuegen, rueckgaengig, vorlageAbgleichen
  };
})();
