/* Білім PRO — API клиенті.
   Сайт Netlify Functions арқылы жарияланса, деректер ортақ серверде (бұлттық режим) сақталады.
   Сервер болмаса (Netlify Drop, файлды тікелей ашу), сол логика браузердің өз қоймасында орындалады. */
'use strict';
(function(){
const AUTH_KEY='bilim-pro-auth-v1',PREFIX='bilim-db:';
const localStore={
 get:async k=>{try{const v=localStorage.getItem(PREFIX+k);return v?JSON.parse(v):null;}catch{return null;}},
 set:async(k,v)=>{try{localStorage.setItem(PREFIX+k,JSON.stringify(v));}catch{throw Object.assign(new Error('Браузер деректі сақтауға рұқсат бермеді.'),{status:507});}},
 del:async k=>{try{localStorage.removeItem(PREFIX+k);}catch{}},
 list:async p=>{const out=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(PREFIX+p))out.push(k.slice(PREFIX.length));}}catch{}return out;}
};
let mode=null,detecting=null,syncTimer=null,lastSync=null;
const listeners=new Set();
function emit(){listeners.forEach(fn=>{try{fn();}catch{}});}

function detect(){
 if(detecting)return detecting;
 detecting=(async()=>{
  if(location.protocol==='file:'){mode='local';return mode;}
  try{
   const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),5000);
   const r=await fetch('/api/bilim?p=%2Fhealth',{signal:ctrl.signal,cache:'no-store'});clearTimeout(t);
   const data=r.ok&&(r.headers.get('content-type')||'').includes('json')?await r.json():null;
   mode=data&&data.ok&&data.mode==='cloud'?'cloud':'local';
  }catch{mode='local';}
  const a=auth();if(a&&a.mode!==mode)setAuth(null);
  emit();return mode;
 })();
 return detecting;
}
function auth(){try{const a=JSON.parse(localStorage.getItem(AUTH_KEY));return a&&typeof a.token==='string'&&(a.role==='teacher'||a.role==='student')?a:null;}catch{return null;}}
function setAuth(a){try{if(a)localStorage.setItem(AUTH_KEY,JSON.stringify({...a,mode}));else localStorage.removeItem(AUTH_KEY);}catch{}emit();}

async function request(method,path,body){
 await detect();
 const a=auth(),token=a?.token||null;
 let status,data;
 if(mode==='cloud'){
  let r;
  try{r=await fetch('/api/bilim?p='+encodeURIComponent(path),{method,cache:'no-store',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:method==='GET'?undefined:JSON.stringify(body||{})});}
  catch{throw Object.assign(new Error('Интернет байланысын тексеріңіз.'),{status:0});}
  status=r.status;try{data=await r.json();}catch{data={error:'Серверден түсінікті жауап келмеді.'};}
 }else{
  if(!window.BilimCore||!globalThis.crypto?.subtle)throw Object.assign(new Error('Бұл браузер жергілікті кабинетті қолдамайды. Сайтты https арқылы ашыңыз.'),{status:0});
  const res=await window.BilimCore.handle({method,path,body:body||{},token,ip:'local'},localStore,{mode:'local'});
  status=res.status;data=res.body;
 }
 if(status===401&&token&&path!=='/auth/login')setAuth(null);
 if(status!==200)throw Object.assign(new Error(data?.error||'Қате орын алды.'),{status});
 return data;
}

// Оқушы прогресін мұғалімге жіберу: жиі сақтауларды біріктіріп, 2 секундтан соң жібереді.
function syncProgress(progress){
 const a=auth();if(!a||a.role!=='student')return;
 clearTimeout(syncTimer);
 syncTimer=setTimeout(async()=>{try{await request('POST','/progress',{progress});lastSync=Date.now();emit();}catch{}},2000);
}

window.BilimAPI={detect,request,auth,setAuth,syncProgress,onChange:fn=>listeners.add(fn),get mode(){return mode;},get lastSync(){return lastSync;}};
})();
