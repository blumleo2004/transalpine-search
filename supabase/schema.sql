-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- Create episodes table
create table if not exists episodes (
  id text primary key,
  title text not null,
  pub_date timestamp with time zone not null,
  audio_url text not null,
  image_url text,
  description text,
  duration integer, -- in seconds
  created_at timestamp with time zone default now()
);

-- Create transcript chunks table
create table if not exists transcript_chunks (
  id uuid primary key default gen_random_uuid(),
  episode_id text references episodes(id) on delete cascade not null,
  speaker text not null,
  start_time numeric not null, -- start timestamp in seconds
  end_time numeric not null, -- end timestamp in seconds
  content text not null,
  embedding vector(1536) not null, -- OpenAI text-embedding-3-small embedding
  created_at timestamp with time zone default now()
);

-- Create an HNSW index for cosine distance search
-- HNSW is generally faster and more accurate than IVFFlat for vector search
create index if not exists transcript_chunks_embedding_hnsw_idx 
on transcript_chunks 
using hnsw (embedding vector_cosine_ops);

-- Create similarity search function (RPC)
create or replace function match_chunks (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  episode_id text,
  speaker text,
  start_time numeric,
  end_time numeric,
  content text,
  title text,
  audio_url text,
  pub_date timestamp with time zone,
  similarity float
)
language sql stable
as $$
  select
    tc.id,
    tc.episode_id,
    tc.speaker,
    tc.start_time,
    tc.end_time,
    tc.content,
    e.title,
    e.audio_url,
    e.pub_date,
    1 - (tc.embedding <=> query_embedding) as similarity
  from transcript_chunks tc
  join episodes e on tc.episode_id = e.id
  where 1 - (tc.embedding <=> query_embedding) > match_threshold
  order by tc.embedding <=> query_embedding
  limit match_count;
$$;
