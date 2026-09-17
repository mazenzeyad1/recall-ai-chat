-- Schema for the AI chat app with memory.
-- Safe to run repeatedly.

create extension if not exists "pgcrypto";

-- A chat thread belonging to one user.
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'New chat',
  created_at  timestamptz not null default now()
);

-- Turns within a thread. user_id is denormalised so RLS is a single-table check.
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  created_at       timestamptz not null default now()
);

-- Durable facts about the user, extracted from conversations and injected
-- into the system prompt on every turn. This is what makes memory survive
-- across separate chat threads.
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);
create index if not exists conversations_user_created_idx
  on public.conversations (user_id, created_at desc);
create index if not exists memories_user_created_idx
  on public.memories (user_id, created_at desc);

-- Stop the same fact being stored twice for one user.
create unique index if not exists memories_user_content_key
  on public.memories (user_id, lower(content));

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.memories      enable row level security;

-- There is no service-role key on this project, so every read and write goes
-- through the user's own JWT. These policies are the entire access model.
do $$
declare
  t text;
begin
  foreach t in array array['conversations', 'messages', 'memories'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select using (auth.uid() = user_id)',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert with check (auth.uid() = user_id)',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete using (auth.uid() = user_id)',
      t || '_delete_own', t);
  end loop;
end $$;
