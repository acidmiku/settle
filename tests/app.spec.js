import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({page}, info) => {
  await page.addInitScript(({platform}) => {
    const data = JSON.parse(localStorage.getItem('test.db') || 'null') || { settings:{design:'scratch'}, notes:[] };
    window.testState = { data, calls:[], clipboard:'', fail:null, delay:0 };
    const persist = () => localStorage.setItem('test.db', JSON.stringify(data));
    window.__TAURI__ = {
      core: { async invoke(command,args = {}) {
        window.testState.calls.push({command,args});
        if (window.testState.delay && ['create_note','copy_to_clipboard'].includes(command)) await new Promise(r => setTimeout(r,window.testState.delay));
        if (window.testState.fail === command) throw new Error('Simulated failure');
        if (command === 'create_note' && args.content === window.testState.failContent) throw new Error('Simulated tab save failure');
        switch(command) {
          case 'get_settings': return data.settings;
          case 'get_runtime_info': return {platform,version:'0.2.1'};
          case 'get_start_with_os': return data.startWithOs === true;
          case 'set_start_with_os': data.startWithOs = args.enabled; persist(); return data.startWithOs;
          case 'check_for_update': return window.testState.update || null;
          case 'install_update': {
            window.testState.installedWorkspace = data.settings.workspace;
            window.testState['settle:update-progress']?.({payload:{phase:'downloading',downloaded:50,total:100}});
            await new Promise(r => setTimeout(r,200));
            window.testState['settle:update-progress']?.({payload:{phase:'installing'}});
            return;
          }
          case 'get_db_info': return { path:'/local/settle.sqlite3', size_bytes:12345 };
          case 'set_setting': data.settings[args.key] = args.value; persist(); return;
          case 'create_note': {
            const note = {id:crypto.randomUUID(),content:args.content,local_date:'2026-10-15',local_time:'14:22:00',tags:[]};
            data.notes.push(note); persist(); return note;
          }
          case 'update_note': data.notes.find(n => n.id === args.noteId).content = args.content; persist(); return;
          case 'delete_note': data.notes = data.notes.filter(n => n.id !== args.noteId); persist(); return;
          case 'list_dates': return data.notes.length ? [{local_date:'2026-10-15',note_count:data.notes.length}] : [];
          case 'list_notes_for_date': return data.notes.filter(n => n.local_date === args.localDate);
          case 'search': return data.notes.filter(n => n.content.toLowerCase().includes(args.query.toLowerCase())).map(n => ({...n,snippet:n.content}));
          case 'copy_to_clipboard': window.testState.clipboard = args.text; return;
          case 'open_preview_link': window.testState.openedUrl = args.url; return;
          case 'hide_main_window': window.testState.hidden = true; return;
          case 'export_json': case 'export_markdown': return {files_written:1, export_dir:'/local/exports/test'};
          default: throw new Error(`Unexpected command ${command}`);
        }
      } },
      event: { async listen(name,handler) { window.testState[name] = handler; return () => { delete window.testState[name]; }; } },
    };
  }, { platform:info.project.name.startsWith('macos') ? 'macos' : 'windows' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
});

const mod = info => info.project.name.startsWith('macos') ? 'Meta' : 'Control';
const sample = 'Desk rebuild\n\nTry the smaller enclosure.\nMove the power connector to the back.\nLeave enough clearance for the cable.\n\nMeasure the shelf before printing.';

test('startup toggle reflects the OS, survives reload and recovers from errors', async ({page},info) => {
  await page.keyboard.press(`${mod(info)}+,`);
  const toggle = page.locator('#set-start-with-os');
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator('#startup-status')).toContainText('will open');
  await page.reload();
  await page.keyboard.press(`${mod(info)}+,`);
  await expect(toggle).toBeChecked();
  await page.evaluate(() => { window.testState.fail = 'set_start_with_os'; });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('#startup-status')).toContainText('Could not change');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.testState.fail = 'get_start_with_os'; });
  await page.keyboard.press(`${mod(info)}+,`);
  await expect(toggle).toBeDisabled();
  await expect(page.locator('#startup-status')).toContainText('Could not read');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.testState.fail = null; window.testState.data.startWithOs = false; });
  await page.keyboard.press(`${mod(info)}+,`);
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
});

