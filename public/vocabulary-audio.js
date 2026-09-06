(() => {
  "use strict";

  const STYLE_ID = "vocabulary-audio-style-833";
  const AUDIO_INPUT_ID = "vocabulary-audio-input-833";
  const AUDIO_PREVIEW_ID = "vocabulary-audio-preview-833";

  function isVocabularyPage() {
    return !!document.querySelector("#vocabulary") || /\bVocabulary\b/i.test(document.body?.innerText || "");
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
      .vocab-audio-player{display:block;width:100%;margin-top:12px}
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
      if (["hidden", "file", "search"].includes(el.type)) return false;
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

  function ensureEditorAudio() {
    if (!isVocabularyPage()) return;
    const editor = findEditor();
    if (!editor || editor.querySelector("." + AUDIO_INPUT_ID)) return;
    addStyles();

    const box = document.createElement("div");
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
    const target = save?.closest("div")?.parentElement || editor;
    target.appendChild(box);

    const input = box.querySelector("input[type=file]");
    const preview = box.querySelector("audio");
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    });
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
    audio.className = "vocab-audio-player";

    const actions = [...card.querySelectorAll("button")].find(b => /^(Edit|Delete)$/i.test((b.textContent || "").trim()));
    if (actions?.parentElement) actions.parentElement.before(audio);
    else card.appendChild(audio);
  }

  function addPlayButtonsFromData(list) {
    if (!isVocabularyPage()) return;
    const root = document.querySelector("#vocabList");
    if (!root) return;
    const items = (list || []).filter(x => x && x.audioUrl && x.cantonese);
    if (!items.length) return;

    // The app renders vocabulary entries directly inside #vocabList. Matching only
    // those direct children avoids accidentally attaching the player to the whole page.
    const cards = [...root.children];
    for (const card of cards) {
      const text = card.textContent || "";
      const item = items.find(x => text.includes(x.cantonese));
      if (item) addAudioToCard(card, item);
    }

    // Fallback for a nested renderer: find the word text inside #vocabList and use
    // the nearest direct child as the card.
    for (const item of items) {
      if ([...root.children].some(card => card.querySelector("audio[data-vocabulary-audio]") && (card.textContent || "").includes(item.cantonese))) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if ((node.nodeValue || "").trim() !== item.cantonese) continue;
        let card = node.parentElement;
        while (card && card.parentElement !== root) card = card.parentElement;
        if (card) addAudioToCard(card, item);
        break;
      }
    }
  }

  async function getVocabulary() {
    const res = await fetch("/api/vocabulary", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error(`Vocabulary request failed (${res.status})`);
    return await res.json();
  }

  async function loadAudioMap() {
    if (!isVocabularyPage()) return;
    try {
      const list = await getVocabulary();
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
    } catch (err) {
      console.warn("Vocabulary audio: could not load audio map", err);
    }
  }

  async function saveVocabularyWithAudio(event) {
    const save = event.target.closest("button");
    if (!save || !/Save Vocabulary/i.test(save.textContent || "")) return;
    if (!isVocabularyPage()) return;

    const editor = findEditor();
    const input = editor?.querySelector(`#${AUDIO_INPUT_ID}`);
    if (!editor || !input?.files?.[0]) return;

    const fields = getFields(editor);
    if (!fields.cantonese || !fields.meaning) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    let id = editor.dataset.vocabularyId || editor.getAttribute("data-vocabulary-id") || "";
    try {
      // Resolve edit mode reliably even if the page was refreshed before the helper
      // finished loading the vocabulary list.
      if (!id) {
        const list = await getVocabulary();
        const match = list.find(x =>
          x.cantonese === fields.cantonese.value.trim() &&
          x.jyutping === (fields.jyutping?.value.trim() || "") &&
          x.meaning === fields.meaning.value.trim()
        );
        if (match) id = String(match.id);
      }

      const fd = new FormData();
      fd.append("cantonese", fields.cantonese.value.trim());
      fd.append("jyutping", fields.jyutping?.value.trim() || "");
      fd.append("meaning", fields.meaning.value.trim());
      fd.append("example", fields.example?.value.trim() || "");
      fd.append("audio", input.files[0]);

      const url = id ? `/api/vocabulary/${encodeURIComponent(id)}` : "/api/vocabulary";
      const method = id ? "PUT" : "POST";
      save.disabled = true;

      const res = await fetch(url, { method, body: fd, credentials: "same-origin", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.detail || "Could not save vocabulary.");
      window.location.reload();
    } catch (err) {
      save.disabled = false;
      alert(err.message || "Could not save vocabulary.");
    }
  }

  function boot() {
    ensureEditorAudio();
    loadAudioMap();
  }

  document.addEventListener("click", saveVocabularyWithAudio, true);
  new MutationObserver(() => boot()).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("load", () => setTimeout(boot, 300));
  setInterval(boot, 2000);
})();
