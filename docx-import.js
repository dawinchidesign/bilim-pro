/* Білім PRO — Word (.docx) файлынан сабақ жүктеу.
   Сыртқы кітапханасыз: .docx — zip архиві, ішіндегі word/document.xml браузерде оқылады.
   Құжат құрылымы (үлгі файлда да сипатталған):
     Тақырып: …  Пән: …  Сынып: …  Бөлім: …  Ұзақтығы: …
     ТЕОРИЯ → абзацтар · ЕСТЕ САҚТА → ережелер · МЫСАЛ → мысал мәтіні
     СҰРАҚТАР → «1. Сұрақ?», «+ дұрыс жауап», «- қате нұсқа», «Түсіндірме: …» */
'use strict';
(function(){
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function inflateRaw(bytes){
 if(typeof DecompressionStream==='undefined')throw new Error('Бұл браузер Word файлын оқи алмайды. Chrome, Edge немесе Safari-дің жаңа нұсқасын қолданыңыз.');
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
 return new Uint8Array(await new Response(stream).arrayBuffer());
}
function readZip(buf){
 const u=new Uint8Array(buf),dv=new DataView(buf);let end=-1;
 for(let i=u.length-22;i>=Math.max(0,u.length-65558);i--)if(dv.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw new Error('Бұл файл .docx емес. Word-та «Басқаша сақтау → Word құжаты (.docx)» таңдаңыз.');
 const count=dv.getUint16(end+10,true),files={};let p=dv.getUint32(end+16,true);
 for(let k=0;k<count&&dv.getUint32(p,true)===0x02014b50;k++){
  const nameLen=dv.getUint16(p+28,true),extraLen=dv.getUint16(p+30,true),commentLen=dv.getUint16(p+32,true);
  files[new TextDecoder().decode(u.subarray(p+46,p+46+nameLen))]={method:dv.getUint16(p+10,true),size:dv.getUint32(p+20,true),offset:dv.getUint32(p+42,true)};
  p+=46+nameLen+extraLen+commentLen;
 }
 return {u,dv,files};
}
async function entry(zip,name){
 const f=zip.files[name];if(!f)return null;
 const p=f.offset,start=p+30+zip.dv.getUint16(p+26,true)+zip.dv.getUint16(p+28,true),data=zip.u.subarray(start,start+f.size);
 const out=f.method===0?data:f.method===8?await inflateRaw(data):null;
 if(!out)throw new Error('Word файлының бұл түрі қолдау көрмейді.');
 return new DOMParser().parseFromString(new TextDecoder().decode(out),'application/xml');
}
const kids=(el,name)=>el?[...el.childNodes].filter(n=>n.namespaceURI===W&&n.localName===name):[];
const attr=(el,name)=>el?el.getAttributeNS(W,name)||el.getAttribute('w:'+name):null;

// Құжаттағы абзацтарды мәтінімен, стилімен және тізім түрімен бірге оқиды.
async function paragraphs(zip){
 const doc=await entry(zip,'word/document.xml');if(!doc)throw new Error('Word құжатының мазмұны табылмады.');
 const styles={},bullets={};
 const st=await entry(zip,'word/styles.xml');
 if(st)for(const s of st.getElementsByTagNameNS(W,'style'))styles[attr(s,'styleId')]=(attr(kids(s,'name')[0],'val')||'').toLowerCase();
 const nb=await entry(zip,'word/numbering.xml');
 if(nb){const abs={};for(const a of nb.getElementsByTagNameNS(W,'abstractNum')){const lvl={};for(const l of kids(a,'lvl'))lvl[attr(l,'ilvl')]=attr(kids(l,'numFmt')[0],'val');abs[attr(a,'abstractNumId')]=lvl;}
  for(const n of nb.getElementsByTagNameNS(W,'num'))bullets[attr(n,'numId')]=abs[attr(kids(n,'abstractNumId')[0],'val')]||{};}
 const out=[];
 for(const p of doc.getElementsByTagNameNS(W,'p')){
  let text='';
  const walk=node=>{for(const n of node.childNodes){if(n.namespaceURI!==W){walk(n);continue;}if(n.localName==='t')text+=n.textContent;else if(n.localName==='tab')text+='\t';else if(n.localName==='br'||n.localName==='cr')text+='\n';else if(n.localName!=='pPr'&&n.localName!=='rPr'&&n.localName!=='instrText')walk(n);}};
  walk(p);
  const pPr=kids(p,'pPr')[0],styleId=attr(kids(pPr,'pStyle')[0],'val')||'',style=styles[styleId]||styleId.toLowerCase();
  const num=kids(pPr,'numPr')[0];let list=null;
  if(num){const id=attr(kids(num,'numId')[0],'val'),lvl=attr(kids(num,'ilvl')[0],'val')||'0';if(id&&id!=='0')list=(bullets[id]||{})[lvl]==='bullet'?'bullet':'number';}
  out.push({text:text.replace(/ /g,' ').trim(),heading:/^(heading|title|заголовок|название)/.test(style),list});
 }
 return {items:out,images:Object.keys(zip.files).some(n=>n.startsWith('word/media/'))};
}

const KEYS=[['instructions',/^(нұсқау|нұсқаулық|инструкция)$/],['paras',/^(теория|түсіндірме мәтіні)$/],['points',/^(есте сақта|ережелер)$/],['code',/^(мысал|шығарылған есеп|мысалмен түсін)$/],['questions',/^(сұрақтар|тест|тест сұрақтары)$/]];
const META=/^(тақырып|пән|сынып|бөлім|тег|ұзақтығы|ұзақтығы, минут|минут)\s*:\s*(.*)$/i;

function interpret({items,images},subjects){
 const lesson={title:'',subject:null,grade:null,tag:'',minutes:null,paras:[],points:[],code:'',questions:[]},warn=[];
 let section=null,q=null,codeLines=[];
 const finishQ=()=>{if(q){lesson.questions.push(q);q=null;}};
 for(const it of items){
  const t=it.text;if(!t)continue;
  const low=t.toLowerCase().replace(/\s+/g,' ');
  const key=t.length<40&&KEYS.find(([,re])=>re.test(low.replace(/[:.]\s*$/,'').trim()));
  if(key){finishQ();section=key[0];continue;}
  const meta=t.match(META);
  if(section==='instructions'&&!meta)continue;
  if(meta&&section!=='questions'&&section!=='code'){
   if(section==='instructions')section=null;
   const k=meta[1].toLowerCase(),v=meta[2].trim();
   if(k==='тақырып')lesson.title=v;
   else if(k==='пән'){const s=subjects.find(s=>[s.name,s.short,s.id].some(n=>n.toLowerCase()===v.toLowerCase())||v.toLowerCase().startsWith(s.short.toLowerCase().replace('.','')));if(s)lesson.subject=s.id;else warn.push(`«${v}» пәні табылмады — пәнді тізімнен таңдаңыз.`);}
   else if(k==='сынып'){const g=parseInt(v,10);if(g>=5&&g<=11)lesson.grade=g;}
   else if(k==='бөлім'||k==='тег')lesson.tag=v;
   else{const m=parseInt(v,10);if(m>=3&&m<=60)lesson.minutes=m;}
   continue;
  }
  if(!section){
   if(!lesson.title&&(it.heading||!lesson.paras.length)){lesson.title=t;continue;}
   section='paras';
  }
  if(section==='paras'){
   if(it.heading&&!lesson.title){lesson.title=t;continue;}
   if(it.list&&lesson.paras.length)lesson.paras[lesson.paras.length-1]+='\n• '+t;else lesson.paras.push(it.list?'• '+t:t);
  }else if(section==='points'){lesson.points.push(t.replace(/^[•\-–—*]\s*/,''));}
  else if(section==='code'){codeLines.push(t);}
  else if(section==='questions'){
   const correct=t.match(/^[+*✓✔]\s*(.+)$/),wrong=t.match(/^[-–—•]\s*(.+)$/),expl=t.match(/^(түсіндірме|explanation)\s*:\s*(.*)$/i),numbered=t.match(/^\d{1,2}\s*[.)]\s*(.+)$/);
   if(expl){if(q)q.explain=expl[2].trim();}
   else if(correct){if(q)q.answer=correct[1].trim();}
   else if(wrong||(it.list==='bullet'&&q)){if(q)q.wrong.push((wrong?wrong[1]:t).trim());}
   else if(numbered||it.list==='number'||!q||q.answer||q.wrong.length){finishQ();q={q:(numbered?numbered[1]:t).trim(),answer:'',wrong:[],explain:''};}
   else q.q+=' '+t;
  }
 }
 finishQ();
 lesson.code=codeLines.join('\n');
 if(lesson.paras.length>8){const rest=lesson.paras.splice(7);lesson.paras.push(rest.join('\n\n'));warn.push('Теория 8 абзацтан көп еді — соңғы абзацтар біріктірілді.');}
 if(lesson.points.length>6){lesson.points.length=6;warn.push('«Есте сақта» бөлімінен алғашқы 6 ереже алынды.');}
 if(lesson.questions.length>20){lesson.questions.length=20;warn.push('Алғашқы 20 сұрақ алынды.');}
 lesson.questions.forEach((x,i)=>{if(!x.answer)warn.push(`${i+1}-сұрақта дұрыс жауап («+» белгісімен) жоқ.`);if(x.wrong.length!==3)warn.push(`${i+1}-сұрақта ${x.wrong.length} қате нұсқа бар, 3 керек.`);x.wrong=x.wrong.slice(0,3);while(x.wrong.length<3)x.wrong.push('');});
 if(!lesson.title)warn.push('Тақырып табылмады — оны қолмен жазыңыз.');
 if(!lesson.paras.length)warn.push('Теория мәтіні табылмады. «ТЕОРИЯ» деген жолдан кейін жазыңыз.');
 if(lesson.questions.length<3)warn.push(`Сұрақтар саны ${lesson.questions.length}. Кемінде 3 сұрақ керек.`);
 if(images)warn.push('Құжаттағы суреттер жүктелмейді, тек мәтін алынады.');
 return {lesson,warnings:warn};
}

async function parse(file,subjects){
 if(!/\.docx$/i.test(file.name))throw new Error(/\.doc$/i.test(file.name)?'Ескі .doc форматы оқылмайды. Word-та «Басқаша сақтау → Word құжаты (.docx)» таңдаңыз.':'Тек .docx форматындағы Word файлын таңдаңыз.');
 if(file.size>15*1024*1024)throw new Error('Файл тым үлкен (15 МБ-тан аспауы керек).');
 const zip=readZip(await file.arrayBuffer());
 return interpret(await paragraphs(zip),subjects);
}
window.BilimDocx={parse,interpret};
})();