test('update checks are manual and hide stale offers after failed or current checks', async ({page},info) => {
  await page.keyboard.press(`${mod(info)}+,`);
  await expect(page.locator('#app-version')).toHaveText('Settle 0.2.1');
  const check = page.locator('#btn-check-update'), install = page.locator('#btn-install-update');
  expect(await page.evaluate(() => window.testState.calls.some(c => c.command === 'check_for_update'))).toBe(false);
  await expect(install).toBeHidden();
  await check.click();
  await expect(page.locator('#update-status')).toContainText('up to date');
  await page.evaluate(() => { window.testState.update = {version:'0.2.2',notes:'<img src=x onerror=alert(1)> New features'}; });
  await check.click();
  await expect(install).toBeVisible();
  await expect(page.locator('#update-status')).toContainText('0.2.2');
  await expect(page.locator('#update-notes img')).toHaveCount(0);
  await page.evaluate(() => { window.testState.fail = 'check_for_update'; });
  await check.click();
  await expect(install).toBeHidden();
  await expect(page.locator('#update-status')).toContainText('Could not check');
  await page.evaluate(() => { window.testState.fail = null; window.testState.update = null; });
  await check.click();
  await expect(install).toBeHidden();
  await expect(page.locator('#update-status')).toContainText('up to date');
});

test('update installation requires a successful draft backup, retries and locks editing during restart', async ({page},info) => {
  const editor = page.locator('#note-input');
  await editor.fill('Unsaved draft before update');
  await page.keyboard.press(`${mod(info)}+,`);
  await page.evaluate(() => { window.testState.update = {version:'0.2.2',notes:'New features'}; });
  await page.locator('#btn-check-update').click();
  await page.evaluate(() => { window.testState.fail = 'set_setting'; });
  await page.locator('#btn-install-update').click();
  await expect(page.locator('#update-status')).toContainText('Draft backup is pending');
  expect(await page.evaluate(() => window.testState.calls.some(c => c.command === 'install_update'))).toBe(false);
  await expect(page.locator('#settings-dialog')).not.toHaveAttribute('inert','');
  await page.evaluate(() => { window.testState.fail = 'install_update'; });
  await page.locator('#btn-install-update').click();
  await expect(page.locator('#update-status')).toContainText('Simulated failure');
  await page.keyboard.press('Escape');
  await editor.fill('Draft edited after failed update');
  await page.keyboard.press(`${mod(info)}+,`);
  await page.evaluate(() => { window.testState.fail = null; });
  await page.locator('#btn-install-update').click();
  await expect(page.locator('#update-status')).toContainText('50%');
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await expect(editor).toHaveAttribute('readonly','');
  await expect(page.locator('#update-status')).toHaveText('Restarting Settle…');
  const saved = await page.evaluate(() => JSON.parse(window.testState.installedWorkspace));
  expect(saved.buffers[0].text).toBe('Draft edited after failed update');
  await page.reload();
  await expect(editor).toHaveValue('Draft edited after failed update');
});

