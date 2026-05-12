/**
 * AI Text Summarizer — Main Application Script
 * Handles: theme, tab switching, file parsing, API calls, downloads
 */

/* ── State ──────────────────────────────────────────────────────────────────── */
const state = {
  activeTab: 'text',
  fileText: '',
  fileName: '',
  currentSummary: '',
  isLoading: false,
};

/* ── Theme ──────────────────────────────────────────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ── Tab switching ──────────────────────────────────────────────────────────── */
function switchTab(tab) {
  state.activeTab = tab;
  const paneText = document.getElementById('pane-text');
  const paneFile = document.getElementById('pane-file');
  const tabText  = document.getElementById('tab-text');
  const tabFile  = document.getElementById('tab-file');

  paneText.style.display = tab === 'text' ? '' : 'none';
  paneFile.style.display = tab === 'file' ? '' : 'none';

  tabText.classList.toggle('tab--active', tab === 'text');
  tabFile.classList.toggle('tab--active', tab === 'file');
  tabText.setAttribute('aria-selected', tab === 'text');
  tabFile.setAttribute('aria-selected', tab === 'file');
}

/* ── Word / char / para counter ────────────────────────────────────────────── */
function countStats(text) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  const paras = text.trim() ? text.trim().split(/\n\s*\n+/).length : 0;
  return { words, chars, paras };
}

function onTextInput() {
  const val  = document.getElementById('text-input').value;
  const s    = countStats(val);
  document.getElementById('wc-words').textContent = `${s.words}w`;
  document.getElementById('wc-chars').textContent = `${s.chars}c`;
  document.getElementById('wc-paras').textContent = `${s.paras}¶`;
}

/* ── Condensation params ────────────────────────────────────────────────────── */
function onCondenseByChange() {
  const val = document.getElementById('condense-by').value;
  ['ratio', 'words', 'chars', 'paragraphs'].forEach(k => {
    document.getElementById('condense-' + k).style.display = val === k ? '' : 'none';
  });
}

function getCondenseValue() {
  const by = document.getElementById('condense-by').value;
  if (by === 'ratio')      return parseInt(document.getElementById('ratio-range').value);
  if (by === 'words')      return parseInt(document.getElementById('target-words').value) || 150;
  if (by === 'chars')      return parseInt(document.getElementById('target-chars').value) || 600;
  if (by === 'paragraphs') return parseInt(document.getElementById('target-paras').value) || 3;
  return 30;
}

/* ── Model note ─────────────────────────────────────────────────────────────── */
const MODEL_NOTES = {
  'facebook/bart-large-cnn':               'Best general-purpose. News, articles, reports.',
  'sshleifer/distilbart-cnn-12-6':         'Faster, lighter BART. Good for quick summaries.',
  'google/pegasus-xsum':                   'Extreme compression into one dense paragraph.',
  'philschmid/bart-large-cnn-samsum':      'Fine-tuned on dialogues and meeting notes.',
  'pszemraj/long-t5-tglobal-base-16384-book-summary': 'Handles very long documents (16k tokens).',
};
function onModelChange() {
  const v = document.getElementById('model-select').value;
  document.getElementById('model-note').textContent = MODEL_NOTES[v] || '';
}

/* ── Tone detection (client-side fallback) ──────────────────────────────────── */
const TONE_KW = {
  academic:  ['therefore','hypothesis','methodology','findings','research','abstract','conclusion','study','analysis','literature','empirical'],
  technical: ['algorithm','function','parameter','implementation','interface','module','protocol','variable','configuration','deployment'],
  informal:  ['gonna','wanna','kinda','yeah','hey','okay','nope','awesome','cool','totally','literally','basically'],
  formal:    ['hereby','whereas','pursuant','henceforth','aforementioned','accordingly','notwithstanding','pertaining','subsequent'],
  creative:  ['imagine','dream','story','beauty','soul','wonder','magic','journey','whisper','dance','echo'],
};
function detectTone(text) {
  const lower = text.toLowerCase();
  const scores = Object.fromEntries(
    Object.entries(TONE_KW).map(([tone, kws]) => [tone, kws.filter(k => lower.includes(k)).length])
  );
  scores.neutral = 1;
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

/* ── File handling ──────────────────────────────────────────────────────────── */
function onFileSelect(evt) {
  const file = evt.target.files[0];
  if (file) loadFile(file);
}
function onDragOver(e)  { e.preventDefault(); document.getElementById('drop-zone').classList.add('dz-over'); }
function onDragLeave()  { document.getElementById('drop-zone').classList.remove('dz-over'); }
function onDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('dz-over');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
}

