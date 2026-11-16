// Contract fixture: rc.2 repeated --patch flags replace each plugin's config in order.
// Exercises real newline JSON-RPC without contacting a model provider.
import readline from 'node:readline';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';

const trace = value => appendFileSync(process.env.QD_MODEL_TRACE, JSON.stringify(value) + '\n');
const args = process.argv.slice(2), patches = [];
trace({ kind: 'start', args, cwd: process.cwd() });
if (args.includes('--version')) { console.log('0.2.0-rc.2'); process.exit(0); }
let config = JSON.parse(readFileSync(process.env.QD_MODEL_BASE, 'utf8'));
for (let index = 0; index < args.length; index++) {
  if (args[index] !== '--patch') continue;
  const patchPath = args[++index], patch = JSON.parse(readFileSync(patchPath, 'utf8'));
  patches.push(patchPath);
  config = config.map(row => ({ ...row, ...patch.find(entry => entry.id === row.id) }));
}
const defaults = config.find(row => row.name === '@deepseek-ai/dsh-agent-default-model' && !row.disabled)?.config;
if (args.includes('--dump-config')) {
  trace({ kind: 'dump', patches, defaults }); console.log(JSON.stringify(config)); process.exit(0);
}
const isolated = patches.some(file => file.endsWith('system.patch.json'));
if (isolated && (patches.at(-1).endsWith('system.patch.json') === false || config.some(row => !row.disabled && /bash|instructions|custom|persistence|hmr|settings|config-editor/.test(row.name)))) process.exit(3);
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line), params = message.params ?? {};
  trace({ kind: 'rpc', method: message.method, params, patches, isolated });
  if (message.method === 'initialize') {
    if (!defaults || ['provider', 'model', 'reasoningEffort'].some(key => params[key] !== defaults[key]) || realpathSync(params.cwd) !== realpathSync(process.cwd()) || isolated && params.maxTokens < 256) {
      send({ id: message.id, error: { message: 'model/default/isolation mismatch' } }); return;
    }
    send({ id: message.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } } });
  } else if (message.method === 'session/prompt') {
    send({ id: message.id, result: { messageId: 'fixture-receipt' } });
    const event = (type, data) => send({ method: 'session.event', params: { sessionId: params.sessionId, event: { type, data } } });
    const prompt = params.contentBlocks[0].text;
    const text = isolated ? JSON.stringify(prompt.includes('TITLE') ? { title: '已选模型标题' } : { reply: 'hello' }) : 'business reply';
    event('assistant/message', { message: { content: [{ type: 'text', text }] }, usage: { totalTokens: 10 } });
    event('turn/end', { reason: { kind: 'completed' } });
  } else if (message.method === 'shutdown') {
    send({ id: message.id, result: {} }); process.exit(0);
  }
});
