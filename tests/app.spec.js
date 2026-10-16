import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installTestBridge } from './bridge.js';

test.beforeEach(async ({page}, info) => {
  await page.addInitScript(installTestBridge, { platform:info.project.name.startsWith('macos') ? 'macos' : 'windows' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
});

const mod = info => info.project.name.startsWith('macos') ? 'Meta' : 'Control';
const sample = 'Desk rebuild\n\nTry the smaller enclosure.\nMove the power connector to the back.\nLeave enough clearance for the cable.\n\nMeasure the shelf before printing.';

test('library groups every date and pages without duplicate notes', async ({page}) => {
  await page.evaluate(() => {
    window.testState.data.notes = Array.from({length:125}, (_,i) => ({id:`note-${String(i).padStart(3,'0')}`,content:`Note ${i}`,local_date:i < 60 ? '2026-10-14' : '2026-10-15',local_time:'10:00:00'}));
  });
  await page.locator('#btn-history').click();
  await expect(page.locator('#history-date')).toHaveCount(0);
  await expect(page.locator('.history-item')).toHaveCount(100);
  await expect(page.locator('.note-date-label')).toHaveCount(2);
  await expect(page.locator('.history-open').first()).toHaveText('Note 124');
  await page.locator('#history-more').click();
  await expect(page.locator('.history-item')).toHaveCount(125);
  await expect(page.locator('.note-date-label')).toHaveCount(2);
  await expect(page.locator('#history-more')).toBeHidden();
  expect(await page.locator('.history-item').evaluateAll(items => new Set(items.map(el => el.dataset.noteId)).size)).toBe(125);
});

test('rename from list and tabs preserves text and unsaved edits and is searchable', async ({page},info) => {
  const input = page.locator('#note-input');
  await input.fill('Original content\nKeep every byte.'); await page.locator('#btn-save').click();
  await page.locator('#btn-history').click();
  await page.locator('.history-open strong').dblclick();
  await page.locator('#edit-item-name').fill('Project Aurora'); await page.locator('#edit-item-submit').click();
  await expect(page.locator('.history-open strong')).toHaveText('Project Aurora');
  await expect(input).toHaveValue('Original content\nKeep every byte.');
  await input.fill('Unsaved content edit');
  await page.locator('.buffer-tab[aria-selected="true"] .tab-label').dblclick();
  await page.locator('#edit-item-name').fill('Final name');
  await page.evaluate(() => { window.testState.fail = 'rename_note'; });
  await page.locator('#edit-item-submit').click();
  await expect(page.locator('#edit-item-error')).toContainText('Simulated failure');
  await expect(page.locator('.buffer-tab[aria-selected="true"]')).toHaveText('Project Aurora');
  await page.evaluate(() => { window.testState.fail = null; });
  await page.locator('#edit-item-submit').click();
  await expect(page.locator('.buffer-tab[aria-selected="true"]')).toHaveText('Final name');
  await expect(input).toHaveValue('Unsaved content edit');
  await page.reload();
  await expect(page.locator('.buffer-tab[aria-selected="true"]')).toHaveText('Final name');
  await expect(input).toHaveValue('Unsaved content edit');
  await page.keyboard.press(`${mod(info)}+k`); await page.locator('#search-input').fill('Final name');
  await expect(page.locator('.search-result strong')).toHaveText('Final name');
  expect(await page.evaluate(() => window.testState.data.notes[0].content)).toBe('Original content\nKeep every byte.');
});

test('folders create notes in place, move notes and keep them when deleting a folder', async ({page}) => {
  await page.locator('#btn-history').click();
  await page.locator('#new-folder').click(); await page.locator('#edit-item-name').fill('Work'); await page.locator('#edit-item-submit').click();
  await expect(page.locator('#notes-heading')).toHaveText('Work');
  await page.locator('#folder-new-note').click();
  await page.locator('#note-input').fill('Project note'); await page.locator('#btn-save').click();
  await expect(page.locator('.history-open')).toHaveCount(1);
  await page.locator('.history-open').click();
  await page.locator('#new-folder').click(); await page.locator('#edit-item-name').fill('Personal'); await page.locator('#edit-item-submit').click();
  await page.getByRole('button', {name:'Work',exact:false}).filter({has:page.locator('svg')}).click();
  await page.locator('.note-actions').click(); await page.getByRole('menuitem',{name:'Move to folder…'}).click();
  const personal = await page.evaluate(() => window.testState.data.folders.find(f => f.name === 'Personal').id);
  await page.locator('#edit-item-folder').selectOption(personal); await page.locator('#edit-item-submit').click();
  await expect(page.locator('.history-open')).toHaveCount(0);
  await page.reload(); await page.locator('#btn-history').click();
  await page.locator(`.folder-button[data-folder-id="${personal}"]`).click();
  await expect(page.locator('.history-open strong')).toHaveText('Project note');
  await expect(page.locator('#note-input')).toHaveValue('Project note');
  await page.getByRole('button',{name:'Actions for Personal',exact:true}).click();
  await page.getByRole('menuitem',{name:'Delete folder…'}).click(); await page.locator('#confirm-ok').click();
  await expect(page.locator('#notes-heading')).toHaveText('Unfiled');
  await expect(page.locator('.history-open')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.testState.data.notes[0].folder_id)).toBe(null);
  await expect(page.locator('#note-input')).toHaveValue('Project note');
  await page.locator('#new-folder').click(); await page.locator('#edit-item-name').fill('work'); await page.locator('#edit-item-submit').click();
  await expect(page.locator('#edit-item-error')).toContainText('already exists');
});

test('individual tab close offers save, discard and cancel and retains text on failed save', async ({page}) => {
  await page.locator('#note-input').fill('Save this background draft');
  await page.locator('#btn-new').click(); await page.locator('#note-input').fill('Keep this active');
  await page.locator('.tab-close').first().click(); await page.locator('#close-tab-cancel').click();
  await expect(page.locator('.buffer-tab')).toHaveCount(2);
  await page.locator('.tab-close').first().click();
  await page.evaluate(() => { window.testState.fail = 'create_note'; });
  await page.locator('#close-tab-save').click();
  await expect(page.locator('.toasts')).toContainText('The tab is still open');
  await expect(page.locator('.buffer-tab')).toHaveCount(2);
  await page.evaluate(() => { window.testState.fail = null; });
  await page.locator('.tab-close').first().click(); await page.locator('#close-tab-save').click();
  await expect(page.locator('.buffer-tab')).toHaveCount(1);
  await expect(page.locator('#note-input')).toHaveValue('Keep this active');
  expect(await page.evaluate(() => window.testState.data.notes.map(n => n.content))).toEqual(['Save this background draft']);
  await page.locator('.tab-close').click(); await page.locator('#close-tab-discard').click();
  await expect(page.locator('#note-input')).toHaveValue('');
  await expect(page.locator('.buffer-tab')).toHaveCount(1);
});

test('saved indicator tracks note content, not background draft backup', async ({page},info) => {
  const status = page.locator('#note-save-status'), input = page.locator('#note-input');
  await expect(status).toHaveAttribute('data-saved','false');
  await input.fill('Saved content'); await page.keyboard.press(`${mod(info)}+s`);
  await page.locator('#btn-history').click(); await page.locator('.history-open').click();
  await expect(status).toHaveAttribute('data-saved','true');
  await input.fill('Changed content');
  await expect.poll(() => page.evaluate(() => JSON.parse(window.testState.data.settings.workspace || '{"buffers":[]}').buffers.some(b => b.text === 'Changed content'))).toBe(true);
  await expect(status).toHaveAttribute('data-saved','false');
  await page.evaluate(() => { window.testState.fail = 'update_note'; });
  await page.keyboard.press(`${mod(info)}+s`);
  await expect(page.locator('.toasts')).toContainText('Save failed');
  await expect(status).toHaveAttribute('data-saved','false');
  await page.evaluate(() => { window.testState.fail = null; });
  await page.keyboard.press(`${mod(info)}+s`); await expect(status).toHaveAttribute('data-saved','true');
});

test('WYSIWYG edits rendered Markdown, preserves source on toggle and restores undo', async ({page},info) => {
  const input = page.locator('#note-input'), toggle = page.locator('#btn-wysiwyg');
  const markdown = '# Heading\n\nA plain paragraph.\n\n- [x] Done\n- [ ] Next\n\n| Name | State |\n| --- | --- |\n| One | Ready |\n\n```js\nconst x = 1;\n```\n\n![Diagram](https://example.com/private.png)\n';
  const remote = []; page.on('request', req => { if (req.url().includes('example.com')) remote.push(req.url()); });
  await expect(toggle).toBeHidden();
  await input.fill(markdown); await page.locator('#syntax-select').selectOption('markdown'); await toggle.click();
  await expect(page.locator('#rich-editor h1')).toHaveText('Heading');
  await expect(page.locator('#rich-editor table')).toBeVisible();
  await expect(page.locator('#rich-editor input[type="checkbox"]')).toHaveCount(2);
  const task = page.locator('#rich-editor li[data-type="taskItem"]').first();
  const checkboxBounds = await task.locator('input').boundingBox(), taskBounds = await task.locator('p').boundingBox();
  expect(Math.abs(checkboxBounds.y - taskBounds.y)).toBeLessThan(15);
  await expect(page.locator('#rich-editor .rich-image')).toHaveText('Diagram');
  await expect(page.locator('#wysiwyg-toolbar')).toBeVisible();
  const tabs = await page.locator('.buffer-bar').boundingBox(), toolbar = await page.locator('#wysiwyg-toolbar').boundingBox();
  expect(Math.abs(toolbar.y - tabs.y - tabs.height)).toBeLessThan(2);
  await toggle.click(); await expect(input).toHaveValue(markdown);
  await toggle.click();
  await page.locator('#rich-editor p').filter({hasText:'A plain paragraph.'}).click({clickCount:3});
  await page.getByRole('button',{name:'Bold',exact:true}).click();
  await expect(page.locator('#rich-editor strong')).toHaveText('A plain paragraph.');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('#rich-editor strong')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('settle.workspace.v3')).buffers[0].text)).toBe(markdown);
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await toggle.click();
  const changed = await input.inputValue();
  expect(changed).toContain('**A plain paragraph.**');
  expect(changed).toContain('https://example.com/private.png');
  expect(changed).toContain('const x = 1;'); expect(changed).toContain('- [x] Done');
  expect(remote).toEqual([]);
  await toggle.click(); await page.reload();
  await expect(page.locator('#rich-editor strong')).toHaveText('A plain paragraph.');
  await page.keyboard.press(`${mod(info)}+s`);
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.length)).toBe(1);
  expect(await page.evaluate(() => window.testState.data.notes[0].content)).toContain('**A plain paragraph.**');
  await expect(page.locator('#rich-editor strong')).toHaveText('A plain paragraph.');
  await expect(page.locator('#btn-wysiwyg')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#note-save-status')).toHaveAttribute('data-saved','true');
  await page.keyboard.press(`${mod(info)}+s`);
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.length)).toBe(1);
});

