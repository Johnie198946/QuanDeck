import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRuntimeDriver } from './driver.mjs';
import { commandInvocation } from '../agent-bridge.mjs';
const binary=fileURLToPath(new URL('./fixtures/system-peer.mjs',import.meta.url));
const connection={connectionId:'first',tool:'codex',binary,nodePath:process.execPath,projectPath:'/old-project-must-not-be-read'};
const schema={type:'object',properties:{schemaVersion:{const:'quandeck.ai.classify.v1'},binding:{properties:{requestId:{const:'system1'},projectId:{const:'new-project'},sourceSeq:{const:0},inputId:{const:'input1'}}}}};
const input={requestId:'system1',projectId:'new-project',connectionId:'first',tool:'codex',kind:'classify',prompt:'Only analyze explicit input',outputSchema:schema,maxTokens:2000,timeoutMs:2000};
test('system Codex runs in an empty isolated new session, separate from business runs and events',async()=>{
 const events=[],driver=createRuntimeDriver({getConnection:()=>connection,onEvent:event=>events.push(event)});
 try{const [a,b]=await Promise.all([driver.assist(input),driver.assist(input)]);assert.equal(a.sourceSessionId,b.sourceSessionId);assert.equal(a.projectId,'new-project');assert.equal(a.actualTokens,23);assert.equal(a.contextPolicy,'new-isolated-session');assert.equal(a.toolPolicy,'read-only-isolated');assert.deepEqual(driver.listRuns(),[]);assert.deepEqual(events,[]);await assert.rejects(driver.assist({...input,prompt:'changed'}),/不能复用/);const next=await driver.assist({...input,requestId:'system2'});assert.notEqual(a.sourceSessionId,next.sourceSessionId);}finally{await driver.close();}
});
test('integration review uses the same isolated system adapter and cannot become a business run', async () => {
 const events = [], driver = createRuntimeDriver({ getConnection: () => connection, onEvent: event => events.push(event) });
 try {
  const receipt = await driver.assist({ ...input, requestId: 'integration-review', kind: 'integration' });
  assert.equal(receipt.requestId, 'integration-review');
  assert.equal(receipt.toolPolicy, 'read-only-isolated');
  assert.equal(receipt.contextPolicy, 'new-isolated-session');
  assert.deepEqual(driver.listRuns(), []); assert.deepEqual(events, []);
 } finally { await driver.close(); }
});
test('unconfirmed sandbox, unsupported first tool and any attempted system tool fail closed',async()=>{
 for(const override of [{model:'unsafe'},{tool:'dsh'}]){const driver=createRuntimeDriver({getConnection:()=>({...connection,...override})});try{await assert.rejects(driver.assist({...input,tool:override.tool??'codex'}),error=>['SYSTEM_ADAPTER_UNSUPPORTED'].includes(error.code));assert.equal(driver.listRuns().length,0);}finally{await driver.close();}}
 const driver=createRuntimeDriver({getConnection:()=>connection});try{await assert.rejects(driver.assist({...input,prompt:'REQUEST_TOOL'}),error=>error.code==='SYSTEM_TOOL_POLICY');}finally{await driver.close();}
});
test('system timeout has explicit unknown acceptance and never resends the same request',async()=>{
 const driver = createRuntimeDriver({ getConnection: () => connection });
 try {
  const request = { ...input, prompt: 'RETRY_TIMEOUT', timeoutMs: 1000 };
  const retriedWithoutReply = error => error.code === 'SYSTEM_TIMEOUT' && error.acceptance === 'unknown' && error.modelAcknowledged && error.modelRetried && error.retryGraceUsed;
  await assert.rejects(driver.assist(request), retriedWithoutReply);
  await assert.rejects(driver.assist(request), retriedWithoutReply);
  assert.equal(driver.listRuns().length, 0);
 } finally { await driver.close(); }
});
test('closing driver cancels system inference promptly instead of waiting for the request timeout',async()=>{
 const driver=createRuntimeDriver({getConnection:()=>connection});const pending=driver.assist({...input,prompt:'TIMEOUT',timeoutMs:90000}).catch(error=>error);await new Promise(resolve=>setTimeout(resolve,60));const start=Date.now();await driver.close();const result=await pending;assert.equal(result.code,'SYSTEM_INTERRUPTED');assert(Date.now()-start<1500);assert.equal(driver.listRuns().length,0);
});
test('Claude system requests explicitly disable tools, settings, MCP and history; missing usage remains null',async()=>{
 let options;
 const sdk={query:value=>{options=value.options;return{close(){},async *[Symbol.asyncIterator](){yield{type:'system',subtype:'init',session_id:'real-claude-system',tools:[]};yield{type:'result',subtype:'success',session_id:'real-claude-system',is_error:false,structured_output:{ok:true},modelUsage:{model:{}}};}};}};
 const driver=createRuntimeDriver({getConnection:()=>({...connection,tool:'claude'}),systemSdk:sdk});
 try{const receipt=await driver.assist({...input,tool:'claude'});assert.deepEqual(options.tools,[]);assert.deepEqual(options.settingSources,[]);assert.deepEqual(options.skills,[]);assert.deepEqual(options.plugins,[]);assert.deepEqual(options.mcpServers,{});assert.equal(options.strictMcpConfig,true);assert.equal(options.persistSession,false);assert.equal(options.maxBudgetUsd,undefined);assert.equal(options.taskBudget,undefined);assert.equal(options.resume,undefined);assert.notEqual(options.cwd,connection.projectPath);assert.equal(receipt.actualTokens,null);assert.equal(receipt.sourceSessionId,'real-claude-system');assert.deepEqual(driver.listRuns(),[]);}finally{await driver.close();}
});

