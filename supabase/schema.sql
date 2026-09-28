-- =====================================================================
-- Foliuma — banco de dados no Supabase
-- Cole este arquivo inteiro em: Supabase → SQL Editor → New query → Run
-- Pode rodar de novo sem problemas (é idempotente).
-- =====================================================================

-- 1) Tabela principal: cada documento do app é uma linha (caminho → JSON)
create table if not exists public.docs (
  path        text primary key,          -- ex.: data/users/<uid>/tree, sharedpg/p_abc
  collection  text not null,             -- caminho da "pasta" (tudo antes da última /)
  doc_id      text not null,             -- nome do documento (depois da última /)
  data        jsonb not null default '{}'::jsonb,
  owner       uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);
create index if not exists docs_collection_idx on public.docs (collection);
create index if not exists docs_data_idx on public.docs using gin (data jsonb_path_ops);

create or replace function public.docs_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs
for each row execute function public.docs_touch();

-- 2) Regras de acesso (Row Level Security)
--    • data/users/<seu-id>/...  → só você lê e escreve (cadernos privados)
--    • shared...                → todas as pessoas com conta neste projeto
--                                 (cadernos compartilhados, comentários, áudios)
create or replace function public.caderno_can_access(p text) returns boolean
language sql stable as $$
  select auth.uid() is not null and (
    p like 'data/users/' || auth.uid()::text || '/%'
    or p like 'sharednb/%' or p like 'sharedpg/%'
    or p like 'sharedau/%' or p like 'sharedcm/%'
  )
$$;

alter table public.docs enable row level security;
drop policy if exists docs_select on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_select on public.docs for select to authenticated using (public.caderno_can_access(path));
create policy docs_insert on public.docs for insert to authenticated with check (public.caderno_can_access(path));
create policy docs_update on public.docs for update to authenticated using (public.caderno_can_access(path)) with check (public.caderno_can_access(path));
create policy docs_delete on public.docs for delete to authenticated using (public.caderno_can_access(path));

-- 3) Perfis (nome e cor exibidos em responsáveis, comentários e presença)
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text,
  email       text,
  color       text,
  updated_at  timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid());

-- 4) Tempo real (sincronização instantânea entre aparelhos e pessoas)
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
