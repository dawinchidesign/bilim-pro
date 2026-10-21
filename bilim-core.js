/* Білім PRO — мұғалімдер мен сыныптардың ортақ логикасы.
   Бір код екі жерде жұмыс істейді: Netlify Function ішінде (бұлттық режим)
   және браузерде localStorage арқылы (жергілікті режим). Тек Web Crypto қолданылады. */
(function(root){
'use strict';
const SUBJECT_IDS=['informatics','math','physics','mathlit'];
const ITERATIONS=120000;
const TOKEN_DAYS=30;
const LIMITS={classes:30,students:80,lessons:100,questions:10};
const enc=new TextEncoder();
const subtle=()=>globalThis.crypto.subtle;

class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new ApiError(status,message);};

const b64u=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const fromB64u=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const hex=buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
function randomId(n=12,alphabet='abcdefghijkmnpqrstuvwxyz23456789'){const a=new Uint8Array(n);globalThis.crypto.getRandomValues(a);return [...a].map(b=>alphabet[b%alphabet.length]).join('');}
async function sha(s){return hex(await subtle().digest('SHA-256',enc.encode(String(s))));}
async function pbkdf2(password,salt){const key=await subtle().importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return hex(await subtle().deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:ITERATIONS},key,256));}
async function hmac(secret,data){const key=await subtle().importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await subtle().sign('HMAC',key,enc.encode(data))));}
function same(a,b){a=String(a);b=String(b);let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0;}

// Мәтінді тазалау: басқару таңбаларын алып тастап, ұзындығын шектейді.
function text(v,max,{min=0,multiline=false,label='Өріс'}={}){
 let s=typeof v==='string'?v:v==null?'':String(v);
 s=s.replace(multiline?/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g:/[\u0000-\u001F\u007F]/g,'').replace(/\r\n?/g,'\n').trim();
 if(!multiline)s=s.replace(/\s+/g,' ');
 if(s.length<min)fail(400,`${label}: кемінде ${min} таңба жазыңыз.`);
 if(s.length>max)fail(400,`${label}: ${max} таңбадан аспауы керек.`);
 return s;
}
const int=(v,lo,hi,def)=>Number.isInteger(v)&&v>=lo&&v<=hi?v:def;
const emailOk=e=>/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(e);
const subjectsOf=v=>[...new Set((Array.isArray(v)?v:[]).filter(x=>SUBJECT_IDS.includes(x)))];
const safeId=(v,label='ID')=>{if(typeof v!=='string'||!/^[a-z0-9-]{6,24}$/.test(v))fail(404,`${label} табылмады.`);return v;};

function publicTeacher(t,extra={}){return {id:t.id,name:t.name,school:t.school,subjects:t.subjects,bio:t.bio||'',created:t.created,...extra};}
function ownTeacher(t){return {...publicTeacher(t),email:t.email,public:t.public!==false};}

function cleanLesson(b){
 const subject=SUBJECT_IDS.includes(b.subject)?b.subject:fail(400,'Пәнді таңдаңыз.');
 const grade=int(Number(b.grade),5,11,null);if(grade===null)fail(400,'Сынып 5–11 аралығында болуы керек.');
 const title=text(b.title,90,{min:3,label:'Тақырып'});
 const tag=text(b.tag,30,{label:'Бөлім'})||'Мұғалім сабағы';
 const minutes=int(Number(b.minutes),3,60,10);
 const paras=(Array.isArray(b.paras)?b.paras:[]).map(p=>text(p,1500,{multiline:true,label:'Теория'})).filter(Boolean);
 if(!paras.length)fail(400,'Теория бөлімін толтырыңыз.');if(paras.length>8)fail(400,'Теория: ең көбі 8 абзац.');
 const points=(Array.isArray(b.points)?b.points:[]).map(p=>text(p,220,{label:'Есте сақта'})).filter(Boolean).slice(0,6);
 const code=text(b.code,2000,{multiline:true,label:'Мысал'});
 const qs=Array.isArray(b.questions)?b.questions:[];
 if(qs.length<3||qs.length>LIMITS.questions)fail(400,`Сұрақтар саны 3–${LIMITS.questions} болуы керек.`);
 const questions=qs.map((q,i)=>{const n=`${i+1}-сұрақ`;const out={q:text(q?.q,300,{min:3,label:n}),answer:text(q?.answer,200,{min:1,label:n+' (дұрыс жауап)'}),wrong:(Array.isArray(q?.wrong)?q.wrong:[]).map(w=>text(w,200,{min:1,label:n+' (қате нұсқа)'})),explain:text(q?.explain,400,{label:n+' (түсіндірме)'})};
  if(out.wrong.length!==3)fail(400,`${n}: үш қате нұсқа керек.`);
  const all=[out.answer,...out.wrong].map(x=>x.toLowerCase());if(new Set(all).size!==4)fail(400,`${n}: жауап нұсқалары қайталанбауы керек.`);
  return out;});
 const visibility=b.visibility==='classes'?'classes':'public';
 return {subject,grade,title,tag,minutes,paras,points,code,questions,visibility};
}

