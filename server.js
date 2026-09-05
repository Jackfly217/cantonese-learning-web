const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// Supabase
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const STORAGE_BUCKET = "lesson-files";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ------------------------------------------------------------
// App / session
// ------------------------------------------------------------
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

// Files are held in memory only long enough to upload them to Supabase Storage.
// Supabase Storage has a 50 MB limit on this bucket at the moment.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});
const mediaUpload = upload.any();

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function loginRequired(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Login required" });
  }
  next();
}

function adminRequired(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

function cleanFileName(name) {
  return path.basename(String(name || "file"))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

function storagePath(lessonId, type, originalName, index = "") {
  const stamp = Date.now();
  const safe = cleanFileName(originalName);
  const prefix = index === "" ? type : `${type}-${index}`;
  return `lessons/${lessonId}/${prefix}-${stamp}-${safe}`;
}

async function uploadToStorage(file, lessonId, type, index = "") {
  if (!file) return "";

  const objectPath = storagePath(lessonId, type, file.originalname, index);

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype || "application/octet-stream",
      upsert: false
    });

  if (error) throw error;
  return objectPath;
}

async function removeStoragePaths(paths) {
  const clean = [...new Set((paths || []).filter(Boolean))];
  if (!clean.length) return;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove(clean);

  if (error) console.error("Storage remove error:", error);
}

async function signedUrl(storagePathValue) {
  if (!storagePathValue) return "";

  // Private bucket: return a temporary URL to the frontend.
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePathValue, 60 * 60 * 24);

  if (error) {
    console.error("Signed URL error:", error);
    return "";
  }
  return data?.signedUrl || "";
}

function normalizePhrases(value) {
  let phrases = value;
  if (typeof value === "string") {
    try {
      phrases = JSON.parse(value || "[]");
    } catch {
      phrases = [];
    }
  }
  if (!Array.isArray(phrases)) phrases = [];

  return phrases.map(p => ({
    cantonese: String(p?.cantonese || ""),
    jyutping: String(p?.jyutping || ""),
    meaning: String(p?.meaning || ""),
    audio: String(p?.audio || "")
  }));
}

