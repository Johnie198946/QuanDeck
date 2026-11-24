import test from 'node:test';
import assert from 'node:assert/strict';
import { discussionTurnMessage } from './discussion-style.mjs';
import { createRuntimeDriver } from './driver.mjs';
import { commandInvocation } from '../agent-bridge.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('new discussion and non-discussion inputs retain their original instructions', () => {
  for (const purpose of ['execution', 'review', undefined]) assert.equal(discussionTurnMessage({purpose}, 'hello'), 'hello');
  assert.equal(discussionTurnMessage({purpose:'discussion',prompt:'first'}, 'first'), 'first');
  assert.match(discussionTurnMessage({purpose:'discussion',prompt:'first'}, 'next'), /^next\n\n.*[\s\S]*quandeck-conclusion/);
});

test('executing a new or resumed task preserves the first prompt and shows visual guidance on follow-up', () => {
  for (const purpose of ['execution', 'review']) {
    for (const prompt of ['旧会话原始要求', '新会话 quandeck-chart 要求']) {
      assert.equal(discussionTurnMessage({purpose, prompt}, prompt), prompt);
      assert.match(discussionTurnMessage({purpose, prompt}, '把两处入口放在一起'), /^把两处入口放在一起[\s\S]*示意图/);
    }
  }
});

test('restored discussion sends concise response contract but records the unmodified user input', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'qd-discussion-style-'));
  const peer=path.join(directory,'peer.mjs');
  const original=await readFile(new URL('./fixtures/protocol-peer.mjs',import.meta.url),'utf8');
  await writeFile(peer, original.replace("text:'Codex 回报'",'text:globalThis.lastPrompt').replace("const prompt=tool===", "const prompt=globalThis.lastPrompt=tool==="));
  const connection={connectionId:'c',tool:'codex',binary:peer,nodePath:process.execPath,projectPath:directory};
  const driver=createRuntimeDriver({getConnection:()=>connection,commandInvocation,initialRuns:[{runId:'old',sessionId:'019a7d11-6213-7110-9279-000000000003',connectionId:'c',purpose:'discussion',prompt:'old verbose instruction',status:'paused',sequence:1,events:[],budget:{maxTokens:20},tokens:999999}]});
  try {
    const userText = '周三出发，两人同行';
    await driver.control('old','reply',{displayPrompt:userText,prompt:userText+'\n\n相关项目经验：现场登记用蓝册。'});
    for(let i=0;i<100&&!driver.read('old').lastReply;i++)await new Promise(resolve=>setTimeout(resolve,10));
    const state=driver.read('old');
    assert.match(state.lastReply,/周三出发，两人同行[\s\S]*现场登记用蓝册[\s\S]*只说明变化[\s\S]*quandeck-conclusion/);
    assert.equal(state.events.find(e=>e.message?.role==='user').message.text,'周三出发，两人同行');
    assert.equal(state.status,'waiting_reply');
  } finally {await driver.close();await rm(directory,{recursive:true,force:true});}
});


test('discussion can carry sourced visual choices without turning card feedback into project approval', () => {
  const message = discussionTurnMessage({ purpose: 'discussion', prompt: 'initial' }, '我偏好第二种');
  assert.match(message, /visualBlocks/);
  assert.match(message, /sources:/);
  assert.match(message, /真实图片、地点与来源/);
  assert.match(message, /不代表批准整套方案/);
  assert.match(message, /不为配图在本轮执行整个项目/);
});
