import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appVersionForTag, createUpdateManifest } from '../scripts/create-update-manifest.mjs';

test('release manifest maps both Mac architectures to the signed universal archive and requires all signatures', async t => {
  const directory = await mkdtemp(path.join(tmpdir(),'settle-manifest-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const files = ['windows/Settle_0.2.1_x64-setup.exe','mac/macos/Settle.app.tar.gz'];
  for (const file of files) {
    await mkdir(path.dirname(path.join(directory,file)),{recursive:true});
    await writeFile(path.join(directory,file),'fixture');
    await writeFile(path.join(directory,file + '.sig'),'c2lnbmF0dXJl\n');
  }
  const options = {directory,tag:'v0.2.1',repository:'acidmiku/settle',notes:'Release notes',date:'2026-10-16T00:00:00Z'};
  const result = await createUpdateManifest(options);
  assert.equal(result.version,'0.2.1');
  assert.equal(result.notes,'Release notes');
  assert.deepEqual(Object.keys(result.platforms),['windows-x86_64','darwin-aarch64','darwin-x86_64']);
  assert.deepEqual(result.platforms['darwin-aarch64'],result.platforms['darwin-x86_64']);
  assert.equal(result.platforms['darwin-aarch64'].url,'https://github.com/acidmiku/settle/releases/download/v0.2.1/Settle.app.tar.gz');
  assert.equal(result.platforms['windows-x86_64'].signature,'c2lnbmF0dXJl');
  const hotfix = await createUpdateManifest({...options,tag:'v0.2.2a'});
  assert.equal(hotfix.version,'0.2.3');
  assert.equal(hotfix.platforms['darwin-aarch64'].url,'https://github.com/acidmiku/settle/releases/download/v0.2.2a/Settle.app.tar.gz');
  assert.match(hotfix.platforms['windows-x86_64'].url,/\/v0\.2\.2a\//);
  assert.equal(appVersionForTag('v0.2.2'),'0.2.2');
  assert.throws(() => appVersionForTag('v0.2.3a'),/stable/);
  assert.throws(() => appVersionForTag('v0.2.2-a'),/stable/);
  await writeFile(path.join(directory,files[0] + '.sig'),'');
  await assert.rejects(createUpdateManifest(options),/signature/);
  await assert.rejects(createUpdateManifest({...options,tag:'invalid'}),/stable/);
});
