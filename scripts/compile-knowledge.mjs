import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readActiveSkeleton } from './compile-question-bank.mjs';
import katex from 'katex';
import { createPatternIndex, compilePatternLinks } from '../src/core/knowledge/patternSchema.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const archive=resolve(root,'题库整理/knowledge-v2');
const source=JSON.parse(await readFile(resolve(root,'knowledge/relations.json'),'utf8'));
// Validate source before writing runtime data; importing the runtime reader would
// depend on its previous build, so the pure index validator is extracted below.
const sk=await readActiveSkeleton(),seen=new Set();
for(const r of source.relations) {
  if(seen.has(r.id)||r.review!=='verified'||!r.conditions?.length||!r.evidence?.length||!r.task?.length
    ||![r.inputState,r.operation,r.output,r.boundary].every(t=>typeof t==='string'&&t.trim()))throw new Error(`Incomplete reviewed relation ${r.id}`);
  seen.add(r.id);
  for(const n of [r.from,r.to])if(!['method','scenario'].includes(n.kind)||!(n.kind==='method'?sk.methodById:sk.scenarioById).has(n.id))throw new Error(`Broken relation ${r.id}`);
  if(r.type==='applies_to'&&!sk.scenarioById.get(r.to.id).methods.some(e=>e.method_id===r.from.id))throw new Error(`Missing paired edge ${r.id}`);
}
await mkdir(resolve(root,'frontend/src/assets/knowledge'),{recursive:true});
await writeFile(resolve(root,'frontend/src/assets/knowledge/relations.json'),JSON.stringify(source,null,2)+'\n');
await mkdir(archive,{recursive:true});
const lines=(await readFile(resolve(root,'审查输出/跨章节接续候选.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));
const normalized=lines.map(r=>({id:r.record_id,status:r.status,reviewDepth:r.audit_depth,needsStructuring:!['input_state','task','conditions','operation','output_state_or_fact'].every(k=>Object.hasOwn(r,k)),
  inputState:r.input_state??null,task:r.task??null,conditions:r.conditions??null,operation:r.operation??null,output:r.output_state_or_fact??null,
  claim:r.mathematical_finding,evidence:r.evidence,boundary:r.boundary_or_counterexample,original:r}));
await writeFile(resolve(archive,'候选关系.normalized.json'),JSON.stringify({runtimeEnabled:false,rows:normalized},null,2)+'\n');
const patternSource=JSON.parse(await readFile(resolve(root,'knowledge/patterns.json'),'utf8'));
createPatternIndex(sk,patternSource);
const bankDirectory=resolve(root,'frontend/src/assets/practice/question-banks');
const banks=await Promise.all((await readdir(bankDirectory)).filter(name=>/^bank.*\.json$/.test(name)).map(async name=>({
  name,bank:JSON.parse(await readFile(resolve(bankDirectory,name),'utf8')),
})));
const runtimePatterns={...patternSource,questionLinks:compilePatternLinks(sk,patternSource,banks.flatMap(({bank})=>bank.questions))};
createPatternIndex(sk,runtimePatterns);
function checkMath(value) {
  if(typeof value==='string') {
    for(const match of value.matchAll(/\$([^$]+)\$/gu))katex.renderToString(match[1],{throwOnError:true,strict:'ignore',trust:false});
  } else if(Array.isArray(value))value.forEach(checkMath);
  else if(value && typeof value==='object')Object.values(value).forEach(checkMath);
}
checkMath(runtimePatterns.patterns);
await writeFile(resolve(root,'frontend/src/assets/knowledge/patterns.json'),JSON.stringify(runtimePatterns,null,2)+'\n');
// Published banks keep their historical taxonomy snapshots and exact file identity.
// Current knowledge descriptions come from the active skeleton, not those snapshots.
console.log(JSON.stringify({verifiedRelations:source.relations.length,candidates:normalized.length,
  needsStructuring:normalized.filter(r=>r.needsStructuring).length,patterns:runtimePatterns.patterns.length,
  patternScenarios:new Set(runtimePatterns.patterns.flatMap(p=>p.scenarioIds)).size,reviewedPatternSteps:runtimePatterns.questionLinks.length}));
