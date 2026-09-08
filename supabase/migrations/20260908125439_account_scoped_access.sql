-- Account access for MonkeyPanel. Application data and identifiers are preserved.
-- Only an administrator can assign access. No role is granted access by email,
-- URL parameters, user_metadata, or a client-provided athlete identifier.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.athlete_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  can_write boolean not null default false,
  primary key (user_id, athlete_id)
);
alter table public.athlete_access enable row level security;
revoke all on public.athlete_access from PUBLIC, anon, authenticated;
grant select on public.athlete_access to authenticated;
create policy own_access on public.athlete_access for select to authenticated
  using (user_id = (select auth.uid()));

-- Ensure no previous broad policy survives before adding restricted rules.
do $guard$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
    and tablename <> 'athlete_access') then
    raise exception 'Existing policies require review before enabling account access';
  end if;
end;
$guard$;

-- Authenticated clients receive only the operations used by the application.
-- The import audit table remains administrator-only.

alter table public.athletes enable row level security;
revoke all on public.athletes from PUBLIC, anon, authenticated;
grant select on public.athletes to authenticated;
create policy account_read on public.athletes for select to authenticated
  using (exists (select 1 from public.athlete_access a where a.athlete_id = athletes.id));

alter table public.plan_athletes enable row level security;
revoke all on public.plan_athletes from PUBLIC, anon, authenticated;
grant select on public.plan_athletes to authenticated;
create policy account_read on public.plan_athletes for select to authenticated
  using (exists (select 1 from public.athlete_access a where a.athlete_id = plan_athletes.athlete_id));

alter table public.plans enable row level security;
revoke all on public.plans from PUBLIC, anon, authenticated;
grant select on public.plans to authenticated;
create policy account_read on public.plans for select to authenticated
  using (exists (select 1 from public.plan_athletes p where p.plan_id = plans.id));

alter table public.trainings enable row level security;
revoke all on public.trainings from PUBLIC, anon, authenticated;
grant select on public.trainings to authenticated;
create policy account_read on public.trainings for select to authenticated
  using (exists (select 1 from public.plans p where p.id = trainings.plan_id));

alter table public.training_exercises enable row level security;
revoke all on public.training_exercises from PUBLIC, anon, authenticated;
grant select on public.training_exercises to authenticated;
create policy account_read on public.training_exercises for select to authenticated
  using (exists (select 1 from public.trainings t where t.id = training_exercises.training_id));

alter table public.progression_blocks enable row level security;
revoke all on public.progression_blocks from PUBLIC, anon, authenticated;
grant select on public.progression_blocks to authenticated;
create policy account_read on public.progression_blocks for select to authenticated
  using (exists (select 1 from public.plans p where p.id = progression_blocks.plan_id));

alter table public.progression_exercises enable row level security;
revoke all on public.progression_exercises from PUBLIC, anon, authenticated;
grant select on public.progression_exercises to authenticated;
create policy account_read on public.progression_exercises for select to authenticated
  using (exists (select 1 from public.progression_blocks b where b.id = progression_exercises.block_id));

alter table public.progression_sets enable row level security;
revoke all on public.progression_sets from PUBLIC, anon, authenticated;
grant select on public.progression_sets to authenticated;
create policy account_read on public.progression_sets for select to authenticated
  using (exists (select 1 from public.progression_exercises e where e.id = progression_sets.progression_exercise_id));

alter table public.progression_week_notes enable row level security;
revoke all on public.progression_week_notes from PUBLIC, anon, authenticated;
grant select on public.progression_week_notes to authenticated;
create policy account_read on public.progression_week_notes for select to authenticated
  using (exists (select 1 from public.progression_blocks b where b.id = progression_week_notes.block_id));

alter table public.plan_resources enable row level security;
revoke all on public.plan_resources from PUBLIC, anon, authenticated;
grant select on public.plan_resources to authenticated;
create policy account_read on public.plan_resources for select to authenticated
  using (exists (select 1 from public.plans p where p.id = plan_resources.plan_id));

