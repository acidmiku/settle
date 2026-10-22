import { Editor, StarterKit, Markdown, TableKit, TaskList, TaskItem, Image, TextSelection, canSplit } from '../vendor/wysiwyg.js';
import { DOMPurify, marked } from '../vendor/editor.js';
import { $, editItem, characterStats, formatCount } from './utils.js';

// Image references survive Markdown round trips without contacting remote servers.
const LocalImage = Image.extend({
  renderHTML({node}) { return ['span', {class:'rich-image', contenteditable:'false'}, node.attrs.alt || 'Image']; },
}).configure({inline:true, allowBase64:true});

function isolateSelectedLines({tr}) {
  const selection = tr.selection, breaks = new Set();
  let first = Infinity, last = -Infinity;
  tr.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!node.isTextblock) return;
    const separators = [], start = pos + 1, end = start + node.content.size;
    if (['paragraph','heading'].includes(node.type.name)) node.forEach((child, offset) => {
      if (child.type.name === 'hardBreak') separators.push(start + offset);
      else if (child.isText) for (let i = 0; i < child.text.length; i++) {
        if (child.text[i] === '\n') separators.push(start + offset + i);
      }
    });
    let lineStart = start;
    for (let i = 0; i <= separators.length; i++) {
      const lineEnd = separators[i] ?? end;
      const selected = selection.empty
        ? selection.from >= lineStart && selection.from <= lineEnd
        : selection.from <= lineEnd && selection.to > lineStart;
      if (selected) {
        first = Math.min(first, lineStart); last = Math.max(last, lineEnd);
        if (i > 0) breaks.add(separators[i - 1]);
        if (i < separators.length) breaks.add(separators[i]);
      }
      lineStart = lineEnd + 1;
    }
    return false;
  });
  if (!Number.isFinite(first)) return true;
  // A Markdown paragraph can contain many visible lines. Split only the boundaries
  // touched by this selection, keeping surrounding text, inline marks and undo intact.
  const mappingStart = tr.mapping.maps.length;
  for (const pos of [...breaks].sort((a,b) => b - a)) {
    if (!canSplit(tr.doc, pos)) continue;
    tr.delete(pos, pos + 1).split(pos);
  }
  const mapping = tr.mapping.slice(mappingStart);
  const from = mapping.map(Math.max(selection.from, first), 1);
  const to = selection.empty ? from : mapping.map(Math.min(selection.to, last), -1);
  tr.setSelection(TextSelection.create(tr.doc, selection.anchor > selection.head ? to : from, selection.anchor > selection.head ? from : to));
  return true;
}

