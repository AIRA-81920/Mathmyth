import { readFile, writeFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const gradle = await readFile('android/app/build.gradle', 'utf8');
const currentCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
if (process.argv[2] === '--info') console.log(`${pkg.version}|${currentCode}`);
else if (process.argv[2] === '--set') {
  const version = process.argv[3], code = Number(process.argv[4]);
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version) || !Number.isInteger(code) || code < 1 || code > 2100000000) throw new Error('Use a semantic version and positive Android versionCode.');
  if (code < currentCode || (version !== pkg.version && code <= currentCode)) throw new Error('A changed version requires a higher versionCode so Android can upgrade the installed app.');
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  pkg.version = version; lock.version = version; lock.packages[''].version = version;
  await writeFile('package.json', JSON.stringify(pkg,null,2) + '\n');
  await writeFile('package-lock.json', JSON.stringify(lock,null,2) + '\n');
  await writeFile('android/app/build.gradle', gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`).replace(/versionName\s+"[^"]+"/, `versionName "${version}"`));
}
