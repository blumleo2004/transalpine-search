-- Transalpine Suchmaschine — Datenbankschema (Neon Postgres)
-- Führe dieses Skript einmalig gegen eine frische Neon-Datenbank aus, um das
-- Schema neu aufzusetzen (z.B. bei einem Provider-Wechsel oder Reset).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS episodes (
  id text PRIMARY KEY,
  title text NOT NULL,
  pub_date timestamptz NOT NULL,
  audio_url text NOT NULL,
  image_url text,
  description text,
  duration integer,
  created_at timestamptz DEFAULT now()
);

-- embedding ist vector(512): OpenAI text-embedding-3-small mit dimensions=512
-- (nicht die volle 1536-dim Ausgabe!). Grund: 94.595 Chunks × 1536 Dimensionen
-- sprengen das 512MB-Speicherlimit von Neons kostenlosem Tier; 512 Dimensionen
-- passen komfortabel (~300MB Gesamtgröße) bei weiterhin guter Retrieval-Qualität.
CREATE TABLE IF NOT EXISTS transcript_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id text REFERENCES episodes(id) ON DELETE CASCADE NOT NULL,
  speaker text NOT NULL,
  start_time numeric NOT NULL,
  end_time numeric NOT NULL,
  content text NOT NULL,
  embedding vector(512) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcript_chunks_embedding_hnsw_idx
  ON transcript_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS transcript_chunks_content_trgm_idx
  ON transcript_chunks USING gin (content gin_trgm_ops);

CREATE TABLE IF NOT EXISTS search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  search_type text NOT NULL, -- 'semantic' | 'exact' | 'hybrid'
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS speaker_mappings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  episode_id text NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  speaker_label text NOT NULL,
  real_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(episode_id, speaker_label)
);
CREATE INDEX IF NOT EXISTS idx_speaker_mappings_episode ON speaker_mappings(episode_id);

-- Durable cache for the /api/stats route. A local-disk cache doesn't survive
-- serverless cold starts on Vercel, so the cache lives in Postgres instead.
CREATE TABLE IF NOT EXISTS app_cache (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
