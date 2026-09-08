// Authentication UI. Database policies remain the authority for every request.
let PROFILE_ACCESS=[];

function authShell(title, content){
  APP_READY=false;
  document.getElementById('app').hidden=true;
  document.getElementById('authRoot').hidden=false;
  document.getElementById('modalRoot').innerHTML='';
  document.getElementById('authRoot').innerHTML=`<div class="selector"><div class="eyebrow">MonkeyPanel</div><h1>${esc(title)}</h1>${content}</div>`;
}

function showLogin(message=''){
  authShell('Twój zeszyt treningowy', `<p>Zaloguj się, aby otworzyć swój plan i historię treningów.</p>
    <form id="loginForm" onsubmit="submitLogin(event)">
      <div class="field"><label for="loginEmail">E-mail</label><input id="loginEmail" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="loginPassword">Hasło</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" required></div>
      <p id="authMessage" class="auth-message" role="status">${esc(message)}</p>
      <button class="btn full" type="submit">Zaloguj się</button>
    </form><p style="font-size:12px;margin:18px 0 0">Nie masz dostępu lub nie pamiętasz hasła? Skontaktuj się z administratorem MonkeyPanel.</p>`);
}

async function submitLogin(event){
  event.preventDefault();
  const form=event.currentTarget, button=form.querySelector('button');
  button.disabled=true;
  document.getElementById('authMessage').textContent='Logowanie…';
  try{
    const {error}=await sb.auth.signInWithPassword({email:form.elements.email.value.trim(),password:form.elements.password.value});
    form.elements.password.value='';
    if(error){document.getElementById('authMessage').textContent='Nie udało się zalogować. Sprawdź e-mail i hasło.';return}
    await bootAuth();
  }catch{
    form.elements.password.value='';
    document.getElementById('authMessage').textContent='Nie udało się połączyć. Spróbuj ponownie.';
  }finally{button.disabled=false}
}

function renderClientSelector(message=''){
  authShell('Wybierz profil', `<p>${esc(message||'Masz dostęp do poniższych profili.')}</p>
    ${PROFILE_ACCESS.map((a,i)=>`<button class="clientBtn" onclick="chooseClient(${i})">${esc(a.athletes.name)}<small>${a.can_write?'Twój plan i wyniki':'Tylko podgląd'}</small></button>`).join('')}
    <button class="auth-link" onclick="signOutAccount()">Wyloguj się</button>`);
}

function chooseClient(index){
  const access=PROFILE_ACCESS[index];
  if(!access)return;
  location.assign(`${location.pathname}?client=${encodeURIComponent(access.athletes.client_key)}`);
}

function prepareUserState(userId,clientKey,canWrite){
  STATE_KEY=`monkeypanel.auth.v1.${userId}.${clientKey}`;
  // Preserve old drafts only after validating the signed-in owner's access.
  const saved=load(STATE_KEY,null) || (canWrite?load(`monkeypanel.alpha.v04.${clientKey}`,null):null);
  const result={...emptyState(),...(saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{})};
  for(const field of ['logs','skips','serverStatus','measurements','notes','sessionNotes','sessionRpe','videoOpen','modeOverrides','planArchive']){
    if(!result[field]||typeof result[field]!=='object'||Array.isArray(result[field]))result[field]={};
  }
  if(!canWrite)result.mode='calendar';
  if(!['today','plan','history','measure'].includes(result.view))result.view='today';
  return result;
}

function clearAuthenticatedState(){
  APP_READY=false; AUTH_USER=null; CAN_WRITE=false; STATE_KEY=null;
  PROFILE_ACCESS=[]; ATHLETE=null; DB_PLAN=null; PLAN_LINKS=[];
  DB_TRAININGS=[]; DB_TRAINING_EXERCISES=[]; DB_PROGRESSION_BLOCKS=[];
  DB_PROGRESSION_EXERCISES=[]; DB_PROGRESSION_SETS=[]; DB_WEEK_NOTES=[];
  DB_WORKOUT_SESSIONS=[]; VIDEOS={}; state=emptyState();
  document.getElementById('view').innerHTML='';
  document.getElementById('accountBar').innerHTML='';
}

