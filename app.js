/* global JSZip, JSON5, tinymce */

// ===== Configuration =====
const APP_CONFIG = {
  // TinyMCE license key: use 'gpl' for GPL usage, or replace with your commercial key
  tinymceLicenseKey: 'gpl'
};


// Local-first: if vendors are missing, show a banner and optionally load from CDN.
const els = {
  zipInput: document.getElementById("zipInput"),
  status: document.getElementById("status"),
  scormVersion: document.getElementById("scormVersion"),
  manifestPath: document.getElementById("manifestPath"),
  dataJsPath: document.getElementById("dataJsPath"),

  vendorBanner: document.getElementById("vendorBanner"),
  missingVendors: document.getElementById("missingVendors"),
  loadCdnBtn: document.getElementById("loadCdnBtn"),

  blockList: document.getElementById("blockList"),
  addBlockTypeSelect: document.getElementById("addBlockTypeSelect"),
  moveUpBtn: document.getElementById("moveUpBtn"),
  moveDownBtn: document.getElementById("moveDownBtn"),
  searchInput: document.getElementById("searchInput"),
  typeFilter: document.getElementById("typeFilter"),
  listDisplayMode: document.getElementById("listDisplayMode"),
  cleanViewToggle: document.getElementById("cleanViewToggle"),
  modifiedOnlyToggle: document.getElementById("modifiedOnlyToggle"),

  blockId: document.getElementById("blockId"),
  blockType: document.getElementById("blockType"),

  tabWysiwyg: document.getElementById("tabWysiwyg"),
  tabRaw: document.getElementById("tabRaw"),
  tabDiff: document.getElementById("tabDiff"),
  panelWysiwyg: document.getElementById("panelWysiwyg"),
  panelRaw: document.getElementById("panelRaw"),
  panelDiff: document.getElementById("panelDiff"),

  blockText: document.getElementById("blockText"),
  blockTextRaw: document.getElementById("blockTextRaw"),

  addChoiceBtn: document.getElementById("addChoiceBtn"),
  renumberChoicesBtn: document.getElementById("renumberChoicesBtn"),
  choicesEditor: document.getElementById("choicesEditor"),
  choicesHint: document.getElementById("choicesHint"),
  validationBox: document.getElementById("validationBox"),

  diffBlock: document.getElementById("diffBlock"),
  diffChoices: document.getElementById("diffChoices"),

  applyBtn: document.getElementById("applyBtn"),
  revertBtn: document.getElementById("revertBtn"),
  saveZipBtn: document.getElementById("saveZipBtn"),
  saveAsBtn: document.getElementById("saveAsBtn"),

  previewFrame: document.getElementById("previewFrame")
};

const state = {
  zip: null,
  zipName: null,
  manifestPath: null,
  scorm: null,
  dataJsPath: null,
  keyword: "const",
  varName: "surveyData",
  surveyData: [],
  selectedIndex: -1,
  selectedUid: null,
  uidCounter: 1,
  dragUid: null,
  assetByObjectUrl: new Map(),
  assetSeq: 1,
  filteredIndexes: [],
  activeTab: "wysiwyg",
  cleanView: Boolean(els.cleanViewToggle?.checked),
  original: { text: "", choices: {} },
  tinymceReady: false,
  baseline: []
};

// ===== Helpers =====
const MOD_TRI_SVG = `<svg class=\"mod-tri\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\" xmlns=\"http://www.w3.org/2000/svg\"><path fill=\"currentColor\" d=\"M12 4l10 18H2L12 4z\"/></svg>`;