alter table public.exercises enable row level security;
revoke all on public.exercises from PUBLIC, anon, authenticated;
grant select on public.exercises to authenticated;
create policy account_read on public.exercises for select to authenticated
  using (exists (select 1 from public.training_exercises t where t.exercise_id = exercises.id)
    or exists (select 1 from public.progression_exercises e where e.exercise_id = exercises.id));

alter table public.exercise_aliases enable row level security;
revoke all on public.exercise_aliases from PUBLIC, anon, authenticated;
grant select on public.exercise_aliases to authenticated;
create policy account_read on public.exercise_aliases for select to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_aliases.exercise_id));

alter table public.rpe_scale enable row level security;
revoke all on public.rpe_scale from PUBLIC, anon, authenticated;
grant select on public.rpe_scale to authenticated;
create policy account_read on public.rpe_scale for select to authenticated
  using (exists (select 1 from public.athlete_access));

alter table public.workout_sessions enable row level security;
revoke all on public.workout_sessions from PUBLIC, anon, authenticated;
grant select on public.workout_sessions to authenticated;
create policy account_read on public.workout_sessions for select to authenticated
  using (exists (select 1 from public.athlete_access a where a.athlete_id = workout_sessions.athlete_id));

alter table public.athlete_measurements enable row level security;
revoke all on public.athlete_measurements from PUBLIC, anon, authenticated;
grant select on public.athlete_measurements to authenticated;
create policy account_read on public.athlete_measurements for select to authenticated
  using (exists (select 1 from public.athlete_access a where a.athlete_id = athlete_measurements.athlete_id));

alter table public.workout_set_logs enable row level security;
revoke all on public.workout_set_logs from PUBLIC, anon, authenticated;
grant select on public.workout_set_logs to authenticated;
create policy account_read on public.workout_set_logs for select to authenticated
  using (exists (select 1 from public.workout_sessions s where s.id = workout_set_logs.workout_session_id
    and s.athlete_id = workout_set_logs.athlete_id
    and s.plan_id is not distinct from workout_set_logs.plan_id));

grant insert, update on public.workout_sessions to authenticated;
create policy account_insert on public.workout_sessions for insert to authenticated
  with check (exists (select 1 from public.athlete_access a
    where a.athlete_id = workout_sessions.athlete_id and a.can_write)
    and exists (select 1 from public.athletes a
      where a.id = workout_sessions.athlete_id and a.client_key = workout_sessions.client_key)
    and exists (select 1 from public.plan_athletes p
      where p.athlete_id = workout_sessions.athlete_id and p.plan_id = workout_sessions.plan_id));
create policy account_update on public.workout_sessions for update to authenticated
  using (exists (select 1 from public.athlete_access a
    where a.athlete_id = workout_sessions.athlete_id and a.can_write))
  with check (exists (select 1 from public.athlete_access a
    where a.athlete_id = workout_sessions.athlete_id and a.can_write)
    and exists (select 1 from public.athletes a
      where a.id = workout_sessions.athlete_id and a.client_key = workout_sessions.client_key)
    and exists (select 1 from public.plan_athletes p
      where p.athlete_id = workout_sessions.athlete_id and p.plan_id = workout_sessions.plan_id));

grant insert, update on public.athlete_measurements to authenticated;
create policy account_insert on public.athlete_measurements for insert to authenticated
  with check (exists (select 1 from public.athlete_access a
    where a.athlete_id = athlete_measurements.athlete_id and a.can_write)
    and exists (select 1 from public.athletes a
      where a.id = athlete_measurements.athlete_id and a.client_key = athlete_measurements.client_key)
    and exists (select 1 from public.plan_athletes p
      where p.athlete_id = athlete_measurements.athlete_id and p.plan_id = athlete_measurements.plan_id));
create policy account_update on public.athlete_measurements for update to authenticated
  using (exists (select 1 from public.athlete_access a
    where a.athlete_id = athlete_measurements.athlete_id and a.can_write))
  with check (exists (select 1 from public.athlete_access a
    where a.athlete_id = athlete_measurements.athlete_id and a.can_write)
    and exists (select 1 from public.athletes a
      where a.id = athlete_measurements.athlete_id and a.client_key = athlete_measurements.client_key)
    and exists (select 1 from public.plan_athletes p
      where p.athlete_id = athlete_measurements.athlete_id and p.plan_id = athlete_measurements.plan_id));

