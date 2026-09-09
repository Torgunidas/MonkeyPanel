import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {sessionApp} from './helpers/session-app.mjs';

test('Extra occurrences belong to one session, including duplicates of planned names',()=>{
  const a=sessionApp(),original=a.run('JSON.stringify(PLAN)');
  a.run("const first=addSessionExercise('Przysiad');const second=addSessionExercise('Przysiad');");
  assert.equal(a.run('sessionWorkout().exercises.length'),4);
  assert.notEqual(a.run('first.no'),a.run('second.no'));
  assert.equal(a.run("sessionWorkout({id:'W2T1',week:2,workoutId:1}).exercises.length"),2);
  assert.equal(a.run('JSON.stringify(PLAN)'),original);
  assert.equal(a.run("addSessionExercise('   ')"),null);
  assert.match(a.elements.get('view').innerHTML,/Dodane w tej sesji/);
});

test('Prepend, append and move preserve results, identity, notes and prescribed targets',()=>{
  const a=sessionApp();
  a.run("const first=setsFor()[0];first.done=true;first.freeNote='Warmup note';const last=addSet('end');const extra=addSet('start');moveSessionSet('squat',last.id,1);");
  assert.equal(a.run('setsFor()[0].id'),a.run('extra.id'));
  assert.equal(a.run('setsFor()[1].id'),a.run('last.id'));
  assert.equal(a.run('setsFor()[2].id'),a.run('first.id'));
  assert.equal(a.run('setsFor()[2].planned.kg'),80);
  assert.equal(a.run('setsFor()[2].done'),true);
  assert.equal(a.run('setsFor()[2].freeNote'),'Warmup note');
  assert.equal(a.run("moveSessionSet('squat','missing',0)"),false);
  assert.equal(a.run("moveSessionSet('squat',first.id,-1)"),false);
  a.run("setHandleKey({key:'ArrowUp',preventDefault(){}},'squat',first.id)");
  assert.equal(a.run('setsFor()[1].id'),a.run('first.id'));
  assert.match(a.elements.get('view').innerHTML,/Dodaj serię na początku/);
  assert.match(a.elements.get('view').innerHTML,/onpointerdown=/);
  a.run("toggleSet(setsFor()[3].id)");
  assert.equal(a.run('setsFor()[3].done'),true);
});

test('Superset ordering is independent for each exercise',()=>{
  const a=sessionApp();
  a.run("PLAN[0].exercises.forEach(ex=>ex.supersetKey='pair');const rowBefore=JSON.stringify(setsFor(exerciseById('row')));const added=addSet('start');moveSessionSet('squat',added.id,2);");
  assert.equal(a.run("JSON.stringify(setsFor(exerciseById('row')))"),a.run('rowBefore'));
  assert.equal(a.run('supersetSequence(currentSuperset()).sequence.length'),4);
  assert.match(a.elements.get('view').innerHTML,/data-session-exercise="squat"/);
  assert.match(a.elements.get('view').innerHTML,/data-session-exercise="row"/);
});

test('Dirty saved-session drafts survive reload and stale server hydration',()=>{
  const a=sessionApp();
  a.run("addSet('start');updateSet(setsFor()[0].id,'kg','12');");
  const b=sessionApp({},a.storage);
  b.run("state=load(STATE_KEY,emptyState());const row={session_id:'W1T1',plan_id:'plan-alpha',exercise_no:'1',set_no:1,kg:999};pruneLocalCacheBeforeServerHydrate([row],[]);hydrateLogsFromServer([row]);refreshUntouchedDraftsFromProgression();");
  assert.equal(b.run('setsFor().length'),3);
  assert.equal(b.run('setsFor()[0].kg'),'12');
  assert.equal(b.run('hasActiveDraft()'),true);
});

test('Coach, signed-out visitors and saved-history views cannot edit sessions',()=>{
  for(const role of ['CAN_WRITE=false','AUTH_USER=null',"state.mode='history-detail'"]){
    const a=sessionApp();a.run(role);
    assert.equal(a.run("addSessionExercise('Should not exist')"),null);
    a.run("addSet('start');updateSet('anything','kg','999')");
    assert.equal(a.run('Object.keys(state.logs).length'),0);
    assert.equal(a.run('Object.keys(state.sessionWorkouts).length'),0);
  }
});

test('Mode changes apply to the session occurrence without changing future plans',()=>{
  const a=sessionApp();a.run("setExerciseMode('time')");
  assert.equal(a.run('exerciseMode(exercise())'),'time');
  assert.equal(a.run("exerciseMode(workout().exercises[0],{id:'W2T1',week:2,workoutId:1})"),'sets');
  a.run("const extra=addSessionExercise('Przysiad','done')");
  assert.equal(a.run('exerciseMode(extra)'),'done');
});