async function decorateLesson(row) {
  const phrases = normalizePhrases(row.phrases);

  for (const p of phrases) {
    if (p.audio) {
      p.audio = await signedUrl(p.audio);
    }
  }

  return {
    id: Number(row.id),
    title: row.title,
    lessonNumber: row.lesson_number || "",
    category: row.category || "Other",
    cantonese: row.cantonese || "",
    jyutping: row.jyutping || "",
    meaning: row.meaning || "",
    notes: row.notes || "",
    phrases,
    video: await signedUrl(row.video_url || ""),
    audio: await signedUrl(row.audio_url || ""),
    pdf: await signedUrl(row.pdf_url || ""),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getAllLessons() {
  const { data, error } = await supabase
    .from("lessons")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const result = [];
  for (const row of data || []) result.push(await decorateLesson(row));
  return result;
}

async function getLessonRow(id) {
  const { data, error } = await supabase
    .from("lessons")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function rowToVocabulary(row) {
  return {
    id: Number(row.id),
    cantonese: row.cantonese || "",
    jyutping: row.jyutping || "",
    meaning: row.meaning || "",
    example: row.example || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureAdminUser() {
  const username = String(process.env.ADMIN_USERNAME || "admin").trim();
  const password = String(process.env.ADMIN_PASSWORD || "").trim();

  if (!password) {
    console.warn("ADMIN_PASSWORD is not set. No admin account was created automatically.");
    return;
  }

  const { data: existing, error: findError } = await supabase
    .from("users")
    .select("id, username, role")
    .eq("username", username)
    .maybeSingle();

  if (findError) throw findError;

  if (!existing) {
    const { error } = await supabase.from("users").insert({
      username,
      password_hash: bcrypt.hashSync(password, 10),
      role: "admin"
    });
    if (error) throw error;
    console.log(`Admin account created: ${username}`);
  }
}

// ------------------------------------------------------------
// Auth
// ------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    const { data: user, error } = await supabase
      .from("users")
      .select("id, username, password_hash, role")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    req.session.user = {
      id: Number(user.id),
      username: user.username,
      role: user.role
    };

    res.json({ user: req.session.user });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get("/api/health", async (req, res) => {
  try {
    const { error } = await supabase.from("about").select("id").eq("id", 1).maybeSingle();
    if (error) throw error;

    res.json({
      ok: true,
      service: "Cantonese Learning",
      version: "8.0-supabase"
    });
  } catch (err) {
    console.error("Health error:", err);
    res.status(500).json({ ok: false, error: "Supabase connection failed" });
  }
});

// ------------------------------------------------------------
// About
// ------------------------------------------------------------
app.get("/api/about", loginRequired, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("about")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;

    res.json({
      title: data?.title || "About this app",
      content: data?.content || "",
      updatedAt: data?.updated_at || null
    });
  } catch (err) {
    console.error("Get about error:", err);
    res.status(500).json({ error: "Could not load About information." });
  }
});

app.put("/api/about", adminRequired, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const content = String(req.body?.content || "");

    if (!title) {
      return res.status(400).json({ error: "About title is required." });
    }

    const { data, error } = await supabase
      .from("about")
      .upsert({
        id: 1,
        title,
        content,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      title: data.title,
      content: data.content,
      updatedAt: data.updated_at
    });
  } catch (err) {
    console.error("Update about error:", err);
    res.status(500).json({ error: "Could not save About information." });
  }
});

// ------------------------------------------------------------
// Vocabulary
// ------------------------------------------------------------
app.get("/api/vocabulary", loginRequired, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vocabulary")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json((data || []).map(rowToVocabulary));
  } catch (err) {
    console.error("Get vocabulary error:", err);
    res.status(500).json({ error: "Could not load vocabulary." });
  }
});

app.post("/api/vocabulary", adminRequired, async (req, res) => {
  try {
    const cantonese = String(req.body?.cantonese || "").trim();
    const jyutping = String(req.body?.jyutping || "").trim();
    const meaning = String(req.body?.meaning || "").trim();
    const example = String(req.body?.example || "").trim();

    if (!cantonese || !meaning) {
      return res.status(400).json({
        error: "Cantonese and Myanmar meaning are required."
      });
    }

    const { data, error } = await supabase
      .from("vocabulary")
      .insert({ cantonese, jyutping, meaning, example })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(rowToVocabulary(data));
  } catch (err) {
    console.error("Create vocabulary error:", err);
    res.status(500).json({ error: "Could not save vocabulary." });
  }
});

app.put("/api/vocabulary/:id", adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const updates = {};
    for (const key of ["cantonese", "jyutping", "meaning", "example"]) {
      if (req.body?.[key] !== undefined) {
        updates[key] = String(req.body[key] || "").trim();
      }
    }

    const { data: current, error: findError } = await supabase
      .from("vocabulary")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;
    if (!current) return res.status(404).json({ error: "Vocabulary not found." });

    const next = {
      cantonese: updates.cantonese !== undefined ? updates.cantonese : current.cantonese,
      jyutping: updates.jyutping !== undefined ? updates.jyutping : current.jyutping,
      meaning: updates.meaning !== undefined ? updates.meaning : current.meaning,
      example: updates.example !== undefined ? updates.example : current.example,
      updated_at: new Date().toISOString()
    };

    if (!next.cantonese || !next.meaning) {
      return res.status(400).json({
        error: "Cantonese and Myanmar meaning are required."
      });
    }

    const { data, error } = await supabase
      .from("vocabulary")
      .update(next)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    res.json(rowToVocabulary(data));
  } catch (err) {
    console.error("Update vocabulary error:", err);
    res.status(500).json({ error: "Could not update vocabulary." });
  }
});