function cleanProgress(p){
 p=p&&typeof p==='object'?p:{};
 const ids=v=>[...new Set((Array.isArray(v)?v:[]).filter(x=>typeof x==='string'&&/^[a-z0-9-]{1,40}$/.test(x)))].slice(0,400);
 const quiz={};if(p.quiz&&typeof p.quiz==='object')for(const [k,v] of Object.entries(p.quiz).slice(0,400))if(/^[a-z0-9-]{1,40}$/.test(k)&&Number.isInteger(v)&&v>=0&&v<=LIMITS.questions)quiz[k]=v;
 const history=(Array.isArray(p.history)?p.history:[]).slice(0,10).filter(h=>h&&Number.isInteger(h.score)&&Number.isInteger(h.total)&&h.total>0&&h.total<=60&&h.score>=0&&h.score<=h.total&&Number.isFinite(h.date)).map(h=>({score:h.score,total:h.total,date:h.date,subject:SUBJECT_IDS.includes(h.subject)?h.subject:'informatics'}));
 return {xp:int(p.xp,0,1e7,0),completed:ids(p.completed),quiz,solved:int(p.solved,0,1000,0),labs:ids(p.labs).slice(0,20),history};
}

async function secretOf(store,opts){
 if(opts.secret)return opts.secret;
 let s=await store.get('meta/secret');
 if(!s||typeof s.key!=='string'){s={key:randomId(48)};await store.set('meta/secret',s);}
 return s.key;
}
async function sign(store,opts,payload){const secret=await secretOf(store,opts);const body=b64u(enc.encode(JSON.stringify({...payload,exp:Date.now()+TOKEN_DAYS*864e5})));return body+'.'+await hmac(secret,body);}
async function verify(store,opts,token){
 if(typeof token!=='string'||token.length>2000||!token.includes('.'))return null;
 const [body,sig]=token.split('.');const secret=await secretOf(store,opts);
 if(!same(await hmac(secret,body),sig))return null;
 try{const p=JSON.parse(new TextDecoder().decode(fromB64u(body)));return p.exp>Date.now()?p:null;}catch{return null;}
}

// Қате әрекеттерді шектеу: 6 сәтсіз әрекеттен кейін 10 минут күту.
async function guard(store,key){const r=await store.get('rl/'+key);if(r&&r.until>Date.now())fail(429,'Тым көп сәтсіз әрекет. 10 минуттан соң қайталаңыз.');}
async function strike(store,key){const r=(await store.get('rl/'+key))||{n:0};const n=(r.until&&r.until<=Date.now()?0:r.n)+1;await store.set('rl/'+key,n>=6?{n:0,until:Date.now()+10*60e3}:{n,until:0});}

async function listValues(store,prefix){const keys=await store.list(prefix);const values=await Promise.all(keys.map(k=>store.get(k)));return values.filter(Boolean);}

async function teacherFrom(store,auth){if(!auth||auth.r!=='t')fail(401,'Мұғалім ретінде кіріңіз.');const t=await store.get('teacher/'+auth.id);if(!t)fail(401,'Аккаунт табылмады. Қайта кіріңіз.');return t;}
async function ownedClass(store,teacher,id){const c=await store.get('class/'+safeId(id,'Сынып'));if(!c||c.teacherId!==teacher.id)fail(404,'Сынып табылмады.');return c;}
async function deleteClass(store,c){
 const students=await store.list(`student/${c.id}/`),names=await store.list(`sname/${c.id}/`);
 await Promise.all([...students,...names].map(k=>store.del(k)));
 await store.del('code/'+c.code);await store.del('class/'+c.id);
}
async function newCode(store){for(let i=0;i<20;i++){const code=randomId(6,'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');if(!await store.get('code/'+code))return code;}fail(500,'Сынып кодын жасау мүмкін болмады.');}
function studentRow(s){return {id:s.id,name:s.name,joined:s.joined,updated:s.updated||s.joined,progress:s.progress||cleanProgress({})};}