test('A completed unsaved session can return to an exercise or add another occurrence',()=>{
  const a=sessionApp();a.run("sessionWorkout().exercises.forEach(ex=>setsFor(ex).forEach(s=>s.done=true));render()");
  assert.match(a.elements.get('view').innerHTML,/Zapisz trening/);
  a.run('editSessionExercise(0)');
  assert.match(a.elements.get('view').innerHTML,/Dodaj serię na początku/);
  a.run("addSet('start')");assert.equal(a.run('sessionDone()'),false);
});

test('Actual workout payload survives the existing RPC, reload and coach history without changing plan rows',async()=>{
  const db=new PGlite();
  try{
    await db.exec(await fs.readFile(new URL('./security-schema.sql',import.meta.url),'utf8'));
    await db.exec('begin;'+await fs.readFile(new URL('../supabase/migrations/20260908125439_account_scoped_access.sql',import.meta.url),'utf8')+'commit;');
    await db.exec(`
      insert into auth.users values ('00000000-0000-0000-0000-000000000001');
      insert into athletes(id,client_key,name) values ('00000000-0000-0000-0000-000000000011','alpha','Synthetic athlete');
      insert into athlete_access values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',true);
      insert into plans(id,slug,name,start_date,weeks) values ('00000000-0000-0000-0000-000000000021','plan-alpha','Synthetic plan','2026-09-01',2);
      insert into plan_athletes values ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011',now());
      set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
    `);
    const requests=[];
    const sb={rpc:async(name,args)=>{
      requests.push(name);
      try{await db.query('select public.save_workout($1::jsonb,$2::jsonb)',[JSON.stringify(args.p_session),JSON.stringify(args.p_sets)]);return {}}
      catch(error){return {error}}
    },from:table=>{
      assert.ok(['workout_sessions','workout_set_logs'].includes(table));
      let fields='*',where=[],values=[],order=[];
      const q={select(f){fields=f;assert.match(f,/raw_payload/);return q},eq(k,v){values.push(v);where.push(`${k}=$${values.length}`);return q},in(k,vs){values.push(vs);where.push(`${k}=any($${values.length}::uuid[])`);return q},order(k,{ascending=true}={}){order.push(k+(ascending?' asc':' desc'));return q},then(resolve,reject){return db.query(`select ${fields} from ${table} where ${where.join(' and ')} order by ${order.join(',')}`,values).then(r=>resolve({data:r.rows}),reject)}};return q;
    }};
    const a=sessionApp(sb),original=a.run('JSON.stringify(PLAN)');
    a.run("const warmup=addSet('start');updateSet(warmup.id,'kg','0');updateSet(warmup.id,'reps','12');updateSet(warmup.id,'freeNote','Before the working sets');const firstExtra=addSessionExercise('Przysiad');updateSet(setsFor()[0].id,'kg','22');const secondExtra=addSessionExercise('Przysiad');updateSet(setsFor()[0].id,'kg','33');updateExerciseNote(secondExtra.id,'Session occurrence note');sessionWorkout().exercises.forEach(ex=>setsFor(ex).forEach(s=>s.done=true));markSessionChanged();");
    await a.run('syncWorkout()');
    assert.deepEqual(requests,['save_workout']);
    assert.equal(a.errors.length,0);
    assert.equal(a.run('hasSessionEdits()'),false);
    assert.equal(a.run('JSON.stringify(PLAN)'),original);
    const b=sessionApp(sb);b.run("CAN_WRITE=false;state.mode='history-detail'");await b.run('apiGetWorkoutLog()');
    assert.equal(b.run('sessionWorkout().exercises.length'),4);
    assert.equal(b.run("setsFor(exerciseById('squat'))[0].kg"),'0');
    assert.equal(b.run("setsFor(exerciseById('squat'))[0].freeNote"),'Before the working sets');
    assert.equal(b.run("setsFor(exerciseById('squat'))[1].planned.label"),'Top set');
    assert.equal(b.run('existingSetsFor(sessionWorkout().exercises[2])[0].kg'),'22');
    assert.equal(b.run('existingSetsFor(sessionWorkout().exercises[3])[0].kg'),'33');
    assert.match(b.elements.get('view').innerHTML,/Dodane w tej sesji/);
    assert.match(b.elements.get('view').innerHTML,/Session occurrence note/);
    assert.equal(b.errors.length,0);
    assert.doesNotMatch(b.elements.get('view').innerHTML,/set-drag-handle|showAddSessionExercise/);
    assert.equal((await db.query('select count(*)::int as n from plans')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int as n from training_exercises')).rows[0].n,0);
  }finally{await db.close()}
});

test('A failed save keeps the modified exercise list and series as a retryable draft',async()=>{
  const a=sessionApp({rpc:async()=>({error:new Error('synthetic failure')})});
  a.run("addSessionExercise('Extra after failed save');addSet('start')");
  await a.run('syncWorkout()');
  assert.equal(a.run('SESSION_SAVING'),false);
  assert.equal(a.run('hasSessionEdits()'),true);
  assert.equal(a.run('sessionWorkout().exercises.length'),3);
  assert.equal(a.run('setsFor().length'),2);
  assert.match(a.errors[0].message,/synthetic failure/);
});