app.delete("/api/vocabulary/:id", adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const { data: current, error: findError } = await supabase
      .from("vocabulary")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;
    if (!current) return res.status(404).json({ error: "Vocabulary not found." });

    const { error } = await supabase
      .from("vocabulary")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete vocabulary error:", err);
    res.status(500).json({ error: "Could not delete vocabulary." });
  }
});

// ------------------------------------------------------------
// Lessons
// ------------------------------------------------------------
app.get("/api/lessons", loginRequired, async (req, res) => {
  try {
    res.json(await getAllLessons());
  } catch (err) {
    console.error("Get lessons error:", err);
    res.status(500).json({ error: "Could not load lessons." });
  }
});

app.post("/api/lessons", adminRequired, mediaUpload, async (req, res) => {
  const uploadedPaths = [];

  try {
    const {
      title,
      lessonNumber,
      category,
      cantonese,
      jyutping,
      meaning,
      notes
    } = req.body;

    if (!title || !cantonese) {
      return res.status(400).json({
        error: "Title and Cantonese text are required"
      });
    }

    let phrases = normalizePhrases(req.body.phrases);

    // Insert first so Supabase gives us a real lesson ID.
    const { data: inserted, error: insertError } = await supabase
      .from("lessons")
      .insert({
        title: String(title),
        lesson_number: String(lessonNumber || ""),
        category: String(category || "Other"),
        cantonese: String(cantonese),
        jyutping: String(jyutping || ""),
        meaning: String(meaning || ""),
        notes: String(notes || ""),
        phrases: phrases.map(p => ({ ...p, audio: "" }))
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const lessonId = Number(inserted.id);
    const files = req.files || [];

    const videoFile = files.find(f => f.fieldname === "video");
    const audioFile = files.find(f => f.fieldname === "audio");
    const pdfFile = files.find(f => f.fieldname === "pdf");

    const videoPath = await uploadToStorage(videoFile, lessonId, "video");
    if (videoPath) uploadedPaths.push(videoPath);

    const audioPath = await uploadToStorage(audioFile, lessonId, "audio");
    if (audioPath) uploadedPaths.push(audioPath);

    const pdfPath = await uploadToStorage(pdfFile, lessonId, "pdf");
    if (pdfPath) uploadedPaths.push(pdfPath);

    for (let i = 0; i < phrases.length; i++) {
      const phraseFile = files.find(f => f.fieldname === `phraseAudio_${i}`);
      if (phraseFile) {
        const phrasePath = await uploadToStorage(
          phraseFile,
          lessonId,
          "phraseAudio",
          i
        );
        uploadedPaths.push(phrasePath);
        phrases[i].audio = phrasePath;
      }
    }

    const { error: updateError } = await supabase
      .from("lessons")
      .update({
        video_url: videoPath,
        audio_url: audioPath,
        pdf_url: pdfPath,
        phrases,
        updated_at: new Date().toISOString()
      })
      .eq("id", lessonId);

    if (updateError) throw updateError;

    const saved = await getLessonRow(lessonId);
    res.status(201).json(await decorateLesson(saved));
  } catch (err) {
    console.error("Create lesson error:", err);
    await removeStoragePaths(uploadedPaths);

    // If a DB row was created before a file upload failed, clean it up.
    if (err && err.message) {
      const maybeId = Number(req.body?.__createdLessonId);
      if (Number.isFinite(maybeId) && maybeId > 0) {
        await supabase.from("lessons").delete().eq("id", maybeId);
      }
    }

    res.status(500).json({
      error: "Could not save lesson",
      detail: err?.message || ""
    });
  }
});

app.put("/api/lessons/:id", adminRequired, mediaUpload, async (req, res) => {
  const id = Number(req.params.id);
  const newlyUploadedPaths = [];

  try {
    const lesson = await getLessonRow(id);
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    const updates = {};

    for (const key of [
      "title",
      "lessonNumber",
      "category",
      "cantonese",
      "jyutping",
      "meaning",
      "notes"
    ]) {
      if (req.body[key] !== undefined) {
        const dbKey = {
          lessonNumber: "lesson_number"
        }[key] || key;

        updates[dbKey] = String(req.body[key] ?? "");
      }
    }

    let phrases = normalizePhrases(
      req.body.phrases !== undefined ? req.body.phrases : lesson.phrases
    );

    const files = req.files || [];

    const oldPaths = [
      lesson.video_url,
      lesson.audio_url,
      lesson.pdf_url,
      ...normalizePhrases(lesson.phrases).map(p => p.audio)
    ];

    for (const key of ["video", "audio", "pdf"]) {
      const nf = files.find(f => f.fieldname === key);
      if (nf) {
        const newPath = await uploadToStorage(nf, id, key);
        newlyUploadedPaths.push(newPath);

        updates[`${key}_url`] = newPath;
      }
    }

    for (let i = 0; i < phrases.length; i++) {
      const pf = files.find(f => f.fieldname === `phraseAudio_${i}`);
      if (pf) {
        const newPath = await uploadToStorage(
          pf,
          id,
          "phraseAudio",
          i
        );
        newlyUploadedPaths.push(newPath);
        phrases[i].audio = newPath;
      }
    }

    updates.phrases = phrases;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("lessons")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Delete old files only after the database update succeeds.
    const newPaths = [
      data.video_url,
      data.audio_url,
      data.pdf_url,
      ...normalizePhrases(data.phrases).map(p => p.audio)
    ];
    const pathsToDelete = oldPaths.filter(p => p && !newPaths.includes(p));
    await removeStoragePaths(pathsToDelete);

    res.json(await decorateLesson(data));
  } catch (err) {
    console.error("Update lesson error:", err);
    await removeStoragePaths(newlyUploadedPaths);
    res.status(500).json({
      error: "Could not update lesson",
      detail: err?.message || ""
    });
  }
});

app.delete("/api/lessons/:id", adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const lesson = await getLessonRow(id);

    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const paths = [
      lesson.video_url,
      lesson.audio_url,
      lesson.pdf_url,
      ...normalizePhrases(lesson.phrases).map(p => p.audio)
    ];

    const { error } = await supabase
      .from("lessons")
      .delete()
      .eq("id", id);

    if (error) throw error;

    await removeStoragePaths(paths);
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete lesson error:", err);
    res.status(500).json({ error: "Could not delete lesson" });
  }
});

