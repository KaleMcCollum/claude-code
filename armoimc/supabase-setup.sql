-- ARMOIMC III — database setup
-- Run this ONCE in your Supabase project:
--   Supabase dashboard  ->  SQL Editor  ->  New query  ->  paste all of this  ->  Run.
-- It creates two tables and opens them up so the website can read/write votes.

-- 1) Every ballot: one row per (voter, player).
create table if not exists votes (
  voter_id    text not null,           -- random id saved in the voter's browser
  voter_name  text,                    -- the name they typed
  player_name text not null,           -- which competitor they're rating
  golf        int check (golf between 0 and 7),
  drink       int check (drink between 0 and 7),
  rank        int,                     -- this voter's personal ranking position
  member      text,                    -- committee member name (official ballots)
  committee   boolean default false,   -- true = official committee ballot
  comment     text,
  created_at  timestamptz default now(),
  primary key (voter_id, player_name)  -- re-voting updates instead of duplicating
);

-- 2) The AI-generated official rankings (single row, id = 1).
create table if not exists ai_rankings (
  id         int primary key,
  data       jsonb,
  updated_at timestamptz default now()
);

-- 3) Player self-service profiles ("Claim your player").
create table if not exists profiles (
  player_name text primary key,
  nickname    text,
  birthday    date,
  height      text,
  weight      text,
  photo       text,                    -- resized base64 image
  updated_at  timestamptz default now()
);

-- Allow the public website (anon key) to read & write.
-- NOTE: this is open by design so friends can vote without logging in.
-- Fine for a friend-group event; don't store anything sensitive here.
alter table votes        enable row level security;
alter table ai_rankings  enable row level security;
alter table profiles     enable row level security;

drop policy if exists "anon read profiles"   on profiles;
drop policy if exists "anon insert profiles" on profiles;
drop policy if exists "anon update profiles" on profiles;
create policy "anon read profiles"   on profiles for select using (true);
create policy "anon insert profiles" on profiles for insert with check (true);
create policy "anon update profiles" on profiles for update using (true) with check (true);

drop policy if exists "anon read votes"   on votes;
drop policy if exists "anon insert votes" on votes;
drop policy if exists "anon update votes" on votes;
create policy "anon read votes"   on votes for select using (true);
create policy "anon insert votes" on votes for insert with check (true);
create policy "anon update votes" on votes for update using (true) with check (true);
drop policy if exists "anon delete votes" on votes;
create policy "anon delete votes" on votes for delete using (true);

drop policy if exists "anon read ai"   on ai_rankings;
drop policy if exists "anon insert ai" on ai_rankings;
drop policy if exists "anon update ai" on ai_rankings;
create policy "anon read ai"   on ai_rankings for select using (true);
create policy "anon insert ai" on ai_rankings for insert with check (true);
create policy "anon update ai" on ai_rankings for update using (true) with check (true);

-- Team rankings + champion picks
create table if not exists team_votes (
  voter_id text not null, voter_name text, team_id int not null check (team_id between 1 and 6),
  team_rank int check (team_rank between 1 and 6), champion boolean not null default false,
  comment text, member text, committee boolean not null default false,
  updated_at timestamptz not null default now(), primary key (voter_id, team_id)
);
alter table team_votes enable row level security;
drop policy if exists "anon read team_votes" on team_votes;
drop policy if exists "anon insert team_votes" on team_votes;
drop policy if exists "anon update team_votes" on team_votes;
create policy "anon read team_votes" on team_votes for select using (true);
create policy "anon insert team_votes" on team_votes for insert with check (true);
create policy "anon update team_votes" on team_votes for update using (true) with check (true);
drop policy if exists "anon delete team_votes" on team_votes;
create policy "anon delete team_votes" on team_votes for delete using (true);

-- Prediction calculator (final-score + per-teammate drink predictions)
create table if not exists predictions (
  id bigint generated always as identity primary key, predictor text,
  team_id int not null check (team_id between 1 and 6), final_score int,
  drinks jsonb, created_at timestamptz default now()
);
alter table predictions enable row level security;
drop policy if exists "anon read predictions"   on predictions;
drop policy if exists "anon insert predictions" on predictions;
drop policy if exists "anon delete predictions" on predictions;
create policy "anon read predictions"   on predictions for select using (true);
create policy "anon insert predictions" on predictions for insert with check (true);
create policy "anon delete predictions" on predictions for delete using (true);
