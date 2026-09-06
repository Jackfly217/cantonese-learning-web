(() => {
  "use strict";

  const STYLE_ID = "vocabulary-audio-style-835";
  const BOX_ID = "vocabulary-audio-box-835";
  const AUDIO_INPUT_ID = "vocabulary-audio-input-835";
  const AUDIO_PREVIEW_ID = "vocabulary-audio-preview-835";

  let vocabularyCache = null;
  let vocabularyLoadPromise = null;

  function isVocabularyPage() {
    return !!document.querySelector("#vocabulary") || !!document.querySelector("#vocabList");
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
      cantonese: document.getElementById("vocabCantonese") || editor?.querySelector('input[placeholder="你好"]'),
      jyutping: document.getElementById("vocabJyutping") || editor?.querySelector('input[placeholder="nei5 hou2"]'),
      meaning: document.getElementById("vocabMeaning") || editor?.querySelector('input[placeholder="မင်္ဂလာပါ"]'),
      example: document.getElementById("vocabExample") || editor?.querySelector("textarea")
    };
  }

  function ensureEditorAudio() {
    if (!isVocabularyPage()) return;
    const editor = findEditor();
    if (!editor) return;

    // IMPORTANT: use an element id / data marker, not a CSS class selector.
    // This prevents the MutationObserver from adding the audio box forever.
    if (editor.querySelector(`#${BOX_ID}`) || editor.querySelector(`[data-vocab-audio-box="1"]`)) return;

    addStyles();

    const box = document.createElement("div");
    box.id = BOX_ID;
    box.dataset.vocabAudioBox = "1";
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
      if (preview.src && preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
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

    const cards = [...root.children];
    for (const card of cards) {
      const text = card.textContent || "";
      const item = items.find(x => text.includes(x.cantonese));
      if (item) addAudioToCard(card, item);
    }

    // Fallback for nested card renderers.
    for (const item of items) {
      const already = [...root.querySelectorAll("audio[data-vocabulary-audio]")].some(audio =>
        (audio.closest("* > *")?.textContent || "").includes(item.cantonese)
      );
      if (already) continue;
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
    if (vocabularyCache) return vocabularyCache;
    if (vocabularyLoadPromise) return vocabularyLoadPromise;

    vocabularyLoadPromise = fetch("/api/vocabulary", {
      credentials: "same-origin",
      cache: "no-store"
    })
      .then(res => {
        if (!res.ok) throw new Error(`Vocabulary request failed (${res.status})`);
        return res.json();
      })
      .then(list => {
        vocabularyCache = Array.isArray(list) ? list : [];
        return vocabularyCache;
      })
      .finally(() => {
        vocabularyLoadPromise = null;
      });

    return vocabularyLoadPromise;
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
    const save = event.target?.closest?.("button");
    if (!save || !/Save Vocabulary/i.test(save.textContent || "")) return;
    if (!isVocabularyPage()) return;

    const editor = findEditor();
    const input = document.getElementById(AUDIO_INPUT_ID);
    const file = input?.files?.[0];
    if (!editor || !file) return; // Let the normal JSON save handler run when no audio is selected.

    // This handler runs in capture phase. Stop the original onclick handler so it
    // cannot submit JSON and complain about missing fields while the audio upload
    // is being handled here.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const fields = getFields(editor);
    const cantonese = fields.cantonese?.value?.trim() || "";
    const jyutping = fields.jyutping?.value?.trim() || "";
    const meaning = fields.meaning?.value?.trim() || "";
    const example = fields.example?.value?.trim() || "";

    if (!cantonese || !meaning) {
      alert("Cantonese and Myanmar meaning are required.");
      return;
    }

    let id = editor.dataset.vocabularyId || editor.getAttribute("data-vocabulary-id") || "";
    try {
      // For an edit, identify the existing row from the current field values.
      if (!id) {
        const list = await getVocabulary();
        const match = list.find(x =>
          x.cantonese === cantonese &&
          x.jyutping === jyutping &&
          x.meaning === meaning
        );
        if (match) id = String(match.id);
      }

      const fd = new FormData();
      fd.append("cantonese", cantonese);
      fd.append("jyutping", jyutping);
      fd.append("meaning", meaning);
      fd.append("example", example);
      fd.append("audio", file);

      const url = id ? `/api/vocabulary/${encodeURIComponent(id)}` : "/api/vocabulary";
      const method = id ? "PUT" : "POST";
      save.disabled = true;
      const oldText = save.textContent;
      save.textContent = "Saving…";

      const res = await fetch(url, {
        method,
        body: fd,
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.detail || "Could not save vocabulary.");

      window.location.reload();
    } catch (err) {
      save.disabled = false;
      save.textContent = "Save Vocabulary";
      alert(err.message || "Could not save vocabulary.");
    }
  }

  function boot() {
    ensureEditorAudio();
    if (vocabularyCache) addPlayButtonsFromData(vocabularyCache);
    else loadAudioMap();
  }

  document.addEventListener("click", saveVocabularyWithAudio, true);

  // Debounced observer: react to SPA rendering without repeatedly fetching the API.
  let observerTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(boot, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("load", () => setTimeout(boot, 300));
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-section="vocabulary"], [data-page="vocabulary"], #vocabulary')) {
      setTimeout(boot, 100);
    }
  });
})();