function setStatus(text) {
  els.status.textContent = text;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSpaces(str) {
  return String(str).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}



function ensureUid(item) {
  if (!item) return null;
  if (!item.__uid) {
    item.__uid = `uid_${state.uidCounter}`;
    state.uidCounter += 1;
  }
  return item.__uid;
}

function snapshotItem(item) {
  return {
    text: String(item?.text ?? ''),
    selector: String(item?.selector ?? ''),
    choices: (item?.choices && typeof item.choices === 'object' && !Array.isArray(item.choices))
      ? Object.keys(item.choices).sort((a, b) => Number(a) - Number(b)).map((k) => ({
        k,
        d: String(item.choices[k]?.Display ?? '')
      }))
      : []
  };
}


function safeFileName(name) {
  const base = String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_');
  return base.length ? base : 'file';
}

function registerAsset(file) {
  const safe = safeFileName(file.name);
  const ext = safe.includes('.') ? safe.split('.').pop() : '';
  const stamp = Date.now();
  const seq = state.assetSeq;
  state.assetSeq += 1;
  const outName = `${stamp}-${seq}-${safe}`;
  const relPath = `assets/${outName}`;

  const objUrl = URL.createObjectURL(file);
  state.assetByObjectUrl.set(objUrl, { file, relPath, mime: file.type || 'application/octet-stream' });
  return { objUrl, relPath };
}

function rewriteObjectUrlsToRelative(html) {
  // Replace any object URLs we registered with their final relative paths
  let out = String(html || '');
  state.assetByObjectUrl.forEach((meta, objUrl) => {
    // Replace src/href occurrences
    out = out.split(objUrl).join(meta.relPath);
  });
  return out;
}
function isItemModifiedByIndex(idx) {
  const cur = state.surveyData[idx];
  if (!cur) return false;
  const base = state.baselineByUid?.get(cur.__uid);
  if (!base) return true; // new blocks

  const now = snapshotItem(cur);
  if (base.text !== now.text) return true;
  if (base.choices.length !== now.choices.length) return true;
  for (let i = 0; i < base.choices.length; i += 1) {
    if (base.choices[i].k !== now.choices[i].k) return true;
    if (base.choices[i].d !== now.choices[i].d) return true;
  }
  return false;
}


// Updated per your request: ASCII-safe, robust empty-content patterns.
// Note: This matches real innerHTML (not HTML-escaped source).
const emptyPatterns = [
  /^(?:&nbsp;|&#160;|<br\/?>(?:<br\/?><br\/?0?>)*)+$/i,
  /^(?:<br\/?>(?:<br\/?0?>)*)+$/i
];

function nodeHasMeaningfulContent(el) {
  if (!el) return false;
  if (el.querySelector && el.querySelector("img,table,video,audio,svg")) return true;
  return normalizeSpaces(el.textContent || "").length > 0;
}

function isVisuallyEmptyElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (nodeHasMeaningfulContent(el)) return false;

  const html = (el.innerHTML || "").toLowerCase().replace(/\s+/g, "");
  if (emptyPatterns.some((re) => re.test(html))) return true;
  return normalizeSpaces(el.textContent || "") === "";
}

function cleanHtmlForDisplay(html) {
  const container = document.createElement("div");
  container.innerHTML = html || "";

  // Remove leading empty nodes
  let changed = true;
  while (changed) {
    changed = false;

    while (container.firstChild && container.firstChild.nodeType === Node.TEXT_NODE) {
      if (normalizeSpaces(container.firstChild.nodeValue || "") === "") {
        container.removeChild(container.firstChild);
        changed = true;
      } else {
        break;
      }
    }

    const firstEl = container.firstElementChild;
    if (firstEl && isVisuallyEmptyElement(firstEl)) {
      firstEl.remove();
      changed = true;
    }
  }

  // Collapse repeated empties near top only
  const kids = Array.from(container.children).slice(0, 12);
  let emptyRun = 0;
  kids.forEach((el) => {
    if (isVisuallyEmptyElement(el)) {
      emptyRun += 1;
      if (emptyRun >= 2) el.remove();
    } else {
      emptyRun = 0;
    }
  });

  return container.innerHTML;
}

function getDisplayHtml(html) {
  return state.cleanView ? cleanHtmlForDisplay(html || "") : (html || "");
}

function isMeaningfulText(str, minLen = 2) {
  const t = normalizeSpaces(str);
  if (t.length < minLen) return false;
  // ASCII-safe: skip lone punctuation marks and bars
  if (/^[-|.]+$/.test(t)) return false;
  return true;
}

function getFirstMeaningfulLineFromHtml(html) {
  const container = document.createElement("div");
  container.innerHTML = html || "";

  // Heading-first
  const heading = container.querySelector("h1,h2,h3,h4,h5,h6");
  if (heading) {
    const t = normalizeSpaces(heading.textContent || "");
    if (isMeaningfulText(t)) return t;
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const blockTags = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TD", "TH"]);

  let line = "";
  let started = false;

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName;
      if (tag === "BR") {
        if (started && isMeaningfulText(line)) break;
        continue;
      }
      if (blockTags.has(tag) && started && isMeaningfulText(line)) break;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const t = normalizeSpaces(node.nodeValue || "");
      if (!isMeaningfulText(t)) continue;
      started = true;
      line = line ? `${line} ${t}` : t;
      if (line.length >= 120) break;
    }
  }

  if (!isMeaningfulText(line)) {
    const plain = normalizeSpaces(container.textContent || "");
    if (!plain) return "";
    return plain.split(/[.!?]\s+/)[0] || plain;
  }

  return line;
}

function getSnippetFromHtml(html, maxLen = 70) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  const txt = normalizeSpaces(div.textContent || "");
  if (txt.length <= maxLen) return txt;
  return `${txt.slice(0, maxLen).trim()}…`;
}

// ===== SCORM detection =====
async function detectScorm(zip) {
  const manifests = Object.keys(zip.files).filter((p) => p.toLowerCase().endsWith("imsmanifest.xml"));
  if (manifests.length === 0) return { version: "unknown", details: "No imsmanifest.xml found", path: null };

  manifests.sort((a, b) => a.length - b.length);
  const path = manifests[0];
  const xmlText = await zip.file(path).async("string");

  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { version: "unknown", details: "imsmanifest.xml parse error", path };
  }

  const xml = xmlText.toLowerCase();
  const is2004 = xml.includes("imsss:") || xml.includes("adlseq:") || xml.includes("adlnav:");
  const is12 = xml.includes("adlcp:scormtype") && !is2004;

  if (is2004) return { version: "2004", details: "Sequencing namespaces detected", path };
  if (is12) return { version: "1.2", details: "adlcp:scormtype detected", path };

  const sv = doc.getElementsByTagName("schemaversion")[0]?.textContent?.trim();
  if (sv && sv.includes("2004")) return { version: "2004", details: `schemaversion=${sv}`, path };
  if (sv && sv.includes("1.2")) return { version: "1.2", details: `schemaversion=${sv}`, path };

  return { version: "unknown", details: "Could not confidently detect", path };
}