test('browser preview shows the library beside rich text and works at compact window sizes', async ({page}) => {
  await page.goto('/preview');
  await expect(page.locator('.history-item')).toHaveCount(6);
  await expect(page.locator('#rich-editor h1')).toHaveText('A calmer workspace');
  await mkdir('.qa/screenshots', {recursive:true});
  await page.screenshot({path:'.qa/screenshots/library-preview.png'});
  await page.setViewportSize({width:620,height:420});
  await expect(page.locator('#note-save-status')).toBeInViewport();
  await expect(page.locator('#new-folder')).toBeInViewport();
  await expect(page.locator('#close-history')).toBeInViewport();
  await page.locator('#close-history').click();
  await expect(page.getByRole('textbox',{name:'Rich text note editor'})).toBeVisible();
  expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
});

for (const separator of ['\n', '  \n', '\n\n']) {
  test(`heading formatting affects only selected lines (${JSON.stringify(separator)})`, async ({page},info) => {
    const source = ['Before one', 'Before two', 'Target **words** here', 'After one', 'After two'].join(separator);
    const input = page.locator('#note-input'), rich = page.getByRole('textbox',{name:'Rich text note editor'});
    await input.fill(source); await page.locator('#syntax-select').selectOption('markdown'); await page.locator('#btn-wysiwyg').click();
    await page.locator('#rich-editor strong').dblclick();
    await expect.poll(() => page.evaluate(() => getSelection().toString().trim())).toBe('words');
    await page.locator('#rich-heading').focus(); await page.locator('#rich-heading').selectOption('2');
    await expect(page.locator('#rich-editor h2')).toHaveText('Target words here');
    await expect(page.locator('#rich-editor h2 strong')).toHaveText('words');
    await expect(rich).toContainText('Before one'); await expect(rich).toContainText('After two');
    const edited = await page.evaluate(() => JSON.parse(localStorage.getItem('settle.workspace.v3')).buffers[0].text);
    expect(edited).toBe(['Before one' + separator + 'Before two', '## Target **words** here', 'After one' + separator + 'After two'].join('\n\n'));
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(page.locator('#rich-editor h2')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('settle.workspace.v3')).buffers[0].text)).toBe(source);
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    await expect(page.locator('#rich-editor h2')).toHaveText('Target words here');
    await page.keyboard.press(`${mod(info)}+s`);
    await page.reload(); await expect(page.locator('#rich-editor h2')).toHaveText('Target words here');
    await page.locator('#rich-editor h2 strong').click(); await expect(page.locator('#rich-heading')).toHaveValue('2');
    await page.locator('#rich-heading').focus(); await page.locator('#rich-heading').selectOption('0');
    await expect(page.locator('#rich-editor h2')).toHaveCount(0);
    await expect(page.locator('#rich-editor strong')).toHaveText('words');
  });
}