function loadFile(file) {
  state.fileName = file.name;
  const ext = file.name.split('.').pop().toLowerCase();
  const dz  = document.getElementById('drop-zone');
  dz.classList.add('dz-has-file');

  const reader = new FileReader();

  if (['txt', 'md', 'tex', 'latex', 'rst', 'org', 'csv'].includes(ext)) {
    reader.onload = e => setFileText(e.target.result, file.name);
    reader.readAsText(file);
  } else if (['html', 'htm'].includes(ext)) {
    reader.onload = e => {
      const doc = new DOMParser().parseFromString(e.target.result, 'text/html');
      setFileText(doc.body.innerText || doc.body.textContent, file.name);
    };
    reader.readAsText(file);
  } else if (ext === 'rtf') {
    reader.onload = e => {
      let t = e.target.result;
      t = t.replace(/\{\\[a-z0-9*]+[^}]*\}/g, '').replace(/\\[a-z0-9*]+\s?/g, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ');
      setFileText(t.trim(), file.name);
    };
    reader.readAsText(file);
  } else if (ext === 'pdf') {
    reader.onload = e => {
      // Basic client-side PDF text heuristic
      const bytes = new Uint8Array(e.target.result);
      let text = '';
      for (let i = 0; i < bytes.length - 1; i++) {
        if (bytes[i] === 40) {  // '('
          i++;
          let s = '';
          while (i < bytes.length && bytes[i] !== 41) { s += String.fromCharCode(bytes[i]); i++; }
          if (s.length > 2 && /[a-zA-Z0-9 ]/.test(s)) text += s + ' ';
        }
      }
      setFileText(text.trim() || '[PDF: for best results, paste text directly or use the server-side endpoint.]', file.name);
    };
    reader.readAsArrayBuffer(file);
  } else if (ext === 'docx') {
    reader.onload = e => {
      const bytes = new Uint8Array(e.target.result);
      // Attempt to pull word/document.xml from the ZIP
      let xml = '';
      let i = 0;
      while (i < bytes.length - 4) {
        if (bytes[i]===0x50&&bytes[i+1]===0x4B&&bytes[i+2]===0x03&&bytes[i+3]===0x04) {
          i += 26;
          const fnLen = bytes[i] + bytes[i+1]*256;
          const exLen = bytes[i+2] + bytes[i+3]*256;
          i += 4;
          let fname = '';
          for (let j = i; j < i + fnLen; j++) fname += String.fromCharCode(bytes[j]);
          i += fnLen + exLen;
          if (fname === 'word/document.xml') {
            let end = i;
            while (end < bytes.length - 4 && !(bytes[end]===0x50&&bytes[end+1]===0x4B&&(bytes[end+2]===0x03||bytes[end+2]===0x01))) end++;
            xml = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(i, end));
            break;
          }
        } else { i++; }
      }
      const plain = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      setFileText(plain || '[DOCX: paste text directly or use the server endpoint for best results.]', file.name);
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = e => setFileText(e.target.result || '', file.name);
    reader.readAsText(file);
  }
}

function setFileText(text, name) {
  state.fileText = text;
  const s = countStats(text);
  document.getElementById('wc-file').textContent = `${s.words}w · ${s.chars}c · ${s.paras}¶`;
  const badge = document.getElementById('file-badge');
  badge.style.display = 'inline-flex';
  badge.querySelector('.badge-name').textContent = name;
}

