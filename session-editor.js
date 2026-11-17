// Session changes are snapshots of what happened, never writes to the training plan.
let SESSION_REVIEW_EDIT=false, SESSION_SAVING=false, setDrag=null, consumedSetDrag=false;
let sessionModalFocus=null;

function sessionWorkout(sess=currentSession()){
  const base=workout(sess.workoutId);
  return {...base,exercises:state.sessionWorkouts?.[sessionKey(sess)]||base.exercises};
}
function ensureSessionSnapshot(sess=currentSession()){
  state.sessionWorkouts=state.sessionWorkouts||{};
  const key=sessionKey(sess);
  if(!state.sessionWorkouts[key])state.sessionWorkouts[key]=JSON.parse(JSON.stringify(workout(sess.workoutId).exercises));
  return state.sessionWorkouts[key];
}
function canEditSession(){
  return APP_READY&&!!AUTH_USER&&CAN_WRITE&&state.mode==="session"&&!SESSION_SAVING&&!statusSaysDone(currentSession());
}
function markSessionChanged(sess=currentSession()){
  ensureSessionSnapshot(sess);
  state.sessionEdits=state.sessionEdits||{};
  state.sessionEdits[sessionKey(sess)]=uid();
  save();
}
function hasSessionEdits(sess=currentSession()){return !!state.sessionEdits?.[sessionKey(sess)]}
function editSessionExercise(index){
  if(!canEditSession())return;
  state.sessionSummaryOpen=false;
  SESSION_REVIEW_EDIT=true;
  state.exerciseIndex=Math.max(0,Math.min(index,sessionWorkout().exercises.length-1));
  render();scrollToExerciseTop();
}
function showSessionSummary(){
  if(!canEditSession())return;
  state.sessionSummaryOpen=true;
  SESSION_REVIEW_EDIT=false;
  document.activeElement?.blur?.();
  cancelSetDrag();
  render();scrollToExerciseTop();
}
function sessionNextButtonHTML(last){
  return `<button class="btn" onclick="${last?"showSessionSummary()":"nextExercise()"}">${last?"Podsumowanie":"Następne ćwiczenie"} <span aria-hidden="true">→</span></button>`;
}
function pendingSessionExercisesHTML(sess=currentSession()){
  if(sessionDone(sess))return "";
  const pending=sessionWorkout(sess).exercises.map((ex,index)=>({ex,index})).filter(({ex})=>!exerciseDone(ex,sess));
  if(!pending.length)return "";
  return `<section class="session-pending"><h3>Do sprawdzenia: ${pending.length}</h3><p class="subtitle">Nie wszystkie serie są zaliczone. Wróć do ćwiczenia lub zapisz wykonany trening.</p><div class="session-exercise-list">${pending.map(({ex,index})=>{const sets=existingSetsFor(ex,sess);return `<button class="session-exercise-choice" onclick="editSessionExercise(${index})"><span>${esc(ex.name)}<small>${sets.length?`Nieukończone · serie ${sets.filter(set=>set.done).length}/${sets.length}`:"Brak serii — uzupełnij lub pomiń"}</small></span><span aria-hidden="true">→</span></button>`}).join("")}</div></section>`;
}
function sessionActionsHTML(){
  if(!canEditSession())return "";
  return `<div class="session-actions"><button class="btn ghost" onclick="showSessionExercises()">Ćwiczenia tej sesji</button><button class="btn ghost" onclick="showAddSessionExercise()">+ Dodaj ćwiczenie</button>${SESSION_REVIEW_EDIT&&sessionDone()?'<button class="btn ghost" onclick="showSessionSummary()">Wróć do podsumowania</button>':''}</div>`;
}
function updateSessionNote(value){if(!canEditSession())return;state.sessionNotes[sessionKey()]=value;markSessionChanged()}
function openSessionModal(title,body){
  sessionModalFocus=document.activeElement;
  document.getElementById("modalRoot").innerHTML=`<div class="modal" onclick="hideModal()"><div class="panel" role="dialog" aria-modal="true" aria-labelledby="sessionDialogTitle" onclick="event.stopPropagation()"><div class="dialog-head"><h2 id="sessionDialogTitle">${esc(title)}</h2><button class="icon-btn" aria-label="Zamknij" onclick="hideModal()">×</button></div>${body}</div></div>`;
  refreshIcons();
  requestAnimationFrame(()=>document.querySelector('#modalRoot [autofocus], #modalRoot .panel button')?.focus());
}
function showSessionExercises(){
  if(!canEditSession())return;
  openSessionModal("Ćwiczenia tej sesji",`<div class="session-exercise-list">${sessionWorkout().exercises.map((ex,i)=>`<button class="session-exercise-choice" onclick="hideModal();editSessionExercise(${i})"><span>${i+1}. ${esc(ex.name)}<small>${ex.sessionOnly?"Dodane w tej sesji · ":""}${exerciseSkipped(ex)?"Pominięte":exerciseDone(ex)?"Wykonane":"Do wykonania"}</small></span><span aria-hidden="true">→</span></button>`).join("")}</div><button class="btn full" onclick="showAddSessionExercise()">+ Dodaj ćwiczenie</button>`);
}
function showAddSessionExercise(){
  if(!canEditSession())return;
  const names=[...new Set(PLAN.flatMap(w=>w.exercises.map(ex=>ex.name)))];
  openSessionModal("Dodaj ćwiczenie",`<p class="subtitle">Tylko w tej sesji. Plan trenera pozostaje bez zmian.</p><form class="session-exercise-form" onsubmit="submitSessionExercise(event)"><div class="field"><label for="sessionExerciseName">Nazwa ćwiczenia</label><input id="sessionExerciseName" name="exerciseName" list="sessionExerciseNames" placeholder="Wpisz nazwę lub wybierz podpowiedź" maxlength="160" required autofocus autocomplete="off"><datalist id="sessionExerciseNames">${names.map(name=>`<option value="${esc(name)}"></option>`).join("")}</datalist></div><div class="field"><label for="sessionExerciseMode">Co zapisujesz?</label><select id="sessionExerciseMode" name="exerciseMode"><option value="sets">Ciężar i powtórzenia</option><option value="time">Czas / dystans</option><option value="done">Samo wykonanie</option></select></div><button class="btn full" type="submit">Dodaj do tej sesji</button></form>`);
}
function submitSessionExercise(event){
  event.preventDefault();
  const form=event.currentTarget;
  addSessionExercise(form.elements.exerciseName.value,form.elements.exerciseMode.value);
}
function addSessionExercise(name,type="sets"){
  if(!canEditSession())return null;
  name=String(name||"").trim();
  if(!name||name.length>160||!["sets","time","done"].includes(type))return null;
  const exercises=ensureSessionSnapshot(),id=`extra_${uid()}`;
  const ex={id,no:id,name,type,sets:type==="sets"?"1":"",reps:"",rest:"",notes:"",sessionOnly:true,requiresPrescription:false,supersetKey:"",prescriptions:{}};
  exercises.push(ex);
  state.logs[exerciseKey(ex)]=defaultSets(ex);
  state.exerciseIndex=exercises.length-1;
  state.sessionSummaryOpen=false;
  SESSION_REVIEW_EDIT=true;
  markSessionChanged();hideModal();render();scrollToExerciseTop();
  return ex;
}
function removeSessionExercise(id){
  if(!canEditSession())return;
  const exercises=ensureSessionSnapshot(),index=exercises.findIndex(ex=>ex.id===id&&ex.sessionOnly);
  if(index<0)return;
  const ex=exercises[index],key=exerciseKey(ex);
  if(existingSetsFor(ex).some(s=>s.done||s.kg||s.reps||s.rpe||s.freeNote)&&!confirm(`Usunąć dodatkowe ćwiczenie „${ex.name}” wraz z wynikami z tej sesji?`))return;
  exercises.splice(index,1);delete state.logs[key];delete state.skips[key];delete state.notes[key];
  state.exerciseIndex=Math.max(0,Math.min(state.exerciseIndex,exercises.length-1));
  SESSION_REVIEW_EDIT=false;markSessionChanged();render();
}
function addSetAt(exerciseId,position="end"){
  if(!canEditSession())return;
  const ex=exerciseById(exerciseId);
  if(!ex||exerciseMode(ex)!=="sets")return;
  const sets=setsFor(ex),index=position==="start"?0:position==="end"?sets.length:Math.max(0,Math.min(Number(position)||0,sets.length));
  const set={id:uid(),note:"Dodatkowa seria",kg:"",reps:"",rpe:"",done:false,freeNote:"",sessionOnly:true};
  sets.splice(index,0,set);
  markSessionChanged();render();
  requestAnimationFrame(()=>setElement(ex.id,set.id)?.querySelector('input')?.focus());
  return set;
}
function moveSessionSet(exerciseId,setId,toIndex){
  if(!canEditSession())return false;
  const ex=exerciseById(exerciseId);if(!ex)return false;
  const sets=setsFor(ex),from=sets.findIndex(s=>s.id===setId);
  if(from<0||!Number.isInteger(toIndex)||toIndex<0||toIndex>=sets.length||from===toIndex)return false;
  sets.splice(toIndex,0,sets.splice(from,1)[0]);
  markSessionChanged();render();return true;
}
function removeSessionSet(exerciseId,setId){
  if(!canEditSession())return;
  const ex=exerciseById(exerciseId);if(!ex)return;
  const sets=setsFor(ex),index=sets.findIndex(s=>s.id===setId),set=sets[index];
  if(!set)return;
  if(sets.length<=1){showToast("Zostaw jedną serię lub pomiń ćwiczenie");return}
  if((set.done||set.kg||set.reps||set.rpe||set.freeNote)&&!confirm(`Usunąć serię ${index+1} razem z wpisanymi wynikami?`))return;
  sets.splice(index,1);markSessionChanged();hideModal();render();
}
function setHandleHTML(ex,set,index){
  return `<button class="set-drag-handle" type="button" aria-label="Seria ${index+1}: przesuń lub otwórz opcje" title="Przeciągnij serię lub kliknij po opcje" onpointerdown="beginSetDrag(event,'${ex.id}','${set.id}')" onpointermove="moveSetDrag(event)" onpointerup="endSetDrag(event)" onpointercancel="cancelSetDrag()" onlostpointercapture="cancelSetDrag()" onclick="setHandleClick('${ex.id}','${set.id}')" onkeydown="setHandleKey(event,'${ex.id}','${set.id}')"><span aria-hidden="true">⠿</span><span>${index+1}</span></button>`;
}
function setHandleClick(exerciseId,setId){if(consumedSetDrag){consumedSetDrag=false;return}showSetActions(exerciseId,setId)}
function setHandleKey(event,exerciseId,setId){
  if(!["ArrowUp","ArrowDown"].includes(event.key))return;
  event.preventDefault();
  const ex=exerciseById(exerciseId);if(!ex)return;
  const index=setsFor(ex).findIndex(s=>s.id===setId);
  if(moveSessionSet(exerciseId,setId,index+(event.key==="ArrowUp"?-1:1)))requestAnimationFrame(()=>setElement(exerciseId,setId)?.querySelector('.set-drag-handle')?.focus());
}
function showSetActions(exerciseId,setId){
  if(!canEditSession())return;
  const ex=exerciseById(exerciseId);if(!ex)return;
  const sets=setsFor(ex),index=sets.findIndex(s=>s.id===setId);if(index<0)return;
  openSessionModal(`Seria ${index+1} · ${ex.name}`,`<div class="set-action-menu"><button class="btn ghost" ${index===0?"disabled":""} onclick="hideModal();moveSessionSet('${ex.id}','${setId}',${index-1})">↑ Przesuń wyżej</button><button class="btn ghost" ${index===sets.length-1?"disabled":""} onclick="hideModal();moveSessionSet('${ex.id}','${setId}',${index+1})">↓ Przesuń niżej</button><button class="btn ghost" onclick="hideModal();addSetAt('${ex.id}',${index})">+ Dodaj serię przed tą</button><button class="btn ghost" onclick="hideModal();addSetAt('${ex.id}',${index+1})">+ Dodaj serię po tej</button><button class="btn ghost" ${sets.length<=1?"disabled":""} onclick="removeSessionSet('${ex.id}','${setId}')">Usuń tę serię</button></div>`);
}
function setElements(exerciseId){return [...document.querySelectorAll('[data-session-exercise]')].filter(el=>el.dataset.sessionExercise===exerciseId)}
function setElement(exerciseId,setId){return setElements(exerciseId).find(el=>el.dataset.sessionSet===setId)}
function beginSetDrag(event,exerciseId,setId){
  if(!canEditSession()||event.button!==0)return;
  consumedSetDrag=false;
  setDrag={exerciseId,setId,pointerId:event.pointerId,handle:event.currentTarget,startY:event.clientY,y:event.clientY,moved:false,target:setsFor(exerciseById(exerciseId)).findIndex(s=>s.id===setId)};
  event.currentTarget.setPointerCapture(event.pointerId);
}
function updateSetDragTarget(){
  if(!setDrag)return;
  const elements=setElements(setDrag.exerciseId);
  let nearest=null,distance=Infinity;
  elements.forEach((el,index)=>{el.classList.remove('set-drop-target');const r=el.getBoundingClientRect(),d=Math.abs(setDrag.y-(r.top+r.height/2));if(d<distance){distance=d;nearest={el,index}}});
  if(nearest){setDrag.target=nearest.index;nearest.el.classList.add('set-drop-target')}
}
function scrollSetDrag(){
  if(!setDrag?.moved)return;
  if(!setDrag.handle.isConnected||document.hidden||document.activeElement?.matches?.('input,textarea,select')){cancelSetDrag();return}
  const edge=100,y=setDrag.y,speed=y<edge?-10:y>window.innerHeight-edge?10:0;
  if(speed)window.scrollBy(0,speed);
  updateSetDragTarget();setDrag.frame=requestAnimationFrame(scrollSetDrag);
}
function moveSetDrag(event){
  if(!setDrag||event.pointerId!==setDrag.pointerId)return;
  setDrag.y=event.clientY;
  if(!setDrag.moved&&Math.abs(setDrag.y-setDrag.startY)>6){setDrag.moved=true;setElement(setDrag.exerciseId,setDrag.setId)?.classList.add('set-dragging');scrollSetDrag()}
  if(setDrag?.moved){event.preventDefault();updateSetDragTarget()}
}
function cancelSetDrag(){
  if(!setDrag)return;
  const drag=setDrag;setDrag=null;
  if(drag.moved)consumedSetDrag=true;
  if(drag.frame)cancelAnimationFrame(drag.frame);
  if(drag.handle.hasPointerCapture(drag.pointerId))drag.handle.releasePointerCapture(drag.pointerId);
  setElements(drag.exerciseId).forEach(el=>el.classList.remove('set-dragging','set-drop-target'));
}
function endSetDrag(event){
  if(!setDrag||event.pointerId!==setDrag.pointerId)return;
  const drag=setDrag;cancelSetDrag();
  if(drag.moved){consumedSetDrag=true;moveSessionSet(drag.exerciseId,drag.setId,drag.target)}
}
window.addEventListener('blur',cancelSetDrag);
window.addEventListener('pagehide',cancelSetDrag);
window.addEventListener('focusin',event=>{
  if(event.target.matches?.('input,textarea,select'))cancelSetDrag();
});

