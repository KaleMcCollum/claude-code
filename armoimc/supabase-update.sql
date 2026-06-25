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

-- 4) Rardman experience year (drives ROOKIE/SOPHOMORE/VETERAN badge)
alter table profiles add column if not exists yrs int;

-- 5) team rankings + champion picks (run once; safe to re-run)
create table if not exists team_votes (
  voter_id    text not null,
  voter_name  text,
  team_id     int  not null check (team_id between 1 and 6),
  team_rank   int  check (team_rank between 1 and 6),
  champion    boolean not null default false,
  comment     text,
  member      text,
  committee   boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (voter_id, team_id)
);
alter table team_votes add column if not exists champion boolean not null default false;
alter table team_votes enable row level security;
drop policy if exists "anon read team_votes"   on team_votes;
drop policy if exists "anon insert team_votes" on team_votes;
drop policy if exists "anon update team_votes" on team_votes;
create policy "anon read team_votes"   on team_votes for select using (true);
create policy "anon insert team_votes" on team_votes for insert with check (true);
create policy "anon update team_votes" on team_votes for update using (true) with check (true);

-- 6) admin-published site config (team names/blurbs + Rules text)
create table if not exists config (id int primary key, data jsonb, updated_at timestamptz default now());
alter table config enable row level security;
drop policy if exists "anon read config"   on config;
drop policy if exists "anon insert config" on config;
drop policy if exists "anon update config" on config;
create policy "anon read config"   on config for select using (true);
create policy "anon insert config" on config for insert with check (true);
create policy "anon update config" on config for update using (true) with check (true);

-- 7) admin ballot manager: allow deleting ballots (spam / messed-up cleanup)
drop policy if exists "anon delete votes"      on votes;
drop policy if exists "anon delete team_votes" on team_votes;
create policy "anon delete votes"      on votes      for delete using (true);
create policy "anon delete team_votes" on team_votes for delete using (true);