/* ── Main summarize ─────────────────────────────────────────────────────────── */
async function summarize() {
  if (state.isLoading) return;

  const inputText = state.activeTab === 'text'
    ? document.getElementById('text-input').value.trim()
    : state.fileText.trim();

  if (!inputText || inputText.length < 50) {
    showAlert('Text must be at least 50 characters long.', 'error');
    return;
  }

  setLoadingState(true);
  clearOutput();

  const model         = document.getElementById('model-select').value;
  const tone          = document.getElementById('tone-select').value;
  const outputFormat  = document.getElementById('format-select').value;
  const condenseBy    = document.getElementById('condense-by').value;
  const condenseValue = getCondenseValue();

  const LOADING_MSGS = [
    'Connecting to HuggingFace…',
    'Loading model (may take ~20s on first call)…',
    'Tokenising input…',
    'Running inference…',
    'Assembling summary…',
  ];
  let msgIdx = 0;
  const msgEl   = document.getElementById('loading-msg');
  const progEl  = document.getElementById('progress-fill');
  const PROG    = [5, 25, 50, 75, 92];

  msgEl.textContent = LOADING_MSGS[0];
  progEl.style.width = PROG[0] + '%';

  const msgInterval = setInterval(() => {
    msgIdx = Math.min(msgIdx + 1, LOADING_MSGS.length - 1);
    msgEl.textContent = LOADING_MSGS[msgIdx];
    progEl.style.width = PROG[msgIdx] + '%';
  }, 3500);

  try {
    const result = await callHuggingFace({ text: inputText, model, tone, outputFormat, condenseBy, condenseValue });
    clearInterval(msgInterval);
    progEl.style.width = '100%';

    state.currentSummary = result.summary;
    const detectedTone   = result.tone || (tone === 'auto' ? detectTone(inputText) : tone);

    showOutput(result.summary, result.stats || computeLocalStats(inputText, result.summary), detectedTone);
  } catch (err) {
    clearInterval(msgInterval);
    showAlert('Error: ' + err.message, 'error');
  } finally {
    setLoadingState(false);
  }
}

/* ── HuggingFace API call ───────────────────────────────────────────────────── */
async function callHuggingFace({ text, model, tone, outputFormat, condenseBy, condenseValue }) {
  // Try backend first (if running locally)
  const useBackend = window.location.hostname !== '' && !window.location.protocol.startsWith('file');

  if (useBackend && window.location.port) {
    // Server-side route
    const body = JSON.stringify({ text, model, tone, output_format: outputFormat, condense_by: condenseBy, condense_value: condenseValue });
    const res  = await fetch('/api/summarize/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) { const d = await res.json(); throw new Error(d.detail || `HTTP ${res.status}`); }
    return res.json();
  }

  // Direct HF inference (frontend-only / standalone HTML)
  const lengths = computeLengths(text, condenseBy, condenseValue);
  const resp = await fetch("/api/summarize/text", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
})//fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: text.slice(0, 3500),
      parameters: { min_length: lengths.min, max_length: lengths.max, do_sample: false, truncation: true },
      options: { wait_for_model: true },
    }),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error || `HuggingFace returned HTTP ${resp.status}`);
  }

  const data = await resp.json();
  let summaryText = '';
  if (Array.isArray(data) && data[0]?.summary_text) summaryText = data[0].summary_text;
  else if (typeof data === 'string') summaryText = data;
  else summaryText = JSON.stringify(data);

  const formatted = formatSummary(summaryText, outputFormat);
  const detectedTone = tone === 'auto' ? detectTone(text) : tone;

  return {
    summary: formatted,
    tone: detectedTone,
    stats: computeLocalStats(text, formatted),
  };
}

function computeLengths(text, by, value) {
  const words = text.trim().split(/\s+/).length;
  let target;
  if (by === 'ratio')      target = Math.max(30, Math.round(words * value / 100));
  else if (by === 'words') target = Math.max(30, value);
  else if (by === 'chars') target = Math.max(20, Math.round(value / 5));
  else                     target = Math.max(20, value * 80);
  return { min: Math.max(20, Math.round(target * 0.6)), max: Math.min(1024, Math.round(target * 1.5)) };
}

function formatSummary(text, fmt) {
  if (fmt === 'bullets') {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    return sentences.map(s => '• ' + s.trim()).join('\n');
  }
  return text.trim();
}

function computeLocalStats(input, output) {
  const iw = input.trim().split(/\s+/).length;
  const ow = output.trim().split(/\s+/).length;
  return { input_words: iw, output_words: ow, input_chars: input.length, output_chars: output.length, ratio: Math.round(ow / Math.max(1, iw) * 100) };
}

/* ── Output rendering ───────────────────────────────────────────────────────── */
function clearOutput() {
  document.getElementById('output-placeholder').style.display = 'none';
  document.getElementById('output-result').style.display     = 'none';
  document.getElementById('output-loading').style.display    = '';
  document.getElementById('alert-box').style.display         = 'none';
}

function showOutput(summary, stats, tone) {
  document.getElementById('output-loading').style.display = 'none';
  document.getElementById('output-result').style.display  = '';

  // Stats row
  document.getElementById('stats-row').innerHTML =
    `<span class="stat-chip">${stats.input_words} words in</span>` +
    `<span class="stat-chip chip-accent">${stats.output_words} words out</span>` +
    `<span class="stat-chip">${stats.ratio}% of original</span>` +
    `<span class="stat-chip">${stats.output_chars} chars</span>`;

  // Tone badge
  const toneMap = { formal:'Formal', informal:'Informal', academic:'Academic', technical:'Technical', neutral:'Neutral', creative:'Creative' };
  document.getElementById('tone-badge').innerHTML =
    `<span class="tone-badge tone-${tone}"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>${toneMap[tone] || tone}</span>`;

  document.getElementById('output-text').textContent = summary;
}

