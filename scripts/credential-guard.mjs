import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { unzipSync } from 'fflate';

export function inspectAsset(name, value, secrets = []) {
  const bytes = Buffer.from(value);
  if (/(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]*\.(?:sqlite|sqlite3|db|pem|key|keystore|jks))$/i.test(name)
    || bytes.subarray(0,16).toString() === 'SQLite format 3\0') throw new Error(`Forbidden private/data asset: ${name}`);
  const text = bytes.toString('utf8');
  if (/sk-[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
    || /(?:apiKey|api_key|API_KEY)\s*[=:]\s*["'][^"'\s]{8,}["']/.test(text)
    || secrets.some((secret) => bytes.includes(Buffer.from(secret)))) throw new Error(`Credential detected in asset: ${name}`);
}
async function files(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path,entry.name);
    if (entry.isDirectory()) result.push(...await files(target)); else result.push(target);
  }
  return result;
}
export async function guard(path) {
  const secrets = Object.entries(process.env).filter(([key,value]) => /(?:API.?KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && value?.length >= 8).map(([,value]) => value);
  for (const name of (await readdir('.')).filter((name) => /^\.env(?:\.|$)/.test(name))) {
    const source = await readFile(name,'utf8');
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
      if (match && /KEY|TOKEN|SECRET|PASSWORD/i.test(match[1])) {
        const value = match[2].replace(/^['"]|['"]$/g,''); if (value.length >= 8) secrets.push(value);
      }
    }
  }
  let count = 0;
  if (path.endsWith('.apk')) {
    for (const [name, value] of Object.entries(unzipSync(new Uint8Array(await readFile(path))))) { inspectAsset(name,value,secrets); count++; }
  } else for (const name of await files(path)) { inspectAsset(name,await readFile(name),secrets); count++; }
  console.log(`Credential guard passed: ${count} assets (${basename(path)}). No SQLite backup/env/private key assets.`);
}
if (process.argv[1]?.replace(/\\/g,'/').endsWith('/credential-guard.mjs')) await guard(process.argv[2] || 'dist');
