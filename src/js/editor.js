import { $, escapeHtml } from './utils.js';
import { invoke } from './api.js';
import { toast } from './toast.js';
import { LANGUAGES, languageName, normalizeSyntax } from './languages.js';
import { detectSyntax, highlight, renderMarkdown } from './syntax.js';

export function createEditor(onChange, onOptionsChange, settings) {
  const input = $('note-input'), title = $('note-title'), layer = $('syntax-layer');
  const preview = $('markdown-preview'), selector = $('syntax-select');
  let lastTarget = input, designSelection = null, redline = false, source = '';
  let syntax = 'auto', language = 'plaintext', previewing = false, composing = false, highlightTimer;
  let lineNumbers = settings.line_numbers !== 'false', metricKey = '', heights = [], offsets = [];
  selector.innerHTML = '<option value="auto">Auto · Plain text</option>' + LANGUAGES.map(([id,name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('');

  function selection() {
    const offset = redline && lastTarget === input ? title.value.length + 1 : 0;
    return [lastTarget.selectionStart + offset, lastTarget.selectionEnd + offset];
  }
  function restoreSelection(start, end, focus = false) {
    const offset = redline ? title.value.length + 1 : 0;
    const target = redline && start < offset ? title : input;
    const shift = target === input ? offset : 0;
    if (focus) target.focus();
    target.setSelectionRange(Math.max(0,start - shift), Math.max(0,end - shift));
    lastTarget = target;
    return [target, Math.max(0,start - shift), Math.max(0,end - shift)];
  }
  function layout() {
    redline = document.documentElement.dataset.design === 'redline' && language === 'plaintext';
    document.documentElement.dataset.proseTitle = String(redline);
    document.documentElement.dataset.code = String(!['plaintext','markdown'].includes(language));
    document.documentElement.dataset.lineNumbers = String(lineNumbers);
    const split = source.indexOf('\n');
    title.value = split < 0 ? source : source.slice(0,split);
    input.value = redline ? split < 0 ? '' : source.slice(split + 1) : source;
    if (!redline) lastTarget = input;
    input.wrap = settings.word_wrap === 'false' ? 'off' : 'soft';
    input.spellcheck = ['plaintext','markdown'].includes(language);
    layer.style.whiteSpace = input.wrap === 'off' ? 'pre' : 'pre-wrap';
    metricKey = '';
  }
  function paint() {
    // Keep every glyph's metrics identical to the native textarea, including tabs.
    $('syntax-content').innerHTML = highlight(input.value, language) + '\n';
    input.classList.toggle('highlighted', language !== 'plaintext');
    layer.hidden = language === 'plaintext';
    updateMetrics();
  }
  function refreshSyntax() {
    clearTimeout(highlightTimer);
    if (composing) return;
    const next = syntax === 'auto' ? detectSyntax(source) : syntax;
    if (next !== language) {
      const caret = selection(), scroll = [input.scrollTop,input.scrollLeft];
      const editing = document.activeElement === input || document.activeElement === title;
      language = next; layout(); restoreSelection(...caret, editing);
      [input.scrollTop,input.scrollLeft] = scroll;
    }
    selector.value = syntax;
    selector.options[0].textContent = `Auto · ${languageName(language)}`;
    document.documentElement.dataset.language = language;
    $('btn-markdown-preview').hidden = language !== 'markdown';
    if (language !== 'markdown' && previewing) setPreview(false);
    paint();
    if (previewing) renderMarkdown(source, preview);
  }
  function setText(text) {
    source = text;
    language = syntax === 'auto' ? detectSyntax(source) : syntax;
    layout(); refreshSyntax();
  }
  function setBuffer(buffer) {
    syntax = normalizeSyntax(buffer.syntax);
    // Render source first, then restore this tab's preview preference.
    setPreview(false, false); setText(buffer.text);
    setPreview(buffer.preview && language === 'markdown', false);
  }
  function changed() {
    source = redline ? title.value + (input.value || source.includes('\n') ? '\n' + input.value : '') : input.value;
    metricKey = '';
    // Show fresh text immediately while detection waits for a pause in typing.
    $('syntax-content').textContent = input.value + '\n';
    updateMetrics(); onChange(source);
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(refreshSyntax, 100);
  }
  function updateMetrics() {
    if (previewing || !input.clientWidth) return;
    const lines = input.value.split('\n'), css = getComputedStyle(input);
    const leading = parseFloat(css.lineHeight);
    const key = [input.clientWidth, css.font, css.padding, input.wrap, redline, document.documentElement.dataset.design, input.value].join('|');
    if (key !== metricKey) {
      metricKey = key;
      if (input.wrap === 'off') heights = lines.map(() => leading);
      else {
        // Measure logical lines so gutters stay correct when text or code wraps.
        const measure = document.createElement('div');
        Object.assign(measure.style, {
          position:'fixed', visibility:'hidden', pointerEvents:'none', top:'0', left:'0',
          width:`${input.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)}px`,
          font:css.font, letterSpacing:css.letterSpacing, tabSize:css.tabSize,
          whiteSpace:'pre-wrap', overflowWrap:'break-word',
        });
        for (const line of lines) { const row = document.createElement('div'); row.textContent = line || '\u200b'; measure.append(row); }
        document.body.append(measure);
        heights = [...measure.children].map(row => row.getBoundingClientRect().height);
        measure.remove();
      }
      let top = 0;
      offsets = heights.map(height => { const y = top; top += height; return y; });
      $('line-number-content').innerHTML = heights.map((height,i) => `<span style="height:${height}px">${String(i + 1 + (redline ? 1 : 0)).padStart(document.documentElement.dataset.design === 'optic' ? 2 : 1,'0')}</span>`).join('');
    }
    const before = input.value.slice(0,input.selectionStart), current = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    const gutter = $('line-number-content');
    gutter.querySelector('.current')?.classList.remove('current');
    gutter.children[current - 1]?.classList.add('current');
    gutter.style.transform = `translateY(${-input.scrollTop}px)`;
    $('active-line').style.top = `${parseFloat(css.paddingTop) + (offsets[current - 1] || 0) - input.scrollTop}px`;
    $('active-line').style.height = `${heights[current - 1] || leading}px`;
    $('editor-stats').textContent = redline && document.activeElement === title ? `Ln 1, Col ${title.selectionStart + 1}` : `Ln ${current + (redline ? 1 : 0)}, Col ${col}`;
    layer.style.width = `${input.clientWidth}px`;
    layer.style.height = `${input.clientHeight}px`;
    layer.scrollTop = input.scrollTop; layer.scrollLeft = input.scrollLeft;
  }
  function layoutChanged() {
    const caret = selection(), scroll = [input.scrollTop,input.scrollLeft];
    layout();
    const mapped = restoreSelection(...caret);
    if ($('settings-dialog').open) designSelection = mapped;
    [input.scrollTop,input.scrollLeft] = scroll;
    paint();
  }
  function setPreview(enabled, persist = true) {
    previewing = Boolean(enabled && language === 'markdown');
    if (previewing) { refreshSyntax(); renderMarkdown(source, preview); }
    $('editor-source').hidden = previewing;
    preview.hidden = !previewing;
    $('btn-markdown-preview').setAttribute('aria-pressed', String(previewing));
    $('btn-markdown-preview').textContent = previewing ? 'Edit Markdown' : 'Preview Markdown';
    $('btn-line-numbers').disabled = previewing;
    if (persist) onOptionsChange({syntax, preview:previewing});
    if (!previewing) updateMetrics();
  }
  function focus() { (previewing ? preview : redline && !source ? title : lastTarget).focus(); }
  function revealSource() { if (previewing) { setPreview(false); focus(); } }
  function select(start, end) {
    revealSource(); restoreSelection(start,end,true);
    if (lastTarget === input) {
      const css = getComputedStyle(input), mirror = document.createElement('div');
      Object.assign(mirror.style, {
        position:'fixed', visibility:'hidden', left:'0', top:'0',
        width:`${input.clientWidth}px`, padding:css.padding, font:css.font,
        letterSpacing:css.letterSpacing, tabSize:css.tabSize,
        whiteSpace:input.wrap === 'off' ? 'pre' : 'pre-wrap', overflowWrap:'break-word',
      });
      mirror.textContent = input.value.slice(0,input.selectionStart);
      const marker = document.createElement('span');
      marker.textContent = input.value.slice(input.selectionStart,input.selectionEnd) || '.';
      mirror.append(marker); document.body.append(mirror);
      const rect = marker.getBoundingClientRect(), parent = mirror.getBoundingClientRect();
      input.scrollTop = Math.max(0,rect.top - parent.top - input.clientHeight / 2);
      input.scrollLeft = Math.max(0,rect.left - parent.left - input.clientWidth / 2);
      mirror.remove();
    }
    updateMetrics();
  }
  selector.addEventListener('change', () => {
    syntax = normalizeSyntax(selector.value); refreshSyntax();
    onOptionsChange({syntax, preview:previewing}); focus();
  });
  $('btn-markdown-preview').onclick = () => { refreshSyntax(); setPreview(!previewing); focus(); };
  preview.addEventListener('click', async e => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    e.preventDefault();
    try { await invoke('open_preview_link', {url:link.getAttribute('href')}); }
    catch (error) { toast(`Could not open link: ${error}`, {kind:'error'}); }
  });
  $('btn-line-numbers').setAttribute('aria-pressed', String(lineNumbers));
  $('btn-line-numbers').onclick = async () => {
    const button = $('btn-line-numbers'); button.disabled = true;
    try {
      await invoke('set_setting', {key:'line_numbers',value:String(!lineNumbers)});
      lineNumbers = !lineNumbers;
      document.documentElement.dataset.lineNumbers = String(lineNumbers);
      button.setAttribute('aria-pressed', String(lineNumbers)); metricKey = ''; updateMetrics();
    } catch (e) { toast(`Line numbers could not be saved: ${e}`, {kind:'error'}); }
    finally { button.disabled = previewing; }
  };
  input.addEventListener('focus', () => { lastTarget = input; });
  title.addEventListener('focus', () => { lastTarget = title; });
  $('settings-dialog').addEventListener('close', () => {
    if (!designSelection || previewing) { designSelection = null; return; }
    const [target,start,end] = designSelection; designSelection = null;
    target.focus(); target.setSelectionRange(start,end); updateMetrics();
  });
  input.addEventListener('input', changed); title.addEventListener('input', changed);
  for (const target of [input,title]) {
    target.addEventListener('compositionstart', () => { composing = true; clearTimeout(highlightTimer); });
    target.addEventListener('compositionend', () => { composing = false; clearTimeout(highlightTimer); highlightTimer = setTimeout(refreshSyntax,100); });
  }
  title.addEventListener('keydown', e => {
    const newline = document.documentElement.dataset.saveMode === 'enter' ? e.shiftKey : !e.shiftKey;
    if (e.key === 'Enter' && newline && !e.ctrlKey && !e.metaKey && !e.isComposing) {
      e.preventDefault();
      if (!source.includes('\n')) { source += '\n'; onChange(source); }
      input.focus();
    }
  });
  for (const target of [input,title]) ['click','keyup','scroll','select'].forEach(event => target.addEventListener(event,updateMetrics));
  new ResizeObserver(updateMetrics).observe(input);
  window.addEventListener('settle:design-changed',layoutChanged);
  window.addEventListener('settle:word-wrap-changed',layoutChanged);
  layoutChanged();
  return {input, title, setText, setBuffer, getText:() => source, focus, select, updateMetrics, revealSource};
}

export function createFind(editor) {
  const bar = $('find-bar'), input = $('find-input');
  let matches = [], selected = -1;
  function refresh() {
    matches = [];
    const query = input.value;
    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped,'giu');
      matches = [...editor.getText().matchAll(regex)].map(m => [m.index,m.index + m[0].length]);
    }
    selected = -1; $('find-count').textContent = `0 / ${matches.length}`;
  }
  function step(delta = 1) {
    if (!matches.length) return;
    selected = (selected + delta + matches.length) % matches.length;
    editor.select(...matches[selected]); $('find-count').textContent = `${selected + 1} / ${matches.length}`;
  }
  function open() { editor.revealSource(); bar.hidden = false; refresh(); input.focus(); input.select(); }
  function close() { bar.hidden = true; editor.focus(); }
  input.addEventListener('input',refresh);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); step(e.shiftKey ? -1 : 1); } });
  $('find-next').onclick = () => step(1); $('find-prev').onclick = () => step(-1); $('find-close').onclick = close;
  return {open, close, refresh, step, isOpen:() => !bar.hidden};
}
