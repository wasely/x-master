create extension if not exists vector;

create table if not exists public.tweet_examples (
  id text primary key,
  document text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tweet_rejections (
  id text primary key,
  document text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);

alter table public.tweet_examples enable row level security;
alter table public.tweet_rejections enable row level security;

create index if not exists tweet_examples_embedding_idx
  on public.tweet_examples
  using hnsw (embedding vector_l2_ops);

create index if not exists tweet_rejections_embedding_idx
  on public.tweet_rejections
  using hnsw (embedding vector_l2_ops);

create or replace function public.match_tweet_examples(
  query_embedding vector(384),
  match_count integer default 8
)
returns table (
  id text,
  document text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    tweet_examples.id,
    tweet_examples.document,
    tweet_examples.metadata,
    tweet_examples.embedding <=> query_embedding as similarity
  from public.tweet_examples
  order by tweet_examples.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

create or replace function public.match_tweet_rejections(
  query_embedding vector(384),
  match_count integer default 8
)
returns table (
  id text,
  document text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    tweet_rejections.id,
    tweet_rejections.document,
    tweet_rejections.metadata,
    tweet_rejections.embedding <=> query_embedding as similarity
  from public.tweet_rejections
  order by tweet_rejections.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