function setLoadingState(loading) {
  state.isLoading = loading;
  const btn = document.getElementById('summarize-btn');
  btn.disabled = loading;
  document.getElementById('output-loading').style.display = loading ? '' : 'none';
  if (!loading && !state.currentSummary) {
    document.getElementById('output-placeholder').style.display = '';
  }
}

/* ── Alert ──────────────────────────────────────────────────────────────────── */
function showAlert(msg, type = 'error') {
  const box = document.getElementById('alert-box');
  box.className = 'alert alert-' + type;
  box.querySelector('.alert-msg').textContent = msg;
  box.style.display = 'flex';
  document.getElementById('output-loading').style.display = 'none';
  document.getElementById('output-placeholder').style.display = 'none';
}

/* ── Copy ───────────────────────────────────────────────────────────────────── */
function copySummary() {
  if (!state.currentSummary) return;
  navigator.clipboard.writeText(state.currentSummary).then(() => {
    showAlert('Copied to clipboard!', 'success');
    setTimeout(() => { document.getElementById('alert-box').style.display = 'none'; }, 2200);
  });
}

/* ── Download ───────────────────────────────────────────────────────────────── */
function downloadAs(fmt) {
  if (!state.currentSummary) return;
  const s = state.currentSummary;

  if (fmt === 'pdf')  { return printAsPDF(s); }
  if (fmt === 'docx') { return downloadDocx(s); }

  let content = '', mime = '', ext = fmt;
  if (fmt === 'txt')  { content = s; mime = 'text/plain'; }
  if (fmt === 'md')   { content = `# Summary\n\n${s}`; mime = 'text/markdown'; }
  if (fmt === 'html') {
    content = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Summary</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:700px;margin:48px auto;padding:0 24px;line-height:1.75;color:#1a1a1a}h1{font-size:20px;font-weight:500;margin-bottom:1.5rem;color:#0D7A5F}</style>` +
      `</head><body><h1>Summary</h1><div>${s.replace(/\n/g,'<br>')}</div></body></html>`;
    mime = 'text/html';
  }

  const blob = new Blob([content], { type: mime });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `summary.${ext}` });
  a.click();
}

function printAsPDF(text) {
  const w = window.open('', '_blank');
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Summary</title>` +
    `<style>body{font-family:Georgia,serif;max-width:700px;margin:48px auto;font-size:13pt;line-height:1.8;color:#111}h1{font-size:18pt;margin-bottom:1.5rem;font-weight:400;color:#0A5E48}</style>` +
    `</head><body><h1>Summary</h1><p>${text.replace(/\n/g,'</p><p>')}</p>` +
    `<script>window.onload=function(){window.print();window.close();}<\/script></body></html>`
  );
  w.document.close();
}

function downloadDocx(text) {
  const xmlBody = text.split('\n').map(line =>
    `<w:p><w:r><w:t xml:space="preserve">${line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</w:t></w:r></w:p>`
  ).join('');

  const docXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Summary</w:t></w:r></w:p>` +
    xmlBody + `<w:sectPr/></w:body></w:document>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const ct =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  if (window.JSZip) {
    const zip = new window.JSZip();
    zip.file('_rels/.rels', rels);
    zip.file('[Content_Types].xml', ct);
    zip.file('word/document.xml', docXml);
    zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      .then(blob => {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'summary.docx' });
        a.click();
      });
  } else {
    // Fallback: plain text
    const blob = new Blob([text], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'summary.txt' });
    a.click();
    console.warn('JSZip not available — downloaded as .txt instead.');
  }
}

/* ── Init ───────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();

  // Expose globals for inline handlers
  window.toggleTheme    = toggleTheme;
  window.switchTab      = switchTab;
  window.onTextInput    = onTextInput;
  window.onFileSelect   = onFileSelect;
  window.onDragOver     = onDragOver;
  window.onDragLeave    = onDragLeave;
  window.onDrop         = onDrop;
  window.onCondenseByChange = onCondenseByChange;
  window.onModelChange  = onModelChange;
  window.summarize      = summarize;
  window.copySummary    = copySummary;
  window.downloadAs     = downloadAs;
});
