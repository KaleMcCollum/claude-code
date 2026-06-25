-- ARMOIMC III — quick database UPDATE (run once if you set up the DB earlier)
-- Supabase dashboard -> SQL Editor -> New query -> paste all -> Run.
-- This enables drag-order saving and the new 1–7 rating scale.

-- 1) store each voter's personal ranking position
alter table votes add column if not exists rank int;

-- 1b) committee (official) ballots: who submitted + flag
alter table votes add column if not exists member text;
alter table votes add column if not exists committee boolean default false;

-- 2) allow the new 1–7 golf/drinking scale (old setup capped values at 5)
alter table votes drop constraint if exists votes_golf_check;
alter table votes drop constraint if exists votes_drink_check;
alter table votes add constraint votes_golf_check  check (golf  between 0 and 7);
alter table votes add constraint votes_drink_check check (drink between 0 and 7);

-- 3) player self-service profiles ("Claim your player": photo, stats, nickname)
create table if not exists profiles (
  player_name text primary key,
  nickname    text,
  birthday    date,
  height      text,
  weight      text,
  photo       text,                    -- resized base64 image
  updated_at  timestamptz default now()
);
alter table profiles enable row level security;
drop policy if exists "anon read profiles"   on profiles;
drop policy if exists "anon insert profiles" on profiles;
drop policy if exists "anon update profiles" on profiles;
create policy "anon read profiles"   on profiles for select using (true);
create policy "anon insert profiles" on profiles for insert with check (true);
create policy "anon update profiles" on profiles for update using (true) with check (true);
