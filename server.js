const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const usersFile = path.join(DATA_DIR, "users.json");
const lessonsFile = path.join(DATA_DIR, "lessons.json");
const aboutFile = path.join(DATA_DIR, "about.json");
const vocabularyFile = path.join(DATA_DIR, "vocabulary.json");

if (!fs.existsSync(usersFile)) {
  fs.writeFileSync(usersFile, JSON.stringify([
    { id: 1, username: "admin", password: bcrypt.hashSync("admin123", 10), role: "admin" },
    { id: 2, username: "student", password: bcrypt.hashSync("student123", 10), role: "student" }
  ], null, 2));
}
if (!fs.existsSync(lessonsFile)) fs.writeFileSync(lessonsFile, "[]");
if (!fs.existsSync(aboutFile)) fs.writeFileSync(aboutFile, JSON.stringify({title:"About this app",content:"A clean Cantonese-only learning workspace."}, null, 2));
if (!fs.existsSync(vocabularyFile)) fs.writeFileSync(vocabularyFile, "[]");

const readJSON = f => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: process.env.SESSION_SECRET || "cantonese-learning-dev-secret",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax"}
}));

const storage = multer.diskStorage({
  destination: (_,__,cb)=>cb(null,UPLOAD_DIR),
  filename: (_,file,cb)=>{
    const safe=file.originalname.replace(/[^a-zA-Z0-9._-]/g,"_");
    cb(null,Date.now()+"-"+safe);
  }
});
const upload=multer({storage});
const mediaUpload=upload.any();

function loginRequired(req,res,next){
  if(!req.session.user) return res.status(401).json({error:"Login required"});
  next();
}
function adminRequired(req,res,next){
  if(!req.session.user || req.session.user.role!=="admin")
    return res.status(403).json({error:"Admin only"});
  next();
}

app.post("/api/login",(req,res)=>{
  const {username,password}=req.body;
  const user=readJSON(usersFile).find(u=>u.username===username);
  if(!user || !bcrypt.compareSync(password||"",user.password))
    return res.status(401).json({error:"Invalid username or password"});
  req.session.user={id:user.id,username:user.username,role:user.role};
  res.json({user:req.session.user});
});

app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));
app.get("/api/health",(req,res)=>res.json({ok:true,service:"Cantonese Learning",version:"7.3"}));

app.get("/api/lessons",loginRequired,(req,res)=>{
  res.json(readJSON(lessonsFile));
});

app.get("/api/about", loginRequired, (req,res)=>{
  res.json(readJSON(aboutFile));
});

app.put("/api/about", adminRequired, (req,res)=>{
  const title=String(req.body?.title||"").trim();
  const content=String(req.body?.content||"");
  if(!title) return res.status(400).json({error:"About title is required."});
  const data={title,content,updatedAt:new Date().toISOString()};
  writeJSON(aboutFile,data);
  res.json(data);
});

app.get("/api/vocabulary", loginRequired, (req,res)=>{
  res.json(readJSON(vocabularyFile));
});

app.post("/api/vocabulary", adminRequired, (req,res)=>{
  const cantonese=String(req.body?.cantonese||"").trim();
  const jyutping=String(req.body?.jyutping||"").trim();
  const meaning=String(req.body?.meaning||"").trim();
  const example=String(req.body?.example||"").trim();
  if(!cantonese || !meaning) return res.status(400).json({error:"Cantonese and Myanmar meaning are required."});
  const vocabulary=readJSON(vocabularyFile);
  const item={id:Date.now(),cantonese,jyutping,meaning,example,createdAt:new Date().toISOString()};
  vocabulary.unshift(item); writeJSON(vocabularyFile,vocabulary); res.status(201).json(item);
});

app.put("/api/vocabulary/:id", adminRequired, (req,res)=>{
  const id=Number(req.params.id), vocabulary=readJSON(vocabularyFile);
  const item=vocabulary.find(x=>x.id===id);
  if(!item) return res.status(404).json({error:"Vocabulary not found."});
  for(const k of ["cantonese","jyutping","meaning","example"]) if(req.body?.[k]!==undefined) item[k]=String(req.body[k]||"").trim();
  if(!item.cantonese || !item.meaning) return res.status(400).json({error:"Cantonese and Myanmar meaning are required."});
  item.updatedAt=new Date().toISOString(); writeJSON(vocabularyFile,vocabulary); res.json(item);
});

app.delete("/api/vocabulary/:id", adminRequired, (req,res)=>{
  const id=Number(req.params.id), vocabulary=readJSON(vocabularyFile);
  if(!vocabulary.some(x=>x.id===id)) return res.status(404).json({error:"Vocabulary not found."});
  writeJSON(vocabularyFile,vocabulary.filter(x=>x.id!==id)); res.json({ok:true});
});



function attachPhraseAudios(req, phrases){
  const files=req.files||[];
  for(let i=0;i<phrases.length;i++){
    const f=files.find(x=>x.fieldname===`phraseAudio_${i}`);
    if(f) phrases[i].audio="/uploads/"+f.filename;
  }
  return phrases;
}

