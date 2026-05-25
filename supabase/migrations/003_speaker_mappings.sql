-- Speaker mapping table: allows manual assignment of real names to generic speaker labels per episode
CREATE TABLE IF NOT EXISTS speaker_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  speaker_label TEXT NOT NULL,        -- e.g. "Sprecher 0"
  real_name TEXT NOT NULL,            -- e.g. "Matthias Daum"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(episode_id, speaker_label)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_speaker_mappings_episode ON speaker_mappings(episode_id);
