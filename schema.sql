-- ============================================================
--  REPS — database schema + security
--  Run ONCE:  Supabase Dashboard  →  SQL Editor  →  New query
--             paste this whole file  →  Run.
--
--  Every table below has Row-Level Security (RLS) turned on with
--  explicit policies. With RLS on and no matching policy, the
--  default is DENY — so nothing is readable or writable unless a
--  policy below allows it. This is what keeps user data private
--  even though the app talks to the database directly.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. TABLES  (only user-generated data lives here; the program /
--    exercise catalog is static content shipped inside the app)
-- ----------------------------------------------------------------

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  friend_code     text unique not null,
  age             int,
  gender          text,
  height_cm       numeric,
  weight_kg       numeric,
  fitness_level   text default 'Beginner',
  activity_level  text default 'Moderate',
  conditions      text,
  allergies       text,
  injuries        text,
  preferred_type  text,
  calendar_public boolean default false,
  created_at      timestamptz default now()
);

create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending','accepted','declined')),
  created_at    timestamptz default now(),
  unique (requester_id, addressee_id)
);

create table if not exists public.goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  target     numeric,
  unit       text,
  created_at timestamptz default now()
);

create table if not exists public.workouts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz default now()
);

create table if not exists public.workout_exercises (
  id           uuid primary key default gen_random_uuid(),
  workout_id   uuid not null references public.workouts(id) on delete cascade,
  name         text not null,
  position     int default 0,
  sets         int,
  reps         int,
  weight       numeric,
  rest_seconds int
);

create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text,
  started_at   timestamptz default now(),
  ended_at     timestamptz,
  total_volume numeric default 0
);

create table if not exists public.set_logs (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  exercise_name text not null,
  set_number    int,
  weight        numeric,
  reps          int,
  rpe           numeric,
  done          boolean default false
);

create table if not exists public.measurements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  site        text not null,
  value_cm    numeric,
  measured_at date default current_date
);

create table if not exists public.personal_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  lift        text not null,
  value       numeric,
  unit        text default 'kg',
  achieved_at date default current_date
);

create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  taken_on     date default current_date,
  created_at   timestamptz default now()
);

create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  photo_id   uuid references public.photos(id) on delete set null,
  caption    text,
  created_at timestamptz default now()
);

create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null check (type in ('love','support')),
  created_at timestamptz default now(),
  unique (post_id, user_id, type)
);

-- ----------------------------------------------------------------
-- 2. HELPER FUNCTIONS
--    are_friends() runs as SECURITY DEFINER so it can check the
--    friendship table without tripping over RLS recursion. It only
--    ever answers a yes/no about the *current* user, so it leaks
--    nothing.
-- ----------------------------------------------------------------

create or replace function public.are_friends(other uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ( (f.requester_id = auth.uid() and f.addressee_id = other)
         or (f.addressee_id = auth.uid() and f.requester_id = other) )
  );
$$;

-- Add a friend by their code WITHOUT exposing the whole user table.
-- Returns only id + name, and only on an exact code match, so the
-- list of users cannot be scraped or enumerated.
create or replace function public.find_profile_by_code(code text)
returns table (id uuid, full_name text)
language sql security definer stable
set search_path = public
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.friend_code = upper(trim(code))
  limit 1;
$$;

-- Auto-create a profile (with a unique friend code) on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare new_code text;
begin
  loop
    new_code := 'REPS-' || upper(substr(md5(random()::text), 1, 5));
    exit when not exists (select 1 from public.profiles where friend_code = new_code);
  end loop;
  insert into public.profiles (id, full_name, friend_code)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new_code);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------
-- 3. ENABLE RLS + POLICIES
-- ----------------------------------------------------------------

-- profiles: read your own + accepted friends' profiles; write only your own
alter table public.profiles enable row level security;
create policy "profiles_select" on public.profiles for select
  using ( id = auth.uid() or public.are_friends(id) );
create policy "profiles_insert" on public.profiles for insert
  with check ( id = auth.uid() );