// ===== data.js parsing =====
function extractSurveyDataFromJs(jsText) {
  const text = jsText.replace(/^\uFEFF/, "");
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");

  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    throw new Error("Could not locate an array literal in data.js.");
  }

  const preamble = text.slice(0, firstBracket);
  const arrayText = text.slice(firstBracket, lastBracket + 1);

  const m = preamble.match(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/m);
  const keyword = m ? m[1] : "const";
  const varName = m ? m[2] : "surveyData";

  let arr;
  try {
    arr = JSON.parse(arrayText);
  } catch {
    arr = JSON5.parse(arrayText);
  }

  if (!Array.isArray(arr)) {
    throw new Error("data.js array did not parse into an Array.");
  }

  return { arr, keyword, varName };
}

// ===== Tabs =====
function setActiveTab(tab) {
  state.activeTab = tab;

  const isW = tab === "wysiwyg";
  const isR = tab === "raw";
  const isD = tab === "diff";

  els.tabWysiwyg.setAttribute("aria-selected", isW ? "true" : "false");
  els.tabRaw.setAttribute("aria-selected", isR ? "true" : "false");
  els.tabDiff.setAttribute("aria-selected", isD ? "true" : "false");

  els.panelWysiwyg.classList.toggle("hidden", !isW);
  els.panelRaw.classList.toggle("hidden", !isR);
  els.panelDiff.classList.toggle("hidden", !isD);

  if (state.selectedIndex >= 0) {
    syncEditors(tab);
    if (isD) renderDiff();
  }
}

function bindTabs() {
  els.tabWysiwyg.addEventListener("click", () => setActiveTab("wysiwyg"));
  els.tabRaw.addEventListener("click", () => setActiveTab("raw"));
  els.tabDiff.addEventListener("click", () => setActiveTab("diff"));
}

// ===== WYSIWYG (block text only) =====
function destroyTinymce() {
  try {
    if (window.tinymce && tinymce.get("blockText")) {
      tinymce.get("blockText").remove();
    }
  } catch {
    // ignore
  }
}

async function initBlockEditor() {
  destroyTinymce();

  if (!window.tinymce) {
    state.tinymceReady = false;
    return;
  }

  await tinymce.init({
    selector: "#blockText",
    license_key: APP_CONFIG.tinymceLicenseKey,
    menubar: false,
    branding: false,
    plugins: "link lists code table image media",
    toolbar: "undo redo | bold italic underline | bullist numlist | link | table | removeformat | code | image media",
    height: 360,
    valid_elements: "*[*]",
    file_picker_types: 'image media',
    images_upload_handler: (blobInfo) => new Promise((resolve) => {
      const blob = blobInfo.blob();
      const file = new File([blob], blobInfo.filename(), { type: blob.type || 'image/png' });
      const reg = registerAsset(file);
      resolve(reg.objUrl);
    }),
    file_picker_callback: (callback, _value, meta) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = meta.filetype === 'image' ? 'image/*' : 'video/*,audio/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reg = registerAsset(file);
        callback(reg.objUrl, { title: file.name });
      };
      input.click();
    }
  });

  state.tinymceReady = true;

  tinymce.get("blockText").on("input change keyup", () => {
    if (state.activeTab === "diff") renderDiff();
    renderList();
  });
  ensureSelectionVisible();
}

function getCurrentBlockHtml() {
  if (state.activeTab === "raw") return els.blockTextRaw.value;
  if (state.tinymceReady && tinymce.get("blockText")) return tinymce.get("blockText").getContent();
  return els.blockText.value;
}

function setBlockHtml(html) {
  els.blockText.value = html || "";
  els.blockTextRaw.value = html || "";
  if (state.tinymceReady && tinymce.get("blockText")) {
    tinymce.get("blockText").setContent(html || "");
  }
}

// ===== Choices editing (plain inputs) =====
function isChoiceQuestion(item) {
  // Qualtrics: MC + selector SAVR (single) or MAVR (multi). We'll allow for any MC with object choices.
  return item && item.type === "MC";
}

function getDisplayType(item) {
  if (!item) return '';
  if (item.type === 'MC' && String(item.selector || '').toUpperCase() === 'MAVR') return 'MS';
  return item.type || '';
}


function normalizeChoices(item) {
  if (!item) return;
  // Some exports may have choices as [] or null
  if (!item.choices || Array.isArray(item.choices)) item.choices = {};
}

function sortedChoiceKeys(choices) {
  return Object.keys(choices || {}).sort((a, b) => Number(a) - Number(b));
}

function nextChoiceKey(choices) {
  const keys = sortedChoiceKeys(choices);
  if (!keys.length) return "1";
  const maxK = Math.max(...keys.map((k) => Number(k) || 0));
  return String(maxK + 1);
}

function readChoiceInputs() {
  const item = state.surveyData[state.selectedIndex];
  if (!item) return;
  if (!isChoiceQuestion(item)) return;
  normalizeChoices(item);

  const inputs = els.choicesEditor.querySelectorAll("input[data-choice-key]");
  inputs.forEach((inp) => {
    const k = inp.getAttribute("data-choice-key");
    if (!item.choices[k]) item.choices[k] = {};
    item.choices[k].Display = inp.value;
  });
}

