import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/apiGetPlan\(\)\.then\([\s\S]*$/, '');
function app(){
  const elements=new Map(), storage=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',style:{},classList:{toggle(){},remove(){},add(){}}});return elements.get(id)};
  const context=vm.createContext({console,Date,URLSearchParams,Math,setTimeout(){},requestAnimationFrame(){},
    window:{supabase:{createClient:()=>({})},addEventListener(){},scrollTo(){}},location:{search:'?client=test'},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>({remove(){}})}});
  vm.runInContext(source,context);
  return {run:code=>vm.runInContext(code,context),context,elements};
}

test('Explicit sets, time and done modes take precedence over exercise names',()=>{
  const a=app();
  assert.equal(a.run('exerciseMode({name:"DB Weighted Butterfly Stretch",type:"sets",sets:"3"},{week:1})'),'sets');
  assert.equal(a.run('defaultSets({name:"DB Weighted Butterfly Stretch",type:"sets",sets:"3",reps:"12"},{week:1}).length'),3);
  assert.equal(a.run('exerciseMode({name:"Rozgrzewka",type:"time"},{week:1})'),'time');
  assert.equal(a.run('exerciseMode({name:"Ćwiczenie",type:"done"},{week:1})'),'done');
});
test('Missing weekly prescriptions produce no invented series',()=>{
  const a=app();
  assert.equal(a.run('defaultSets({name:"Zercher Squat",type:"sets",sets:"3",requiresPrescription:true,prescriptions:{}},{week:5}).length'),0);
  assert.equal(a.run('plannedSetCount({type:"sets",sets:"3",requiresPrescription:true,prescriptions:{}},{week:5})'),0);
  assert.equal(a.run('countSets({type:"sets",sets:"według rozpiski"},{week:5})'),0);
});
test('Base load, tempo and planned targets are preserved without linking actual edits',()=>{
  const a=app();
  a.run('const ex=mapTrainingExercise({id:"row",mode:"sets",sets_text:"3",reps_text:"12",load_text:"15+15",tempo_text:"2200",exercises:{name:"DB Row"}},0); const sets=defaultSets(ex,{week:1}); sets[0].reps="10";');
  assert.equal(a.run('ex.load'),'15+15');
  assert.equal(a.run('ex.tempo'),'2200');
  assert.equal(a.run('sets[0].planned.reps'),'12');
  assert.equal(a.run('sets[0].reps'),'10');
});
test('Set view shows roles, original target and rest, including zero load',()=>{
  const a=app();
  const text=a.run('setPrescriptionHTML({planned:{label:"Back-off",kg:"0",reps:"6",rest:"3 min"}})');
  assert.match(text,/Back-off/); assert.match(text,/0 kg/); assert.match(text,/6 powt/); assert.match(text,/3 min/);
});
test('An explicitly empty plan note suppresses unrelated registry progression notes',()=>{
  const a=app();
  assert.equal(a.run('mapTrainingExercise({id:"row",notes:"",exercises:{name:"Podciąganie",notes:"progresja liniowa"}},0).notes'),'');
});
test('Legacy series expansion and training-specific links still work',()=>{
  const a=app();
  a.run(`DB_PROGRESSION_BLOCKS=[{id:'b',start_week:1,end_week:2}];
    DB_PROGRESSION_EXERCISES=[{id:'pe',block_id:'b',training_exercise_id:'first',exercise_id:'squat'}];
    DB_PROGRESSION_SETS=[{id:'s',progression_exercise_id:'pe',week_number:1,set_no:1,reps_text:'5',kg:50,set_count:3}];`);
  assert.equal(a.run("prescriptionsFor({id:'first',exercise_id:'squat'})['1'].length"),3);
  assert.equal(a.run("Object.keys(prescriptionsFor({id:'other',exercise_id:'squat',training_id:'other-training'})).length"),0);
});

