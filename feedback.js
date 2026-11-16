// Feedback und Fehler melden (unter „Weitere“).
// Kein Google-Zugriff noetig: die App oeffnet eine vorausgefuellte E-Mail an KOSTEN_CONFIG.FEEDBACK_EMAIL
// (inkl. App-Version und Geraet). Keine Finanzdaten werden mitgeschickt.
(function () {
  const $ = id => document.getElementById(id);
  const ARTEN = { fehler: 'Fehler', idee: 'Idee / Wunsch', sonstiges: 'Sonstiges' };
  let art = 'fehler';

  function version() {
    const v = document.querySelector('#fuss .sub');
    return v ? v.textContent.replace(/^Version\s*/, '') : '?';
  }
  function geraet() {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'anderes Gerät';
    const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? ', als App installiert' : '';
    return os + ', ' + browser + app + ', Bildschirm ' + screen.width + '×' + screen.height;
  }
  function info() {
    return [
      'App-Version: ' + version() + (/finanzplaner-test/.test(location.pathname) ? ' (TESTVERSION)' : ''),
      'Gerät: ' + geraet(),
      'Gemeldet am: ' + new Date().toLocaleString('de-DE')
    ].join('\n');
  }
  function text() {
    const nachricht = $('feedbackText').value.trim();
    return 'Art: ' + ARTEN[art] + '\n\n' + nachricht + '\n\n---\n' + info();
  }
  function betreff() {
    const anfang = $('feedbackText').value.trim().split('\n')[0].slice(0, 50);
    return 'Finanzplaner ' + ARTEN[art] + (anfang ? ': ' + anfang : '');
  }
  function hinweis(t) { $('meldungFeedback').textContent = t || ''; }
  function setzeArt(w) {
    art = w;
    document.querySelectorAll('#feedbackArt button').forEach(b => b.classList.toggle('aktiv', b.dataset.wert === w));
    $('feedbackText').placeholder = w === 'fehler'
      ? 'Was ist passiert? Was hast du gerade gemacht (z. B. welcher Tab, welcher Posten)? Was hättest du erwartet?'
      : w === 'idee' ? 'Was wünschst du dir? Wofür würdest du es nutzen?' : 'Deine Nachricht';
  }

  function oeffnen() {
    setzeArt('fehler'); hinweis('');
    $('feedbackInfo').textContent = 'Wird automatisch mitgeschickt (keine Beträge oder Tabelleninhalte):\n' + info();
    $('feedback').hidden = false;
    $('feedbackText').focus();
  }
  function schliessen() { $('feedback').hidden = true; }

  function leer() {
    if ($('feedbackText').value.trim()) return false;
    hinweis('Bitte schreib kurz, worum es geht.'); $('feedbackText').focus(); return true;
  }

  function mail() {
    if (leer()) return;
    const an = (window.KOSTEN_CONFIG || {}).FEEDBACK_EMAIL || '';
    location.href = 'mailto:' + encodeURIComponent(an).replace('%40', '@') +
      '?subject=' + encodeURIComponent(betreff()) + '&body=' + encodeURIComponent(text());
    hinweis('Dein E-Mail-Programm öffnet sich mit der fertigen Nachricht. Bitte dort noch auf „Senden“ tippen. Öffnet sich nichts, nutze „Text kopieren“.');
  }
  function kopieren() {
    if (leer()) return;
    const t = betreff() + '\n\n' + text();
    const ok = () => hinweis('Kopiert. Du kannst den Text jetzt z. B. per WhatsApp oder E-Mail schicken.');
    const notfall = () => {
      const feld = $('feedbackText'), vorher = feld.value;
      feld.value = t; feld.select();
      let geklappt = false;
      try { geklappt = document.execCommand('copy'); } catch (e) { /* nichts */ }
      if (geklappt) { feld.value = vorher; ok(); } else hinweis('Kopieren ging nicht. Der komplette Text steht jetzt oben im Feld, bitte markieren und kopieren.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, notfall);
    else notfall();
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('feedback')) return;
    $('zuFeedback').onclick = oeffnen;
    $('feedbackAbbrechen').onclick = schliessen;
    $('feedbackMail').onclick = mail;
    $('feedbackKopieren').onclick = kopieren;
    $('feedback').onclick = e => { if (e.target === $('feedback')) schliessen(); };
    document.querySelectorAll('#feedbackArt button').forEach(b => { b.onclick = () => setzeArt(b.dataset.wert); });
  });
})();