function renderChoices(item) {
  els.choicesEditor.innerHTML = "";
  els.choicesHint.textContent = "";
  els.addChoiceBtn.disabled = true;
  els.renumberChoicesBtn.disabled = true;

  if (!item || !isChoiceQuestion(item)) {
    els.choicesHint.textContent = "Choices are available for MC items. Select an MC block to edit choices.";
    return;
  }

  normalizeChoices(item);
  const keys = sortedChoiceKeys(item.choices);

  els.addChoiceBtn.disabled = false;
  els.renumberChoicesBtn.disabled = keys.length < 2;

  if (!keys.length) {
    els.choicesHint.textContent = "No choices yet. Click Add choice.";
  }

  keys.forEach((k) => {
    const row = document.createElement("div");
    row.className = "choice-row";

    const keyEl = document.createElement("div");
    keyEl.className = "choice-key";
    keyEl.textContent = `Choice ${k}`;

    const input = document.createElement("input");
    input.className = "choice-input";
    input.type = "text";
    input.value = item.choices[k]?.Display ?? "";
    input.setAttribute("data-choice-key", k);
    input.addEventListener("input", () => {
      // live update model
      if (!item.choices[k]) item.choices[k] = {};
      item.choices[k].Display = input.value;
      if (state.activeTab === "diff") renderDiff();
    renderList();
    });

    const del = document.createElement("button");
    del.className = "icon-btn";
    del.type = "button";
    del.title = "Remove choice";
    del.textContent = "✕";
    del.addEventListener("click", () => {
      delete item.choices[k];
      renderChoices(item);
      if (state.activeTab === "diff") renderDiff();
    renderList();
    });

    row.appendChild(keyEl);
    row.appendChild(input);
    row.appendChild(del);
    els.choicesEditor.appendChild(row);
  });
}

function renumberChoices(item) {
  normalizeChoices(item);
  const keys = sortedChoiceKeys(item.choices);
  const values = keys.map((k) => ({ Display: item.choices[k]?.Display ?? "" }));
  item.choices = {};
  values.forEach((v, i) => {
    item.choices[String(i + 1)] = { Display: v.Display };
  });
}

function validateItem(item) {
  const errors = [];
  const warnings = [];

  if (isChoiceQuestion(item)) {
    normalizeChoices(item);
    const keys = sortedChoiceKeys(item.choices);

    if (keys.length < 1) errors.push("At least one choice is required.");

    const seen = new Map();
    keys.forEach((k) => {
      const val = String(item.choices[k]?.Display ?? "");
      if (!val.trim()) errors.push(`Choice ${k} is empty.`);
      const norm = val.trim().toLowerCase();
      if (norm) {
        if (seen.has(norm)) warnings.push(`Duplicate choice text: "${val.trim()}" (choices ${seen.get(norm)} and ${k})`);
        else seen.set(norm, k);
      }
    });
  }

  return { errors, warnings };
}

function showValidation({ errors, warnings }) {
  if ((!errors || !errors.length) && (!warnings || !warnings.length)) {
    els.validationBox.classList.add("hidden");
    els.validationBox.innerHTML = "";
    return;
  }

  const html = [];
  if (errors.length) {
    html.push(`<div class="err">Errors</div>`);
    html.push("<ul>" + errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("") + "</ul>");
  }
  if (warnings.length) {
    html.push(`<div class="warn">Warnings</div>`);
    html.push("<ul>" + warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("") + "</ul>");
  }

  els.validationBox.innerHTML = html.join("");
  els.validationBox.classList.remove("hidden");
}

// ===== List rendering =====
function getFilteredIndexes() {
  const q = (els.searchInput.value || "").trim().toLowerCase();
  const type = els.typeFilter.value;
  const modifiedOnly = Boolean(els.modifiedOnlyToggle?.checked);

  const result = [];
  state.surveyData.forEach((item, idx) => {
    if (type) {
      const dt = getDisplayType(item);
      if (type !== dt) return;
    }
    if (modifiedOnly && !isItemModified(item)) return;
    if (modifiedOnly && !isItemModifiedByIndex(idx)) return;
    if (!q) {
      result.push(idx);
      return;
    }
    const hay = `${item.id || ""} ${item.type || ""} ${item.text || ""}`.toLowerCase();
    if (hay.includes(q)) result.push(idx);
  });
  return result;
}