test('Claude system analysis resolves verified Windows npm wrappers to Node without a shell', async () => {
 const folder = String.raw`C:\Users\test & Work\AppData\Roaming\npm`;
 const entry = folder + String.raw`\node_modules\@anthropic-ai\claude-code\cli.js`;
 const node = String.raw`C:\Node Runtime\node.exe`;
 for (const extension of ['cmd', 'bat']) {
  let sdkOptions, launched;
  const shim = folder + '\\claude.' + extension;
  const argv = [entry, '--input-format', 'stream-json', '中文 "quoted"\n%PATH% ! & | $(never-execute)'];
  const resolve = (binary, args, _platform, options) => commandInvocation(binary, args, 'win32', {
   ...options, env: {},
   readFile: async file => file.endsWith('package.json') ? '{"name":"@anthropic-ai/claude-code"}' : '@"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
   isFile: async file => [entry, node].includes(file),
  });
  const sdk = { query: ({ options }) => {
   sdkOptions = options;
   options.spawnClaudeCodeProcess({ args: argv, cwd: options.cwd, env: {}, signal: options.abortController.signal });
   return { close() {}, async *[Symbol.asyncIterator]() { yield { type: 'result', subtype: 'success', session_id: 'system-windows-claude', is_error: false, structured_output: { ok: true }, modelUsage: {} }; } };
  } };
  const driver = createRuntimeDriver({
   getConnection: () => ({ ...connection, tool: 'claude', binary: shim, nodePath: node }),
   commandInvocation: resolve, systemSdk: sdk,
   spawnProcess: (binary, args, options) => { launched = { binary, args, options }; return {}; },
  });
  try {
   const receipt = await driver.assist({ ...input, tool: 'claude' });
   assert.equal(sdkOptions.pathToClaudeCodeExecutable, entry);
   assert.deepEqual(sdkOptions.tools, []);
   assert.equal(sdkOptions.strictMcpConfig, true);
   assert.equal(launched.binary, node);
   assert.deepEqual(launched.args, argv);
   assert.equal(launched.options.shell, false);
   assert.equal(launched.options.cwd, sdkOptions.cwd);
   assert.notEqual(sdkOptions.cwd, connection.projectPath);
   assert.equal(receipt.sourceSessionId, 'system-windows-claude');
   assert.deepEqual(driver.listRuns(), []);
  } finally { await driver.close(); }
 }
});

test('unverified Claude Windows wrapper is rejected before SDK or shell execution', async () => {
 let invoked = false;
 const driver = createRuntimeDriver({
  getConnection: () => ({ ...connection, tool: 'claude', binary: String.raw`C:\Unverified\claude.cmd` }),
  commandInvocation: (binary, args) => commandInvocation(binary, args, 'win32', { readFile: async () => 'echo unrelated', isFile: async () => false, env: {} }),
  systemSdk: { query: () => { invoked = true; throw new Error('must not call SDK'); } },
  spawnProcess: () => { invoked = true; throw new Error('must not start shell'); },
 });
 try {
  await assert.rejects(driver.assist({ ...input, tool: 'claude' }), failure => failure.code === 'SYSTEM_ADAPTER_UNSUPPORTED' && failure.acceptance === 'rejected' && failure.actualTokens === 0);
  assert.equal(invoked, false);
  assert.deepEqual(driver.listRuns(), []);
 } finally { await driver.close(); }
});

