-- ============================================================
--  REPS — tracking tables (nutrition + daily metrics).
--  Run AFTER schema.sql and schema-moderation.sql.
-- ============================================================

create table if not exists public.food_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  kcal       int not null default 0,
  logged_on  date default current_date,
  created_at timestamptz default now()
);
alter table public.food_logs enable row level security;
create policy "food_owner" on public.food_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.daily_metrics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null default current_date,
  water_ml    int default 0,
  steps       int default 0,
  sleep_hours numeric,
  weight_kg   numeric,
  unique (user_id, day)
);
alter table public.daily_metrics enable row level security;
create policy "daily_owner" on public.daily_metrics for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
