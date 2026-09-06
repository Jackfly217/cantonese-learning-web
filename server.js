const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = "8.3.3";

// ------------------------------------------------------------
// Supabase
// ------------------------------------------------------------
function normalizeSupabaseUrl(value) {
  const raw = String(value || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL. Use the Project URL, e.g. https://your-project.supabase.co");
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("SUPABASE_URL must start with http:// or https://");
  }

  // Accept the normal Project URL, but also repair the common mistake of
  // pasting /rest/v1 or /storage/v1 into the environment variable.
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname === "/rest/v1" || pathname.startsWith("/rest/v1/")) pathname = "";
  if (pathname === "/storage/v1" || pathname.startsWith("/storage/v1/")) pathname = "";

  if (parsed.search || parsed.hash) {
    throw new Error("SUPABASE_URL must be the Project URL only, without a query string or hash");
  }

  parsed.pathname = pathname;
  return parsed.toString().replace(/\/$/, "");
}

const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || "").trim();
const STORAGE_BUCKET = "lesson-files";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}

console.log(`Supabase URL: ${SUPABASE_URL}`);

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

function rowToVocabulary(row, audioUrl = "") {
  return {
    id: Number(row.id),
    cantonese: row.cantonese || "",
    jyutping: row.jyutping || "",
    meaning: row.meaning || "",
    example: row.example || "",
    audioUrl: audioUrl || "",
    audio: audioUrl || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function decorateVocabulary(row) {
  const audioUrl = await signedUrl(row.audio_url || "");
  return rowToVocabulary(row, audioUrl);
}

function vocabularyStoragePath(vocabularyId, originalName) {
  const stamp = Date.now();
  const safe = cleanFileName(originalName);
  return `vocabulary/${vocabularyId}/audio-${stamp}-${safe}`;
}

async function uploadVocabularyAudio(file, vocabularyId) {
  if (!file) return "";

  const objectPath = vocabularyStoragePath(vocabularyId, file.originalname);
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype || "audio/mpeg",
      upsert: false
    });

  if (error) throw error;
  return objectPath;
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

app.put("/api/account", adminRequired, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newUsername = String(req.body?.username || "").trim();
    const newPassword = String(req.body?.newPassword || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const currentUserId = Number(req.session.user.id);

    if (!currentPassword) {
      return res.status(400).json({ error: "Please enter your current password." });
    }
    if (!newUsername) {
      return res.status(400).json({ error: "Please enter a username." });
    }
    if (newUsername.length < 3 || newUsername.length > 50) {
      return res.status(400).json({ error: "Username must be 3–50 characters." });
    }
    if (newPassword && newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    if (newPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ error: "New passwords do not match." });
    }

    const { data: currentUser, error: currentError } = await supabase
      .from("users")
      .select("id, username, password_hash, role")
      .eq("id", currentUserId)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!currentUser || currentUser.role !== "admin") {
      return res.status(403).json({ error: "Admin account not found." });
    }

    if (!bcrypt.compareSync(currentPassword, currentUser.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const usernameChanged = newUsername !== currentUser.username;
    const passwordChanged = Boolean(newPassword);

    if (!usernameChanged && !passwordChanged) {
      return res.status(400).json({ error: "Please enter a new username or a new password." });
    }

    if (usernameChanged) {
      const { data: conflicts, error: conflictError } = await supabase
        .from("users")
        .select("id")
        .ilike("username", newUsername)
        .neq("id", currentUserId)
        .limit(1);

      if (conflictError) throw conflictError;
      if ((conflicts || []).length) {
        return res.status(409).json({ error: "That username is already in use." });
      }
    }

    const updates = {};
    if (usernameChanged) updates.username = newUsername;
    if (passwordChanged) updates.password_hash = bcrypt.hashSync(newPassword, 10);

    const { data: updated, error: updateError } = await supabase
      .from("users")
      .update(updates)
      .eq("id", currentUserId)
      .select("id, username, role")
      .single();

    if (updateError) throw updateError;

    req.session.user = {
      id: Number(updated.id),
      username: updated.username,
      role: updated.role
    };

    res.json({
      ok: true,
      user: req.session.user,
      changed: { username: usernameChanged, password: passwordChanged }
    });
  } catch (err) {
    console.error("Update admin account error:", err);
    res.status(500).json({ error: "Could not update the admin account." });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    const { error } = await supabase.from("about").select("id").eq("id", 1).maybeSingle();
    if (error) throw error;

    res.json({
      ok: true,
      service: "Cantonese Learning",
      version: APP_VERSION
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

    const result = [];
    for (const row of data || []) result.push(await decorateVocabulary(row));
    res.json(result);
  } catch (err) {
    console.error("Get vocabulary error:", err);
    res.status(500).json({ error: "Could not load vocabulary." });
  }
});

app.post("/api/vocabulary", adminRequired, mediaUpload, async (req, res) => {
  const uploadedPaths = [];
  let createdVocabularyId = null;

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
      .insert({ cantonese, jyutping, meaning, example, audio_url: "" })
      .select()
      .single();

    if (error) throw error;
    createdVocabularyId = Number(data.id);

    const audioFile = (req.files || []).find(f => f.fieldname === "audio");
    if (audioFile) {
      const audioPath = await uploadVocabularyAudio(audioFile, createdVocabularyId);
      uploadedPaths.push(audioPath);

      const { data: updated, error: updateError } = await supabase
        .from("vocabulary")
        .update({ audio_url: audioPath, updated_at: new Date().toISOString() })
        .eq("id", createdVocabularyId)
        .select()
        .single();

      if (updateError) throw updateError;
      return res.status(201).json(await decorateVocabulary(updated));
    }

    res.status(201).json(await decorateVocabulary(data));
  } catch (err) {
    console.error("Create vocabulary error:", err);
    await removeStoragePaths(uploadedPaths);

    if (Number.isFinite(createdVocabularyId) && createdVocabularyId > 0) {
      const { error: cleanupError } = await supabase
        .from("vocabulary")
        .delete()
        .eq("id", createdVocabularyId);
      if (cleanupError) console.error("Vocabulary row cleanup error:", cleanupError);
    }

    res.status(500).json({
      error: "Could not save vocabulary.",
      detail: err?.message || ""
    });
  }
});

app.put("/api/vocabulary/:id", adminRequired, mediaUpload, async (req, res) => {
  const newlyUploadedPaths = [];

  try {
    const id = Number(req.params.id);
    const { data: current, error: findError } = await supabase
      .from("vocabulary")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;
    if (!current) return res.status(404).json({ error: "Vocabulary not found." });

    const updates = {};
    for (const key of ["cantonese", "jyutping", "meaning", "example"]) {
      if (req.body?.[key] !== undefined) updates[key] = String(req.body[key] || "").trim();
    }

    const next = {
      cantonese: updates.cantonese !== undefined ? updates.cantonese : current.cantonese,
      jyutping: updates.jyutping !== undefined ? updates.jyutping : current.jyutping,
      meaning: updates.meaning !== undefined ? updates.meaning : current.meaning,
      example: updates.example !== undefined ? updates.example : current.example,
      audio_url: current.audio_url || "",
      updated_at: new Date().toISOString()
    };

    if (!next.cantonese || !next.meaning) {
      return res.status(400).json({
        error: "Cantonese and Myanmar meaning are required."
      });
    }

    const audioFile = (req.files || []).find(f => f.fieldname === "audio");
    if (audioFile) {
      const newPath = await uploadVocabularyAudio(audioFile, id);
      newlyUploadedPaths.push(newPath);
      next.audio_url = newPath;
    }

    const { data, error } = await supabase
      .from("vocabulary")
      .update(next)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    if (current.audio_url && current.audio_url !== data.audio_url) {
      await removeStoragePaths([current.audio_url]);
    }

    res.json(await decorateVocabulary(data));
  } catch (err) {
    console.error("Update vocabulary error:", err);
    await removeStoragePaths(newlyUploadedPaths);
    res.status(500).json({
      error: "Could not update vocabulary.",
      detail: err?.message || ""
    });
  }
});

app.delete("/api/vocabulary/:id", adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const { data: current, error: findError } = await supabase
      .from("vocabulary")
      .select("id, audio_url")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;
    if (!current) return res.status(404).json({ error: "Vocabulary not found." });

    const { error } = await supabase
      .from("vocabulary")
      .delete()
      .eq("id", id);

    if (error) throw error;
    await removeStoragePaths([current.audio_url]);
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
  let createdLessonId = null;

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
    createdLessonId = lessonId;
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

    // If a DB row was created before a file upload/update failed, clean it up.
    if (Number.isFinite(createdLessonId) && createdLessonId > 0) {
      const { error: cleanupError } = await supabase
        .from("lessons")
        .delete()
        .eq("id", createdLessonId);
      if (cleanupError) console.error("Lesson row cleanup error:", cleanupError);
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

app.put("/api/users/:id", adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const password = String(req.body?.password || "");
    const username = String(req.body?.username || "").trim();

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid student ID." });
    }

    if (password && password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const { data: target, error: findError } = await supabase
      .from("users")
      .select("id, username, role")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;
    if (!target) return res.status(404).json({ error: "User not found." });
    if (target.role === "admin") {
      return res.status(400).json({ error: "Admin account must be changed from Settings." });
    }

    const updates = {};
    if (username && username !== target.username) {
      if (username.length < 3 || username.length > 50) {
        return res.status(400).json({ error: "Username must be 3–50 characters." });
      }
      const { data: conflict, error: conflictError } = await supabase
        .from("users")
        .select("id")
        .ilike("username", username)
        .neq("id", id)
        .limit(1);
      if (conflictError) throw conflictError;
      if ((conflict || []).length) {
        return res.status(409).json({ error: "That username is already in use." });
      }
      updates.username = username;
    }
    if (password) updates.password_hash = bcrypt.hashSync(password, 10);

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "Please enter a new username or password." });
    }

    const { data: updated, error: updateError } = await supabase
      .from("users")
      .update(updates)
      .eq("id", id)
      .select("id, username, role")
      .single();

    if (updateError) throw updateError;
    res.json({ id: Number(updated.id), username: updated.username, role: updated.role });
  } catch (err) {
    console.error("Update student error:", err);
    res.status(500).json({ error: "Could not update student account." });
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
// Vocabulary audio frontend helper
// ------------------------------------------------------------
// The existing frontend can stay unchanged. This middleware injects a tiny
// helper script into HTML responses so the Vocabulary page gets audio upload
// and playback without replacing the current UI.
const FRONTEND_DIR = path.join(__dirname, "public");
app.use((req, res, next) => {
  if (req.method !== "GET" || !(req.headers.accept || "").includes("text/html")) return next();

  const indexPath = path.join(FRONTEND_DIR, "index.html");
  if (!fs.existsSync(indexPath)) return next();

  try {
    let html = fs.readFileSync(indexPath, "utf8");
    const tags = [
      '<script src="/vocabulary-audio.js?v=8.3.4"></script>',
      '<script src="/admin-settings.js"></script>',
      '<script src="/admin-tools-8.3.js"></script>'
    ];
    for (const tag of tags) {
      const src = tag.match(/src="([^"]+)"/)?.[1];
      if (src && !html.includes(src)) {
        html = html.replace(/<\/body>/i, `${tag}</body>`);
      }
    }
    res.type("html").send(html);
  } catch (err) {
    console.error("Frontend injection error:", err);
    next();
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
    // Verify the exact database endpoint before creating the admin account.
    // This gives Render logs a clear error if the Supabase URL/key is wrong.
    const { error: healthError } = await supabase
      .from("about")
      .select("id")
      .eq("id", 1)
      .maybeSingle();

    if (healthError) {
      throw new Error(`Supabase Data API check failed: ${healthError.message} [${healthError.code || "no-code"}]`);
    }

    console.log("Supabase Data API connection: OK");
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
