(() => {
  "use strict";

  const STYLE_ID = "vocabulary-audio-style";
  const AUDIO_INPUT_ID = "vocabulary-audio-input";
  const AUDIO_PREVIEW_ID = "vocabulary-audio-preview";

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;"
    }[c]));
  }

  function isVocabularyPage() {
    const text = document.body?.innerText || "";
    return /Vocabulary/i.test(text) && /Save Vocabulary|Add Vocabulary/i.test(text);
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .vocab-audio-box{margin-top:14px;padding:14px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa}
      .vocab-audio-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .vocab-audio-label{font-weight:600;color:#111827}
      .vocab-audio-box input[type=file]{max-width:100%}
      .vocab-audio-preview{width:min(100%,420px);margin-top:10px}
      .vocab-audio-play{display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:7px 11px;border:0;border-radius:8px;cursor:pointer;font:inherit}
      .vocab-audio-status{font-size:13px;color:#6b7280}
    `;
    document.head.appendChild(style);
  }

  function findSaveButton() {
    return [...document.querySelectorAll("button")].find(b => /Save Vocabulary/i.test(b.textContent || ""));
  }

  function findEditor() {
    const save = findSaveButton();
    if (!save) return null;
    return save.closest("form") || save.closest("section") || save.closest("article") || save.parentElement?.parentElement?.parentElement || null;
  }

  function visibleFields(editor) {
    if (!editor) return [];
    return [...editor.querySelectorAll("input, textarea")].filter(el => {
      if (el.type === "hidden" || el.type === "file" || el.type === "search") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function findField(editor, words, fallbackIndex) {
    const fields = visibleFields(editor);
    for (const field of fields) {
      const id = field.id;
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const nearby = `${field.name || ""} ${field.placeholder || ""} ${field.getAttribute("aria-label") || ""} ${label?.textContent || ""}`.toLowerCase();
      if (words.some(w => nearby.includes(w))) return field;
    }
    return fields[fallbackIndex] || null;
  }

  function getFields(editor) {
    return {
      cantonese: findField(editor, ["cantonese"], 0),
      jyutping: findField(editor, ["jyutping"], 1),
      meaning: findField(editor, ["myanmar", "meaning"], 2),
      example: findField(editor, ["example", "sentence"], 3)
    };
  }

  function findOrCreateAudioBox(editor) {
    let box = editor.querySelector(".vocab-audio-box");
    if (box) return box;

    box = document.createElement("div");
    box.className = "vocab-audio-box";
    box.innerHTML = `
      <div class="vocab-audio-row">
        <span class="vocab-audio-label">🔊 Audio pronunciation</span>
        <input id="${AUDIO_INPUT_ID}" type="file" accept="audio/*">
        <span class="vocab-audio-status">Optional — upload one audio file for this word.</span>
      </div>
      <audio id="${AUDIO_PREVIEW_ID}" class="vocab-audio-preview" controls hidden></audio>
    `;

    const save = findSaveButton();
    if (save) {
      const parent = save.closest("div") || save.parentElement;
      (parent?.parentElement || editor).appendChild(box);
    } else {
      editor.appendChild(box);
    }

    const input = box.querySelector("input[type=file]");
    const preview = box.querySelector("audio");
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    });
    return box;
  }

  function ensureEditorAudio() {
    if (!isVocabularyPage()) return;
    addStyles();
    const editor = findEditor();
    if (!editor) return;
    findOrCreateAudioBox(editor);
  }

  function addPlayButtons() {
    if (!isVocabularyPage()) return;
    document.querySelectorAll("[data-vocab-audio-url]").forEach(el => {
      if (el.dataset.audioReady === "1") return;
      el.dataset.audioReady = "1";
      const url = el.getAttribute("data-vocab-audio-url");
      if (!url) return;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "none";
      audio.src = url;
      audio.style.width = "100%";
      el.replaceWith(audio);
    });
  }

  async function loadAudioMap() {
    try {
      const res = await fetch("/api/vocabulary", { credentials: "same-origin" });
      if (!res.ok) return;
      const list = await res.json();
      const map = new Map(list.map(x => [String(x.id), x]));

      // If the current editor is in edit mode, infer its vocabulary id from the fields.
      const editor = findEditor();
      if (editor) {
        const fields = getFields(editor);
        const cv = fields.cantonese?.value?.trim() || "";
        const jp = fields.jyutping?.value?.trim() || "";
        const mn = fields.meaning?.value?.trim() || "";
        const match = list.find(x => x.cantonese === cv && x.jyutping === jp && x.meaning === mn);
        if (match) editor.dataset.vocabularyId = String(match.id);
      }

      // Existing cards don't have a guaranteed class, so locate likely Edit/Delete groups.
      for (const card of document.querySelectorAll("article, li, [class*=card], [class*=Card]")) {
        const buttons = [...card.querySelectorAll("button")];
        const edit = buttons.find(b => /Edit/i.test(b.textContent || ""));
        const del = buttons.find(b => /Delete/i.test(b.textContent || ""));
        if (!edit && !del) continue;

        const raw = card.dataset.id || card.getAttribute("data-id") || "";
        let item = raw ? map.get(String(raw)) : null;
        if (!item) {
          const txt = card.innerText || "";
          item = list.find(x => x.cantonese && txt.includes(x.cantonese));
        }
        if (!item || !item.audioUrl || card.querySelector("audio[data-vocabulary-audio]")) continue;

        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = item.audioUrl;
        audio.dataset.vocabularyAudio = "1";
        audio.style.width = "100%";
        audio.style.marginTop = "10px";
        (del?.parentElement || edit?.parentElement || card).appendChild(audio);
      }
    } catch (_) {}
  }

  async function saveVocabularyWithAudio(event) {
    const save = event.target.closest("button");
    if (!save || !/Save Vocabulary/i.test(save.textContent || "")) return;
    if (!isVocabularyPage()) return;

    const editor = findEditor();
    if (!editor) return;
    const input = editor.querySelector(`#${AUDIO_INPUT_ID}`);
    // Let the existing frontend handle ordinary saves/edits when no audio is selected.
    if (!input?.files?.[0]) return;

    const fields = getFields(editor);
    if (!fields.cantonese || !fields.meaning) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const fd = new FormData();
    fd.append("cantonese", fields.cantonese.value.trim());
    fd.append("jyutping", fields.jyutping?.value.trim() || "");
    fd.append("meaning", fields.meaning.value.trim());
    fd.append("example", fields.example?.value.trim() || "");

    if (input?.files?.[0]) fd.append("audio", input.files[0]);

    // Existing frontend edit mode normally exposes an id in a data attribute; boot() also
    // infers it from the current field values when possible.
    const id = editor.dataset.vocabularyId || editor.getAttribute("data-vocabulary-id") || "";
    const url = id ? `/api/vocabulary/${encodeURIComponent(id)}` : "/api/vocabulary";
    const method = id ? "PUT" : "POST";

    save.disabled = true;
    try {
      const res = await fetch(url, { method, body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save vocabulary.");
      window.location.reload();
    } catch (err) {
      save.disabled = false;
      alert(err.message || "Could not save vocabulary.");
    }
  }

  function boot() {
    ensureEditorAudio();
    addPlayButtons();
    loadAudioMap();
  }

  document.addEventListener("click", saveVocabularyWithAudio, true);
  new MutationObserver(() => boot()).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("load", () => setTimeout(boot, 300));
  setInterval(boot, 1500);
})();