// ------------------------------------------------------------
// Users
// ------------------------------------------------------------
app.get("/api/users", adminRequired, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, username, role")
      .order("id", { ascending: true });

    if (error) throw error;

    res.json((data || []).map(u => ({
      id: Number(u.id),
      username: u.username,
      role: u.role
    })));
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ error: "Could not load users." });
  }
});

app.post("/api/users", adminRequired, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username) {
      return res.status(400).json({ error: "Please enter a username." });
    }
    if (!password) {
      return res.status(400).json({ error: "Please enter a password." });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters." });
    }

    const { data: existing, error: findError } = await supabase
      .from("users")
      .select("id")
      .ilike("username", username)
      .maybeSingle();

    if (findError) throw findError;
    if (existing) {
      return res.status(409).json({ error: "Username already exists." });
    }

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        username,
        password_hash: bcrypt.hashSync(password, 10),
        role: "student"
      })
      .select("id, username, role")
      .single();

    if (error) throw error;

    console.log(`Student created: ${username}`);
    res.status(201).json({
      id: Number(user.id),
      username: user.username,
      role: user.role
    });
  } catch (err) {
    console.error("Create student error:", err);
    res.status(500).json({ error: "Could not create student account." });
  }
});

app.delete("/api/users/:id", adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const { data: target, error: findError } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === "admin") {
      return res.status(400).json({ error: "Admin account cannot be deleted here" });
    }

    const { error } = await supabase
      .from("users")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Could not delete user." });
  }
});

// ------------------------------------------------------------
// Static frontend
// ------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.get("/{*splat}", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------
async function start() {
  try {
    await ensureAdminUser();
    app.listen(PORT, () => {
      console.log(`Cantonese Learning: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
}

start();
