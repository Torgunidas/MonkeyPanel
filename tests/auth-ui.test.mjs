import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const main=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const editor=fs.readFileSync(new URL('../session-editor.js',import.meta.url),'utf8');
const auth=fs.readFileSync(new URL('../auth.js',import.meta.url),'utf8').replace(/bootAuth\(\);\s*$/,'');

function app({user=null,access=[],client='',storage=new Map()}={}){
  const elements=new Map(),calls=[];let authCallback;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,style:{},classList:{toggle(){},remove(){},add(){}}});
    return elements.get(id);
  };
  const sb={auth:{
    getSession:async()=>({data:{session:user?{user}:null}}),
    getUser:async()=>({data:{user}}),
    onAuthStateChange:fn=>{authCallback=fn},
    signOut:async()=>{authCallback('SIGNED_OUT',null);return {}},
  },from:table=>{calls.push(table);return {select:async()=>({data:access})}},rpc:()=>{calls.push('rpc');return {}}};
  const context=vm.createContext({console,Date,URLSearchParams,Math,setTimeout(){},requestAnimationFrame(){},
    window:{supabase:{createClient:()=>sb},addEventListener(){},scrollTo(){}},
    location:{search:client?`?client=${client}`:'',pathname:'/',assign(){},reload(){}},history:{replaceState(){}},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>({remove(){}}),body:{appendChild(){}}}
  });
  vm.runInContext(main+'\n'+editor+'\n'+auth,context);
  // Use deterministic synthetic app data while exercising the real auth flow.
  vm.runInContext(`apiGetPlan=async()=>{DB_PLAN={id:'plan'};ATHLETE={id:'athlete'};};
    apiGetWorkoutLog=async()=>{};apiGetMeasurements=async()=>{};`,context);
  return {run:code=>vm.runInContext(code,context),elements,calls,storage,emit:(e,s)=>authCallback(e,s)};
}

test('Signed-out visitors see login and never query athlete profiles or read cached workouts',async()=>{
  const storage=new Map([['monkeypanel.alpha.v04.alpha',JSON.stringify({sessionNotes:{secret:'private'}})]]);
  const a=app({client:'alpha',storage});await a.run('bootAuth()');
  assert.deepEqual(a.calls,[]);assert.equal(a.elements.get('app').hidden,true);
  assert.match(a.elements.get('authRoot').innerHTML,/loginPassword/);
  assert.doesNotMatch(a.elements.get('authRoot').innerHTML,/private/);
  assert.equal(a.run('Object.keys(state.sessionNotes).length'),0);
});

test('Changing client in the URL cannot load an unassigned athlete',async()=>{
  const a=app({user:{id:'user-a'},client:'beta',access:[{athlete_id:'a',can_write:true,athletes:{client_key:'alpha',name:'A'}}]});
  await a.run('bootAuth()');assert.equal(a.run('APP_READY'),false);assert.equal(a.run('DB_PLAN'),null);
  assert.match(a.elements.get('authRoot').innerHTML,/Nie masz dostępu/);
  assert.deepEqual(a.calls,['athlete_access']);
});

test('An unrelated signed-in account waits for assignment without accessing app data',async()=>{
  const a=app({user:{id:'unassigned'}});await a.run('bootAuth()');
  assert.equal(a.run('APP_READY'),false);assert.match(a.elements.get('authRoot').innerHTML,/oczekuje na dostęp/);
  assert.deepEqual(a.calls,['athlete_access']);
});

test('Legacy drafts migrate only for an authorized owner and cache keys include account identity',()=>{
  const original=JSON.stringify({sessionNotes:{draft:'unsaved'}});
  const a=app({storage:new Map([['monkeypanel.alpha.v04.alpha',original]])});
  assert.equal(a.run("prepareUserState('owner','alpha',true).sessionNotes.draft"),'unsaved');
  assert.equal(a.run('STATE_KEY'),'monkeypanel.auth.v1.owner.alpha');
  assert.equal(a.run("prepareUserState('coach','alpha',false).sessionNotes.draft"),undefined);
  assert.equal(a.storage.get('monkeypanel.alpha.v04.alpha'),original);
});

test('Coach sees read-only plan and measurement history without mutation controls',async()=>{
  const a=app();a.run("AUTH_USER={id:'coach'};APP_READY=true;CAN_WRITE=false;STATE_KEY='coach';CURRENT_PLAN={planId:'plan'};");
  a.run('renderMeasurements()');
  assert.doesNotMatch(a.elements.get('view').innerHTML,/Zapisz pomiar|oninput/);
  assert.match(a.elements.get('view').innerHTML,/Historia pomiarów/);
  a.run("renderPlanPreview({id:'W1T1',week:1,workoutId:1},{name:'Plan',exercises:[{no:'1',name:'Squat',sets:'3',reps:'10'}]})");
  assert.match(a.elements.get('view').innerHTML,/Squat/);
  assert.doesNotMatch(a.elements.get('view').innerHTML,/syncWorkout|updateSet/);
  await a.run('syncWorkout()');await a.run('saveMeasurements()');assert.deepEqual(a.calls,[]);
});

test('Logout hides the app and clears identity and workout data from memory',async()=>{
  const a=app();a.run("AUTH_USER={id:'a'};APP_READY=true;STATE_KEY='draft';CAN_WRITE=true;DB_WORKOUT_SESSIONS=[{id:'private'}];");
  a.emit('SIGNED_OUT',null);
  assert.equal(a.run('AUTH_USER'),null);assert.equal(a.run('DB_WORKOUT_SESSIONS.length'),0);
  assert.equal(a.elements.get('app').hidden,true);assert.equal(a.run('APP_READY'),false);
});

test('Session notes and exercise names cannot break out of event attributes',()=>{
  const a=app();
  const escaped=a.run(`eventJSON({note:"Coach's <img src=x onerror=alert(1)> &quot;"})`);
  assert.doesNotMatch(escaped,/[<>"']/);
  assert.match(escaped,/&#39;/);assert.match(escaped,/&amp;quot;/);
});
