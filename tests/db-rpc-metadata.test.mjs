import test from 'node:test';
import assert from 'node:assert/strict';

test('database Worker transport preserves preferences, method identity, title ownership and private context', async () => {
  const previous=globalThis.Worker, calls=[];
  globalThis.Worker=class {
    postMessage(value) {
      calls.push(structuredClone(value));
      queueMicrotask(()=>this.onmessage({data:{id:value.id,ok:true,result:{saved:true},generation:0}}));
    }
  };
  try {
    const database=await import('../src/core/db/database.js');
    const preferences={theme:'dark',trailExpanded:{'block:B.limit':true},trailScroll:240};
    await database.saveChanges({preferences,conversations:[{id:'method',title:'短标题',methodId:'M.example',titleStatus:'manual',messages:[
      {id:'answer',role:'assistant',content:'公开回答',reasoningContent:'私有上下文',status:'complete'}]}]});
    const changes=calls[0].args[0];
    assert.deepEqual(changes.preferences,preferences);
    assert.equal(changes.conversations[0].methodId,'M.example');assert.equal(changes.conversations[0].titleStatus,'manual');
    assert.equal(changes.conversations[0].messages[0].reasoningContent,'私有上下文');assert.equal(changes.conversations[0].messages[0].content,'公开回答');
    await database.exportDatabase();
    assert.equal(calls.at(-1).method, 'exportBackup');
  } finally { globalThis.Worker=previous; }
});
