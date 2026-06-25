-- ARMOIMC III — quick database UPDATE (run once if you set up the DB earlier)
-- Supabase dashboard -> SQL Editor -> New query -> paste all -> Run.
-- This enables drag-order saving and the new 1–7 rating scale.

-- 1) store each voter's personal ranking position
alter table votes add column if not exists rank int;

-- 2) allow the new 1–7 golf/drinking scale (old setup capped values at 5)
alter table votes drop constraint if exists votes_golf_check;
alter table votes drop constraint if exists votes_drink_check;
alter table votes add constraint votes_golf_check  check (golf  between 0 and 7);
alter table votes add constraint votes_drink_check check (drink between 0 and 7);
