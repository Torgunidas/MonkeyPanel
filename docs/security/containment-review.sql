-- APPLIED 2026-09-08 via migration 20260908074510_contain_public_app_tables.
-- Reference script; do not rerun after implementing account access.
-- Target: gorillia_panel / matuflemwleglsrzrlkp, inspected 2026-09-08.
-- Immediate containment only. Stops ALL current browser reads and writes.
-- Does not delete or modify workout rows. Owner access is retained.
-- Restore application access through Auth and restricted policies, not by
-- restoring anonymous grants or the prototype policies.
-- Run the entire file in one transaction, only after approving the outage.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $containment$
declare
  expected_tables constant text[] := array[
    'athlete_measurements', 'athletes', 'exercise_aliases', 'exercises',
    'plan_athletes', 'plan_imports', 'plan_resources', 'plans',
    'progression_blocks', 'progression_exercises', 'progression_sets',
    'progression_week_notes', 'rpe_scale', 'training_exercises', 'trainings',
    'workout_sessions', 'workout_set_logs'
  ];
  expected_policies constant text[] := array[
    'prototype_select_athlete_measurements',
    'prototype_write_athlete_measurements',
    'prototype_delete_progression_week_notes',
    'prototype_insert_progression_week_notes',
    'prototype_select_progression_week_notes',
    'prototype_update_progression_week_notes',
    'prototype_select_workout_sessions',
    'prototype_write_workout_sessions',
    'prototype_select_workout_set_logs',
    'prototype_write_workout_set_logs'
  ];
  actual_tables text[];
  target_table text;
  target_role text;
  target_oid oid;
  existing_policy record;
begin
  -- Stop if the inspected application's inventory has changed.
  select array_agg(c.relname::text order by c.relname::text collate "C")
  into actual_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f');

  if actual_tables is distinct from expected_tables then
    raise exception 'Public relation inventory changed; repeat security review.';
  end if;

  if exists (select 1 from auth.users) then
    raise exception 'Auth accounts now exist; review their access before containment.';
  end if;

  -- Lock the known tables before changing their access controls.
  foreach target_table in array expected_tables loop
    execute format('lock table public.%I in access exclusive mode', target_table);
  end loop;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and not (policyname::text = any(expected_policies))
  ) then
    raise exception 'Unexpected RLS policy; repeat security review.';
  end if;

  foreach target_table in array expected_tables loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format(
      'revoke all privileges on table public.%I from PUBLIC, anon, authenticated',
      target_table
    );
  end loop;

  -- These are the inspected permissive prototype policies, not user policies.
  for existing_policy in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and policyname::text = any(expected_policies)
  loop
    execute format(
      'drop policy %I on public.%I',
      existing_policy.policyname, existing_policy.tablename
    );
  end loop;

  -- Abort the whole transaction if inherited or column grants retain access.
  foreach target_table in array expected_tables loop
    target_oid := to_regclass(format('public.%I', target_table));
    foreach target_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(target_role, target_oid,
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege(target_role, target_oid,
           'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'Residual access for role % on public.%', target_role, target_table;
      end if;
    end loop;
  end loop;
end;
$containment$;

commit;

-- Read-only post-commit check. Expected: 17 rows; RLS true, both grants false.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_access,
       has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