// Read the immutable exercise snapshot before resolving log identity. Extra exercises may
// have the same name as a planned exercise, so names alone must not merge their results.
function hydrateSessionSnapshots(sessions){
  state.sessionWorkouts=state.sessionWorkouts||{};
  for(const row of sessions){
    const key=planKey(row.session_id),payload=row.raw_payload;
    if(state.sessionEdits?.[key]||payload?.version!==2||!Array.isArray(payload.exerciseSnapshot))continue;
    const snapshot=payload.exerciseSnapshot;
    if(!snapshot.every(ex=>ex&&typeof ex.name==="string"&&/^[a-zA-Z0-9_-]+$/.test(ex.id)&&typeof ex.no==="string"))continue;
    if(new Set(snapshot.map(ex=>ex.no)).size!==snapshot.length)continue;
    if(new Set(snapshot.map(ex=>ex.id)).size!==snapshot.length)continue;
    state.sessionWorkouts[key]=JSON.parse(JSON.stringify(snapshot));
    if(payload.sessionRpe!=null)state.sessionRpe[key]=String(payload.sessionRpe);
  }
}
function clearServerSessionAnnotations(sessions){
  for(const row of sessions){
    const key=planKey(row.session_id);if(state.sessionEdits?.[key])continue;
    for(const field of ['skips','notes']){
      for(const item of Object.keys(state[field]||{}))if(item.startsWith(key+'__E'))delete state[field][item];
    }
    if(row.raw_payload?.version===2){
      for(const ex of state.sessionWorkouts[key]||[]){
        const note=row.raw_payload.exerciseNotes?.[ex.no];
        if(typeof note==='string')state.notes[`${key}__E${ex.no}`]=note;
      }
    }
    state.sessionNotes[key]=row.session_note||'';
  }
}
window.addEventListener('keydown',event=>{
  const dialog=document.querySelector('#modalRoot [role="dialog"]');if(!dialog)return;
  if(event.key==='Escape'){event.preventDefault();hideModal();return}
  if(event.key!=='Tab')return;
  const controls=[...dialog.querySelectorAll('button:not([disabled]), input, select, textarea')],first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
});
