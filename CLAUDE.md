# Transalpine Suchmaschine – Projektübersicht für Claude Code

## Was ist das?
Eine semantische Suchmaschine für den Podcast **"Servus. Grüezi. Hallo." (Transalpina)** (Neue Zürcher Zeitung / ZEIT ONLINE).
Nutzer können in Transkripten von 411 Episoden (94.595 Chunks) suchen – nach Themen, Aussagen, Personen – und sich witzige, insiderlastige Statistiken zum Archiv ansehen.

## Tech Stack
- **Frontend/Backend**: Next.js 14 (App Router), TypeScript
- **Datenbank**: [Neon](https://neon.tech) (Serverless Postgres + pgvector), zugegriffen via `pg` (kein ORM, rohes SQL)
- **Embeddings**: OpenAI `text-embedding-3-small`, auf **256 Dimensionen** truncated (`dimensions: 256` Parameter) — siehe "Warum Neon + 256 Dim?" unten
- **Deployment**: Vercel
- **Styling**: CSS Modules

## Warum Neon statt Supabase, und warum 256 statt 1536 Dimensionen? (Migrationsgeschichte)
Das Projekt lief ursprünglich auf Supabase Free Tier ("Nano"-Compute). Das führte zu echten, empirisch bestätigten Problemen:
1. Ein vergessener `pg_cron`-Job (`* * * * *`) versuchte minütlich den Vektor-Index neu zu bauen, kam nie fertig und blockierte sich selbst dauerhaft — das war die Hauptursache für DB-Aussetzer/"resource exhausted".
2. Selbst nach Bereinigung: Der Nano-Tier war zu schwach, um überhaupt einen HNSW- oder IVFFlat-Index über 94.595 × 1536-dim Vektoren zu bauen (Build blieb nach 20+ Minuten bei "performing k-means" hängen).
3. Ein Compute-Upgrade bei Supabase ist nur möglich, wenn die gesamte Organisation auf den Pro-Plan ($25/Monat Basis) upgegradet wird — kein günstiges "pay-per-hour"-Upgrade auf Free-Plan-Ebene.

Migration zu Neon (kostenloser Tier, autoscaling Compute) war günstiger, aber Neons Free Tier hat ein hartes **512MB Speicherlimit**. Der erste Migrationsversuch mit den originalen 1536-dim Embeddings scheiterte nach 58.000 von 94.595 Zeilen, weil die Rohdaten allein schon ~580MB brauchen.

**Lösung**: Alle Chunks mit `dimensions: 256` (statt der vollen 1536) neu embedden lassen. Ein Zwischenschritt bei 512 Dimensionen zeigte: pgvectors HNSW-Index speichert pro Knoten eine volle Vektorkopie, wodurch der Index fast so groß wie die Rohdaten selbst wird — bei 512 Dim landete die Gesamtgröße bei ~568MB, wieder über dem Limit. Bei 256 Dimensionen liegt die Gesamtgröße bei ~300MB, mit komfortablem Puffer. Auf Neons Compute baute der HNSW-Index in **2,5 Minuten** (vs. nie fertig auf Supabase Nano).

**Wichtig für zukünftige Ingestion**: `scripts/ingest.ts` muss ebenfalls `dimensions: 256` beim Embedding-Call verwenden (ist bereits so eingestellt) — sonst schlägt der Insert fehl, weil die Spalte `vector(256)` erwartet.

## Projektstruktur
```
src/
  lib/db.ts             # pg Connection Pool (DATABASE_URL)
  app/
    page.tsx             # Haupt-Suchseite (Client Component)
    page.module.css       # Styles
    api/
      search/route.ts     # Suchendpunkt (hybrid, semantic, exact)
      context/route.ts    # Kontext-Chunks für einen Zeitstempel
      episodes/route.ts   # Episodenliste
      speakers/route.ts   # Sprecher-Zuordnungen pro Episode
      stats/route.ts      # Öffentliche Statistiken (mit Postgres-Cache)
      admin/stats/route.ts # Meistgesuchte Begriffe (admin, ?pw=)
      log-search/route.ts # Anonyme Suchanfragen-Analytics
      keepalive/route.ts  # Cron-Endpunkt, hält die DB "warm"
      login/route.ts      # Passwortschutz-Login
      explain-match/route.ts # LLM-Erklärung "warum ist das relevant?"
scripts/
  ingest.ts             # Transkripte einlesen + embedden (RSS → Deepgram → OpenAI → Neon)
db/
  schema.sql            # Vollständiges Schema für Neon (einmalig ausführen bei Neuaufsetzung)
```

## Datenbank-Schema
Siehe `db/schema.sql` für die vollständige, aktuelle Definition. Kurzfassung:
```sql
episodes (id text PK, title, audio_url, pub_date, description, duration)
transcript_chunks (id uuid PK, episode_id FK, speaker, start_time, end_time, content, embedding vector(256))
speaker_mappings (episode_id, speaker_label, real_name)  -- manuelle Sprecher-Korrektur pro Episode
search_queries (query, search_type, created_at)          -- anonyme Analytics
app_cache (key, value jsonb, updated_at)                  -- Cache für /api/stats (24h TTL)
```

Indizes: `transcript_chunks_embedding_hnsw_idx` (HNSW, Vektorsuche), `transcript_chunks_content_trgm_idx` (GIN Trigram, beschleunigt `ILIKE '%...%'` für Exakt-/Hybridsuche und die Wortzähl-Statistiken massiv).

## Suchtypen
- `?type=semantic` (Sinnsuche) — OpenAI Embedding der Query, Cosine-Similarity via HNSW-Index
- `?type=exact` (Textsuche) — `ILIKE`, beschleunigt durch Trigram-Index
- `?type=hybrid` (beides kombiniert, Exakt-Treffer werden geboostet)

## Statistiken (`/api/stats`)
Berechnet u.a. Redeanteile pro Host/Jahr, ein "Wortgewitter" (Wortwolke der meistgenannten Themen), host-spezifische Signalwörter, grenzüberschreitende Ländernennungen und thematische "Duelle" (z.B. Velo 🇨🇭 vs. Fahrrad 🇩🇪/🇦🇹). Alle ~70 Wort-Zähl-Bedingungen werden in **einer** SQL-Abfrage mit `count(*) FILTER (WHERE ...)` berechnet (ein einziger Table-Scan statt ~70 Einzelabfragen). Ergebnis wird für 24h in `app_cache` zwischengespeichert, damit ein Vercel-Cold-Start nicht jedes Mal alles neu berechnet.

## Umgebungsvariablen (Vercel)
```
DATABASE_URL              # Neon Postgres Connection String
OPENAI_API_KEY
DEEPGRAM_API_KEY          # nur für scripts/ingest.ts (Transkription neuer Folgen)
RSS_FEED_URL
APP_PASSWORD              # Passwortschutz-Gate (Cookie-Session)
ADMIN_PASSWORD            # Schutz für /api/admin/stats
```
Alle Vercel-Env-Vars sind als "Sensitive" markiert → Werte können nicht per `vercel env pull` ausgelesen werden, nur zur Laufzeit in den Functions selbst.

## Deployment
- GitHub: `blumleo2004/transalpine-search`
- Vercel: automatisch bei Push auf `main`
- Cron: `/api/keepalive` (2×/Woche) hält die DB warm — **wichtig**: dieser Pfad muss in `src/middleware.ts` von der Passwort-Gate ausgenommen bleiben, sonst schlägt der Cron-Call mit 401 fehl, ohne dass die DB je erreicht wird (das war lange Zeit unbemerkt der Fall)
- `npm run dev` für lokale Entwicklung (braucht `DATABASE_URL` etc. in `.env.local`)
- `npm run ingest` für manuelle Ingestion neuer Episoden (`-- --pre-scan` für Dry-Run, `--force` zum Neu-Verarbeiten)

## Status (Stand: nach Migration)
- ✅ Sinnsuche funktioniert, ~60-100ms Antwortzeit
- ✅ Exakt-/Hybridsuche schnell dank Trigram-Index
- ✅ Statistiken laufen über effiziente Batch-Queries + Cache
- ✅ Kein Vendor-Lock mehr auf einen zu schwachen Free-Tier
- ✅ Visuelles Redesign live: eigenes Logo/Favicon, Bento-Grid-Stats-Hero, korrekte SVG-Flaggen, reduzierte Emoji-Nutzung, OG/Meta-Tags, Skeleton-Loader, ehrliche "Über dieses Projekt"-Seite (siehe `docs/superpowers/specs/2026-07-01-visual-redesign-and-stats-design.md`)
- ✅ Neue Statistiken: Ja-/Nein-/Aber-Zähler und Wortschatz-Vielfalt pro Host
- Offene Ideen für später: Sprecher-Mappings (`speaker_mappings`) sind aktuell leer — könnten UI-seitig befüllt werden, um "Sprecher 0/1/2"-Reste in älteren Folgen in echte Namen zu übersetzen.
