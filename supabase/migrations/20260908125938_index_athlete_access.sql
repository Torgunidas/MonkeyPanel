-- Cover the new access mapping foreign key and athlete lookup.
set local lock_timeout = '5s';
create index athlete_access_athlete_id_idx on public.athlete_access (athlete_id);
