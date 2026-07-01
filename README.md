# Transalpine Suchmaschine

Durchsuchbares Archiv des Podcasts **„Servus. Grüezi. Hallo.“** — 411 Episoden, 94.595 Gesprächsabschnitte, semantisch durchsuchbar.

Privates Hobbyprojekt, kein offizielles Angebot der Podcast-Macher. Mehr dazu im "Über dieses Projekt"-Tab der App.

## Tech Stack

- Next.js 14 (App Router) + TypeScript
- [Neon](https://neon.tech) (Serverless Postgres + pgvector), Zugriff via `pg`
- OpenAI `text-embedding-3-small` (256 Dimensionen) für semantische Suche
- Deepgram für Transkription neuer Folgen
- Deployment: Vercel

## Setup

```bash
npm install
npm run dev
```

Benötigte Umgebungsvariablen in `.env.local`:

```
DATABASE_URL=postgresql://...        # Neon connection string
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...                 # nur für npm run ingest
RSS_FEED_URL=https://...
APP_PASSWORD=...                     # Zugriffsschutz der App
ADMIN_PASSWORD=...                   # Schutz für /api/admin/stats
```

## Datenbank neu aufsetzen

Vollständiges Schema in [`db/schema.sql`](db/schema.sql).

## Neue Episoden einlesen

```bash
npm run ingest -- --pre-scan   # Dry-Run, zeigt was fehlt
npm run ingest                 # tatsächliche Ingestion
```

## Mehr Details

Technische Hintergründe, Migrationsgeschichte und Architekturentscheidungen: [`CLAUDE.md`](CLAUDE.md).