async function route(req,store,opts){
 const method=req.method,parts=req.path.replace(/^\/+|\/+$/g,'').split('/').filter(Boolean),body=req.body&&typeof req.body==='object'?req.body:{};
 const auth=await verify(store,opts,req.token);
 const is=(m,...p)=>method===m&&parts.length===p.length&&p.every((x,i)=>x==='*'||x===parts[i]);

 if(is('GET','health'))return {ok:true,mode:opts.mode||'cloud'};

 if(is('POST','auth','register')){
  if(req.ip&&req.ip!=='local'){const k='reg-'+await sha(req.ip);const r=(await store.get('rl/'+k))||{n:0,since:Date.now()};if(Date.now()-r.since>36e5){r.n=0;r.since=Date.now();}if(r.n>=8)fail(429,'Бір желіден тым көп тіркелу. Біраздан соң қайталаңыз.');r.n++;await store.set('rl/'+k,r);}
  const name=text(body.name,80,{min:3,label:'Аты-жөні'}),email=text(body.email,254,{min:5,label:'Email'}).toLowerCase(),school=text(body.school,120,{min:2,label:'Мектеп'}),bio=text(body.bio,300,{label:'Өзі туралы'});
  if(!emailOk(email))fail(400,'Email мекенжайын тексеріңіз.');
  const password=typeof body.password==='string'?body.password:'';if(password.length<8)fail(400,'Құпиясөз кемінде 8 таңбадан тұруы керек.');if(password.length>200)fail(400,'Құпиясөз тым ұзын.');
  const subjects=subjectsOf(body.subjects);if(!subjects.length)fail(400,'Кемінде бір пәнді таңдаңыз.');
  const ekey='email/'+await sha(email);if(await store.get(ekey))fail(409,'Бұл email бойынша аккаунт бар. Кіру бетін қолданыңыз.');
  const id=randomId(12),salt=randomId(16);
  const t={id,name,email,school,subjects,bio,public:body.public!==false,salt,hash:await pbkdf2(password,salt),created:Date.now()};
  await store.set('teacher/'+id,t);await store.set(ekey,{id});
  return {token:await sign(store,opts,{r:'t',id}),teacher:ownTeacher(t)};
 }
 if(is('POST','auth','login')){
  const email=text(body.email,254,{label:'Email'}).toLowerCase(),password=typeof body.password==='string'?body.password.slice(0,200):'';
  const rk='login-'+await sha(email);await guard(store,rk);
  const link=await store.get('email/'+await sha(email)),t=link&&await store.get('teacher/'+link.id);
  if(!t||!same(await pbkdf2(password,t.salt),t.hash)){await strike(store,rk);fail(401,'Email немесе құпиясөз қате.');}
  await store.del('rl/'+rk);
  return {token:await sign(store,opts,{r:'t',id:t.id}),teacher:ownTeacher(t)};
 }
 if(is('GET','me')){const t=await teacherFrom(store,auth);return {teacher:ownTeacher(t)};}
 if(is('PUT','me')){
  const t=await teacherFrom(store,auth);
  t.name=text(body.name,80,{min:3,label:'Аты-жөні'});t.school=text(body.school,120,{min:2,label:'Мектеп'});t.bio=text(body.bio,300,{label:'Өзі туралы'});
  const subjects=subjectsOf(body.subjects);if(!subjects.length)fail(400,'Кемінде бір пәнді таңдаңыз.');t.subjects=subjects;t.public=body.public!==false;
  await store.set('teacher/'+t.id,t);return {teacher:ownTeacher(t)};
 }
 if(is('POST','me','password')){
  const t=await teacherFrom(store,auth);
  if(!same(await pbkdf2(String(body.current||'').slice(0,200),t.salt),t.hash))fail(403,'Қазіргі құпиясөз қате.');
  const next=typeof body.next==='string'?body.next:'';if(next.length<8||next.length>200)fail(400,'Жаңа құпиясөз 8–200 таңба болуы керек.');
  t.salt=randomId(16);t.hash=await pbkdf2(next,t.salt);await store.set('teacher/'+t.id,t);return {ok:true};
 }
 if(is('DELETE','me')){
  const t=await teacherFrom(store,auth);
  if(!same(await pbkdf2(String(body.password||'').slice(0,200),t.salt),t.hash))fail(403,'Құпиясөз қате.');
  for(const c of (await listValues(store,'class/')).filter(c=>c.teacherId===t.id))await deleteClass(store,c);
  for(const l of (await listValues(store,'lesson/')).filter(l=>l.teacherId===t.id))await store.del('lesson/'+l.id);
  await store.del('email/'+await sha(t.email));await store.del('teacher/'+t.id);return {ok:true};
 }
 if(is('GET','teachers')){
  const [teachers,lessons]=await Promise.all([listValues(store,'teacher/'),listValues(store,'lesson/')]);
  return {teachers:teachers.filter(t=>t.public!==false).sort((a,b)=>a.created-b.created).map(t=>publicTeacher(t,{lessons:lessons.filter(l=>l.teacherId===t.id&&l.visibility==='public').length}))};
 }

 if(is('GET','classes')){
  const t=await teacherFrom(store,auth),classes=(await listValues(store,'class/')).filter(c=>c.teacherId===t.id).sort((a,b)=>a.created-b.created);
  return {classes:await Promise.all(classes.map(async c=>({...c,students:(await store.list(`student/${c.id}/`)).length})))};
 }
 if(is('POST','classes')){
  const t=await teacherFrom(store,auth);
  const mine=(await listValues(store,'class/')).filter(c=>c.teacherId===t.id);if(mine.length>=LIMITS.classes)fail(400,`Ең көбі ${LIMITS.classes} сынып.`);
  const name=text(body.name,60,{min:1,label:'Сынып атауы'}),grade=int(Number(body.grade),5,11,null),subject=SUBJECT_IDS.includes(body.subject)?body.subject:null;
  if(grade===null)fail(400,'Сынып 5–11 аралығында болуы керек.');if(!subject)fail(400,'Пәнді таңдаңыз.');
  const c={id:randomId(12),teacherId:t.id,name,grade,subject,code:await newCode(store),created:Date.now()};
  await store.set('class/'+c.id,c);await store.set('code/'+c.code,{classId:c.id});return {class:{...c,students:0}};
 }
 if(is('GET','classes','*')){
  const t=await teacherFrom(store,auth),c=await ownedClass(store,t,parts[1]);
  const students=(await listValues(store,`student/${c.id}/`)).sort((a,b)=>a.name.localeCompare(b.name,'kk'));
  return {class:{...c,students:students.length},students:students.map(studentRow)};
 }
 if(is('DELETE','classes','*')){const t=await teacherFrom(store,auth),c=await ownedClass(store,t,parts[1]);await deleteClass(store,c);return {ok:true};}
 if(is('DELETE','classes','*','students','*')){
  const t=await teacherFrom(store,auth),c=await ownedClass(store,t,parts[1]),sid=safeId(parts[3],'Оқушы');
  const s=await store.get(`student/${c.id}/${sid}`);if(!s)fail(404,'Оқушы табылмады.');
  await store.del(`student/${c.id}/${sid}`);await store.del(`sname/${c.id}/${s.nameKey}`);return {ok:true};
 }

 if(is('POST','join')){
  const code=text(body.code,12,{label:'Сынып коды'}).toUpperCase().replace(/[^A-Z0-9]/g,'');
  const name=text(body.name,40,{min:2,label:'Аты-жөнің'}),pin=String(body.pin||'');
  if(!/^\d{4}$/.test(pin))fail(400,'PIN-код 4 цифрдан тұруы керек.');
  const rk='join-'+await sha(code+'|'+name.toLowerCase());await guard(store,rk);
  const link=code.length===6&&await store.get('code/'+code),c=link&&await store.get('class/'+link.classId);
  if(!c){await strike(store,rk);fail(404,'Мұндай сынып коды табылмады. Мұғалімнен кодты қайта сұра.');}
  const nameKey=await sha(name.toLowerCase()),existing=await store.get(`sname/${c.id}/${nameKey}`);
  let s;
  if(existing){
   s=await store.get(`student/${c.id}/${existing.id}`);
   if(!s||!same(await pbkdf2(pin,s.salt),s.pin)){await strike(store,rk);fail(403,'Бұл есіммен оқушы тіркелген, PIN сәйкес келмеді.');}
  }else{
   if((await store.list(`student/${c.id}/`)).length>=LIMITS.students)fail(400,'Сыныпта орын қалмады. Мұғаліміңе хабарла.');
   const salt=randomId(16);s={id:randomId(12),name,nameKey,salt,pin:await pbkdf2(pin,salt),joined:Date.now(),progress:cleanProgress(body.progress)};
   await store.set(`student/${c.id}/${s.id}`,s);await store.set(`sname/${c.id}/${nameKey}`,{id:s.id});
  }
  await store.del('rl/'+rk);
  const t=await store.get('teacher/'+c.teacherId);
  return {token:await sign(store,opts,{r:'s',id:s.id,c:c.id}),student:{id:s.id,name:s.name},class:{name:c.name,grade:c.grade,subject:c.subject,code:c.code,teacher:t?.name||''}};
 }
 if(is('GET','student')){
  if(!auth||auth.r!=='s')fail(401,'Сыныпқа қайта қосыл.');
  const c=await store.get('class/'+auth.c),s=c&&await store.get(`student/${c.id}/${auth.id}`);if(!s)fail(401,'Сынып немесе оқушы өшірілген.');
  const t=await store.get('teacher/'+c.teacherId);
  return {student:{id:s.id,name:s.name},class:{name:c.name,grade:c.grade,subject:c.subject,code:c.code,teacher:t?.name||''}};
 }
 if(is('POST','progress')){
  if(!auth||auth.r!=='s')fail(401,'Сыныпқа қайта қосыл.');
  const key=`student/${auth.c}/${auth.id}`,s=await store.get(key);if(!s)fail(401,'Сынып немесе оқушы өшірілген.');
  s.progress=cleanProgress(body.progress);s.updated=Date.now();await store.set(key,s);return {ok:true,updated:s.updated};
 }

 if(is('GET','lessons')){
  const [lessons,teachers]=await Promise.all([listValues(store,'lesson/'),listValues(store,'teacher/')]);
  let ownTeacherId=null,classTeacherId=null;
  if(auth?.r==='t')ownTeacherId=auth.id;
  if(auth?.r==='s'){const c=await store.get('class/'+auth.c);classTeacherId=c?.teacherId||null;}
  const names=new Map(teachers.map(t=>[t.id,t]));
  return {lessons:lessons.filter(l=>names.has(l.teacherId)&&(l.visibility==='public'||l.teacherId===ownTeacherId||l.teacherId===classTeacherId)).sort((a,b)=>a.created-b.created).map(l=>({...l,teacherName:names.get(l.teacherId).name,teacherSchool:names.get(l.teacherId).school,mine:l.teacherId===ownTeacherId}))};
 }
 if(is('POST','lessons')){
  const t=await teacherFrom(store,auth);
  if((await listValues(store,'lesson/')).filter(l=>l.teacherId===t.id).length>=LIMITS.lessons)fail(400,`Ең көбі ${LIMITS.lessons} сабақ.`);
  const l={id:'t-'+randomId(10),teacherId:t.id,...cleanLesson(body),created:Date.now(),updated:Date.now()};
  await store.set('lesson/'+l.id,l);return {lesson:{...l,teacherName:t.name,teacherSchool:t.school,mine:true}};
 }
 if(is('PUT','lessons','*')||is('DELETE','lessons','*')){
  const t=await teacherFrom(store,auth),id=safeId(parts[1],'Сабақ'),old=await store.get('lesson/'+id);
  if(!old||old.teacherId!==t.id)fail(404,'Сабақ табылмады.');
  if(method==='DELETE'){await store.del('lesson/'+id);return {ok:true};}
  const l={...old,...cleanLesson(body),updated:Date.now()};await store.set('lesson/'+id,l);return {lesson:{...l,teacherName:t.name,teacherSchool:t.school,mine:true}};
 }
 fail(404,'API әдісі табылмады.');
}

async function handle(req,store,opts={}){
 try{return {status:200,body:await route(req,store,opts)};}
 catch(e){if(e instanceof ApiError)return {status:e.status,body:{error:e.message}};if(opts.log)opts.log(e);return {status:500,body:{error:'Сервер қатесі. Біраздан соң қайталаңыз.'}};}
}

const api={handle,SUBJECT_IDS,LIMITS,cleanLesson,cleanProgress};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BilimCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
