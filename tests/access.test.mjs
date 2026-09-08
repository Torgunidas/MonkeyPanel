import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const userA=uuid(1),userB=uuid(2),coach=uuid(3),stranger=uuid(4);
const athleteA=uuid(11),athleteB=uuid(12),planA=uuid(21),planB=uuid(22);
const sessionA=uuid(91),sessionB=uuid(92);
const schema=await fs.readFile(new URL('./security-schema.sql',import.meta.url),'utf8');
const migration=await fs.readFile(new URL('../supabase/migrations/20260908125439_account_scoped_access.sql',import.meta.url),'utf8');

test('Account isolation, coach read-only access and atomic workout save',async t=>{
  const db=new PGlite();
  await db.exec(schema);
  await db.exec('begin;'+migration+'commit;');
  await db.exec(`
    insert into auth.users values ('${userA}'),('${userB}'),('${coach}'),('${stranger}');
    insert into public.athletes(id,client_key,name) values ('${athleteA}','alpha','Athlete A'),('${athleteB}','beta','Athlete B');
    insert into public.athlete_access values ('${userA}','${athleteA}',true),('${userB}','${athleteB}',true),('${coach}','${athleteA}',false),('${coach}','${athleteB}',false);
    insert into public.plans(id,slug,name,start_date,weeks) values ('${planA}','plan-alpha','Plan A','2026-09-01',11),('${planB}','plan-beta','Plan B','2026-09-01',11);
    insert into public.plan_athletes(plan_id,athlete_id) values ('${planA}','${athleteA}'),('${planB}','${athleteB}');
  `);
  for(const n of [1,2]){
    await db.exec(`
      insert into public.exercises(id,name) values ('${uuid(30+n)}','Exercise ${n}');
      insert into public.exercise_aliases(exercise_id,alias) values ('${uuid(30+n)}','Alias ${n}');
      insert into public.trainings(id,plan_id,name,order_index) values ('${uuid(40+n)}','${uuid(20+n)}','Training',1);
      insert into public.training_exercises(id,training_id,exercise_id,order_index) values ('${uuid(50+n)}','${uuid(40+n)}','${uuid(30+n)}',1);
      insert into public.progression_blocks(id,plan_id,name,block_index,start_week,end_week) values ('${uuid(60+n)}','${uuid(20+n)}','Block',1,1,11);
      insert into public.progression_exercises(id,block_id,exercise_id,training_exercise_id) values ('${uuid(70+n)}','${uuid(60+n)}','${uuid(30+n)}','${uuid(50+n)}');
      insert into public.progression_sets(progression_exercise_id,week_number,set_no) values ('${uuid(70+n)}',1,1);
      insert into public.progression_week_notes(block_id,week_number,notes) values ('${uuid(60+n)}',1,'Synthetic note');
      insert into public.plan_resources(plan_id,label) values ('${uuid(20+n)}','Synthetic resource');
      insert into public.workout_sessions(id,athlete_id,plan_id,source_plan_key,client_key,session_id) values ('${uuid(90+n)}','${uuid(10+n)}','${uuid(20+n)}','${n===1?'plan-alpha':'plan-beta'}','${n===1?'alpha':'beta'}','W1T1');
      insert into public.workout_set_logs(workout_session_id,athlete_id,plan_id,source_plan_key,client_key,session_id,exercise_name,kg) values ('${uuid(90+n)}','${uuid(10+n)}','${uuid(20+n)}','${n===1?'plan-alpha':'plan-beta'}','${n===1?'alpha':'beta'}','W1T1','Exercise ${n}',50);
      insert into public.athlete_measurements(athlete_id,plan_id,client_key,measurement_date) values ('${uuid(10+n)}','${uuid(20+n)}','${n===1?'alpha':'beta'}','2026-09-01');
    `);
  }
  await db.exec("insert into public.rpe_scale values (8,'Synthetic','2'); insert into public.plan_imports(source_filename) values ('synthetic.xlsx');");
  async function as(role,user,fn){
    await db.exec(`begin; set local role ${role};`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);
    try{return await fn()}finally{await db.exec('rollback;')}
  }
  const read=table=>db.query(`select count(*)::int as n from public.${table}`).then(r=>r.rows[0].n);
  const scoped=['athletes','plans','plan_athletes','trainings','training_exercises','progression_blocks','progression_exercises','progression_sets','progression_week_notes','plan_resources','exercises','exercise_aliases','workout_sessions','workout_set_logs','athlete_measurements'];
  const denied=fn=>assert.rejects(fn,e=>e.code==='42501');
  const ownSession={athlete_id:athleteA,plan_id:planA,client_key:'alpha',source_plan_key:'plan-alpha',session_id:'W1T1',status:'done'};
  const rpc=(session,sets)=>db.query('select public.save_workout($1::jsonb,$2::jsonb) as id',[JSON.stringify(session),JSON.stringify(sets)]);

  await t.test('Each athlete sees only their own rows through every plan relationship',async()=>{
    for(const user of [userA,userB])await as('authenticated',user,async()=>{
      for(const table of scoped)assert.equal(await read(table),1,table);
      const rows=await db.query('select id from public.athletes');
      assert.equal(rows.rows[0].id,user===userA?athleteA:athleteB);
      assert.equal(await read('athlete_access'),1);
    });
  });
  await t.test('Coach sees both assigned profiles and all their plan relationships',async()=>{
    await as('authenticated',coach,async()=>{for(const table of scoped)assert.equal(await read(table),2,table)});
  });
  await t.test('Anonymous users have no grants and unrelated accounts see no rows',async()=>{
    for(const table of [...scoped,'athlete_access','rpe_scale','plan_imports'])await denied(()=>as('anon',null,()=>read(table)));
    for(const user of [stranger,null])await as('authenticated',user,async()=>{
      for(const table of [...scoped,'athlete_access','rpe_scale'])assert.equal(await read(table),0,table);
    });
  });
  await t.test('Import records remain private even for mapped users',async()=>{
    for(const user of [userA,userB,coach])await denied(()=>as('authenticated',user,()=>read('plan_imports')));
  });
  await t.test('Owners cannot change another athlete, forge ownership or grant themselves access',async()=>{
    await denied(()=>as('authenticated',userA,()=>rpc({...ownSession,athlete_id:athleteB,plan_id:planB,client_key:'beta'},[])));
    await denied(()=>as('authenticated',userA,()=>rpc({...ownSession,client_key:'beta'},[])));
    await denied(()=>as('authenticated',userA,()=>rpc({...ownSession,plan_id:planB},[])));
    await denied(()=>as('authenticated',userA,()=>db.exec(`update public.workout_sessions set athlete_id='${athleteB}' where id='${sessionA}'`)));
    await denied(()=>as('authenticated',userA,()=>db.exec(`insert into public.athlete_access values ('${userA}','${athleteB}',true)`)));
    await denied(()=>as('authenticated',coach,()=>db.exec('update public.athlete_access set can_write=true')));
    await as('authenticated',userA,async()=>{
      assert.equal((await db.query(`update public.workout_sessions set status='forged' where id='${sessionB}' returning id`)).rows.length,0);
      assert.equal((await db.query(`delete from public.workout_set_logs where workout_session_id='${sessionB}' returning id`)).rows.length,0);
    });
  });
  await t.test('Coach cannot save workouts or measurements, update sessions or delete sets',async()=>{
    await denied(()=>as('authenticated',coach,()=>rpc(ownSession,[])));
    await denied(()=>as('authenticated',coach,()=>db.exec(`insert into public.athlete_measurements(athlete_id,plan_id,client_key,measurement_date) values ('${athleteA}','${planA}','alpha','2026-09-02')`)));
    await as('authenticated',coach,async()=>{
      assert.equal((await db.query('update public.workout_sessions set status=\'forged\' returning id')).rows.length,0);
      assert.equal((await db.query('delete from public.workout_set_logs returning id')).rows.length,0);
      assert.equal((await db.query('update public.athlete_measurements set waga=999 returning id')).rows.length,0);
    });
  });
  await t.test('A set cannot be attached to someone else’s session',async()=>{
    await denied(()=>as('authenticated',userA,()=>db.exec(`insert into public.workout_set_logs(workout_session_id,athlete_id,plan_id,source_plan_key,client_key,session_id,exercise_name) values ('${sessionB}','${athleteA}','${planA}','plan-alpha','alpha','W1T1','forged')`)));
  });
  await t.test('Owner can insert and update their own measurements',async()=>{
    await as('authenticated',userA,async()=>{
      await db.exec(`insert into public.athlete_measurements(athlete_id,plan_id,client_key,measurement_date,waga) values ('${athleteA}','${planA}','alpha','2026-09-02',70)`);
      assert.equal((await db.query('update public.athlete_measurements set waga=71 returning waga')).rows.length,2);
    });
  });
  await t.test('Atomic save uses the parent identity and replaces old sets',async()=>{
    await as('authenticated',userA,async()=>{
      const result=await rpc(ownSession,[{exercise_name:'Saved exercise',set_no:1,kg:60,athlete_id:athleteB,workout_session_id:sessionB}]);
      assert.equal(result.rows[0].id,sessionA);
      const sets=await db.query('select athlete_id,workout_session_id,kg from public.workout_set_logs');
      assert.equal(sets.rows.length,1);assert.equal(sets.rows[0].athlete_id,athleteA);assert.equal(sets.rows[0].kg,'60');
    });
  });
  await t.test('A rejected set leaves the existing session and series unchanged',async()=>{
    await as('authenticated',userA,async()=>{
      await db.exec('savepoint before_invalid_save;');
      await assert.rejects(()=>rpc({...ownSession,status:'changed'},[{exercise_name:null}]),e=>e.code==='23502');
      await db.exec('rollback to savepoint before_invalid_save;');
      assert.equal((await db.query('select kg from public.workout_set_logs')).rows[0].kg,'50');
      assert.equal((await db.query('select status from public.workout_sessions')).rows[0].status,null);
    });
  });
  await db.close();
});
