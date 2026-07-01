# Visuelles Redesign, erweiterte Statistiken & Professionalisierung

Status: Vom Nutzer freigegeben (Mockups im Chat besprochen), bereit für Implementierungsplan.

## Kontext

Nach der Migration Supabase → Neon (siehe `CLAUDE.md`) funktionieren Sinnsuche und Statistiken technisch einwandfrei. Dieser Spec behandelt den nächsten Schritt: das Erscheinungsbild überarbeiten, die Statistik-Seite um zwei neue, vom Nutzer vorgeschlagene Auswertungen erweitern, und das Projekt insgesamt "professioneller" wirken lassen (Favicon, Meta-Tags, Fehler-/Ladezustände, README, ehrliche Projektbeschreibung).

Referenzpunkt für den visuellen Stil: der Screenshot der echten ZEIT-ONLINE-Podcastseite (bold sans-serif Headlines, geometrisches Logo-Badge, gestuftes Dunkelgrau statt Tiefschwarz, roter Akzent für Kategorie-Tags).

## 1. Visuelles System

### Logo
Neues eigenes SVG-Icon: stilisierte Bergsilhouette (drei überlappende Dreiecke, mittleres am höchsten) mit kleinem Stern/Gipfel-Akzent in Orange. Ersetzt kein bestehendes Icon (gab bisher keins). Wird verwendet als:
- Header-Icon neben dem Namen "Transalpine" (Wortmarke, kein Bild-Logo-Only)
- Favicon (mehrere Größen, `.ico` + SVG)
- Open-Graph-Bild-Basis (siehe Abschnitt 4)