function renderList() {
  state.filteredIndexes = getFilteredIndexes();
  els.blockList.innerHTML = "";

  const mode = els.listDisplayMode.value || "firstLine";

  state.filteredIndexes.forEach((idx) => {
    const item = state.surveyData[idx];
    ensureUid(item);
    const row = document.createElement('div');
    row.className = 'list-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'list-item-btn';

    // ---- Label + snippet (restored) ----
    const typeLabel = (typeof getDisplayType === 'function')
      ? (getDisplayType(item) || '?')
      : (item.type || '?');

    const label = `${item.id || `#${idx + 1}`}  ·  ${typeLabel}`;

    const modified = (typeof isItemModifiedByIndex === 'function' && isItemModifiedByIndex(idx))
      ? (typeof MOD_TRI_SVG !== 'undefined' ? MOD_TRI_SVG : '')
      : '';

    const displayHtml = (typeof getDisplayHtml === 'function')
      ? getDisplayHtml(item.text)
      : (item.text || '');

    const previewText = (mode === 'snippet')
      ? (typeof getSnippetFromHtml === 'function' ? getSnippetFromHtml(displayHtml, 70) : '')
      : (typeof getFirstMeaningfulLineFromHtml === 'function' ? getFirstMeaningfulLineFromHtml(displayHtml) : '');

    btn.innerHTML =
      `<strong>${escapeHtml(label)} ${modified}</strong>` +
      `<br><span class="badge">${escapeHtml(previewText)}</span>`;

    btn.setAttribute(
      'aria-current',
      (state.selectedUid && item.__uid === state.selectedUid) ? 'true' : 'false'
    );

    btn.addEventListener('click', () => selectItem(idx));


    // Drag/drop reorder
    btn.draggable = true;
    btn.classList.add('draggable-item');
    btn.addEventListener('dragstart', (ev) => {
      state.dragUid = item.__uid;
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', item.__uid); } catch {}
      btn.classList.add('dragging');
    });

    btn.addEventListener('dragend', () => {
      state.dragUid = null;
      btn.classList.remove('dragging');
      document.querySelectorAll('.drop-above, .drop-below').forEach((el) => {
        el.classList.remove('drop-above');
        el.classList.remove('drop-below');
      });
    });

    btn.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      const rect = btn.getBoundingClientRect();
      const placeAfter = (ev.clientY - rect.top) > rect.height / 2;
      btn.classList.toggle('drop-above', !placeAfter);
      btn.classList.toggle('drop-below', placeAfter);
      ev.dataTransfer.dropEffect = 'move';
    });

    btn.addEventListener('dragleave', () => {
      btn.classList.remove('drop-above');
      btn.classList.remove('drop-below');
    });

    btn.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const dragUid = state.dragUid || ev.dataTransfer.getData('text/plain');
      const targetUid = item.__uid;
      const rect = btn.getBoundingClientRect();
      const placeAfter = (ev.clientY - rect.top) > rect.height / 2;
      btn.classList.remove('drop-above');
      btn.classList.remove('drop-below');
      if (!dragUid || !targetUid || dragUid === targetUid) return;
      moveBlockByUid(dragUid, targetUid, placeAfter);
    });

    // Trash button
    const trash = document.createElement('button');
    trash.type = 'button';
    trash.className = 'icon-btn trash';
    trash.title = 'Remove block';
    trash.innerHTML = '&#128465;';
    trash.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (state.selectedIndex < 0) return;
      // compute current index by uid (in case of filtering)
      const idxNow = indexByUid(item.__uid);
      if (idxNow < 0) return;
      if (!window.confirm('Remove this block?')) return;
      removeBlockAt(idxNow);
      updateBlockActionButtons();
    });

    row.appendChild(btn);
    row.appendChild(trash);

    els.blockList.appendChild(row);
  });
}

function ensureSelectionVisible() {
  const modifiedOnly = Boolean(els.modifiedOnlyToggle?.checked);
  if (!modifiedOnly) return;
  if (state.selectedIndex < 0) {
    if (state.filteredIndexes.length) selectItem(state.filteredIndexes[0]);
    return;
  }
  if (!state.filteredIndexes.includes(state.selectedIndex)) {
    if (state.filteredIndexes.length) selectItem(state.filteredIndexes[0]);
    else {
      state.selectedIndex = -1;
      state.selectedUid = null;
      renderList();
      setStatus('No modified blocks.');
    }
  }
}


