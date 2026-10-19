import { invoke } from './api.js';
import { $ } from './utils.js';
import { toast } from './toast.js';
import { createContextMenu } from './context-menu.js';

export const TAB_SIZES = [2,4,8];

// Visual column of `index`, with tabs expanded to the next stop.
function column(text, lineStart, index, size) {
  let col = 0;
  for (let i = lineStart; i < index; i++) col = text[i] === '\t' ? col + size - col % size : col + 1;
  return col;
}
// Leading whitespace worth one indent level: a tab, or up to `size` columns of spaces.
function indentWidth(line, size) {
  let count = 0, width = 0;
  while (width < size && count < line.length) {
    if (line[count] === '\t') return count + 1;
    if (line[count] !== ' ') break;
    count++; width++;
  }
  return count;
}

// Describes the replacement and the selection afterwards, or null when nothing changes.
export function indentEdit(text, start, end, {outdent = false, spaces = false, size = 4} = {}) {
  const lineStart = start ? text.lastIndexOf('\n', start - 1) + 1 : 0;
  if (!outdent && !text.slice(start, end).includes('\n')) {
    const insert = spaces ? ' '.repeat(size - column(text, lineStart, start, size) % size) : '\t';
    return {from:start, to:end, insert, start:start + insert.length, end:start + insert.length};
  }
  // A selection that ends at the start of a line leaves that line alone.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const blockEnd = text.indexOf('\n', last) < 0 ? text.length : text.indexOf('\n', last);
  const unit = spaces ? ' '.repeat(size) : '\t', edits = [];
  let at = lineStart;
  const lines = text.slice(lineStart, blockEnd).split('\n').map(line => {
    const removed = outdent ? indentWidth(line, size) : 0, inserted = outdent || !line ? '' : unit;
    if (removed || inserted) edits.push({at, removed, inserted:inserted.length});
    at += line.length + 1;
    return inserted + line.slice(removed);
  });
  if (!edits.length) return null;
  const map = position => edits.reduce((shift, edit) => edit.at >= position ? shift
    : shift + edit.inserted - Math.min(edit.removed, position - edit.at), position);
  // Replace only the changed span so native undo restores a tight selection.
  const before = text.slice(lineStart, blockEnd), after = lines.join('\n');
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return {from:lineStart + prefix, to:blockEnd - suffix, insert:after.slice(prefix, after.length - suffix), start:map(start), end:map(end)};
}

function applyEdit(input, edit) {
  input.setSelectionRange(edit.from, edit.to);
  // execCommand keeps the edit on the textarea's native undo stack.
  if (!document.execCommand(edit.insert ? 'insertText' : 'delete', false, edit.insert)) {
    input.setRangeText(edit.insert, edit.from, edit.to);
    input.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:edit.insert}));
  }
  input.setSelectionRange(edit.start, edit.end);
}

export function createIndent(editor, settings) {
  const input = editor.input, button = $('btn-indent'), menu = createContextMenu($('indent-menu'));
  let state = {
    tab_size:TAB_SIZES.includes(Number(settings.tab_size)) ? Number(settings.tab_size) : 4,
    indent_spaces:settings.indent_spaces === 'true',
    show_whitespace:settings.show_whitespace === 'true',
  }, menuWasOpen = false;
  function apply() {
    document.documentElement.style.setProperty('--tab-size', String(state.tab_size));
    $('indent-label').textContent = `${state.indent_spaces ? 'Spaces' : 'Tab size'}: ${state.tab_size}`;
    // Repainting also remeasures wrapped lines for the new tab width.
    editor.setWhitespace(state.show_whitespace);
  }
  async function change(key, value) {
    const previous = state;
    state = {...state, [key]:value};
    apply(); editor.focus();
    try { await invoke('set_setting', {key, value:String(value)}); settings[key] = String(value); }
    catch (error) {
      state = previous; apply();
      toast(`Indentation could not be saved: ${error}`, {kind:'error'});
    }
  }
  input.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.keyCode === 229 || input.readOnly) return;
    e.preventDefault();
    const edit = indentEdit(input.value, input.selectionStart, input.selectionEnd, {outdent:e.shiftKey, spaces:state.indent_spaces, size:state.tab_size});
    if (edit) applyEdit(input, edit);
  });
  // The menu closes on pointerdown, so a second click on the button should not reopen it.
  button.addEventListener('pointerdown', () => { menuWasOpen = !$('indent-menu').hidden; });
  button.addEventListener('click', event => {
    if (menuWasOpen) { menuWasOpen = false; return; }
    menu.open(event, [
      {label:'Indent using spaces', checked:state.indent_spaces, action:() => change('indent_spaces', !state.indent_spaces)},
      {label:'Show tabs and spaces', checked:state.show_whitespace, action:() => change('show_whitespace', !state.show_whitespace)},
      {separator:true},
      ...TAB_SIZES.map(n => ({label:`Tab size: ${n}`, checked:n === state.tab_size, radio:true, action:() => change('tab_size', n)})),
    ], button);
  });
  apply();
}