create policy "profiles_update" on public.profiles for update
  using ( id = auth.uid() ) with check ( id = auth.uid() );
create policy "profiles_delete" on public.profiles for delete
  using ( id = auth.uid() );

-- friendships: only the two people involved can see or change a row
alter table public.friendships enable row level security;
create policy "friend_select" on public.friendships for select
  using ( requester_id = auth.uid() or addressee_id = auth.uid() );
create policy "friend_insert" on public.friendships for insert
  with check ( requester_id = auth.uid() );
create policy "friend_update" on public.friendships for update
  using ( requester_id = auth.uid() or addressee_id = auth.uid() )
  with check ( requester_id = auth.uid() or addressee_id = auth.uid() );
create policy "friend_delete" on public.friendships for delete
  using ( requester_id = auth.uid() or addressee_id = auth.uid() );

-- owner-only tables: you can only see/touch rows where user_id is you
do $$
declare t text;
begin
  foreach t in array array['goals','workouts','sessions','measurements','personal_records','photos']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$create policy "%1$s_owner" on public.%1$I for all
      using (user_id = auth.uid()) with check (user_id = auth.uid());$f$, t);
  end loop;
end $$;

-- child tables: inherit ownership through their parent row
alter table public.workout_exercises enable row level security;
create policy "wex_owner" on public.workout_exercises for all
  using ( exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid()) )
  with check ( exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid()) );

alter table public.set_logs enable row level security;
create policy "setlog_owner" on public.set_logs for all
  using ( exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()) )
  with check ( exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()) );

-- posts: visible to you + accepted friends; writable only by you
alter table public.posts enable row level security;
create policy "posts_select" on public.posts for select
  using ( user_id = auth.uid() or public.are_friends(user_id) );
create policy "posts_insert" on public.posts for insert
  with check ( user_id = auth.uid() );
create policy "posts_update" on public.posts for update
  using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
create policy "posts_delete" on public.posts for delete
  using ( user_id = auth.uid() );

-- reactions: you may react to / read reactions on any post you can see
alter table public.reactions enable row level security;
create policy "react_select" on public.reactions for select
  using ( exists (select 1 from public.posts p where p.id = post_id
                  and (p.user_id = auth.uid() or public.are_friends(p.user_id))) );
create policy "react_insert" on public.reactions for insert
  with check ( user_id = auth.uid()
               and exists (select 1 from public.posts p where p.id = post_id
                           and (p.user_id = auth.uid() or public.are_friends(p.user_id))) );
create policy "react_delete" on public.reactions for delete
  using ( user_id = auth.uid() );

-- ----------------------------------------------------------------
-- 4. PRIVATE PHOTO STORAGE
--    Bucket is NOT public. Each user writes into a folder named by
--    their own id. Friends can read a friend's folder (so stories
--    work) but strangers cannot. The app fetches short-lived signed
--    URLs, so even a leaked link expires.
-- ----------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

create policy "photo_insert_own" on storage.objects for insert
  with check ( bucket_id = 'progress-photos'
               and (storage.foldername(name))[1] = auth.uid()::text );

create policy "photo_select_own_or_friend" on storage.objects for select
  using ( bucket_id = 'progress-photos'
          and ( (storage.foldername(name))[1] = auth.uid()::text
                or public.are_friends( ((storage.foldername(name))[1])::uuid ) ) );

create policy "photo_update_own" on storage.objects for update
  using ( bucket_id = 'progress-photos'
          and (storage.foldername(name))[1] = auth.uid()::text );

create policy "photo_delete_own" on storage.objects for delete
  using ( bucket_id = 'progress-photos'
          and (storage.foldername(name))[1] = auth.uid()::text );

-- ============================================================
--  Done. Every table is locked to its owner; friends see only
--  what you share; photos live in a private bucket. The app only
--  ever uses your PUBLIC anon key — never paste the service_role
--  key into the app, that one bypasses all of the above.
-- ============================================================
