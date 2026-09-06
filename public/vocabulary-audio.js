(() => {
  "use strict";

  const STYLE_ID = "vocabulary-audio-style-832";
  const AUDIO_INPUT_ID = "vocabulary-audio-input-832";
  const AUDIO_PREVIEW_ID = "vocabulary-audio-preview-832";

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;"
    }[c]));
  }

  function isVocabularyPage() {
    // Admins have the editor, but students do not. The old check required
    // the admin-only Save Vocabulary button, so student audio never loaded.
    if (document.querySelector("#vocabulary")) return true;
    const text = document.body?.innerText || "";
    return /\bVocabulary\b/i.test(text);
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

  function vocabularyRoot() {
    return document.querySelector("#vocabulary") || document.body;
  }

  function addAudioToCard(card, item) {
    if (!card || !item?.audioUrl) return;
    if (card.querySelector("audio[data-vocabulary-audio]")) return;

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = item.audioUrl;
    audio.dataset.vocabularyAudio = "1";
    audio.setAttribute("aria-label", `Pronunciation audio for ${item.cantonese || "vocabulary word"}`);
    audio.style.width = "100%";
    audio.style.marginTop = "12px";

    // Put playback below the vocabulary meaning/example, before admin actions.
    const actionButton = [...card.querySelectorAll("button")].find(b => /Edit|Delete/i.test(b.textContent || ""));
    if (actionButton?.parentElement) {
      actionButton.parentElement.before(audio);
    } else {
      card.appendChild(audio);
    }
  }

  function addPlayButtonsFromData(list) {
    if (!isVocabularyPage()) return;
    const root = vocabularyRoot();
    const items = (list || []).filter(x => x && x.audioUrl);
    if (!items.length) return;

    // Prefer actual vocabulary cards, but support the existing markup too.
    const candidates = [...root.querySelectorAll("article, li, [class*=card], [class*=Card], .vocab-item, .vocabulary-item")];
    const seen = new Set();

    for (const card of candidates) {
      if (!card || seen.has(card)) continue;
      const text = card.innerText || "";
      const item = items.find(x => x.cantonese && text.includes(x.cantonese));
      if (!item) continue;
      seen.add(card);
      addAudioToCard(card, item);
    }

    // Fallback: if cards don't have useful classes, locate the Cantonese word
    // text and attach the player to its nearest block container.
    for (const item of items) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if ((node.nodeValue || "").trim() !== item.cantonese) continue;
        const el = node.parentElement;
        const card = el?.closest("article, li, div") || el;
        if (card) addAudioToCard(card, item);
        break;
      }
    }
  }

  async function loadAudioMap() {
    if (!isVocabularyPage()) return;
    try {
      const res = await fetch("/api/vocabulary", { credentials: "same-origin" });
      if (!res.ok) return;
      const list = await res.json();
      const map = new Map(list.map(x => [String(x.id), x]));

      // Admin edit mode: infer the vocabulary id from the visible fields.
      const editor = findEditor();
      if (editor) {
        const fields = getFields(editor);
        const cv = fields.cantonese?.value?.trim() || "";
        const jp = fields.jyutping?.value?.trim() || "";
        const mn = fields.meaning?.value?.trim() || "";
        const match = list.find(x => x.cantonese === cv && x.jyutping === jp && x.meaning === mn);
        if (match) editor.dataset.vocabularyId = String(match.id);
      }

      addPlayButtonsFromData(list);
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