export function createRichEditor(text, onChange) {
  let hasHtml = false;
  marked.walkTokens(marked.lexer(text, {gfm:true}), token => { if (token.type === 'html') hasHtml = true; });
  if (hasHtml) throw new Error('This note contains raw HTML. Use source mode to preserve that markup.');
  let initialDoc;
  const toolbar = $('wysiwyg-toolbar');
  const editor = new Editor({
    element:$('rich-editor'), injectCSS:false,
    extensions:[
      StarterKit.configure({underline:false, trailingNode:false, link:{openOnClick:false, autolink:false, linkOnPaste:false}}),
      Markdown.configure({markedOptions:{gfm:true}}), TableKit, TaskList, TaskItem.configure({nested:true, HTMLAttributes:{'data-type':'taskItem'}}), LocalImage,
    ],
    content:text, contentType:'markdown',
    editorProps:{
      attributes:{role:'textbox', 'aria-label':'Rich text note editor', 'aria-multiline':'true', spellcheck:'true'},
      transformPastedHTML:html => DOMPurify.sanitize(html),
      handleClick:(_view, _pos, event) => { if (event.target.closest('a')) { event.preventDefault(); return true; } return false; },
    },
    onUpdate:({editor}) => {
      // A no-op toggle and undo back to the initial document preserve the exact source.
      onChange(initialDoc?.eq(editor.state.doc) ? text : editor.getMarkdown());
      updateToolbar();
    },
    onSelectionUpdate:() => updateToolbar(),
  });
  initialDoc = editor.state.doc;
  function updateToolbar() {
    const marks = {bold:'bold', italic:'italic', strike:'strike', code:'code', bullet:'bulletList', ordered:'orderedList', task:'taskList', quote:'blockquote', block:'codeBlock', link:'link'};
    for (const [action, name] of Object.entries(marks)) toolbar.querySelector(`[data-rich="${action}"]`)?.setAttribute('aria-pressed', String(editor.isActive(name)));
    $('rich-heading').value = String(editor.isActive('heading') ? editor.getAttributes('heading').level : 0);
    toolbar.querySelector('[data-rich="undo"]').disabled = !editor.can().undo();
    toolbar.querySelector('[data-rich="redo"]').disabled = !editor.can().redo();
    const {doc, selection} = editor.state, words = editor.getText().trim().split(/\s+/u).filter(Boolean).length;
    $('editor-stats').textContent = `${formatCount(words, 'word')} · ${characterStats(doc.textBetween(0, doc.content.size, '\n'), doc.textBetween(selection.from, selection.to, '\n'))}`;
  }
  const actions = {
    bold:() => editor.chain().focus().toggleBold().run(), italic:() => editor.chain().focus().toggleItalic().run(),
    strike:() => editor.chain().focus().toggleStrike().run(), code:() => editor.chain().focus().toggleCode().run(),
    bullet:() => editor.chain().focus().toggleBulletList().run(), ordered:() => editor.chain().focus().toggleOrderedList().run(),
    task:() => editor.chain().focus().toggleTaskList().run(), quote:() => editor.chain().focus().toggleBlockquote().run(),
    block:() => editor.chain().focus().toggleCodeBlock().run(), rule:() => editor.chain().focus().setHorizontalRule().run(),
    table:() => editor.chain().focus().insertTable({rows:3, cols:3, withHeaderRow:true}).run(),
    undo:() => editor.chain().focus().undo().run(), redo:() => editor.chain().focus().redo().run(),
    link:() => editItem({heading:'Edit link', label:'URL', value:editor.getAttributes('link').href || '', maxLength:2048, placeholder:'https://example.com',
      hint:'Use a web or email address. Leave blank to remove the link.', onSave:async value => {
        if (value && !/^(https?:\/\/|mailto:)/i.test(value)) throw new Error('Enter a URL starting with https://, http://, or mailto:.');
        if (value) editor.chain().focus().extendMarkRange('link').setLink({href:value}).run();
        else editor.chain().focus().extendMarkRange('link').unsetLink().run();
      }}),
  };
  function syncSelection() {
    // Native selects can take focus before the editor receives selectionchange.
    const selection = window.getSelection(), view = editor.view;
    if (!selection?.anchorNode || !view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return;
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
    const next = TextSelection.between(editor.state.doc.resolve(anchor), editor.state.doc.resolve(head));
    if (!next.eq(editor.state.selection)) view.dispatch(editor.state.tr.setSelection(next));
  }
  toolbar.onmousedown = event => { syncSelection(); if (event.target.closest('button')) event.preventDefault(); };
  toolbar.onfocusin = syncSelection;
  toolbar.onclick = event => { const action = event.target.closest('[data-rich]')?.dataset.rich; if (actions[action]) { actions[action](); updateToolbar(); } };
  $('rich-heading').onchange = event => {
    const level = Number(event.target.value);
    syncSelection();
    const chain = editor.chain().focus().command(isolateSelectedLines);
    if (level) chain.setHeading({level}).run();
    else chain.setParagraph().run();
    updateToolbar();
  };
  updateToolbar();
  return {focus:() => editor.commands.focus(), destroy:() => { editor.destroy(); $('rich-editor').replaceChildren(); }, refresh:updateToolbar};
}