// ===== Preview =====
function renderPreview(item) {
  const choices = item?.choices && typeof item.choices === "object" && !Array.isArray(item.choices)
    ? item.choices
    : null;

  const selector = String(item?.selector ?? '').toUpperCase();
  const isMulti = selector === 'MAVR';
  const inputType = isMulti ? 'checkbox' : 'radio';
  const groupName = `preview-${String(item?.id ?? 'choice').replace(/\s+/g, '-')}`;

  const isChoice = item?.type === 'MC' && choices;
  const isTextEntry = item?.type === 'TE';

  const choiceHtml = isChoice
    ? sortedChoiceKeys(choices)
      .map((k) => {
        const label = escapeHtml(String(choices[k]?.Display ?? ""));
        return `<label style="display:block;margin:6px 0;line-height:1.35;">
  <input type="${inputType}" name="${groupName}" style="margin-right:8px;">${label}
</label>`;
      })
      .join("")
    : "";

  const teHtml = isTextEntry
    ? `<div style="margin-top:16px;">
        <label style="display:block;margin-bottom:6px;font-weight:600;">Answer</label>
        <input type="text" style="width:100%;padding:10px;border:1px solid #d0d5dd;border-radius:8px;" />
      </div>`
    : "";

  const doc = `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="background:#ffffff;color:#000000;font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 16px;">
  <article>${getDisplayHtml(item.text)}</article>
  ${choiceHtml ? `<form style="margin-top:16px;">${choiceHtml}</form>` : ""}
  ${teHtml}
</body>
</html>`;

  const blob = new Blob([doc], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  els.previewFrame.src = url;
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}


// ===== Diff =====
function tokenizeWords(str) {
  return String(str).split(/(\s+)/).filter((t) => t.length > 0);
}

function lcsDiff(aTokens, bTokens) {
  const n = aTokens.length;
  const m = bTokens.length;

  // guard for very large HTML
  if (n * m > 2_000_000) {
    return [{ type: "eq", text: "(Diff too large to compute efficiently. Use Raw HTML for manual comparison.)\n\n" }];
  }

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] = aTokens[i - 1] === bTokens[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const out = [];
  let i = n;
  let j = m;

  while (i > 0 && j > 0) {
    if (aTokens[i - 1] === bTokens[j - 1]) {
      out.push({ type: "eq", text: aTokens[i - 1] });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.push({ type: "del", text: aTokens[i - 1] });
      i -= 1;
    } else {
      out.push({ type: "ins", text: bTokens[j - 1] });
      j -= 1;
    }
  }

  while (i > 0) {
    out.push({ type: "del", text: aTokens[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    out.push({ type: "ins", text: bTokens[j - 1] });
    j -= 1;
  }

  out.reverse();
  return out;
}

function renderDiffHtml(original, current) {
  const diff = lcsDiff(tokenizeWords(original), tokenizeWords(current));
  const parts = diff.map((d) => {
    const safe = escapeHtml(d.text);
    if (d.type === "ins") return `<ins>${safe}</ins>`;
    if (d.type === "del") return `<del>${safe}</del>`;
    return safe;
  });
  return `<pre>${parts.join("")}</pre>`;
}

function renderDiff() {
  if (state.selectedIndex < 0) return;
  const item = state.surveyData[state.selectedIndex];

  const originalText = state.cleanView ? getDisplayHtml(state.original.text) : state.original.text;
  const currentTextRaw = getCurrentBlockHtml();
  const currentText = state.cleanView ? getDisplayHtml(currentTextRaw) : currentTextRaw;

  els.diffBlock.innerHTML = renderDiffHtml(originalText, currentText);

  if (!isChoiceQuestion(item)) {
    els.diffChoices.innerHTML = `<pre>No choices to diff for this block.</pre>`;
    return;
  }

  readChoiceInputs();
  normalizeChoices(item);

  const keys = sortedChoiceKeys(item.choices);
  if (!keys.length) {
    els.diffChoices.innerHTML = `<pre>No choices to diff.</pre>`;
    return;
  }

  const html = keys.map((k) => {
    const orig = state.original.choices[k] ?? "";
    const cur = item.choices[k]?.Display ?? "";
    const o = state.cleanView ? getDisplayHtml(orig) : orig;
    const c = state.cleanView ? getDisplayHtml(cur) : cur;
    return `
      <div class="choice-card" style="margin-bottom:10px;">
        <div class="choice-head">
          <strong>Choice ${escapeHtml(k)}</strong>
          <span class="badge">choices["${escapeHtml(k)}"].Display</span>
        </div>
        <div class="diff">${renderDiffHtml(o, c)}</div>
      </div>
    `;
  }).join("");

  els.diffChoices.innerHTML = html;
}

// ===== Selection / sync =====
function syncEditors(targetTab) {
  if (state.selectedIndex < 0) return;
  const item = state.surveyData[state.selectedIndex];

  if (targetTab === "raw") {
    // copy wysiwyg -> raw
    const html = state.tinymceReady && tinymce.get("blockText")
      ? tinymce.get("blockText").getContent()
      : els.blockText.value;
    els.blockTextRaw.value = html;
  }

  if (targetTab === "wysiwyg") {
    // copy raw -> wysiwyg
    const html = els.blockTextRaw.value;
    els.blockText.value = html;
    if (state.tinymceReady && tinymce.get("blockText")) {
      tinymce.get("blockText").setContent(html);
    }
  }

  if (targetTab === "diff") {
    // keep diff live
    renderDiff();
  }

  // keep preview live-ish
  renderPreview(item);
}

async function selectItem(idx) {
  const item = state.surveyData[idx];
  ensureUid(item);

  state.selectedIndex = idx;
  state.selectedUid = item.__uid;
  renderList();
  renderList();
  els.blockId.value = item.id || "";
  els.blockType.value = getDisplayType(item) || "";

  // Capture loaded-original snapshot
  state.original.text = item.text || "";
  state.original.choices = {};
  if (item.choices && typeof item.choices === "object" && !Array.isArray(item.choices)) {
    Object.keys(item.choices).forEach((k) => {
      state.original.choices[k] = item.choices[k]?.Display ?? "";
    });
  }

  // Ensure editors
  await initBlockEditor();
  setBlockHtml(item.text || "");

  renderChoices(item);
  showValidation({ errors: [], warnings: [] });
  renderPreview(item);
  enableControls(true);
  setActiveTab(state.activeTab || "wysiwyg");
  updateBlockActionButtons();
}

function updateBlockActionButtons() {
  const hasSelection = state.selectedIndex >= 0 && state.selectedIndex < state.surveyData.length;

  if (els.addBlockTypeSelect) {
    // Enable dropdown only when a block is selected (we insert after selection)
    els.addBlockTypeSelect.disabled = !hasSelection;
  }

  if (els.moveUpBtn) els.moveUpBtn.disabled = !hasSelection || state.selectedIndex === 0;
  if (els.moveDownBtn) els.moveDownBtn.disabled = !hasSelection || state.selectedIndex === state.surveyData.length - 1;
}


function enableControls(enabled) {
  els.blockText.disabled = !enabled;
  els.blockTextRaw.disabled = !enabled;
  els.applyBtn.disabled = !enabled;
  if (els.revertBtn) els.revertBtn.disabled = !enabled;
  els.saveZipBtn.disabled = !enabled;
  els.saveAsBtn.disabled = !enabled;
  updateBlockActionButtons();
}


function revertSelectedToOriginal() {
  if (state.selectedIndex < 0) return;

  const idx = state.selectedIndex;
  const base = state.baseline[idx];
  const item = state.surveyData[idx];
  if (!base || !item) return;

  // Restore block text
  item.text = base.text;

  // Restore choices
  item.choices = {};
  base.choices.forEach(({ k, d }) => {
    item.choices[k] = { Display: d };
  });

  // Refresh editors/UI
  setBlockHtml(item.text);
  renderChoices(item);
  showValidation({ errors: [], warnings: [] });
  renderPreview(item);

  // Refresh list and diff
  renderList();
  if (state.activeTab === "diff") renderDiff();
    renderList();

  setStatus("Reverted block to originally loaded content.");
}

// ===== Apply + Save =====
function applyChangesToModel() {
  if (state.selectedIndex < 0) return;

  const item = state.surveyData[state.selectedIndex];

  // Update model from editors
  item.text = rewriteObjectUrlsToRelative(getCurrentBlockHtml());
  readChoiceInputs();

  const report = validateItem(item);
  showValidation(report);

  if (report.errors.length) {
    setStatus("Fix validation errors before applying.");
    return;
  }

  setStatus("Changes applied (not yet downloaded).");
  renderPreview(item);
  renderList();
}


function addAssetsToZip(zip) {
  // Writes registered assets into the output SCORM zip.
  // Note: assets referenced by relative path in HTML.
  state.assetByObjectUrl.forEach((meta) => {
    zip.file(meta.relPath, meta.file);
  });
}
function buildUpdatedDataJs() {
  const json = JSON.stringify(state.surveyData, null, 2);
  return `${state.keyword || "const"} ${state.varName || "surveyData"} = ${json};\n`;
}

async function downloadUpdatedZip() {
  if (!state.zip || !state.dataJsPath) return;

  // Apply current editor state to model before save
  applyChangesToModel();
  const item = state.surveyData[state.selectedIndex];
  const report = validateItem(item);
  if (report.errors.length) {
    // don't save
    return;
  }

  state.zip.file(state.dataJsPath, buildUpdatedDataJs());

  // Include any newly-added media assets
  addAssetsToZip(state.zip);
  addAssetsToZip(state.zip);

  const blob = await state.zip.generateAsync({ type: "blob" });
  const outName = state.zipName
    ? state.zipName.replace(/\.zip$/i, "") + "-edited.zip"
    : "scorm-edited.zip";

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = outName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  setStatus("Downloaded updated SCORM ZIP (manifest preserved). ");
}

async function saveAsWithFileSystemApi() {
  if (!("showSaveFilePicker" in window)) {
    setStatus("Save As not supported in this browser.");
    return;
  }
  if (!state.zip || !state.dataJsPath) return;

  applyChangesToModel();
  const item = state.surveyData[state.selectedIndex];
  const report = validateItem(item);
  if (report.errors.length) return;

  state.zip.file(state.dataJsPath, buildUpdatedDataJs());

  // Include any newly-added media assets
  addAssetsToZip(state.zip);
  addAssetsToZip(state.zip);

  const blob = await state.zip.generateAsync({ type: "blob" });
  const suggestedName = (state.zipName || "scorm.zip").replace(/\.zip$/i, "") + "-edited.zip";

  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [{ description: "ZIP Archive", accept: { "application/zip": [".zip"] } }]
  });

  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  setStatus("Saved updated SCORM ZIP via File System API.");
}

// ===== Load ZIP =====
async function loadZipFile(file) {
  setStatus("Loading ZIP...");
  state.zipName = file.name;

  state.zip = await JSZip.loadAsync(await file.arrayBuffer());

  const scorm = await detectScorm(state.zip);
  state.scorm = scorm;
  els.scormVersion.textContent = `${scorm.version} (${scorm.details})`;
  els.manifestPath.textContent = scorm.path || "—";

  const dataCandidates = Object.keys(state.zip.files).filter((p) => p.toLowerCase().endsWith("data.js"));
  if (dataCandidates.length === 0) throw new Error("No data.js found in the ZIP.");
  dataCandidates.sort((a, b) => a.length - b.length);
  const dataPath = dataCandidates[0];

  state.dataJsPath = dataPath;
  els.dataJsPath.textContent = dataPath;

  const jsText = await state.zip.file(dataPath).async("string");
  const parsed = extractSurveyDataFromJs(jsText);

  state.surveyData = parsed.arr;

  // Assign UIDs + baseline snapshots
  state.baselineByUid = new Map();
  state.surveyData.forEach((it) => {
    ensureUid(it);
    state.baselineByUid.set(it.__uid, snapshotItem(it));
  });

  // Baseline snapshot for modified indicators
  state.baseline = state.surveyData.map((it) => snapshotItem(it));
  state.keyword = parsed.keyword;
  state.varName = parsed.varName;

  setStatus(`Loaded ${state.surveyData.length} blocks from ${state.varName}.`);

  enableControls(false);
  renderList();

  if (state.filteredIndexes.length > 0) {
    await selectItem(state.filteredIndexes[0]);
  }

  els.saveZipBtn.disabled = false;
  els.saveAsBtn.disabled = false;
}

// ===== Vendor check =====
async function checkVendorsAndMaybeBanner() {
  if (!window.__ensureVendors) return;
  const res = await window.__ensureVendors();
  if (res.ok) {
    els.vendorBanner.classList.add("hidden");
    return;
  }

  els.missingVendors.textContent = res.missing.join(", ");
  els.vendorBanner.classList.remove("hidden");
}

els.loadCdnBtn.addEventListener("click", async () => {
  try {
    await window.__loadVendorsFromCDN();
    await checkVendorsAndMaybeBanner();
    // re-init TinyMCE if now available
    if (state.selectedIndex >= 0) {
      await initBlockEditor();
      const item = state.surveyData[state.selectedIndex];
      setBlockHtml(item.text || "");
    }
  } catch {
    // keep banner
  }
});

function indexByUid(uid) { return state.surveyData.findIndex((it) => it && it.__uid === uid); }

function moveBlockByUid(dragUid, targetUid, placeAfter) {
  const from = indexByUid(dragUid);
  const to = indexByUid(targetUid);
  if (from < 0 || to < 0 || from === to) return;
  const moved = state.surveyData.splice(from, 1)[0];
  const to2 = indexByUid(targetUid);
  if (to2 < 0) state.surveyData.push(moved);
  else state.surveyData.splice(placeAfter ? to2 + 1 : to2, 0, moved);
  const newIndex = indexByUid(dragUid);
  if (newIndex >= 0) selectItem(newIndex);
  else renderList();
}

function defaultBlockTemplate(type) {
  const id = `NEW_${state.uidCounter}`;
  if (type === 'MS') {
    return { id, type: 'MC', selector: 'MAVR', text: '<p>New multiple select question</p>', choices: { '1': { Display: 'Option 1' }, '2': { Display: 'Option 2' } } };
  }
  if (type === 'MC') return { id, type: 'MC', selector: 'SAVR', text: '<p>New multiple choice question</p>', choices: { '1': { Display: 'Option 1' }, '2': { Display: 'Option 2' } } };
  if (type === 'TE') return { id, type: 'TE', text: '<p>New text entry question</p>' };
  return { id, type: 'DB', text: '<p>New display block</p>' };
}

function insertBlockAfter(index, type) {
  const nb = defaultBlockTemplate(type);
  ensureUid(nb);
  state.surveyData.splice(index + 1, 0, nb);
  renderList();
  selectItem(index + 1);
}

function removeBlockAt(index) {
  state.surveyData.splice(index, 1);
  const next = Math.min(index, state.surveyData.length - 1);
  if (next >= 0) selectItem(next);
  else { state.selectedIndex = -1; state.selectedUid = null; renderList(); }
}

function moveBlock(index, direction) {
  const ni = index + direction;
  if (ni < 0 || ni >= state.surveyData.length) return;
  const tmp = state.surveyData[index];
  state.surveyData[index] = state.surveyData[ni];
  state.surveyData[ni] = tmp;
  renderList();
  selectItem(ni);
}

// ===== Event wiring =====
els.zipInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    await loadZipFile(file);
  } catch (err) {
     console.error(err);
    setStatus(`Error: ${err.message}`);
    enableControls(false);
    els.blockList.innerHTML = "";
  }
});