// Historical maxTokens metadata must never regain enforcement, even for background calls.
test('system assistance ignores legacy token limits and permits omitted maxTokens', async () => {
 const driver = createRuntimeDriver({ getConnection: () => connection });
 try {
  for (const maxTokens of [undefined, 1, 0]) {
   const receipt = await driver.assist({ ...input, requestId: `no-cap-${maxTokens}`, maxTokens });
   assert.equal(receipt.actualTokens, 23);
   assert.equal(receipt.budgetEnforcement, 'source');
   assert.equal(receipt.tokenLimit, null);
   assert.equal(receipt.budgetExceeded, false);
  }
 } finally { await driver.close(); }
});

test('a source retry gets one bounded grace period on the same admitted model request',async()=>{
 const driver=createRuntimeDriver({getConnection:()=>connection});
 try {
  const receipt=await driver.assist({...input,requestId:'recovered-transport',prompt:'RETRY_RECOVER EXPECT_LOW_EFFORT',timeoutMs:1000});
  assert.equal(receipt.actualTokens,23);assert(receipt.sourceSessionId);assert.deepEqual(driver.listRuns(),[]);
 }finally{await driver.close();}
});
test('title normalization uses low reasoning effort without changing the business model',async()=>{
 const driver=createRuntimeDriver({getConnection:()=>connection});
 try {const receipt=await driver.assist({...input,requestId:'quick-title',kind:'title',prompt:'EXPECT_LOW_EFFORT'});assert.equal(receipt.actualTokens,23);}finally{await driver.close();}
});

test('a valid project summary above 64 KB reaches the isolated Agent without truncation', async () => {
 let received;
 const prompt = '真实项目台帐。'.repeat(6000);
 const sdk = { query: value => {
  received = value.prompt;
  return { close() {}, async *[Symbol.asyncIterator]() {
   yield { type: 'result', subtype: 'success', session_id: 'large-project-summary', is_error: false, structured_output: { ok: true }, modelUsage: {} };
  } };
 } };
 const driver = createRuntimeDriver({ getConnection: () => ({ ...connection, tool: 'claude' }), systemSdk: sdk });
 try {
  const result = await driver.assist({ ...input, tool: 'claude', kind: 'summary', prompt });
  assert(Buffer.byteLength(prompt) > 65536);
  assert.equal(received, prompt);
  assert.equal(result.sourceSessionId, 'large-project-summary');
  assert.deepEqual(driver.listRuns(), []);
 } finally { await driver.close(); }
});


test('actual streamed text, reasoning or increasing usage outlive transport deadline without another inference', async () => {
 for (const mode of ['text', 'reasoning', 'usage']) {
  const driver = createRuntimeDriver({getConnection:()=>connection});
  try {
   const began = Date.now();
   const receipt = await driver.assist({...input, requestId:`active-${mode}`, prompt:`IDLE_STREAM ${mode}`, timeoutMs:1000});
   assert(Date.now()-began > 1500, 'same request must survive the old wall-clock timeout + grace');
   assert.equal(receipt.actualTokens,23);
   assert.deepEqual(driver.listRuns(),[]);
  } finally { await driver.close(); }
 }
});

test('retry/status/empty deltas and repeated usage or fragments cannot keep a system request alive', async () => {
 for (const mode of ['noise','replay']) {
  const driver = createRuntimeDriver({getConnection:()=>connection});
  try {
   const began=Date.now();
   await assert.rejects(driver.assist({...input,requestId:`idle-${mode}`,prompt:`IDLE_STREAM ${mode}`,timeoutMs:1000}), failure => {
    assert.equal(failure.code,'SYSTEM_TIMEOUT');
    assert.equal(failure.acceptance,'unknown');
    assert.equal(failure.modelProgressed,mode==='replay');
    return true;
   });
   assert(Date.now()-began<2200, 'non-progress must not refresh the deadline');
  } finally { await driver.close(); }
 }
});

test('a stream that stops producing still times out and reports output-idle instead of ongoing network failure', async () => {
 const driver=createRuntimeDriver({getConnection:()=>connection});
 try {
  const began=Date.now();
  await assert.rejects(driver.assist({...input,requestId:'stalled-output',prompt:'IDLE_STREAM stalled',timeoutMs:1000}), failure => {
   assert.equal(failure.code,'SYSTEM_TIMEOUT');assert.equal(failure.modelProgressed,true);
   assert.match(failure.message,/持续无新增内容或用量/);assert.doesNotMatch(failure.message,/连接持续重试/);
   assert(failure.lastModelProgressAt);return true;
  });
  assert(Date.now()-began>3000);assert(Date.now()-began<4200);
 }finally{await driver.close();}
});
