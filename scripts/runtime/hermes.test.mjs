import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { createBridgeService } from '../agent-bridge.mjs';

const peer = `
let buffer = '';
const send = frame => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...frame})+'\\n');
process.stdin.on('data', data => {
  buffer += data;
  let newline;
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const {id,method,params} = JSON.parse(buffer.slice(0,newline));
    buffer = buffer.slice(newline+1);
    const reply = result => send({id,result});
    if (method === 'initialize') reply({protocolVersion:1,agentInfo:{name:'hermes-agent'},agentCapabilities:{loadSession:true}});
    if (method === 'session/new') reply({sessionId:'source-hermes'});
    if (method === 'session/load') reply({});
    if (method === 'session/prompt') {
      const text = params.prompt[0].text;
      const update = chunk => send({method:'session/update',params:{sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:chunk}}}});
      update(text.slice(0,3));
      update(text.slice(3));
      update(text);
      reply({stopReason:'end_turn',usage:{totalTokens:14}});
    }
  }
});`;

test('Hermes ACP deduplicates the final replay, reports real turn usage, and resumes the same source', async () => {
  const calls = [];
  const service = createBridgeService({
    spawnProcess(binary, args, options) {
      calls.push(args);
      return spawn(process.execPath, ['-e', peer], options);
    },
  });
  const events = new (await import('node:events')).EventEmitter();
  service.runtime.subscribe(event => { if (event.reply) events.emit('reply', event.reply); });
  try {
    const connection = await service.test({tool:'hermes',binary:process.execPath,projectPath:process.cwd()});
    assert.equal(connection.protocol,'hermes-acp');
    assert.equal(connection.capabilities.resume,true);
    const first = once(events,'reply');
    const run = await service.runtime.run({connectionId:connection.connectionId,dispatchId:'hermes-fixture',prompt:'first answer'});
    assert.equal(run.acceptance,'acknowledged');
    assert.equal((await first)[0].text,'first answer');
    assert.equal(service.runtime.read(run.runId).tokens,14);
    await service.runtime.control(run.runId,'stop');
    const second = once(events,'reply');
    await service.runtime.control(run.runId,'resume',{prompt:'second answer'});
    assert.equal((await second)[0].text,'second answer');
    assert.equal(service.runtime.read(run.runId).sessionId,'source-hermes');
    assert.equal(service.runtime.read(run.runId).tokens,28);
    assert(calls.every(args => args.length === 1 && args[0] === 'acp'));
  } finally {
    await service.runtime.close();
  }
});