async function bootAuth(){
  authShell('Sprawdzanie dostępu…','<p>Łączymy się z Twoim kontem.</p>');
  try{
    const {data:{session},error:sessionError}=await sb.auth.getSession();
    if(sessionError||!session){clearAuthenticatedState();showLogin();return}
    const {data:{user},error:userError}=await sb.auth.getUser();
    if(userError||!user){clearAuthenticatedState();showLogin('Zaloguj się ponownie.');return}
    AUTH_USER=user;
    const {data,error}=await sb.from('athlete_access').select('athlete_id,can_write,athletes(id,client_key,name,status)');
    if(error)throw error;
    PROFILE_ACCESS=(data||[]).filter(a=>a.athletes&&a.athletes.status!=='archived');
    if(!PROFILE_ACCESS.length){
      authShell('Konto oczekuje na dostęp','<p>Jesteś zalogowany, ale nie przypisano Ci jeszcze profilu. Skontaktuj się z administratorem.</p><button class="auth-link" onclick="signOutAccount()">Wyloguj się</button>');
      return;
    }
    let access=PROFILE_ACCESS.find(a=>a.athletes.client_key===CLIENT_ID);
    if(!access){
      if(CLIENT_ID){renderClientSelector('Nie masz dostępu do profilu z tego linku. Wybierz jeden ze swoich profili.');return}
      if(PROFILE_ACCESS.length!==1){renderClientSelector();return}
      access=PROFILE_ACCESS[0];
      CLIENT_ID=access.athletes.client_key;
      history.replaceState(null,'',`${location.pathname}?client=${encodeURIComponent(CLIENT_ID)}`);
    }
    CAN_WRITE=access.can_write===true;
    state=prepareUserState(user.id,CLIENT_ID,CAN_WRITE);
    await apiGetPlan();
    if(!DB_PLAN)throw new Error('No assigned plan');
    migrateLegacyLocalKeys();
    await apiGetWorkoutLog();
    await apiGetMeasurements();
    if(!AUTH_USER||AUTH_USER.id!==user.id)return;
    APP_READY=true;
    document.getElementById('authRoot').hidden=true;
    document.getElementById('app').hidden=false;
    document.getElementById('accountBar').innerHTML=`<span>${esc(user.email||'Moje konto')}${CAN_WRITE?'':' · podgląd'}</span>
      ${PROFILE_ACCESS.length>1?'<button onclick="renderClientSelector()">Zmień profil</button>':''}
      <button onclick="showPasswordForm()">Zmień hasło</button><button onclick="signOutAccount()">Wyloguj</button>`;
    render();
  }catch{
    authShell('Nie udało się otworzyć profilu','<p>Sprawdź połączenie lub przypisanie planu do konta.</p><button class="btn full" onclick="location.reload()">Spróbuj ponownie</button><button class="auth-link" onclick="signOutAccount()">Wyloguj się</button>');
  }
}

async function signOutAccount(){
  save();
  const {error}=await sb.auth.signOut({scope:'local'});
  if(error){showToast('Nie udało się wylogować. Spróbuj ponownie.');return}
  clearAuthenticatedState();
  showLogin();
}

function showPasswordForm(){
  if(!AUTH_USER)return;
  save();
  authShell('Zmień hasło', `<p>Ustaw własne hasło do MonkeyPanel.</p>
    <form onsubmit="submitPasswordChange(event)">
      <div class="field"><label for="currentPassword">Obecne hasło</label><input id="currentPassword" name="current" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="newPassword">Nowe hasło — co najmniej 12 znaków</label><input id="newPassword" name="next" type="password" minlength="12" autocomplete="new-password" required></div>
      <div class="field"><label for="confirmPassword">Powtórz nowe hasło</label><input id="confirmPassword" name="confirm" type="password" minlength="12" autocomplete="new-password" required></div>
      <p id="authMessage" class="auth-message" role="status"></p><button class="btn full" type="submit">Zapisz nowe hasło</button>
    </form><button class="auth-link" onclick="resumeApp()">Wróć do treningów</button>`);
}

async function submitPasswordChange(event){
  event.preventDefault();
  const form=event.currentTarget, message=document.getElementById('authMessage'), button=form.querySelector('button');
  if(form.elements.next.value!==form.elements.confirm.value){message.textContent='Nowe hasła muszą być takie same.';return}
  button.disabled=true;
  try{
    const {error}=await sb.auth.updateUser({current_password:form.elements.current.value,password:form.elements.next.value});
    form.reset();
    message.textContent=error?'Nie udało się zmienić hasła. Sprawdź obecne hasło i spróbuj ponownie.':'Hasło zostało zmienione.';
  }catch{form.reset();message.textContent='Brak połączenia. Spróbuj ponownie.'}
  finally{button.disabled=false}
}

function resumeApp(){
  if(!AUTH_USER)return;
  APP_READY=true;
  document.getElementById('authRoot').hidden=true;
  document.getElementById('app').hidden=false;
  render();
}

function renderPlanPreview(sess,w){
  const exercises=w.exercises.map(ex=>{
    const prescriptions=prescriptionForCurrentWeek(ex,sess);
    return `<article class="preview-exercise"><h3>${esc(ex.no)}. ${esc(ex.name)}</h3>
      ${prescriptions.length?prescriptions.map(p=>setPrescriptionHTML({planned:p})).join(''):`<p>${esc(ex.sets||'')} · ${esc(ex.reps||'')} ${esc(ex.load||'')}</p>`}
      ${ex.notes?`<p>${esc(ex.notes)}</p>`:''}</article>`;
  }).join('');
  document.getElementById('view').innerHTML=`<div class="session-shell"><header class="session-head"><button class="auth-link" onclick="exitSession()">← Wróć do planu</button><h2>${esc(trainingDisplayName(w))}</h2><p>Tydzień ${sess.week} · podgląd</p></header><main class="session-body">${exercises}
    ${DB_WORKOUT_SESSIONS.some(s=>s.session_id===sess.id)?`<button class="btn full" onclick='openHistorySession(${eventJSON(sess)})'>Zobacz zapisane wyniki</button>`:''}</main></div>`;
}

// Avoid async Supabase calls inside its auth callback (the client holds a lock).
sb.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT'){clearAuthenticatedState();showLogin()}
  if(event==='SIGNED_IN'&&AUTH_USER&&session?.user?.id!==AUTH_USER.id){
    clearAuthenticatedState();showLogin();setTimeout(()=>location.reload(),0);
  }
});
bootAuth();