els.applyBtn.addEventListener("click", () => {
  try {
    applyChangesToModel();
  } catch (err) {
    console.error(err);
    setStatus(`Error applying changes: ${err.message}`);
  }
});

els.revertBtn.addEventListener("click", () => {
  try {
    revertSelectedToOriginal();
  } catch (err) {
    console.error(err);
    setStatus(`Error reverting: ${err.message}`);
  }
});


els.saveZipBtn.addEventListener("click", async () => {
  try {
    await downloadUpdatedZip();
  } catch (err) {
    console.error(err);
    setStatus(`Error saving ZIP: ${err.message}`);
  }
});

els.saveAsBtn.addEventListener("click", async () => {
  try {
    await saveAsWithFileSystemApi();
  } catch (err) {
    console.error(err);
    setStatus(`Error with Save As: ${err.message}`);
  }
});

els.searchInput.addEventListener("input", () => renderList());

// Add block dropdown
if (els.addBlockTypeSelect) {
  els.addBlockTypeSelect.addEventListener('change', () => {
    if (state.selectedIndex < 0) {
      // reset
      els.addBlockTypeSelect.value = '';
      return;
    }

    const t = String(els.addBlockTypeSelect.value || '').trim().toUpperCase();
    // reset selection back to placeholder immediately
    els.addBlockTypeSelect.value = '';

    if (!['DB', 'MC', 'MS', 'TE'].includes(t)) return;
    insertBlockAfter(state.selectedIndex, t);
    updateBlockActionButtons();
  });
}