test('headings keep caret and multi-line selections scoped, including a next-line boundary', async ({page}) => {
  const source = 'Before\nOne\nTwo\nAfter';
  await page.locator('#note-input').fill(source); await page.locator('#syntax-select').selectOption('markdown'); await page.locator('#btn-wysiwyg').click();
  const rich = page.getByRole('textbox',{name:'Rich text note editor'});
  const cases = [
    {anchor:8, head:8, headings:['One']},
    {anchor:7, head:14, headings:['One','Two']},
    {anchor:14, head:7, headings:['One','Two']},
    {anchor:7, head:11, headings:['One']},
    {anchor:0, head:0, headings:['Before']},
    {anchor:20, head:20, headings:['After']},
  ];
  for (const {anchor,head,headings} of cases) {
    await rich.click();
    await rich.evaluate(async (el,{anchor,head}) => {
      const text = el.querySelector('p').firstChild;
      const selection = getSelection();
      if (selection.anchorNode === text && selection.focusNode === text && selection.anchorOffset === anchor && selection.focusOffset === head) return;
      const changed = new Promise(resolve => document.addEventListener('selectionchange',resolve,{once:true}));
      selection.setBaseAndExtent(text,anchor,text,head);
      await changed;
    }, {anchor,head});
    await page.locator('#rich-heading').focus(); await page.locator('#rich-heading').selectOption('3');
    await expect(page.locator('#rich-editor h3')).toHaveText(headings);
    await expect(rich).toBeFocused();
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(page.locator('#rich-editor h3')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('settle.workspace.v3')).buffers[0].text)).toBe(source);
  }
  await page.locator('#btn-wysiwyg').click();
  await page.locator('#note-input').fill('Before\n\nOne\n\nTwo\n\nAfter');
  await page.locator('#btn-wysiwyg').click();
  await page.locator('#rich-editor p').nth(1).click();
  await rich.evaluate(el => {
    const paragraphs = el.querySelectorAll('p');
    getSelection().setBaseAndExtent(paragraphs[1].firstChild,0,paragraphs[2].firstChild,0);
  });
  await page.locator('#rich-heading').focus(); await page.locator('#rich-heading').selectOption('2');
  await expect(page.locator('#rich-editor h2')).toHaveText(['One']);
  await expect(page.locator('#rich-editor p')).toHaveText(['Before','Two','After']);
});

