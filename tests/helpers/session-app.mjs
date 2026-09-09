import fs from 'node:fs';
import vm from 'node:vm';

export const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
export const main=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
export const editor=fs.readFileSync(new URL('../../session-editor.js',import.meta.url),'utf8');
export const fixture=`
AUTH_USER={id:'00000000-0000-0000-0000-000000000001'};CAN_WRITE=true;APP_READY=true;STATE_KEY='synthetic-owner';
ATHLETE={id:'00000000-0000-0000-0000-000000000011'};DB_PLAN={id:'00000000-0000-0000-0000-000000000021'};
CLIENT_ID='alpha';CURRENT_PLAN={planId:'plan-alpha'};TOTAL_WEEKS=2;DAYS=[{workoutId:1,offset:0}];
PLAN=[{id:1,name:'Trening A',exercises:[
{id:'squat',no:'1',name:'Przysiad',type:'sets',sets:'2',prescriptions:{'1':[{label:'Top set',kg:80,reps:'5'},{label:'Back-off',kg:60,reps:'8'}]}},
{id:'row',no:'2',name:'Wiosłowanie',type:'sets',sets:'1',reps:'10'}
]}];state.mode='session';state.activeSessionId='W1T1';
`;
export function sessionApp(sb={},storage=new Map()){
  const elements=new Map(),errors=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,style:{},classList:{toggle(){},remove(){},add(){}},focus(){}});
    return elements.get(id);
  };
  const context=vm.createContext({console:{...console,error:e=>errors.push(e),warn:e=>errors.push(e)},Date,URLSearchParams,Math,setTimeout(){},requestAnimationFrame(){},cancelAnimationFrame(){},confirm:()=>true,prompt:()=> 'Synthetic skip',
    window:{supabase:{createClient:()=>sb},addEventListener(){},scrollTo(){},scrollBy(){},innerHeight:800},
    location:{search:'?client=alpha'},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    document:{activeElement:null,getElementById:element,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({remove(){}}),body:{appendChild(){}}}
  });
  vm.runInContext(main+'\n'+editor+'\n'+fixture,context);
  return {run:code=>vm.runInContext(code,context),context,elements,storage,errors};
}
