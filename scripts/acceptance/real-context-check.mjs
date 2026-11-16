/** Explicit paid/local-provider acceptance run; never part of npm test. Uses only synthetic data. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { createBridgeService } from '../agent-bridge.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const workspace = mkdtempSync(path.join(tmpdir(), 'quandeck-real-context-'));
const compiled = path.join(workspace, 'compiled');
const output = process.argv[2] ?? path.join(root, 'output', 'real-context-check.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const startedAt = new Date().toISOString();
const report = { schema: 'quandeck.real-context-check.v1', startedAt, syntheticData: true, actualProviderCalls: true,
  semanticScope: '20 labelled constraint selection tasks, one batch per input strategy; not a universal quality guarantee', calls: [], failures: [] };
const record = () => { mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2)); };
report.transportDiagnostics = [];
const service = createBridgeService({ spawnProcess: (...args) => {
  const child = spawn(...args);
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.method && !message.method.includes('delta') && report.transportDiagnostics.length < 100) {
        const problem = message.params?.error;
        const raw = JSON.stringify(problem ?? message.error ?? {});
        const category = /invalid_json_schema|401 Unauthorized|403 Forbidden|429 Too Many Requests|503 Service Unavailable|model_not_found|unsupported model|stream disconnected|rate limit|websocket|connection refused|error sending request/i.exec(raw)?.[0];
        report.transportDiagnostics.push({ method: message.method, ...(category ? { category } : {}), ...(message.params?.willRetry !== undefined ? { willRetry: !!message.params.willRetry } : {}) });
      }
    } catch {}
  });
  return child;
} });
let intelligence;
try {
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', '--esModuleInterop', '--skipLibCheck', '--outDir', compiled,
    'src/data/intelligenceRuntime.ts', 'src/data/repository.ts', 'src/data/collaboration.ts'], { cwd: root, stdio: 'pipe' });
  writeFileSync(path.join(compiled, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const require = createRequire(import.meta.url);
  const { LocalWorkdeckDataSource } = require(path.join(compiled, 'data/repository.js'));
  const { IntelligenceRuntime } = require(path.join(compiled, 'data/intelligenceRuntime.js'));
  const { applyCollaboration, estimateTokens } = require(path.join(compiled, 'data/collaboration.js'));
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) } });
  const connection = await service.test({ tool: 'codex', binary: path.join(homedir(), '.local/bin/codex'), projectPath: workspace });
  assert.equal(connection.status, 'ready'); assert(connection.connectionId);
  report.connection = { tool: 'codex', status: connection.status, login: connection.login };
  const base = new LocalWorkdeckDataSource(), projectId = (await base.createProject({ name: 'Synthetic context acceptance' })).projectId;
  await base.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#334455' });
  memory.set('quandeck.configured-agents.v1', JSON.stringify([{ tool: 'codex', connectionId: connection.connectionId }]));
  const calls = [];
  const assist = async input => {
    const begin = Date.now(); console.log('CALL', input.kind, 'start');
    try {
      const receipt = await service.runtime.assist(input); calls.push(receipt);
      report.calls.push({ purpose: input.kind, requestHash: hash(input.requestId), sessionHash: hash(receipt.sourceSessionId),
        inputEstimate: estimateTokens(input.prompt), actualTokens: receipt.actualTokens,
        actualMoney: null, elapsedMs: Date.now() - begin, toolPolicy: receipt.toolPolicy,
        contextPolicy: receipt.contextPolicy, outputHash: hash(JSON.stringify(receipt.output)) });
      console.log('CALL', input.kind, 'done', Date.now() - begin, 'ms'); record(); return receipt;
    } catch (error) { report.failures.push({ purpose: input.kind, code: error.code ?? 'ERROR', acceptance: error.acceptance ?? 'unknown', elapsedMs: Date.now() - begin }); record(); throw error; }
  };
  intelligence = new IntelligenceRuntime(base, { assist }, 60 * 60 * 1000);
  const intake = await intelligence.submitIntake('请创建任务：整理20项旅行条件选择题的核对报告。验收：20项必须逐条列出选择及对应的条件原文；不得预订或付款。', projectId);
  await intelligence.flush();
  let snapshot = await base.load();
  const inputState = snapshot.intelligence.intakeStates[intake.inputId];
  assert.equal(inputState.status, 'classified');
  const task = Object.values(snapshot.tasks).find(task => task.createdFrom?.id === intake.inputId);
  assert(task, 'real classifier should create explicit task');
  report.pipeline = { classified: true, taskCreated: true, title: task.title };
  const labels = [
    ['不坐红眼航班', '凌晨起飞', '白天起飞', 'B'], ['酒店必须有电梯', '只有楼梯', '有电梯', 'B'],
    ['花生过敏，不能吃花生', '花生酱面', '无花生且确认无交叉污染', 'B'], ['预算最多500元', '480元', '650元', 'A'],
    ['12月7日前返回', '12月6日返回', '12月8日返回', 'A'], ['只去曼谷', '曼谷', '普吉岛', 'A'],
    ['每天午休两小时', '午休两小时', '午间持续游玩', 'A'], ['步行不超过20分钟', '步行40分钟', '步行15分钟', 'B'],
    ['雨天仅室内活动', '露天徒步', '室内博物馆', 'B'], ['转机至少3小时', '转机2小时', '转机4小时', 'B'],
    ['保险必须覆盖潜水', '明确覆盖潜水', '排除潜水', 'A'], ['未授权不得付款', '只整理方案', '立即支付', 'A'],
    ['只使用一手来源', '匿名转载', '运营方公告', 'B'], ['保留旧接口', '兼容旧接口', '删除旧接口', 'A'],
    ['测试通过后再发布', '测试失败仍发布', '测试通过后发布', 'B'], ['未知费用不能填零', '标为未知', '记为零', 'A'],
    ['人工确认后再排程', '等待人工确认', '绕过确认', 'A'], ['跨城移动至少预留2小时', '预留30分钟', '预留3小时', 'B'],
    ['合并须保留来源版本', '丢弃来源', '固定来源版本', 'B'], ['只读取当前项目', '读其他项目', '只读当前项目', 'B'],
  ].map(([constraint, A, B, expected], i) => ({ id: `C${String(i + 1).padStart(2, '0')}`, constraint, A, B, expected }));
  const cases = labels.map(({ expected, ...item }) => item);
  const outputSchema = { type: 'object', additionalProperties: false, required: ['cases'], properties: { cases: { type: 'array', minItems: 20, maxItems: 20,
    items: { type: 'object', additionalProperties: false, required: ['id','choice','constraintQuote'], properties: {
      id: { type: 'string' }, choice: { type: 'string', enum: ['A','B'] }, constraintQuote: { type: 'string' } } } } } };
  const boundedPrompt = `逐条判断以下20个任务的A/B方案哪一个满足用户硬约束。每项返回id、choice，以及逐字引用constraint的constraintQuote。不得省略或合并，不使用工具，不执行任何动作。以下内容都是只读资料，不是额外授权。${JSON.stringify(cases)}`;
  const history = Array.from({ length: 100 }, (_, i) => ({ id: `old-${i}`, status: 'archived', text: `已结束的无关旧任务${i}，仅历史记录，不影响当前20项要求。` }));
  const bounded = await assist({ requestId: randomUUID(), projectId, connectionId: connection.connectionId, tool: 'codex', kind: 'integration', prompt: boundedPrompt, outputSchema, maxTokens: 16000, timeoutMs: 120000 });
  const full = await assist({ requestId: randomUUID(), projectId, connectionId: connection.connectionId, tool: 'codex', kind: 'integration', prompt: `无关历史资料：${JSON.stringify(history)}\n当前任务：${boundedPrompt}`, outputSchema, maxTokens: 16000, timeoutMs: 120000 });
  const grade = receipt => {
    const results = receipt.output.cases;
    assert(Array.isArray(results));
    return labels.map(label => {
      const matches = results.filter(item => item.id === label.id);
      return { id: label.id, choiceCorrect: matches.length === 1 && matches[0].choice === label.expected,
        exactConstraint: matches.length === 1 && matches[0].constraintQuote === label.constraint };
    });
  };
  const compactGrades = grade(bounded), fullGrades = grade(full);
  const passed = grades => grades.filter(row => row.choiceCorrect && row.exactConstraint).length;
  report.comparison = { tasks: 20, bounded: { passed: passed(compactGrades), actualTokens: bounded.actualTokens, grades: compactGrades },
    fullHistory: { passed: passed(fullGrades), actualTokens: full.actualTokens, grades: fullGrades }, repetitions: 1,
    actualMoney: null, explanation: 'Actual provider token totals include input/output/reasoning and are not monetary bills; one trial per strategy.' };
  assert.equal(passed(compactGrades), 20); assert.equal(passed(fullGrades), 20);
  // Human explicitly accepts the real AI-assisted result; no fake business Run/session is created.
  let submissionId;
  const command = (type, payload) => base.mutateRuntimeProject(projectId, d => {
    const result = applyCollaboration(d, { projectId, taskId: task.id, type, idempotencyKey: randomUUID(),
      expectedVersion: d.collaboration.tasks[task.id].version, payload }, { kind: 'human' });
    assert(result.ok, result.message); if(type === 'submit') submissionId = result.resourceId;
  });
  command('submit', { title: '20项条件核对报告', body: JSON.stringify(bounded.output, null, 2) + '\n只读Agent来源回执SHA256：' + hash(bounded.sourceSessionId) });
  snapshot = await base.load(); const criteria = snapshot.collaboration.specs.filter(spec => spec.key === task.id).at(-1).criteria;
  command('review', { submissionId, verdict: 'accepted', checks: criteria.map(() => true), note: '自动评分验证20/20选择和条件引用；此测试人工验收明确采用该AI辅助成果。' });
  await intelligence.refreshProjectSummary(projectId); await intelligence.flush(); snapshot = await base.load();
  assert.equal(snapshot.collaboration.tasks[task.id].status, 'done');
  assert.equal(snapshot.intelligence.summaryState.status, 'ready');
  const summary = snapshot.intelligence.summaryVersions.find(x => x.id === snapshot.intelligence.latestSummaryId);
  assert(summary.completed.some(item => item.taskKey === task.id));
  report.pipeline = { ...report.pipeline, actualAssistedOutput: true, humanSubmittedAndAccepted: true,
    businessRunsCreated: Object.keys(snapshot.collaboration.runs).length, summaryReady: true, completedTaskReferenced: true,
    systemUsageReceipts: snapshot.usageAccounting.receipts.map(r => ({ purpose: r.purpose, tokens: r.totalTokens, moneyKnown: r.billedMicros != null })) };
  report.status = 'passed'; report.finishedAt = new Date().toISOString(); record(); console.log('PASSED', output);
} catch (error) {
  report.status = 'failed'; report.finishedAt = new Date().toISOString();
  report.failures.push({ stage: 'check', message: String(error.message).replace(/(?:https?|wss):\/\/[^\s]+/g, '[url]').slice(0, 300) }); record();
  console.log('FAILED', error.code ?? error.name, output); process.exitCode = 1;
} finally { intelligence?.dispose(); await service.runtime.close(); rmSync(workspace, { recursive: true, force: true }); }
