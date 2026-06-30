# Transalpine Suchmaschine – Projektübersicht für Claude Code

## Was ist das?
Eine semantische Suchmaschine für den Podcast **"Transalpina"** (Neue Zürcher Zeitung).
Nutzer können in Transkripten von 411 Episoden (94.595 Chunks) suchen – nach Themen, Aussagen, Personen.

## Tech Stack
- **Frontend/Backend**: Next.js 14 (App Router), TypeScript
- **Datenbank**: Supabase (PostgreSQL + pgvector)
- **Embeddings**: OpenAI `text-embedding-3-small` (1536 Dimensionen)
- **Deployment**: Vercel
- **Styling**: CSS Modules

## Projektstruktur
```
src/app/
  page.tsx              # Haupt-Suchseite (Client Component)
  page.module.css       # Styles
  api/
    search/route.ts     # Suchendpunkt (hybrid, semantic, exact)
    context/route.ts    # Kontext-Chunks für einen Zeitstempel
    episodes/route.ts   # Episodenliste
    ingest/route.ts     # Ingestion-Endpunkt
scripts/
  ingest.ts             # Transkripte einlesen + embedden
supabase/
  migrations/           # DB-Schema
scratch/                # Temporäre Testskripte
```

## Datenbank-Schema (Supabase)
```sql
episodes (id text PK, title, audio_url, pub_date, description)
transcript_chunks (id uuid PK, episode_id FK, speaker, start_time, end_time, content, embedding vector(1536))
```

## Wichtige RPC-Funktion
```sql
match_chunks(query_embedding vector, match_threshold float, match_count int, 
             filter_speakers text[], exclude_speakers text[], filter_year text)
```
Nutzt HNSW-Index für Vektor-Ähnlichkeitssuche.

## Bekannte Probleme & Status
1. **HNSW-Index instabil**: Supabase Free Tier pausiert die DB. Nach Pause muss Index neu aufgebaut werden.
   - Workaround: Code fällt nach 3s Timeout automatisch auf Textsuche (ilike) zurück
   - Echter Fix: Supabase Pro ($25/Mo) oder Migration zu Neon.tech

2. **Duplikat-Funktion**: Es gibt zwei `match_chunks` Varianten (mit/ohne Filter-Params).
   - Fix: `DROP FUNCTION IF EXISTS match_chunks(vector, float, int);` im SQL Editor ausführen

3. **Suchtypen**: `?type=semantic` (Sinnsuche), `?type=exact` (Textsuche), `?type=hybrid` (beides)

## Umgebungsvariablen (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
```

## Deployment
- GitHub: `blumleo2004/transalpine-search`
- Vercel: automatisch bei Push auf `main`
- `npm run dev` für lokale Entwicklung

## Nächste Schritte (offene TODOs)
- [ ] Duplikat-Funktion im SQL Editor löschen
- [ ] HNSW-Index dauerhaft stabilisieren (oder Neon.tech Migration)
- [ ] Supabase Free Tier → Pro upgraden für stabile Performance