test('editor owns the window; all ten designs preserve content and persist', async ({page},info) => {
  const editor = page.locator('#note-input');
  await expect(editor).toBeFocused();
  await expect(page.locator('.buffer-tab')).toHaveCount(1);
  await expect(page.getByRole('navigation', {name:'Writing mode'})).toHaveCount(0);
  expect((await editor.boundingBox()).height).toBeGreaterThan(550);
  await editor.fill(sample);
  await page.keyboard.press(`${mod(info)}+,`);
  await expect(page.locator('.design-option')).toHaveCount(10);
  const designs = ['kiln','blackbox','optic','phosphor','sidecar','cobalt','scratch','redline','frost','tape'];
  await mkdir('.qa/screenshots', {recursive:true});
  for (const design of designs) {
    await page.locator(`.design-option[data-value="${design}"]`).click();
    await expect.poll(() => page.evaluate(() => window.testState.data.settings.design)).toBe(design);
    await page.keyboard.press('Escape');
    if (design === 'redline') { await expect(page.locator('#note-title')).toHaveValue('Desk rebuild'); }
    else await expect(editor).toHaveValue(sample);
    await page.screenshot({path:`.qa/screenshots/${info.project.name}-${design}.png`});
    await page.keyboard.press(`${mod(info)}+,`);
  }
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-design','tape');
  await expect(editor).toHaveValue(sample);
  expect(await page.locator('body').innerText()).not.toMatch(/Second Brain|Summarize|API Key/);
});

test('save, reopen, edit and delete a note with a recoverable draft', async ({page},info) => {
  await page.locator('#note-input').fill('First thought #work');
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('#note-input')).toHaveValue('');
  await page.keyboard.press(`${mod(info)}+Shift+h`);
  await page.locator('.history-open').click();
  await expect(page.locator('#note-input')).toHaveValue('First thought #work');
  await page.locator('#note-input').fill('A better thought');
  await page.keyboard.press('Shift+Enter');
  await expect.poll(() => page.evaluate(() => window.testState.data.notes[0].content)).toBe('A better thought');
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.length)).toBe(1);
  await page.locator('.delete-note').click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.length)).toBe(0);
  await expect(page.locator('#note-input')).toHaveValue('A better thought');
});

test('draft tabs survive an immediate reload and share one save behavior', async ({page},info) => {
  await page.locator('#note-input').fill('Unfinished note');
  await page.keyboard.press(`${mod(info)}+n`);
  await page.locator('#note-input').fill('Second draft');
  await page.reload();
  await expect(page.locator('#note-input')).toHaveValue('Second draft');
  await expect(page.locator('.buffer-tab')).toHaveCount(2);
  await page.locator('.buffer-tab').first().click();
  await expect(page.locator('#note-input')).toHaveValue('Unfinished note');
  await page.keyboard.press('Shift+Enter');
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.length)).toBe(1);
  await expect(page.locator('#note-input')).toHaveValue('');
  await page.locator('.buffer-tab').last().click();
  await expect(page.locator('#note-input')).toHaveValue('Second draft');
});

for (const source of ['cache','database']) {
  test(`merges legacy modes from the newer ${source} without losing text or saved-note links`, async ({page}) => {
    await expect.poll(() => page.evaluate(() => Boolean(window.testState.data.settings.workspace))).toBe(true);
    await page.evaluate(source => {
      const old = JSON.stringify({
        version:2, updatedAt:2, mode:'scratch', active:{note:'n',scratch:'s2'},
        buffers:[
          {id:'n',mode:'note',text:'Edited note  \n',noteId:'saved',original:'Saved note'},
          {id:'s1',mode:'scratch',text:'First scratch  \n',noteId:null,original:''},
          {id:'s2',mode:'scratch',text:'Second scratch\n世界',noteId:null,original:''},
        ],
      });
      const stale = JSON.stringify({version:3,updatedAt:1,activeId:'stale',buffers:[{id:'stale',text:'Stale draft'}]});
      localStorage.setItem('settle.workspace.v3', stale);
      if (source === 'cache') localStorage.setItem('settle.workspace.v2', old);
      const data = window.testState.data;
      data.settings.workspace = source === 'database' ? old : stale;
      data.notes = [{id:'saved',content:'Saved note',local_date:'2026-10-15',local_time:'14:22:00',tags:[]}];
      localStorage.setItem('test.db', JSON.stringify(data));
    }, source);
    await page.reload();
    const editor = page.locator('#note-input');
    await expect(editor).toHaveValue('Second scratch\n世界');
    await expect(page.locator('.buffer-tab')).toHaveText(['Edited note','First scratch','Second scratch']);
    await page.locator('.buffer-tab').nth(1).click();
    await expect(editor).toHaveValue('First scratch  \n');
    await page.locator('#btn-save').click();
    await expect(editor).toHaveValue('');
    await expect.poll(() => page.evaluate(() => window.testState.data.notes.length)).toBe(2);
    await page.locator('.buffer-tab').first().click();
    await expect(editor).toHaveValue('Edited note  \n');
    await expect(page.locator('#save-label')).toHaveText('Update');
    await page.locator('#btn-save').click();
    await expect.poll(() => page.evaluate(() => window.testState.data.notes[0].content)).toBe('Edited note  \n');
    await expect(editor).toHaveValue('Edited note  \n');
    await expect.poll(() => page.evaluate(() => JSON.parse(window.testState.data.settings.workspace).version)).toBe(3);
    expect(await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('settle.workspace.v3'));
      return !('mode' in saved) && saved.buffers.every(b => !('mode' in b)) && localStorage.getItem('settle.workspace.v2') === null;
    })).toBe(true);
    await page.reload();
    await expect(editor).toHaveValue('Edited note  \n');
    await page.locator('.buffer-tab').last().click();
    await expect(editor).toHaveValue('Second scratch\n世界');
  });
}