### Farben
Bestehende CSS-Variablen in `globals.css` bleiben als Basis, ergänzt um:
- Neuer Akzent `--accent-orange: #e2673a` (und `--accent-orange-rgb`) — für Sektions-Marker, aktive Tabs, Tag-artige Labels. Bestehendes `--accent-gold` (#c5a880) bleibt zweiter Akzent (z.B. für Zahlen/KPIs).
- Gestufte Oberflächen: `--surface` bleibt Basis-Panel-Farbe, neue Variable `--surface-elevated: #1c1f22` und `--surface-elevated-2: #26292d` für verschachtelte "erhobene" Panels (Hero-Karte auf Seitenhintergrund, Bento-Kacheln auf Hero-Karte) — vermeidet den "zu dunklen/leeren" Eindruck aus dem ersten Entwurf.

### Typografie
Kein grundsätzlicher Font-Wechsel. `--font-serif` (Playfair Display) wird zurückhaltender eingesetzt (z.B. nur noch für die große Zahl in Feature-Karten), Sektionstitel und Fließtext-Hervorhebungen nutzen konsequent `--font-sans` (Inter) mit `font-weight: 700–800`, wie in den freigegebenen Mockups.

### Layout: Stats-Hero als Bento-Grid
Ersetzt die aktuelle 4-Kacheln-Reihe (`statsGrid`) durch ein Bento-Grid:
- Große Feature-Karte (spannt 2 Zeilen): "Archiv-Umfang" — Gesamtzahl Chunks groß, Episodenzahl + Zeitraum als Fußzeile. Bekommt einen `box-shadow`-Glow in Orange (subtil, `opacity` niedrig) statt der aktuellen Top-Border-Gradient-Linie.
- Rechts daneben, im 2×2-Raster: **Episoden** (Zahl), **Audio-Stunden** (Zahl), **Redeanteil-Sieger** (Host mit höchstem Sprechanteil + %, mit korrektem SVG-Flaggen-Icon statt Emoji), **Wortschatz-Sieger** (Host mit den meisten unterschiedlichen Wörtern).

Wichtig: **"Patriotismus-König" und "Flüssiges Gold" verschwinden aus der Hero-Zeile.** Sie bleiben als Statistiken erhalten, wandern aber:
- Der bisherige "Patriotismus-König"-Wert (meiste Eigenland-Nennungen) wird sachlich umbenannt zu **"Eigenland-Erwähnungen"** und in die bestehende Sektion "Blick über die Grenze" integriert (dort ergibt der Ländervergleich ohnehin mehr Sinn).
- "Flüssiges Gold" wird zu **"Meistgenanntes Getränk"** und bleibt als Teil des bestehenden Wortgewitters/Duelle-Bereichs sichtbar, aber ohne eigene Hero-Kachel.

Bestehende Sektionen darunter (Donut-Chart Redeanteil, Balkendiagramm Episoden/Jahr, Trend-Chart, Blick über die Grenze, Wortgewitter, Typische Wörter, Duelle) bleiben inhaltlich erhalten, bekommen aber:
- Ein dezentes Bergsilhouetten-SVG als Hintergrund-Wasserzeichen im Hero-Bereich (nicht in jeder einzelnen Karte — würde zu unruhig wirken).
- Sektionstitel ohne Emoji-Präfix; stattdessen ein kleiner farbiger vertikaler Strich (`3px` breit, Akzentfarbe) vor dem Titel, wie im Mockup gezeigt.

### Emoji-Politik
Kein Komplettverbot, aber deutlich reduziert:
- Länderflaggen: überall durch korrekt proportionierte kleine SVG-Flaggen ersetzt (das gemockte Emoji-Kreuz war fälschlich wie die dänische statt die Schweizer Flagge proportioniert — SVGs vermeiden dieses Risiko grundsätzlich).
- Sektionstitel-Emoji-Präfixe (🎙️, 📅, ☁️, 🗣️, 🥊, 👀) entfernen, durch den Akzentstrich ersetzen.
- Thematische Emojis in Wortgewitter-Labels (🍺, 🏔️, etc.) dürfen bleiben, wo sie zum Thema passen und nicht bei jedem einzelnen Wort stur wiederholt werden — Ziel ist "wirkt nicht KI-generiert", nicht "keine Freude mehr".

## 2. Neue Statistiken

### Ja-/Nein-/Aber-Sager
Neue Card/Sektion "Ja, Nein & Aber" (oder ähnlich schlichter Titel): zählt pro Host, wie oft er/sie die (eigenständigen) Wörter "ja", "nein" und "aber" sagt. Umsetzung: Erweiterung der bestehenden `buildFilterCountsSql`-Mechanik in `/api/stats` (ein zusätzlicher Satz an `count(*) FILTER (WHERE speaker = $x AND content ~* '\yja\y')`-artigen Bedingungen — Wortgrenzen nötig, damit "ja" nicht in "jahrelang" mitgezählt wird; dafür Regex `\m` /`\M` Wortgrenzen-Operator in Postgres oder `~* '(^|[^a-zäöüß])ja([^a-zäöüß]|$)'` verwenden statt einfachem `ILIKE '%ja%'`).

### Wortschatz-Vielfalt
Neue Metrik "Wortschatz" pro Host: Anzahl **unterschiedlicher** Wörter, die ein Host im gesamten Archiv verwendet hat. Umsetzung: eine zusätzliche, eigene SQL-Abfrage (kein FILTER-Batch, da `DISTINCT`-Aggregation pro Sprecher eine echte Gruppierung braucht):
```sql
select speaker, count(distinct word) as vocab_size
from transcript_chunks,
     unnest(regexp_split_to_array(lower(content), '[^a-zäöüßA-ZÄÖÜ]+')) as word
where word <> '' and speaker = any(array['Matthias Daum','Florian Gasser','Lenz Jacobsen'])
group by speaker
```
Das ist eine schwerere Query (tokenisiert den gesamten Text), läuft aber wie alle anderen Stats nur einmal pro 24h-Cache-Fenster — unproblematisch bei ~300MB Datenbankgröße und Neons Compute.

Beide neuen Metriken fließen in die bestehende `computeStats()`-Funktion in `/api/stats/route.ts` und werden im gleichen `app_cache`-Eintrag mitgespeichert.

## 3. Professionalisierung

### Favicon & Meta-Tags
- `src/app/icon.svg` (Next.js App-Router-Konvention, wird automatisch als Favicon eingebunden) mit dem neuen Logo.
- `src/app/layout.tsx`: `metadata`-Objekt ergänzen um `title`, `description`, `openGraph` (title/description/images), `twitter`-Card-Felder. Eine statische OG-Bild-Datei (`public/og-image.png`, 1200×630) mit Logo + Titel "Servus. Grüezi. Hallo. — Suchmaschine" wird als einfaches SVG-zu-PNG oder direkt als gestaltetes SVG-in-PNG-Export erstellt (kein dynamisches OG-Image-Rendering, um Scope klein zu halten).

### Lade-/Fehlerzustände
- Stats-Tab: Skeleton-Platzhalter (graue pulsierende Blöcke in Kachel-Form) statt des aktuellen Spinners, während `statsLoading` aktiv ist.
- Suchergebnisse: gleiches Prinzip für die Ergebnisliste während des Ladens.
- Fehlermeldungen (z.B. wenn `/api/search` einen 500er wirft): statt rohem `{"error": "..."}`-artigem Text eine kurze, freundliche Meldung in der UI ("Die Suche hat gerade ein Problem — versuch's in ein paar Sekunden nochmal.") mit Retry-Button, wo sinnvoll.

### README.md
Neues, eigenständiges `README.md` im Repo-Root (getrennt von `CLAUDE.md`, das weiterhin die technische/Session-Doku für Claude Code bleibt). Inhalt: kurze Projektbeschreibung, Screenshot-Platzhalter, Setup-Schritte (`.env` Variablen, `npm install`, `npm run dev`), Tech-Stack-Liste, Link zur "Über dieses Projekt"-Seite.

### "Über dieses Projekt"-Seite
Neuer Tab/Abschnitt in der App (`page.tsx`, dritter Tab neben Suche/Durchstöbern/Statistiken, oder als eigene Route `/about` — Entscheidung fällt bei der Implementierungsplanung anhand des bestehenden Tab-Musters). Inhalt, in einfacher, unaufgeregter Sprache (kein Marketing-/KI-Ton):
- Was ist das: privates Hobbyprojekt, durchsucht das Archiv des Podcasts "Servus. Grüezi. Hallo."
- Wie funktioniert's kurz erklärt: Transkription per Deepgram, Sprecherzuordnung per LLM-Heuristik, semantische Suche per OpenAI-Embeddings.
- Disclaimer: Sprecherzuordnung kann bei einzelnen Abschnitten falsch sein (automatische Diarisierung), Datumsangaben bei älteren Folgen beruhen teils auf Bestmatch-Heuristiken, Statistiken sind Spielerei und nicht wissenschaftlich exakt.
- Kein Impressum/rechtliche Angaben nötig (kein öffentliches Produkt, passwortgeschützt).

## Out of Scope
- Kein Light-Mode-Toggle (nur die "weniger tiefschwarz"-Anpassung der bestehenden Dark-Palette).
- Keine Suchfunktion/Architektur-Änderungen (bereits in vorheriger Session gefixt).
- Keine neue Datenbanktabelle für die neuen Statistiken — beides läuft über bestehende `transcript_chunks`-Abfragen im Rahmen von `/api/stats`.
- Kein dynamisches (server-generiertes) OG-Image — ein statisches reicht für dieses Projekt.