test('rich text typing, view switches and themes keep content and never execute raw HTML', async ({page},info) => {
  const input = page.locator('#note-input');
  await page.locator('#syntax-select').selectOption('markdown'); await page.locator('#btn-wysiwyg').click();
  const rich = page.getByRole('textbox',{name:'Rich text note editor'});
  await rich.fill('Write visually');
  await page.locator('#rich-heading').selectOption('2');
  await expect(page.locator('#rich-editor h2')).toHaveText('Write visually');
  for (const design of ['kiln','blackbox','optic','phosphor','sidecar','cobalt','scratch','redline','frost','tape']) {
    await page.keyboard.press(`${mod(info)}+,`); await page.locator(`.design-option[data-value="${design}"]`).click(); await page.keyboard.press('Escape');
    await expect(page.locator('#rich-editor h2')).toHaveText('Write visually');
  }
  await page.locator('#btn-markdown-preview').click(); await expect(page.locator('#markdown-preview h2')).toHaveText('Write visually');
  await expect(page.locator('#wysiwyg-toolbar')).toBeHidden();
  await page.locator('#btn-wysiwyg').click(); await expect(rich).toBeVisible();
  await page.locator('#syntax-select').selectOption('plaintext');
  await expect(input).toHaveValue('## Write visually'); await expect(page.locator('#wysiwyg-toolbar')).toBeHidden();
  await input.fill('# Safe\n\n<script>window.injected = true</script>');
  await page.locator('#syntax-select').selectOption('markdown'); await page.locator('#btn-wysiwyg').click();
  await expect(page.locator('.toasts')).toContainText('raw HTML');
  await expect(input).toHaveValue('# Safe\n\n<script>window.injected = true</script>');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

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
  await expect(page.locator('#app-version')).toHaveText('Settle 0.2.3');
  const check = page.locator('#btn-check-update'), install = page.locator('#btn-install-update');
  expect(await page.evaluate(() => window.testState.calls.some(c => c.command === 'check_for_update'))).toBe(false);
  await expect(install).toBeHidden();
  await check.click();
  await expect(page.locator('#update-status')).toContainText('up to date');
  await page.evaluate(() => { window.testState.update = {version:'0.2.4',notes:'<img src=x onerror=alert(1)> New features'}; });
  await check.click();
  await expect(install).toBeVisible();
  await expect(page.locator('#update-status')).toContainText('0.2.4');
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
  await page.evaluate(() => { window.testState.update = {version:'0.2.4',notes:'New features'}; });
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
  await expect(page.locator('#note-save-status')).toHaveAttribute('data-saved','true');
  await expect(page.locator('#note-input')).toHaveValue('First thought #work');
  await page.keyboard.press(`${mod(info)}+Shift+h`);
  await page.locator('.history-open').click();
  await expect(page.locator('#note-input')).toHaveValue('First thought #work');
  await page.locator('#note-input').fill('A better thought');
  await page.keyboard.press('Shift+Enter');
  await expect.poll(() => page.evaluate(() => window.testState.data.notes[0].content)).toBe('A better thought');
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.length)).toBe(1);
  await page.locator('.note-actions').click();
  await page.getByRole('menuitem', {name:'Delete note…', exact:true}).click();
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
  await expect(page.locator('#note-input')).toHaveValue('Unfinished note');
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
    await expect(editor).toHaveValue('First scratch  \n');
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
  await expect(page.locator('#note-save-status')).toHaveAttribute('data-saved','true');
  await expect(editor).toHaveValue('alpha beta alpha <script>');
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
  await expect(page.locator('#note-save-status')).toHaveAttribute('data-saved','true');
  await expect(page.locator('#note-input')).toHaveValue('Enter saves');
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
  await expect(page.locator('#markdown-preview')).toBeVisible();
  await expect(editor).toHaveValue(markdown);
  await previewButton.click();
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