test('clipboard failure and delayed save never clear newer typing', async ({page},info) => {
  const editor = page.locator('#note-input');
  await editor.fill('Keep me');
  await page.evaluate(() => { window.testState.fail = 'copy_to_clipboard'; });
  await page.keyboard.press(`${mod(info)}+Enter`);
  await expect(page.locator('.toast')).toContainText('your text is still here');
  await expect(editor).toHaveValue('Keep me');
  await page.evaluate(() => { window.testState.fail = null; window.testState.delay = 500; });
  await page.keyboard.press('Shift+Enter');
  await editor.fill('Newer typing');
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.length)).toBe(1);
  await expect(editor).toHaveValue('Newer typing');
  await page.keyboard.press(`${mod(info)}+Enter`);
  await expect(editor).toHaveValue('');
  expect(await page.evaluate(() => window.testState.clipboard)).toBe('Newer typing');
});

test('find, search, IME and modal Escape stay scoped', async ({page},info) => {
  const editor = page.locator('#note-input');
  await editor.fill('alpha beta alpha <script>');
  await editor.dispatchEvent('keydown', {key:'Enter',shiftKey:true,isComposing:true});
  expect(await page.evaluate(() => window.testState.data.notes.length)).toBe(0);
  await page.keyboard.press(`${mod(info)}+f`);
  await page.locator('#find-input').fill('alpha');
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-count')).toHaveText('1 / 2');
  await page.locator('#find-next').click();
  await expect(page.locator('#find-count')).toHaveText('2 / 2');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.testState.hidden)).toBeUndefined();
  await page.keyboard.press('Shift+Enter');
  await expect(editor).toHaveValue('');
  await page.keyboard.press(`${mod(info)}+k`);
  await page.locator('#search-input').fill('alpha');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await expect(page.locator('.search-result')).toContainText('<script>');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('alpha beta alpha <script>');
  await page.keyboard.press(`${mod(info)}+,`);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.testState.hidden)).toBeUndefined();
});

test('enter setting, hotkey failure, and compact layouts', async ({page},info) => {
  await page.keyboard.press(`${mod(info)}+,`);
  await page.locator('#set-enter-save').check();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.saveMode)).toBe('enter');
  await page.evaluate(() => { window.testState.fail = 'set_setting'; });
  await page.locator('#set-hotkey').fill('not a shortcut');
  await page.locator('#hotkey-form button').click();
  await expect(page.locator('#hotkey-status')).toContainText('Could not apply');
  await page.keyboard.press('Escape');
  await page.locator('#note-input').fill('Enter saves');
  await page.keyboard.press('Enter');
  await expect(page.locator('#note-input')).toHaveValue('');
  await page.setViewportSize({width:620,height:420});
  for (const design of ['kiln','blackbox','scratch','optic','phosphor','sidecar','redline','cobalt','frost','tape']) {
    await page.evaluate(design => { document.documentElement.dataset.design = design; window.dispatchEvent(new Event('settle:design-changed')); }, design);
    for (const id of ['note-input','btn-save','btn-copy','btn-hide']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(621);
      expect(box.y + box.height).toBeLessThanOrEqual(421);
    }
  }
});

