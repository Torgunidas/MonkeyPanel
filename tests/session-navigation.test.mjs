import assert from 'node:assert/strict';
import test from 'node:test';
import {sessionApp} from './helpers/session-app.mjs';

test('The last exercise opens a summary even when earlier sets are unfinished',()=>{
  const a=sessionApp();
  a.run("setsFor()[0].done=true;state.exerciseIndex=1;setsFor().forEach(set=>set.done=true);render()");
  assert.match(a.elements.get('view').innerHTML,/onclick="showSessionSummary\(\)">Podsumowanie/);
  const before=a.run('JSON.stringify(state.logs)');
  a.run('nextExercise()');
  const summary=a.elements.get('view').innerHTML;
  assert.match(summary,/Podsumowanie treningu/);
  assert.match(summary,/Do sprawdzenia: 1/);
  assert.match(summary,/Przysiad<small>Nieukończone · serie 1\/2/);
  assert.match(summary,/Zapisz wykonane/);
  assert.doesNotMatch(summary,/<h2>Trening ukończony<\/h2>/);
  assert.equal(a.run('sessionDone()'),false);
  assert.equal(a.run('JSON.stringify(state.logs)'),before);
  a.run('editSessionExercise(0)');
  assert.equal(a.run('state.sessionSummaryOpen'),false);
  assert.match(a.elements.get('view').innerHTML,/Dodaj serię na końcu/);
});

test('The final superset can reach a summary without marking pending sets done',()=>{
  const a=sessionApp();
  a.run("PLAN[0].exercises.forEach(ex=>ex.supersetKey='pair');render();nextExercise()");
  assert.equal(a.run('state.sessionSummaryOpen'),true);
  assert.equal(a.run('sessionDone()'),false);
  assert.match(a.elements.get('view').innerHTML,/Do sprawdzenia: 2/);
  assert.match(a.elements.get('view').innerHTML,/Zapisz wykonane/);
});

test('Reviewing a completed session can return to saving, including after reload',()=>{
  const a=sessionApp();
  a.run('sessionWorkout().exercises.forEach(ex=>setsFor(ex).forEach(set=>set.done=true));editSessionExercise(1);nextExercise()');
  assert.equal(a.run('SESSION_REVIEW_EDIT'),false);
  assert.match(a.elements.get('view').innerHTML,/Zapisz trening/);
  assert.doesNotMatch(a.elements.get('view').innerHTML,/Do sprawdzenia/);
  const b=sessionApp({},a.storage);
  b.run('state=load(STATE_KEY,emptyState());render()');
  assert.match(b.elements.get('view').innerHTML,/Zapisz trening/);
  b.run("addSessionExercise('Dodatkowe ćwiczenie')");
  assert.equal(b.run('state.sessionSummaryOpen'),false);
  assert.match(b.elements.get('view').innerHTML,/Dodaj serię na końcu/);
  b.run('setSession(schedule()[1])');
  assert.equal(b.run('state.sessionSummaryOpen'),false);
});

test('A summary cannot be opened for read-only, signed-out or saving sessions',()=>{
  for(const role of ['CAN_WRITE=false','AUTH_USER=null','SESSION_SAVING=true',"state.mode='history-detail'"]){
    const a=sessionApp();a.run(role+';showSessionSummary()');
    assert.equal(a.run('state.sessionSummaryOpen'),false);
  }
});

test('A queued navigation scroll yields to an input focused before the next frame',()=>{
  const a=sessionApp(),frames=[],scrolls=[];
  a.context.requestAnimationFrame=callback=>frames.push(callback);
  a.context.window.scrollTo=position=>scrolls.push(position);
  a.run('scrollToExerciseTop()');
  a.context.document.activeElement={matches:()=>true};
  frames.shift()();
  assert.equal(scrolls.length,0);
  a.context.document.activeElement=null;
  a.run('scrollToExerciseTop()');frames.shift()();
  assert.equal(scrolls.length,1);
});

test('Interrupted series dragging stops auto-scroll when editing, hidden or detached',()=>{
  for(const reason of ['editing','hidden','detached']){
    const a=sessionApp(),frames=[],scrolls=[],cancelled=[];
    a.context.requestAnimationFrame=callback=>frames.push(callback);
    a.context.cancelAnimationFrame=id=>cancelled.push(id);
    a.context.window.scrollBy=(...position)=>scrolls.push(position);
    a.run(`setDrag={exerciseId:'squat',setId:setsFor()[0].id,pointerId:1,y:799,startY:700,moved:false,frame:42,handle:{isConnected:true,hasPointerCapture:()=>false}}`);
    if(reason==='editing')a.context.document.activeElement={matches:()=>true};
    if(reason==='hidden')a.context.document.hidden=true;
    if(reason==='detached')a.run('setDrag.handle.isConnected=false');
    a.run('moveSetDrag({pointerId:1,clientY:799,preventDefault(){}})');
    assert.equal(a.run('setDrag'),null);
    assert.equal(a.run('consumedSetDrag'),true);
    assert.deepEqual(cancelled,[42]);
    assert.equal(frames.length,0);
    assert.equal(scrolls.length,0);
  }
});
