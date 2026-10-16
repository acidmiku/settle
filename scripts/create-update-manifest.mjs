import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function appVersionForTag(tag) {
  // This hotfix keeps its requested release label; installers/updater require SemVer.
  if (tag === 'v0.2.2a') return '0.2.3';
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Expected a stable vX.Y.Z release tag');
  return tag.slice(1);
}

export async function createUpdateManifest({directory, tag, repository, notes, date = new Date().toISOString()}) {
  const version = appVersionForTag(tag);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid GitHub repository');
  const files = await readdir(directory, {recursive:true});
  async function artifact(suffix) {
    const matches = files.filter(file => file.endsWith(suffix));
    if (matches.length !== 1) throw new Error(`Expected exactly one ${suffix} artifact`);
    const file = matches[0];
    const signature = (await readFile(path.join(directory,file + '.sig'),'utf8')).trim();
    if (!signature || !/^[A-Za-z0-9+/=]+$/.test(signature)) throw new Error(`Missing or invalid signature for ${file}`);
    return {signature, url:`https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(path.basename(file))}`};
  }
  const windows = await artifact('_x64-setup.exe');
  const mac = await artifact('.app.tar.gz');
  return {
    version, notes, pub_date:date,
    platforms:{'windows-x86_64':windows, 'darwin-aarch64':mac, 'darwin-x86_64':mac},
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const tag = process.env.RELEASE_TAG;
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
  if (appVersionForTag(tag) !== config.version) throw new Error('Release tag does not match the application version');
  const notes = await readFile(`releases/${tag}.md`,'utf8');
  const manifest = await createUpdateManifest({directory:'dist', tag, repository:process.env.GITHUB_REPOSITORY, notes});
  await writeFile('dist/latest.json',JSON.stringify(manifest,null,2) + '\n');
  console.log(`Created update manifest for ${tag}: ${Object.keys(manifest.platforms).join(', ')}`);
}