els.typeFilter.addEventListener("change", () => renderList());
els.listDisplayMode.addEventListener("change", () => renderList());

els.blockTextRaw.addEventListener("input", () => {
  if (state.activeTab === "diff") renderDiff();
  renderList();
});
els.cleanViewToggle.addEventListener("change", () => {
  state.cleanView = Boolean(els.cleanViewToggle.checked);
  renderList();
  if (state.selectedIndex >= 0) {
    renderPreview(state.surveyData[state.selectedIndex]);
    if (state.activeTab === "diff") renderDiff();
    renderList();
  }
});

els.modifiedOnlyToggle.addEventListener("change", () => renderList());

els.addChoiceBtn.addEventListener("click", () => {
  if (state.selectedIndex < 0) return;
  const item = state.surveyData[state.selectedIndex];
  if (!isChoiceQuestion(item)) return;

  normalizeChoices(item);
  const k = nextChoiceKey(item.choices);
  item.choices[k] = { Display: "" };
  renderChoices(item);
  if (state.activeTab === "diff") renderDiff();
    renderList();
});

els.renumberChoicesBtn.addEventListener("click", () => {
  if (state.selectedIndex < 0) return;
  const item = state.surveyData[state.selectedIndex];
  if (!isChoiceQuestion(item)) return;

  renumberChoices(item);
  renderChoices(item);
  if (state.activeTab === "diff") renderDiff();
    renderList();
});

bindTabs();
checkVendorsAndMaybeBanner();
enableControls(false);






els.moveUpBtn.addEventListener('click', () => { if (state.selectedIndex < 0) return; moveBlock(state.selectedIndex, -1); });

els.moveDownBtn.addEventListener('click', () => { if (state.selectedIndex < 0) return; moveBlock(state.selectedIndex, 1); });
