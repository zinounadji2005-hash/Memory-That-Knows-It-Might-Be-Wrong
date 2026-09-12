-- =============================================================================
-- Memory That Knows It Might Be Wrong — Supabase Schema
-- Apply this via the SQL Editor in your Supabase project dashboard.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- memories: the facts. Every row carries source, confidence, freshness, scope.
-- -----------------------------------------------------------------------------
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'user:default',
  -- fact_text is nullable ON PURPOSE: revocation sets it NULL (privacy rule).
  -- A revoked memory keeps NO content — only the audit trail says it existed.
  fact_text text,
  category text,
  source text not null default 'user_stated' check (source in ('user_stated', 'inferred', 'imported')),
  confidence int not null,
  base_confidence int not null,
  status text not null default 'active' check (status in ('active', 'contested', 'stale', 'revoked')),
  corroboration_count int not null default 1,
  contradicted_by uuid references memories(id),
  created_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now()
);

create index if not exists memories_scope_status_idx on memories (scope, status);
create index if not exists memories_category_idx on memories (category);

-- -----------------------------------------------------------------------------
-- memory_events: append-only audit trail for every write/retrieve/forget event.
-- NOTE: detail must NEVER contain raw revoked content — category only on revoke.
-- -----------------------------------------------------------------------------
create table if not exists memory_events (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid references memories(id),
  event_type text not null check (event_type in
    ('write', 'confirm', 'contradict', 'recall', 'decay', 'revoke', 'resolve')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists memory_events_memory_id_idx on memory_events (memory_id);
create index if not exists memory_events_type_idx on memory_events (event_type);