-- A set cannot be attached to another athlete's session or falsify its parent.
grant insert, delete on public.workout_set_logs to authenticated;
create policy account_insert on public.workout_set_logs for insert to authenticated
  with check (exists (
    select 1 from public.workout_sessions s
    join public.athlete_access a on a.athlete_id = s.athlete_id and a.can_write
    where s.id = workout_set_logs.workout_session_id
      and s.athlete_id = workout_set_logs.athlete_id
      and s.plan_id is not distinct from workout_set_logs.plan_id
      and s.client_key = workout_set_logs.client_key
      and s.source_plan_key = workout_set_logs.source_plan_key
      and s.session_id = workout_set_logs.session_id
  ));
create policy account_delete on public.workout_set_logs for delete to authenticated
  using (exists (
    select 1 from public.workout_sessions s
    join public.athlete_access a on a.athlete_id = s.athlete_id and a.can_write
    where s.id = workout_set_logs.workout_session_id
      and s.athlete_id = workout_set_logs.athlete_id
  ));

alter table public.plan_imports enable row level security;
revoke all on public.plan_imports from PUBLIC, anon, authenticated;
create index if not exists plan_athletes_athlete_plan_idx
  on public.plan_athletes (athlete_id, plan_id);

-- Save a workout and replace its sets in one transaction. SECURITY INVOKER
-- preserves the caller's RLS restrictions; an error cannot erase old sets.
create function public.save_workout(p_session jsonb, p_sets jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  saved public.workout_sessions;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_session) is distinct from 'object'
     or jsonb_typeof(p_sets) is distinct from 'array' then
    raise exception 'Invalid workout payload' using errcode = '22023';
  end if;
  insert into public.workout_sessions (
    athlete_id, plan_id, source_plan_key, client_key, session_id,
    workout_date, performed_date, week_number, workout_id, workout_name,
    status, completed_exercises, total_exercises, session_note, recorded_at, raw_payload
  )
  select r.athlete_id, r.plan_id, r.source_plan_key, r.client_key, r.session_id,
    r.workout_date, r.performed_date, r.week_number, r.workout_id, r.workout_name,
    r.status, r.completed_exercises, r.total_exercises, r.session_note,
    r.recorded_at, coalesce(r.raw_payload, '{}'::jsonb)
  from jsonb_populate_record(null::public.workout_sessions, p_session) r
  on conflict (athlete_id, source_plan_key, session_id) do update set
    plan_id = excluded.plan_id, client_key = excluded.client_key,
    workout_date = excluded.workout_date, performed_date = excluded.performed_date,
    week_number = excluded.week_number, workout_id = excluded.workout_id,
    workout_name = excluded.workout_name, status = excluded.status,
    completed_exercises = excluded.completed_exercises,
    total_exercises = excluded.total_exercises, session_note = excluded.session_note,
    recorded_at = excluded.recorded_at, raw_payload = excluded.raw_payload,
    updated_at = now()
  returning * into saved;

  delete from public.workout_set_logs where workout_session_id = saved.id;
  insert into public.workout_set_logs (
    workout_session_id, athlete_id, plan_id, source_plan_key, client_key,
    session_id, exercise_no, exercise_name, set_no, planned_label,
    kg, reps_text, rpe, done, note, recorded_at, raw_payload
  )
  select saved.id, saved.athlete_id, saved.plan_id, saved.source_plan_key, saved.client_key,
    saved.session_id, r.exercise_no, r.exercise_name, coalesce(r.set_no, 1), r.planned_label,
    r.kg, r.reps_text, r.rpe, coalesce(r.done, true), r.note, saved.recorded_at,
    coalesce(r.raw_payload, '{}'::jsonb)
  from jsonb_populate_recordset(null::public.workout_set_logs, p_sets) r;
  return saved.id;
end;
$function$;
revoke all on function public.save_workout(jsonb, jsonb) from PUBLIC, anon;
grant execute on function public.save_workout(jsonb, jsonb) to authenticated;
