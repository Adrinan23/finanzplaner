# Finanzplaner

Installierbare Web-App (PWA), mit der man Einnahmen und Ausgaben direkt in den eigenen
Finanzplaner (Google Tabelle im eigenen Google Drive) einträgt. Läuft auf GitHub Pages,
die Daten bleiben im Drive jedes Nutzers.

## Funktionen

- Untere Leiste: Einnahmen, Fixkosten, Variabel, Sparen (Zuordnung über die Bereichsüberschrift)
- Betrag wird an die Monatszelle angehängt (`=25.09+7.17` → `=25.09+7.17+12.5`)
- „Monatlich wiederholen bis …“ für wiederkehrende Beträge
- Verlauf mit „Rückgängig“ (Protokoll im Blatt „Eingaben“)
- Eine Datei pro Jahr; ein neues Jahr wird aus dem eigenen Vorjahr erzeugt (Beträge leer)
- „Neue Zeilen aus Vorlage übernehmen“: ergänzt fehlende Posten aus der Vorlage in allen eigenen Jahren
- Erster Start: bestehenden Finanzplaner verbinden oder aus der Vorlage neu anlegen

## Einrichtung (einmalig)

### 1. Google-Cloud-Projekt

1. <https://console.cloud.google.com> öffnen, neues Projekt „Finanzplaner-App“ anlegen.
2. „APIs & Dienste → Bibliothek“: **Google Drive API** und **Google Sheets API** aktivieren.
3. „Google Auth Platform“ (OAuth-Zustimmungsbildschirm): Typ **Extern**, App-Name „Finanzplaner-App“,
   Support-E-Mail eintragen. Unter **Zielgruppe → Testnutzer** alle E-Mail-Adressen eintragen,
   die die App nutzen dürfen.
4. „Clients → Client erstellen“: Typ **Webanwendung**
   - Autorisierte JavaScript-Quellen: `https://<github-name>.github.io`
   - Autorisierte Weiterleitungs-URIs: `https://<github-name>.github.io/finanzplaner/`
5. Die angezeigte **Client-ID** in `config.js` bei `CLIENT_ID` eintragen.

### 2. GitHub Pages

Repository `finanzplaner` → Settings → Pages → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
Die App ist dann unter `https://<github-name>.github.io/finanzplaner/` erreichbar.

### 3. Vorlage

`config.js` → `VORLAGE_ID` zeigt auf die leere Google Tabelle „Finanzplaner (Vorlage)“.
Sie muss per Link für alle lesbar sein (Teilen → „Jeder, der über den Link verfügt“ → Betrachter).

## Neue Nutzer

1. E-Mail-Adresse im Google-Cloud-Projekt als Testnutzer eintragen.
2. Link schicken. Auf dem Handy: iPhone (Safari) Teilen → „Zum Home-Bildschirm“,
   Android (Chrome) Menü → „App installieren“.

## Updates

Änderungen ins Repository hochladen. Die App lädt immer zuerst die neueste Version aus dem Netz,
alle Nutzer haben sie beim nächsten Öffnen.
