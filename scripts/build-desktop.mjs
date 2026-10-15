import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { guard } from './credential-guard.mjs';
import { inspectAsset } from './credential-guard.mjs';
import { listPackage, extractFile, statFile } from '@electron/asar';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
function run(binary,args,options={}) {
  return new Promise((resolve,reject)=>{const child=spawn(binary,args,{cwd:root,stdio:'inherit',shell:false,...options});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Build step failed (${code})`)));});
}
await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/prepare-electron.ps1']);
await run(process.execPath,['node_modules/vite/bin/vite.js','build']);
await guard('dist');
const pkg=JSON.parse(await readFile('package.json','utf8'));
console.log(`Desktop version: ${pkg.version}`);
const stage=resolve(root,'.desktop-stage');
if (relative(root,stage)!=='.desktop-stage' || !stage.startsWith(root+sep))throw new Error('Unsafe staging path');
await rm(stage,{recursive:true,force:true});
await mkdir(`${stage}/electron`,{recursive:true});
await cp('dist',`${stage}/dist`,{recursive:true});
for(const name of ['main.cjs','preload.cjs'])await cp(`electron/${name}`,`${stage}/electron/${name}`);
await writeFile(`${stage}/package.json`,JSON.stringify({name:'mathmyth',version:pkg.version,description:'高数学习辅助工具',author:'Mathmyth',main:'electron/main.cjs'},null,2));
await guard(stage);
await run(process.execPath,['node_modules/electron-builder/out/cli/cli.js','--projectDir',stage,'--config',`${root}/electron-builder.cjs`,'--win','--x64','--publish','never'],
  {env:{...process.env,ELECTRON_CACHE:`${root}/.electron-cache`,ELECTRON_BUILDER_CACHE:`${root}/.electron-builder-cache`,
    ELECTRON_BUILDER_BINARIES_MIRROR:'https://npmmirror.com/mirrors/electron-builder-binaries/',CSC_IDENTITY_AUTO_DISCOVERY:'false'}});
const archive=`${root}/artifacts/desktop/win-unpacked/resources/app.asar`;
for(const name of listPackage(archive)) {
  const asset=name.replace(/^[/\\]+/,'');
  if (!/^(?:dist(?:\/|$)|electron(?:\/|$)|package\.json$)/.test(asset.replace(/\\/g,'/'))) throw new Error('Unexpected desktop packaged file');
  if (statFile(archive,asset).files) continue;
  inspectAsset(asset,extractFile(archive,asset));
}
console.log(`Desktop installer: ${root}/artifacts/desktop/Mathmyth-v${pkg.version}-Setup.exe`);
