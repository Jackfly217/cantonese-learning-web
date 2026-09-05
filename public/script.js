
let lessons=[],currentUser=null,editingLessonId=null,phrases=[],vocabulary=[],editingVocabId=null;
const $=id=>document.getElementById(id);
async function api(url,opt={}){const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Server error");return d;}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

function showSection(id){
 if((id==="creator"||id==="users")&&currentUser?.role!=="admin")id="lessons";
 document.querySelectorAll(".page-section").forEach(s=>{
   if(s.id==="dashboard-extra")s.classList.toggle("active",id==="dashboard");
   else if(["dashboard","creator","lessons","users","vocabulary","about"].includes(s.id))s.classList.toggle("active",s.id===id);
 });
 document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.section===id));
 if(id==="dashboard")updateStats(); if(id==="users")loadUsers(); if(id==="vocabulary")loadVocabulary(); if(id==="about")loadAbout();
}
window.showSection=showSection;
document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>showSection(b.dataset.section));

function updateStats(){for(const [id,val] of [["statLessons",lessons.length],["statVideo",lessons.filter(x=>x.video).length],["statAudio",lessons.filter(x=>x.audio).length],["statPdf",lessons.filter(x=>x.pdf).length]])if($(id))$(id).textContent=val;}

function applyRole(){
 const admin=currentUser?.role==="admin";
 document.querySelectorAll(".admin-only").forEach(x=>x.style.display=admin?"block":"none");
 const builder=document.querySelector('[data-section="creator"]');if(builder)builder.style.display=admin?"block":"none";
 if($("userBadge")){$("userBadge").textContent=currentUser?`${admin?"Admin":"Student"} • ${currentUser.username}`:"";$("userBadge").classList.toggle("hidden",!currentUser);}
 if($("loginBtn"))$("loginBtn").classList.toggle("hidden",!!currentUser);
 if($("logoutBtn"))$("logoutBtn").classList.toggle("hidden",!currentUser);
}

async function loadAbout(){
 try{const d=await api("/api/about"); renderAbout(d);}catch(e){if($("aboutMessage"))$("aboutMessage").textContent=e.message;}
}
function renderAbout(d){
 if($("aboutTitle"))$("aboutTitle").textContent=d.title||"About this app";
 if($("aboutContent"))$("aboutContent").innerHTML=esc(d.content||"").replace(/\n/g,"<br>");
 if(currentUser?.role==="admin"){if($("aboutTitleInput"))$("aboutTitleInput").value=d.title||"";if($("aboutContentInput"))$("aboutContentInput").value=d.content||"";}
}
$("saveAboutBtn").onclick=async()=>{
 try{const title=$("aboutTitleInput").value.trim(),content=$("aboutContentInput").value;if(!title)throw Error("Please enter an About title.");$("aboutMessage").textContent="Saving...";const d=await api("/api/about",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,content})});renderAbout(d);$("aboutMessage").textContent="About saved ✓";}catch(e){$("aboutMessage").textContent=e.message;}
};

async function loadVocabulary(){
 try{vocabulary=await api("/api/vocabulary");renderVocabulary();}catch(e){vocabulary=[];if($("vocabMessage"))$("vocabMessage").textContent=e.message;}
}
function renderVocabulary(){
 const q=($("vocabSearch")?.value||"").toLowerCase().trim();
 const list=vocabulary.filter(v=>[v.cantonese,v.jyutping,v.meaning,v.example].join(" ").toLowerCase().includes(q));
 $("vocabList").innerHTML=list.length?list.map(v=>`<div class="vocab-card"><div class="vocab-cn">${esc(v.cantonese)}</div><div class="vocab-jp">${esc(v.jyutping)}</div><div class="vocab-my">${esc(v.meaning)}</div>${v.example?`<div class="vocab-example">Example: ${esc(v.example)}</div>`:""}${currentUser?.role==="admin"?`<div class="card-actions"><button class="open-btn" onclick="editVocabulary(${v.id})">Edit</button><button class="delete-btn" onclick="deleteVocabulary(${v.id})">Delete</button></div>`:""}</div>`).join(""):`<div class="empty">No vocabulary yet.</div>`;
}
$("vocabSearch").oninput=renderVocabulary;
function clearVocab(){editingVocabId=null;$("vocabCantonese").value="";$("vocabJyutping").value="";$("vocabMeaning").value="";$("vocabExample").value="";$("vocabFormTitle").textContent="+ Add Vocabulary";$("saveVocabBtn").textContent="Save Vocabulary";$("vocabMessage").textContent="";}
$("clearVocabBtn").onclick=clearVocab;
$("saveVocabBtn").onclick=async()=>{
 try{const data={cantonese:$("vocabCantonese").value.trim(),jyutping:$("vocabJyutping").value.trim(),meaning:$("vocabMeaning").value.trim(),example:$("vocabExample").value.trim()};if(!data.cantonese||!data.meaning)throw Error("Cantonese and Myanmar meaning are required.");$("vocabMessage").textContent="Saving...";const d=await api(editingVocabId?"/api/vocabulary/"+editingVocabId:"/api/vocabulary",{method:editingVocabId?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});await loadVocabulary();clearVocab();$("vocabMessage").textContent="Vocabulary saved ✓";}catch(e){$("vocabMessage").textContent=e.message;}
};
window.editVocabulary=id=>{const v=vocabulary.find(x=>x.id===id);if(!v)return;editingVocabId=id;$("vocabCantonese").value=v.cantonese||"";$("vocabJyutping").value=v.jyutping||"";$("vocabMeaning").value=v.meaning||"";$("vocabExample").value=v.example||"";$("vocabFormTitle").textContent="Edit Vocabulary";$("saveVocabBtn").textContent="Update Vocabulary";$("vocabMessage").textContent="Editing vocabulary.";};
window.deleteVocabulary=async id=>{if(!confirm("Delete this vocabulary?"))return;try{await api("/api/vocabulary/"+id,{method:"DELETE"});await loadVocabulary();}catch(e){alert(e.message)}};