app.post("/api/lessons", adminRequired, mediaUpload, (req,res)=>{
  try{
    const {title,lessonNumber,category,cantonese,jyutping,meaning,notes}=req.body;
    if(!title || !cantonese) return res.status(400).json({error:"Title and Cantonese text are required"});

    const files=req.files||[];
    const getFile=name=>files.find(f=>f.fieldname===name);
    let phrases=[];
    try{ phrases=JSON.parse(req.body.phrases||"[]"); }catch(e){ phrases=[]; }
    phrases=phrases.map(p=>({
      cantonese:String(p.cantonese||""),
      jyutping:String(p.jyutping||""),
      meaning:String(p.meaning||""),
      audio:String(p.audio||"")
    }));
    phrases.forEach((p,i)=>{
      const pf=files.find(f=>f.fieldname===`phraseAudio_${i}`);
      if(pf) p.audio="/uploads/"+pf.filename;
    });

    const lesson={
      id:Date.now(), title, lessonNumber:lessonNumber||"",
      category:category||"Other", cantonese, jyutping:jyutping||"",
      meaning:meaning||"", notes:notes||"", phrases,
      video:getFile("video")?"/uploads/"+getFile("video").filename:"",
      audio:getFile("audio")?"/uploads/"+getFile("audio").filename:"",
      pdf:getFile("pdf")?"/uploads/"+getFile("pdf").filename:"",
      createdAt:new Date().toISOString()
    };
    const lessons=readJSON(lessonsFile);
    lessons.unshift(lesson);
    writeJSON(lessonsFile,lessons);
    res.status(201).json(lesson);
  }catch(err){
    console.error(err);
    res.status(500).json({error:"Could not save lesson"});
  }
});

app.delete("/api/lessons/:id",adminRequired,(req,res)=>{
  const id=Number(req.params.id), lessons=readJSON(lessonsFile);
  const lesson=lessons.find(x=>x.id===id);
  if(!lesson) return res.status(404).json({error:"Lesson not found"});
  for(const key of ["video","audio","pdf"]){
    if(lesson[key]){
      const file=path.join(__dirname,lesson[key].replace(/^\/+/,""));
      if(fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
  writeJSON(lessonsFile,lessons.filter(x=>x.id!==id));
  res.json({ok:true});
});


app.put("/api/lessons/:id", adminRequired, mediaUpload, (req,res)=>{
  try{
    const id=Number(req.params.id);
    const lessons=readJSON(lessonsFile);
    const lesson=lessons.find(x=>x.id===id);
    if(!lesson) return res.status(404).json({error:"Lesson not found"});

    ["title","lessonNumber","category","cantonese","jyutping","meaning","notes"].forEach(k=>{
      if(req.body[k]!==undefined) lesson[k]=req.body[k];
    });

    if(req.body.phrases!==undefined){
      try{lesson.phrases=JSON.parse(req.body.phrases||"[]");}catch(e){lesson.phrases=[];}
      lesson.phrases=lesson.phrases.map(p=>({
        cantonese:String(p.cantonese||""),jyutping:String(p.jyutping||""),
        meaning:String(p.meaning||""),audio:String(p.audio||"")
      }));
    } else lesson.phrases=lesson.phrases||[];

    const files=req.files||[];
    for(const key of ["video","audio","pdf"]){
      const nf=files.find(f=>f.fieldname===key);
      if(nf){
        if(lesson[key]){
          const old=path.join(__dirname,lesson[key].replace(/^\/+/,""));
          if(fs.existsSync(old)) fs.unlinkSync(old);
        }
        lesson[key]="/uploads/"+nf.filename;
      }
    }
    lesson.phrases.forEach((p,i)=>{
      const pf=files.find(f=>f.fieldname===`phraseAudio_${i}`);
      if(pf) p.audio="/uploads/"+pf.filename;
    });

    lesson.updatedAt=new Date().toISOString();
    writeJSON(lessonsFile,lessons);
    res.json(lesson);
  }catch(err){
    console.error(err);
    res.status(500).json({error:"Could not update lesson"});
  }
});

app.get("/api/users", adminRequired, (req,res)=>{
  res.json(readJSON(usersFile).map(({id,username,role})=>({id,username,role})));
});

app.post("/api/users", adminRequired, (req,res)=>{
  try{
    const username=String(req.body?.username||"").trim();
    const password=String(req.body?.password||"");
    if(!username) return res.status(400).json({error:"Please enter a username."});
    if(!password) return res.status(400).json({error:"Please enter a password."});
    if(password.length<4) return res.status(400).json({error:"Password must be at least 4 characters."});

    const users=readJSON(usersFile);
    if(users.some(u=>String(u.username||"").trim().toLowerCase()===username.toLowerCase()))
      return res.status(409).json({error:"Username already exists."});

    let id=Date.now();
    while(users.some(u=>Number(u.id)===id)) id++;
    const user={
      id,
      username,
      password:bcrypt.hashSync(password,10),
      role:"student"
    };
    users.push(user);
    writeJSON(usersFile,users);
    console.log(`Student created: ${username}`);
    res.status(201).json({id:user.id,username:user.username,role:user.role});
  }catch(err){
    console.error("Create student error:",err);
    res.status(500).json({error:"Could not create student account."});
  }
});

app.delete("/api/users/:id", adminRequired, (req,res)=>{
  const id=Number(req.params.id);
  const users=readJSON(usersFile);
  const target=users.find(u=>u.id===id);
  if(!target) return res.status(404).json({error:"User not found"});
  if(target.role==="admin") return res.status(400).json({error:"Admin account cannot be deleted here"});
  writeJSON(usersFile,users.filter(u=>u.id!==id));
  res.json({ok:true});
});

app.use("/uploads",express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname,"public")));
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT,()=>console.log(`Cantonese Learning: http://localhost:${PORT}`));
