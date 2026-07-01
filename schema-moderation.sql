-- ============================================================
--  REPS — moderation tables.  Run AFTER schema.sql in the
--  Supabase SQL Editor.
-- ============================================================

-- Bans: who is blocked. Only the server (service_role key) can ever
-- read or write this — there are deliberately NO policies, so with
-- RLS on, all normal/anon access is denied.
create table if not exists public.bans (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null check (subject_type in ('user','client','ip')),
  subject_value text not null,
  reason        text,
  created_by    text,
  created_at    timestamptz default now(),
  unique (subject_type, subject_value)
);
alter table public.bans enable row level security;

-- Reports: users can file them, but only the server can read them.
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post','user')),
  target_id   text not null,
  reason      text,
  resolved    boolean default false,
  created_at  timestamptz default now()
);
alter table public.reports enable row level security;
create policy "reports_insert_own" on public.reports for insert
  with check (reporter_id = auth.uid());
-- (no select policy → only the server's service_role can read reports)