function openAuth(){$("authModal").classList.remove("hidden");$("authMessage").textContent="";$("username").focus();}
$("loginBtn").onclick=openAuth;$("closeAuth").onclick=()=>$("authModal").classList.add("hidden");
$("authSubmit").onclick=async()=>{
 try{
  const username=$("username").value.trim(),password=$("password").value;
  if(!username||!password)throw Error("Enter username and password.");
  currentUser=(await api("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})})).user;
  $("authModal").classList.add("hidden");applyRole();await loadLessons();showSection(currentUser.role==="admin"?"dashboard":"lessons");
 }catch(e){$("authMessage").textContent=e.message;}
};
$("logoutBtn").onclick=async()=>{try{await api("/api/logout",{method:"POST"})}catch(e){}currentUser=null;lessons=[];applyRole();showSection("dashboard");};

async function loadMe(){try{currentUser=(await api("/api/me")).user}catch(e){currentUser=null}applyRole();}
async function loadLessons(){try{lessons=await api("/api/lessons")}catch(e){lessons=[]}render();updateStats();}

function render(){
 const q=($("search")?.value||"").toLowerCase().trim();
 const list=lessons.filter(l=>[l.title,l.category,l.lessonNumber,l.cantonese,l.jyutping,l.meaning,l.notes,...(l.phrases||[]).flatMap(p=>[p.cantonese,p.jyutping,p.meaning])].join(" ").toLowerCase().includes(q));
 $("lessonList").innerHTML=list.length?list.map(l=>`<div class="lesson-card"><div class="card-top"><div>📚 LESSON ${esc(l.lessonNumber||"")}</div><div class="card-category">${esc(l.category||"Lesson")}</div></div><div class="cn">${esc(l.cantonese||"")}</div><div class="jp">${esc(l.jyutping||"")}</div><div class="meaning">${esc(l.meaning||"")}</div><div class="files">${(l.phrases||[]).length} phrase${(l.phrases||[]).length===1?"":"s"} ${l.video?"· 🎬":""} ${l.audio?"· 🔊":""} ${l.pdf?"· 📄":""}</div><div class="files">${esc(l.title)}</div><div class="card-actions"><button class="open-btn" onclick="openLesson(${l.id})">Open</button>${currentUser?.role==="admin"?`<button class="open-btn" onclick="editLesson(${l.id})">Edit</button><button class="delete-btn" onclick="deleteLesson(${l.id})">Delete</button>`:""}</div></div>`).join(""):`<div class="empty">No lessons yet.</div>`;
}
$("search").oninput=render;

function renderPhrases(){
 const box=$("phraseList");if(!box)return;
 box.innerHTML=phrases.length?phrases.map((p,i)=>`<div class="phrase-item"><div class="phrase-head"><span class="phrase-no">PHRASE ${i+1}</span><button type="button" class="remove-phrase" onclick="removePhrase(${i})">Remove</button></div><div class="phrase-grid"><div><label>Cantonese</label><input data-p="cantonese" data-i="${i}" value="${esc(p.cantonese)}"></div><div><label>Jyutping</label><input data-p="jyutping" data-i="${i}" value="${esc(p.jyutping)}"></div><div><label>Myanmar Meaning</label><input data-p="meaning" data-i="${i}" value="${esc(p.meaning)}"></div></div><div class="phrase-audio"><label>Phrase Audio</label><input type="file" accept="audio/*" data-audio-i="${i}"></div></div>`).join(""):`<div class="empty">No phrases yet. Click “+ Add Phrase”.</div>`;
 box.querySelectorAll("input[data-p]").forEach(el=>el.oninput=()=>phrases[+el.dataset.i][el.dataset.p]=el.value);
}
$("addPhraseBtn").onclick=()=>{phrases.push({cantonese:"",jyutping:"",meaning:"",audio:""});renderPhrases();};
window.removePhrase=i=>{phrases.splice(i,1);renderPhrases();};

function clearForm(){ $("lessonForm").reset();editingLessonId=null;phrases=[];renderPhrases();$("message").textContent="";const b=$("lessonForm").querySelector('button[type="submit"]');if(b)b.textContent="Save Lesson";}
$("clearBtn").onclick=clearForm;

$("lessonForm").onsubmit=async e=>{
 e.preventDefault();if(currentUser?.role!=="admin")return;
 $("message").textContent=editingLessonId?"Updating...":"Saving...";
 try{
  const fd=new FormData();
  ["title","lessonNumber","category","cantonese","jyutping","meaning","notes"].forEach(k=>fd.append(k,$(k).value||""));
  ["video","audio","pdf"].forEach(k=>{if($(k)?.files[0])fd.append(k,$(k).files[0]);});
  fd.append("phrases",JSON.stringify(phrases.map(p=>({cantonese:p.cantonese,jyutping:p.jyutping,meaning:p.meaning,audio:p.audio||""}))));
  phrases.forEach((p,i)=>{const f=document.querySelector(`input[data-audio-i="${i}"]`)?.files[0];if(f)fd.append(`phraseAudio_${i}`,f);});
  await api(editingLessonId?"/api/lessons/"+editingLessonId:"/api/lessons",{method:editingLessonId?"PUT":"POST",body:fd});
  await loadLessons();clearForm();$("message").textContent="Lesson saved ✓";showSection("lessons");
 }catch(e){$("message").textContent=e.message;console.error(e);}
};

window.openLesson=id=>{
 const l=lessons.find(x=>x.id===id);if(!l)return;
 $("viewMeta").textContent=`${l.category||"Lesson"}${l.lessonNumber?" • Lesson "+l.lessonNumber:""}`;$("viewTitle").textContent=l.title;$("viewCantonese").textContent=l.cantonese||"";$("viewJyutping").textContent=l.jyutping||"";$("viewMeaning").textContent=l.meaning||"";$("viewNotes").textContent=l.notes||"";
 $("viewPhrases").innerHTML=(l.phrases||[]).map(p=>`<div class="view-phrase"><div class="v-cn">${esc(p.cantonese)}</div><div class="v-jp">${esc(p.jyutping)}</div><div class="v-my">${esc(p.meaning)}</div>${p.audio?`<audio controls src="${esc(p.audio)}"></audio>`:""}</div>`).join("")||`<div class="empty">No conversation phrases.</div>`;
 for(const [k,box] of [["video","viewVideoBox"],["audio","viewAudioBox"],["pdf","viewPdfBox"]]){
  if(l[k]){$(k==="pdf"?"viewPdf":"view"+k[0].toUpperCase()+k.slice(1)).src=l[k];if(k==="pdf")$("viewPdf").href=l[k];$(box).classList.remove("hidden")}else $(box).classList.add("hidden");
 }
 $("viewer").classList.remove("hidden");
};
$("closeViewer").onclick=()=>$("viewer").classList.add("hidden");

window.editLesson=id=>{const l=lessons.find(x=>x.id===id);if(!l)return;editingLessonId=id;["title","lessonNumber","category","cantonese","jyutping","meaning","notes"].forEach(k=>$(k).value=l[k]||"");phrases=(l.phrases||[]).map(p=>({...p}));renderPhrases();$("lessonForm").querySelector('button[type="submit"]').textContent="Update Lesson";$("message").textContent="Editing lesson.";showSection("creator");};
window.deleteLesson=async id=>{const l=lessons.find(x=>x.id===id);if(!l||!confirm(`Delete "${l.title}"?`))return;try{await api("/api/lessons/"+id,{method:"DELETE"});await loadLessons()}catch(e){alert(e.message)}};

let users=[];
async function loadUsers(){if(currentUser?.role!=="admin")return;try{users=await api("/api/users");$("userList").innerHTML=users.map(u=>`<div class="user-row"><div><b>${esc(u.username)}</b><span>${esc(u.role)}</span></div>${u.role==="student"?`<button class="delete-btn" onclick="deleteUser(${u.id})">Delete</button>`:""}</div>`).join("")}catch(e){$("userMessage").textContent=e.message}}
$("createStudentBtn").onclick=async()=>{
  const username=$("newUsername").value.trim();
  const password=$("newPassword").value;
  const msg=$("userMessage");
  if(!username){msg.textContent="Please enter a username.";return;}
  if(!password){msg.textContent="Please enter a password.";return;}
  if(password.length<4){msg.textContent="Password must be at least 4 characters.";return;}
  const btn=$("createStudentBtn");
  btn.disabled=true; msg.textContent="Creating student...";
  try{
    const created=await api("/api/users",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username,password})
    });
    $("newUsername").value="";
    $("newPassword").value="";
    msg.textContent=`Student "${created.username}" created ✓`;
    await loadUsers();
  }catch(e){
    msg.textContent=e.message||"Could not create student.";
  }finally{
    btn.disabled=false;
  }
};
window.deleteUser=async id=>{if(!confirm("Delete this student account?"))return;try{await api("/api/users/"+id,{method:"DELETE"});loadUsers()}catch(e){alert(e.message)}};

(async()=>{await loadMe();await loadLessons();renderPhrases();await loadAbout();await loadVocabulary();showSection(currentUser?.role==="admin"?"dashboard":"lessons")})();