if(process.argv[2]){
  const plan=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  function imported(){
    const a=app(); a.context.input=plan;
    a.run(`DB_PLAN={id:'plan'}; CURRENT_PLAN={planId:'dup',planName:'DUP',clientName:'Test'}; TOTAL_WEEKS=11;
      DB_TRAININGS=input.trainings.map(t=>({id:'t'+t.order_index,name:t.name,order_index:t.order_index}));
      DB_PROGRESSION_BLOCKS=[{id:'b',start_week:1,end_week:11}];
      DB_WEEK_NOTES=[{block_id:'b',week_number:9,notes:'D1/D2: deload. D3/D4: brak rozpiski.'}];
      input.trainings.forEach(t=>t.exercises.forEach((e,i)=>{
        const id='t'+t.order_index+'e'+i;
        DB_TRAINING_EXERCISES.push({id,training_id:'t'+t.order_index,exercise_no:String(i+1),order_index:i+1,sets_text:e.sets_text,reps_text:e.reps_text,mode:'sets',notes:e.notes,use_wg:e.progression,exercises:{name:e.name}});
        if(e.progression){DB_PROGRESSION_EXERCISES.push({id,block_id:'b',training_exercise_id:id});DB_PROGRESSION_SETS.push(...e.series.map(s=>({...s,id:id+'w'+s.week_number+'s'+s.set_no,progression_exercise_id:id})));}
      }));PLAN=mapPlanWorkouts();DAYS=buildDays(PLAN.length);`);
    return a;
  }
  test('Workbook resolves to 4 days, 25 exercises and the exact heavy top/back-off sets',()=>{
    const a=imported();
    assert.equal(a.run('PLAN.length'),4);
    assert.equal(a.run('PLAN.flatMap(t=>t.exercises).length'),25);
    assert.equal(a.run('sessionLetter(3)'),'D3');
    assert.equal(a.run('workoutPlannedSets(PLAN[0],{week:1})'),23);
    assert.equal(a.run('workoutPlannedSets(PLAN[1],{week:1})'),17);
    assert.equal(a.run('workoutPlannedSets(PLAN[1],{week:2})'),18);
    const actual=JSON.parse(a.run('JSON.stringify(defaultSets(PLAN[0].exercises[1],{week:1}).map(s=>[s.planned.label,s.kg,s.reps]))'));
    assert.deepEqual(actual,[['Top set','62.5','6'],['Back-off','52.5','6'],['Back-off','52.5','6'],['Back-off','52.5','6']]);
  });
  test('All 375 imported series retain their week, load, rep count and role',()=>{
    const a=imported();
    const result=a.run(`input.trainings.every((t,ti)=>t.exercises.every((e,ei)=>e.series.every(s=>{
      const p=PLAN[ti].exercises[ei].prescriptions[String(s.week_number)][s.set_no-1];
      return p.kg===(s.load_text||'')&&p.reps===s.reps_text&&p.label===s.label;
    })))`);
    assert.equal(result,true);
  });
  test('Volume weeks are 12/14/16/10; week 5 remains empty and renders a warning',()=>{
    const a=imported();
    assert.deepEqual(JSON.parse(a.run('JSON.stringify([1,2,3,4].map(week=>defaultSets(PLAN[3].exercises[1],{week})[0].reps))')),['12','14','16','10']);
    assert.equal(a.run('defaultSets(PLAN[3].exercises[1],{week:5}).length'),0);
    a.run("state.mode='session';state.workoutId=4;state.activeSessionId='W5T4';state.exerciseIndex=1;renderSession();");
    assert.match(a.elements.get('view').innerHTML,/Brak rozpiski na tydzień 5/);
    assert.doesNotMatch(a.elements.get('view').innerHTML,/Kilogramy, seria/);
  });
  test('Week 2 screen shows resolved reps and the deload note is available in week 9',()=>{
    const a=imported();
    a.run("state.mode='session';state.workoutId=3;state.activeSessionId='W2T3';state.exerciseIndex=0;renderSession();");
    assert.match(a.elements.get('view').innerHTML,/14 powt\./);
    assert.doesNotMatch(a.elements.get('view').innerHTML,/12 powt\./);
    assert.match(a.run('weekNotesFor({week:9})'),/deload/);
  });
  test('Completed imported sets survive the existing database log mapping',()=>{
    const a=imported();
    const result=a.run(`const e=PLAN[0].exercises[1],s=defaultSets(e,{week:1})[0];
      s.kg='60';s.reps='5';s.rpe='8';s.done=true;
      const mapped=mapDbLogRow({session_id:'W1T1',exercise_no:e.no,exercise_name:e.name,set_no:1,planned_label:s.note,kg:nullableNumber(s.kg),reps_text:s.reps,rpe:8,done:true});
      JSON.stringify(normalizeServerLogRow(mapped).set);`);
    const set=JSON.parse(result);assert.equal(set.kg,'60');assert.equal(set.reps,'5');assert.equal(set.rpe,'8');assert.equal(set.done,true);assert.match(set.note,/Top set/);
  });
}