test('Ctrl/Cmd+S keeps the same tab, text and caret and updates without duplicates', async ({page},info) => {
  const editor = page.locator('#note-input');
  const tabId = await page.locator('.buffer-tab[aria-selected="true"]').getAttribute('data-buffer-id');
  await editor.fill('Hotkey note');
  await editor.evaluate(el => el.setSelectionRange(3,6));
  await page.keyboard.press(`${mod(info)}+s`);
  await expect(page.locator('#note-save-status')).toHaveAttribute('data-saved','true');
  await expect(editor).toHaveValue('Hotkey note');
  expect(await editor.evaluate(el => [el.selectionStart,el.selectionEnd])).toEqual([3,6]);
  await expect(page.locator('.buffer-tab[aria-selected="true"]')).toHaveAttribute('data-buffer-id',tabId);
  await expect(page.locator('#save-label')).toHaveText('Update');
  await page.keyboard.press(`${mod(info)}+s`);
  await expect(page.locator('#btn-save')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.length)).toBe(1);
  await page.keyboard.press(`${mod(info)}+Shift+h`);
  await page.locator('.history-open').click();
  await expect(page.locator('.buffer-tab')).toHaveCount(1);
  await page.locator('#note-input').fill('Hotkey update');
  await page.keyboard.press(`${mod(info)}+s`);
  await expect.poll(() => page.evaluate(() => window.testState.data.notes.map(n => n.content))).toEqual(['Hotkey update']);
  await expect(page.locator('#note-input')).toHaveValue('Hotkey update');
  await page.reload();
  await expect(editor).toHaveValue('Hotkey update');
  await expect(page.locator('.buffer-tab[aria-selected="true"]')).toHaveAttribute('data-buffer-id',tabId);
  await expect(page.locator('#note-save-status')).toHaveAttribute('data-saved','true');
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
  await page.locator('#close-tab-discard').click();
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