test('design changes preserve the caret; find reveals distant matches', async ({page},info) => {
  const editor = page.locator('#note-input');
  await editor.fill('Title\n' + 'x'.repeat(250) + ' needle');
  await editor.evaluate(el => el.setSelectionRange(4,4));
  await page.keyboard.press(`${mod(info)}+,`);
  await page.locator('#set-word-wrap').uncheck();
  await expect(editor).toHaveAttribute('wrap','off');
  await page.locator('.design-option[data-value="redline"]').click();
  await expect.poll(() => page.evaluate(() => window.testState.data.settings.design)).toBe('redline');
  await page.locator('.design-option[data-value="scratch"]').click();
  await expect.poll(() => page.evaluate(() => window.testState.data.settings.design)).toBe('scratch');
  await page.keyboard.press('Escape');
  await expect.poll(() => editor.evaluate(el => el.selectionStart)).toBe(4);
  await page.keyboard.press(`${mod(info)}+f`);
  await page.locator('#find-input').fill('needle');
  await page.keyboard.press('Enter');
  await expect.poll(() => editor.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
});

test('syntax autodetect, manual overrides and per-tab preferences survive reload', async ({page},info) => {
  const editor = page.locator('#note-input'), selector = page.locator('#syntax-select');
  const code = 'const answer = "hello";\nfunction greet(name) {\n  return `${answer}, ${name}`;\n}';
  await editor.dispatchEvent('compositionstart');
  await editor.fill(code);
  await page.waitForTimeout(150);
  await expect(page.locator('html')).toHaveAttribute('data-language','plaintext');
  await editor.dispatchEvent('compositionend');
  await expect(page.locator('html')).toHaveAttribute('data-language','javascript');
  await expect(page.locator('#syntax-content .hljs-keyword').first()).toBeVisible();
  expect(await page.locator('#syntax-content').textContent()).toBe(code + '\n');
  await selector.selectOption('plaintext');
  await expect(page.locator('#syntax-layer')).toBeHidden();
  await page.keyboard.press(`${mod(info)}+n`);
  await editor.fill('{"enabled": true, "count": 42}');
  await expect(page.locator('html')).toHaveAttribute('data-language','json');
  await selector.selectOption('rust');
  await page.reload();
  await expect(selector).toHaveValue('rust');
  await page.locator('.buffer-tab').first().click();
  await expect(selector).toHaveValue('plaintext');
  await expect(editor).toHaveValue(code);
  await page.keyboard.press(`${mod(info)}+,`);
  await page.locator('#set-word-wrap').uncheck();
  await expect(editor).toHaveAttribute('wrap','off');
  await page.keyboard.press('Escape');
  await selector.selectOption('javascript');
  await editor.fill('const distant = "' + 'x'.repeat(250) + '";\n'.repeat(60) + 'return distant;');
  await editor.evaluate(el => { el.scrollTop = el.scrollHeight; el.scrollLeft = 300; el.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.evaluate(() => Math.abs(document.getElementById('syntax-layer').scrollTop - document.getElementById('note-input').scrollTop))).toBeLessThan(2);
  await expect.poll(() => page.evaluate(() => Math.abs(document.getElementById('syntax-layer').scrollLeft - document.getElementById('note-input').scrollLeft))).toBeLessThan(2);
  await page.screenshot({path:`.qa/screenshots/${info.project.name}-syntax.png`});
  await selector.selectOption('plaintext');
  await editor.fill('');
  await page.evaluate(() => { document.documentElement.dataset.design = 'redline'; window.dispatchEvent(new Event('settle:design-changed')); });
  await selector.selectOption('auto');
  await page.locator('#note-title').fill('# A Markdown heading');
  await expect(page.locator('html')).toHaveAttribute('data-language','markdown');
  await expect(editor).toHaveValue('# A Markdown heading');
  await expect(editor).toBeFocused();
});

test('word wrap defaults on, aligns highlighted lines in every design and persists', async ({page},info) => {
  const editor = page.locator('#note-input'), toggle = page.locator('#set-word-wrap');
  const text = 'const message = "' + 'long words '.repeat(30) + '";\nconst token = "' + 'x'.repeat(300) + '";\nreturn message;';
  await page.locator('#syntax-select').selectOption('javascript');
  await editor.fill(text);
  await expect(editor).toHaveAttribute('wrap','soft');
  await page.keyboard.press(`${mod(info)}+,`);
  await expect(toggle).toBeChecked();
  await page.keyboard.press('Escape');
  const designs = ['kiln','blackbox','optic','phosphor','sidecar','cobalt','scratch','redline','frost','tape'];
  for (const enabled of [true,false]) {
    if (!enabled) {
      await editor.focus();
      await editor.evaluate(el => el.setSelectionRange(8,15));
      await page.keyboard.press(`${mod(info)}+,`);
      await toggle.uncheck();
      await expect(editor).toHaveAttribute('wrap','off');
      await page.keyboard.press('Escape');
      expect(await editor.evaluate(el => [el.selectionStart,el.selectionEnd])).toEqual([8,15]);
    }
    for (const design of designs) {
      await page.evaluate(design => { document.documentElement.dataset.design = design; window.dispatchEvent(new Event('settle:design-changed')); },design);
      await expect(editor).toHaveValue(text);
      await expect(editor).toHaveAttribute('wrap',enabled ? 'soft' : 'off');
      await expect.poll(() => editor.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(!enabled);
      const lineHeight = await editor.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
      const firstNumber = page.locator('#line-number-content span').first();
      if (enabled) expect(await firstNumber.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(lineHeight * 2);
      else expect(await firstNumber.evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(lineHeight,0);
      // The highlighted third line must start at the same height as its gutter,
      // after both a paragraph and a long unbroken token have wrapped.
      await expect.poll(() => page.evaluate(() => {
        const token = [...document.querySelectorAll('#syntax-content .hljs-keyword')].find(el => el.textContent === 'return');
        const number = document.querySelector('#line-number-content').children[2];
        const leading = parseFloat(getComputedStyle(document.getElementById('note-input')).lineHeight);
        return Math.abs(token.getBoundingClientRect().top - number.getBoundingClientRect().top) / leading;
      })).toBeLessThan(.5);
    }
  }
  await page.reload();
  await expect(editor).toHaveAttribute('wrap','off');
  await expect(editor).toHaveValue(text);
  await page.keyboard.press(`${mod(info)}+n`);
  await page.locator('#syntax-select').selectOption('markdown');
  await editor.fill('# Heading\n' + 'Markdown words '.repeat(50));
  await expect(editor).toHaveAttribute('wrap','off');
  await page.locator('#btn-markdown-preview').click();
  await page.keyboard.press(`${mod(info)}+,`);
  await expect(toggle).not.toBeChecked();
  await page.evaluate(() => { window.testState.fail = 'set_setting'; });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(editor).toHaveAttribute('wrap','off');
  await page.evaluate(() => { window.testState.fail = null; });
  await toggle.check();
  await expect(editor).toHaveAttribute('wrap','soft');
  await page.keyboard.press('Escape');
  await expect(page.locator('#markdown-preview')).toBeVisible();
  await page.locator('#btn-markdown-preview').click();
  await expect.poll(() => editor.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThan(2);
  await page.reload();
  await expect(editor).toHaveAttribute('wrap','soft');
  await page.locator('.buffer-tab').first().click();
  await expect(editor).toHaveValue(text);
  await expect(editor).toHaveAttribute('wrap','soft');
});

test('line numbers toggle across all themes, align wrapped lines and persist', async ({page},info) => {
  const editor = page.locator('#note-input');
  await page.locator('#syntax-select').selectOption('plaintext');
  await editor.fill('One\nTwo\nThree');
  for (const design of ['kiln','blackbox','optic','phosphor','sidecar','cobalt','scratch','redline','frost','tape']) {
    await page.evaluate(design => { document.documentElement.dataset.design = design; window.dispatchEvent(new Event('settle:design-changed')); },design);
    await expect(page.locator('#line-numbers')).toBeVisible();
    await page.locator('#btn-line-numbers').click();
    await expect(page.locator('#line-numbers')).toBeHidden();
    await page.locator('#btn-line-numbers').click();
    await expect(page.locator('#line-numbers')).toBeVisible();
    const numbers = await page.locator('#line-number-content').innerText();
    expect(numbers.trim()).toBe(design === 'redline' ? '2\n3' : design === 'optic' ? '01\n02\n03' : '1\n2\n3');
  }
  await page.evaluate(() => { document.documentElement.dataset.design = 'blackbox'; window.dispatchEvent(new Event('settle:design-changed')); });
  await editor.fill('Long words '.repeat(45) + '\nSecond line');
  expect(await page.locator('#line-number-content span').first().evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(72);
  await page.screenshot({path:`.qa/screenshots/${info.project.name}-wrapped-lines.png`});
  await page.locator('#btn-line-numbers').click();
  await page.reload();
  await expect(page.locator('#line-numbers')).toBeHidden();
  await expect(page.locator('#btn-line-numbers')).toHaveAttribute('aria-pressed','false');
});

test('Markdown preview renders safely, preserves source and works with save and find', async ({page},info) => {
  const editor = page.locator('#note-input'), previewButton = page.locator('#btn-markdown-preview');
  await expect(previewButton).toBeHidden();
  const markdown = '# Release notes\n\n**Ready** to write.\n\n- [x] Editor\n- [ ] More coffee\n\n| Name | Value |\n| --- | --- |\n| Build | 42 |\n\n```js\nconst ready = true;\n```\n\n[Website](https://example.com)\n\n<script>window.previewPwned = true</script>\n<img src="https://example.com/tracker" onerror="window.previewPwned = true">\n[bad](javascript:alert(1))\n<iframe srcdoc="<script>alert(1)</script>"></iframe>';
  await editor.fill(markdown);
  await expect(page.locator('html')).toHaveAttribute('data-language','markdown');
  await expect(previewButton).toBeVisible();
  await editor.evaluate(el => el.setSelectionRange(4,9));
  await previewButton.click();
  await expect(editor).toBeHidden();
  await expect(page.locator('#markdown-preview h1')).toHaveText('Release notes');
  await expect(page.locator('#markdown-preview table')).toBeVisible();
  await expect(page.locator('#markdown-preview .hljs-keyword')).toHaveText('const');
  await expect(page.locator('#markdown-preview input').first()).toBeChecked();
  await expect(page.locator('#markdown-preview input').first()).toBeDisabled();
  expect(await page.evaluate(() => window.previewPwned)).toBeUndefined();
  await expect(page.locator('#markdown-preview script, #markdown-preview iframe, #markdown-preview [onerror], #markdown-preview a[href^="javascript:"]')).toHaveCount(0);
  await page.locator('#markdown-preview a', {hasText:'Website'}).click();
  expect(await page.evaluate(() => window.testState.openedUrl)).toBe('https://example.com');
  await page.screenshot({path:`.qa/screenshots/${info.project.name}-markdown.png`});
  await previewButton.click();
  await expect(editor).toHaveValue(markdown);
  expect(await editor.evaluate(el => [el.selectionStart,el.selectionEnd])).toEqual([4,9]);
  await previewButton.click();
  await page.keyboard.press(`${mod(info)}+f`);
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await previewButton.click();
  await page.keyboard.press(`${mod(info)}+s`);
  await expect.poll(() => page.evaluate(() => window.testState.data.notes[0]?.content)).toBe(markdown);
  await expect(editor).toHaveValue('');
  await expect(editor).toBeVisible();
  await page.locator('#syntax-select').selectOption('markdown');
  await editor.fill('Plain words');
  await previewButton.click();
  await page.reload();
  await expect(page.locator('#markdown-preview')).toBeVisible();
  await expect(page.locator('#markdown-preview')).toHaveText('Plain words');
  await page.locator('#syntax-select').selectOption('plaintext');
  await expect(previewButton).toBeHidden();
  await expect(editor).toHaveValue('Plain words');
});

test('Ctrl/Cmd+S creates and updates notes without duplicates', async ({page},info) => {
  await page.locator('#note-input').fill('Hotkey note');
  await page.keyboard.press(`${mod(info)}+s`);
  await expect(page.locator('#note-input')).toHaveValue('');
  await page.keyboard.press(`${mod(info)}+Shift+h`);
  await page.locator('.history-open').click();
  await page.locator('#note-input').fill('Hotkey update');
  await page.keyboard.press(`${mod(info)}+s`);
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.map(n => n.content))).toEqual(['Hotkey update']);
  await expect(page.locator('#note-input')).toHaveValue('Hotkey update');
});

test('tab context menu targets the clicked tab, supports keyboard and confirms discard all', async ({page},info) => {
  const editor = page.locator('#note-input');
  await editor.fill('Keep this');
  await page.locator('.buffer-bar').click({button:'right'});
  await page.getByRole('menuitem', {name:'New tab',exact:true}).click();
  await editor.fill('Discard this');
  await page.locator('.buffer-tab').first().click();
  await page.locator('.buffer-tab').last().click({button:'right'});
  await page.getByRole('menuitem', {name:'Close tab',exact:true}).click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('.buffer-tab')).toHaveCount(1);
  await expect(editor).toHaveValue('Keep this');
  await page.locator('.buffer-tab').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  expect(await page.evaluate(() => window.testState.hidden)).toBeUndefined();
  await page.locator('.buffer-bar').click({button:'right'});
  await page.getByRole('menuitem', {name:'Close all without saving…',exact:true}).click();
  await page.locator('#confirm-cancel').click();
  await expect(editor).toHaveValue('Keep this');
  await page.locator('.buffer-bar').click({button:'right'});
  await page.getByRole('menuitem', {name:'Close all without saving…',exact:true}).click();
  await page.locator('#confirm-ok').click();
  await expect(editor).toHaveValue('');
  expect(await page.evaluate(() => window.testState.data.notes)).toHaveLength(0);
});

test('close all saves every tab, retains tabs on partial failure and retries without duplicates', async ({page},info) => {
  const editor = page.locator('#note-input');
  await editor.fill('First tab');
  await page.keyboard.press(`${mod(info)}+n`);
  await editor.fill('Second tab');
  await page.evaluate(() => { window.testState.failContent = 'Second tab'; });
  await page.locator('.buffer-bar').click({button:'right'});
  await page.getByRole('menuitem', {name:'Close all with saving',exact:true}).click();
  await expect(page.locator('.toast').last()).toContainText('All tabs are still open');
  await expect(page.locator('.buffer-tab')).toHaveCount(2);
  await expect(editor).toHaveValue('Second tab');
  expect(await page.evaluate(() => window.testState.data.notes.map(n => n.content))).toEqual(['First tab']);
  await page.reload();
  await page.locator('.buffer-tab').first().click();
  await expect(page.locator('#save-label')).toHaveText('Update');
  await editor.fill('First tab updated');
  await page.locator('.buffer-bar').click({button:'right'});
  await page.getByRole('menuitem', {name:'Close all with saving',exact:true}).click();
  await expect(page.locator('.buffer-tab')).toHaveCount(1);
  await expect(editor).toHaveValue('');
  expect(await page.evaluate(() => window.testState.data.notes.map(n => n.content))).toEqual(['First tab updated','Second tab']);
});
