/** One-shot DSH system requests use an invocation-only patch; source config is never edited.
 * Contract: dsh-v0.2.0-rc.2 packages/bundle/{base,sdk-minimal}/cordis.patch.yml.
 * Keep the model/credential adapters, remove every tool producer and durable session writer.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument, isSeq, isMap, isScalar } from 'yaml';
import { parseDshDefaults } from './dshDefaults.mjs';
const executeFile = promisify(execFile);
const allowed = new Set(['cordis-plugin-timer', ...[
  'llm','deepseek-llm-api-extensions','session','session-log-deepseek','session-title',
  'user-questions','agent','agent-default-model','jobs-local','llm-retry',
  'authorization','deepseek-account-platform','credentials-local',
  'llm-pi-ai','llm-deepseek','llm-deepseek-api-key','llm-deepseek-account',
  'session-projection','tools','tool-executor-native','system-prompt','agent-loop',
  'sdk-app','sdk-jsonrpc-server',
].map(name => `dsh-${name}`)].map(name => `@deepseek-ai/${name}`));
const required = ['dsh-llm','dsh-session','dsh-agent','dsh-tools','dsh-system-prompt','dsh-agent-loop','dsh-sdk-app','dsh-sdk-jsonrpc-server'].map(name=>`@deepseek-ai/${name}`);
const unavailable = () => Object.assign(new Error('此 DSH 配置暂不支持隔离检测，请检查 DSH SDK 配置后重试'), { code: 'SYSTEM_ADAPTER_UNSUPPORTED' });
const plain = node => isScalar(node) && !node.tag ? node.value : undefined;
function entries(source) {
  try {
    const doc = parseDocument(source, { prettyErrors:false, strict:true, uniqueKeys:true });
    if (doc.errors.length || !isSeq(doc.contents) || doc.contents.items.length > 2000) throw unavailable();
    const ids = new Set();
    return doc.contents.items.map(row => {
      if (!isMap(row) || row.has('group')) throw unavailable();
      const id=plain(row.get('id',true)), name=plain(row.get('name',true));
      if (typeof id !== 'string' || !/^[\w.-]{1,160}$/.test(id) || typeof name !== 'string' || ids.has(id)) throw unavailable();
      ids.add(id); return {id,name,row};
    });
  } catch { throw unavailable(); }
}
const resetConfig = (name, instructions) => ({
  '@deepseek-ai/dsh-tools': {mode:'native'},
  '@deepseek-ai/dsh-system-prompt': {personaPrefix:instructions,personaSuffix:'',includeHarnessIdentity:false,includeRuntimeContext:false},
  '@deepseek-ai/dsh-agent-loop': {agents:[]},
  '@deepseek-ai/dsh-sdk-jsonrpc-server': {maxTokensAsSuccess:false},
}[name]);
export function buildDshSystemPatch(source, instructions) {
  const rows=entries(source);
  for (const name of required) if (rows.filter(r=>r.name===name).length!==1) throw unavailable();
  return rows.map(({id,name,row}) => ({id, ...(!allowed.has(name) ? {disabled:true} : resetConfig(name,instructions) ? {disabled:false,config:resetConfig(name,instructions)} : {disabled:plain(row.get('disabled',true))===true})}));
}
export function verifyDshSystemConfig(source, instructions) {
  const rows=entries(source);
  for (const {name,row} of rows) {
    if (!allowed.has(name) && plain(row.get('disabled',true))!==true) throw unavailable();
    const config=resetConfig(name,instructions);
    if (config && (plain(row.get('disabled',true))===true || JSON.stringify(row.get('config')?.toJSON())!==JSON.stringify(config))) throw unavailable();
  }
  for (const name of required) if (rows.filter(r=>r.name===name&&plain(r.row.get('disabled',true))!==true).length!==1) throw unavailable();
}
export async function prepareDshSystem(connection, cwd, instructions, { runtimeInvocation, commandInvocation, execute = executeFile, signal } = {}) {
  const dump=async (args, projectPath) => {
    const invocation=await runtimeInvocation(connection,args,commandInvocation);
    try { return String((await execute(invocation.binary,invocation.args,{cwd:projectPath,signal,timeout:10000,maxBuffer:2*1024*1024,windowsHide:true,env:{...process.env,...invocation.env}})).stdout); }
    catch { throw unavailable(); }
  };
  const source=await dump(['sdk','--dump-config'],connection.projectPath);
  signal?.throwIfAborted();
  const defaults=connection.provider&&connection.model ? {provider:connection.provider,model:connection.model} : parseDshDefaults(source);
  const patchPath=path.join(cwd,'system.patch.json');
  await writeFile(patchPath,JSON.stringify(buildDshSystemPatch(source,instructions)),{mode:0o600});
  signal?.throwIfAborted();
  verifyDshSystemConfig(await dump(['sdk','--patch',patchPath,'--dump-config'],cwd),instructions);
  return {patchPath,defaults};
}
