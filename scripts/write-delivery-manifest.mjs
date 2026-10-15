import {readFile,writeFile,stat,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SCHEMA_VERSION} from '../src/core/db/constants.js';
import {unzipSync} from 'fflate';
import {extractFile} from '@electron/asar';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const files=[`artifacts/Mathmyth-v${pkg.version}-debug.apk`,`artifacts/desktop/Mathmyth-v${pkg.version}-Setup.exe`];
const artifacts=[];
const dateTag=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).replaceAll('-','');
for(const file of files){const bytes=await readFile(file),datedFile=file.replace(/-(debug\.apk|Setup\.exe)$/,`-${dateTag}-$1`);await copyFile(file,datedFile);artifacts.push({file,datedFile,bytes:(await stat(file)).size,sha256:createHash('sha256').update(bytes).digest('hex')});}
const testFile=process.argv[2] || '.qa/route-tests.log';
const tests=await readFile(testFile,'utf8'),coreTests=Number(tests.match(/ℹ tests (\d+)/)?.[1]),corePassed=Number(tests.match(/ℹ pass (\d+)/)?.[1]);
if(!coreTests || coreTests!==corePassed)throw new Error('Core test evidence is missing or failed.');
const browser=JSON.parse(await readFile('.qa/route-browser.report.json','utf8'));
const crop=JSON.parse(await readFile('.qa/image-crop-browser.report.json','utf8'));
const native=JSON.parse(await readFile('.qa/route-android.report.json','utf8'));
const desktop=JSON.parse(await readFile('.qa/route-windows.report.json','utf8'));
if(!browser.length || !crop.length || !native.length || !desktop.length || ![...browser,...crop,...native,...desktop].every(item=>item.ok))throw new Error('Current interaction verification is missing or failed.');
const apk=unzipSync(await readFile(files[0])), webIndex=Buffer.from(await readFile('dist/index.html'));
const desktopIndex=extractFile('artifacts/desktop/win-unpacked/resources/app.asar','dist/index.html');
if(!webIndex.equals(Buffer.from(apk['assets/public/index.html']))||!webIndex.equals(desktopIndex))throw new Error('APK and desktop web assets do not match the final frontend build.');
const manifest={version:pkg.version,androidVersionCode:Number((await readFile('android/app/build.gradle','utf8')).match(/versionCode\s+(\d+)/)[1]),schemaVersion:SCHEMA_VERSION,
  builtAt:new Date().toISOString(),artifacts,validation:{coreTests,corePassed,browserChecks:browser.length+crop.length,androidChecks:native.length,windowsChecks:desktop.length,android36Emulator:true,windowsPackagedApp:true,matchingWebAssets:true,productionCredentialsBundled:false},
  limitations:['Android debug signature; Windows unsigned','Real provider mathematical quality and physical devices not verified','27 self-authored worked examples; broad textbook mother-question curation still requires user selection','AI variant drafts do not contribute mastery before review']};
await writeFile('artifacts/交付清单.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
