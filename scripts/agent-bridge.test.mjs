import test from "node:test";
import assert from "node:assert/strict";
import { createBridgeService, createBridgeServer, resumeCommand, validDirectory, commandInvocation, resolveCodexNpmCommand, windowsResumeScript, windowsDiscussionLaunch, windowsArgument, windowsTerminalBootstrap } from "./agent-bridge.mjs";

const MAIN = "019a7d11-6213-7110-9279-000000000001";
const CHILD = "019a7d11-6213-7110-9279-000000000002";
function fixture(overrides = {}) {
  const opened = []; const calls = [];
  const service = createBridgeService({
    findBinary: async (tool) => tool === "codex" ? "/bin/codex" : null,
    exec: async (_binary, args) => ({ stdout: args[0] === "resume" ? "Usage: codex resume [OPTIONS]\n-C, --cd <DIR>" : "codex-cli 0.161.0\n" }),
    validDirectory: async (dir) => dir,
    platform: "darwin",
    rpc: async (_binary, _cwd, action) => action(async (method, params) => {
      calls.push([method, params]);
      if (method === "account/read") return { account: { type: "chatgpt" }, requiresOpenaiAuth: true };
      return { thread: { id: params.threadId, cwd: "/project" } };
    }),
    terminalOpen: async (...args) => opened.push(args),
    ...overrides,
  });
  return { service, opened, calls };
}

test("detect installation/version without login secrets", async () => {
  const { service } = fixture(); const result = await service.tools();
  assert.equal(result.tools[0].version, "0.161.0");
  assert.equal(result.tools[0].login, "unknown");
  assert.equal(result.tools[1].installed, false);
});
test("connection probes do not dispatch or report unverified capabilities", async () => {
  const { service, calls, opened } = fixture();
  const result = await service.test({ tool: "codex", projectPath: "/project" });
  assert.equal(result.status, "ready");
  assert.equal(result.capabilities.sourceOpen, true);
  assert.equal(result.capabilities.observe, false);
  assert.equal(result.capabilities.dispatch, false);
  assert.deepEqual(calls.map(([method]) => method), ["account/read"]);
  assert.equal(opened.length, 0);
});
test("sample IDs never reach source tool", async () => {
  const { service, opened } = fixture();
  assert.equal((await service.open({ mode: "sample", sessionId: "demo-search" })).status, "unavailable");
  assert.equal(opened.length, 0);
});
test("unpaired live open is rejected", async () => {
  const { service } = fixture();
  await assert.rejects(service.open({ mode: "live", tool: "codex", connectionId: "fake", sessionId: MAIN }), /连接已失效/);
});
test("exact child session is validated then opened, request identity preserved", async () => {
  const { service, opened, calls } = fixture();
  const c = await service.test({ tool: "codex", projectPath: "/project" });
  const r = await service.open({ mode: "live", tool: "codex", connectionId: c.connectionId, sessionId: MAIN, childSessionId: CHILD, parentSessionId: MAIN, requestId: "approval-4" });
  assert.equal(r.status, "opened"); assert.equal(r.targetSessionId, CHILD); assert.equal(r.requestId, "approval-4");
  assert.equal(opened[0][2], CHILD); assert.equal(calls[1][0], "thread/read");
});
test("non-resumable child explicitly falls back to parent, no pretend anchor navigation", async () => {
  const { service, opened } = fixture({ rpc: async (_b, _p, action) => action(async (method, params) => {
    if (method === "account/read") return { account: {}, requiresOpenaiAuth: true };
    if (params.threadId === CHILD) throw new Error("not found");
    return { thread: { id: MAIN, cwd: "/project" } };
  }) });
  const c = await service.test({ tool: "codex", projectPath: "/project" });
  const r = await service.open({ mode: "live", tool: "codex", connectionId: c.connectionId, sessionId: CHILD, parentSessionId: MAIN, childCallId: "call-1" });
  assert.equal(r.status, "parent_opened"); assert.equal(r.childCallId, "call-1"); assert.equal(opened[0][2], MAIN);
});
test("cross-project threads cannot launch", async () => {
  const { service, opened } = fixture({ rpc: async (_b, _p, action) => action(async (method, params) => method === "account/read" ? { account: {} } : { thread: { id: params.threadId, cwd: "/other-project" } }) });
  const c = await service.test({ tool: "codex", projectPath: "/project" });
  await assert.rejects(service.open({ mode: "live", tool: "codex", connectionId: c.connectionId, sessionId: MAIN }), /不属于/);
  assert.equal(opened.length, 0);
});
test("bad session IDs are not interpolated into a terminal command", async () => {
  assert.throws(() => resumeCommand("/bin/codex", "/project", "$(touch /tmp/bad)"));
  const command = resumeCommand("/bin/codex", "/a'b $(touch /tmp/bad)", MAIN);
  assert.ok(command.includes("'/a'\\''b $(touch /tmp/bad)'"));
  await assert.rejects(validDirectory("relative/path"));
  await assert.rejects(validDirectory("/project\nexec bad"));
});
test("sign-in failure never creates a connection", async () => {
  const { service } = fixture({ rpc: async () => ({ account: null, requiresOpenaiAuth: true }) });
  const r = await service.test({ tool: "codex", projectPath: "/project" });
  assert.equal(r.status, "needs_login"); assert.equal(r.connectionId, undefined);
});
test("HTTP token and origin enforced; reply endpoint never accepts a permission", async () => {
  const { service } = fixture();
  const server = createBridgeServer({ token: "test-secret", origins: ["http://127.0.0.1:4173"], service });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + "/v1/tools")).status, 401);
    assert.equal((await fetch(base + "/v1/tools", { headers: { Authorization: "Bearer test-secret", Origin: "https://evil.example" } })).status, 403);
    const headers = { Authorization: "Bearer test-secret", Origin: "http://127.0.0.1:4173" };
    assert.equal((await fetch(base + "/v1/tools", { headers })).status, 200);
    const result = await fetch(base + "/v1/interactions/respond", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "r", response: { kind: "permission", decision: "allow_once" } }) });
    assert.equal(result.status, 501);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

const WINDOWS_SHIM = "C:\\Users\\O'Neil & Friends\\AppData\\Roaming\\npm\\codex.cmd";
const WINDOWS_ENTRY = WINDOWS_SHIM.replace(/codex\.cmd$/, 'node_modules\\@openai\\codex\\bin\\codex.js');
const WINDOWS_NODE = 'C:\\Program Files\\nodejs\\node.exe';
function npmFixture(overrides = {}) {
  return {
    env: { PATH: 'C:\\Program Files\\nodejs' },
    readFile: async file => file.endsWith('package.json') ? '{"name":"@openai/codex"}' : '@"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    isFile: async file => [WINDOWS_ENTRY, WINDOWS_NODE].includes(file),
    ...overrides,
  };
}

test('known npm Codex shim bypasses cmd.exe for RPC, metadata and arbitrary prompts', async () => {
  for (const args of [['--version'], ['app-server', '--stdio'], ['resume', '--help'], ['--cd', 'C:\\100%\\旅行', '去芭提雅\n预算 "5k" & %PATH% ! $()']]) {
    const command = await commandInvocation(WINDOWS_SHIM, args, 'win32', npmFixture());
    assert.equal(command.binary, WINDOWS_NODE);
    assert.deepEqual(command.args, [WINDOWS_ENTRY, ...args]);
  }
  const native = await commandInvocation('C:\\Tools\\codex.exe', ['--version'], 'win32');
  assert.equal(native.binary, 'C:\\Tools\\codex.exe');
});

test('npm resolution requires matching wrapper, package and a real standalone node executable', async () => {
  assert.equal(await resolveCodexNpmCommand(WINDOWS_SHIM, npmFixture({ readFile: async () => 'echo unrelated' })), null);
  assert.equal(await resolveCodexNpmCommand(WINDOWS_SHIM, npmFixture({ isFile: async file => file === WINDOWS_ENTRY })), null);
  assert.equal(await resolveCodexNpmCommand(WINDOWS_SHIM, npmFixture({ readFile: async file => file.endsWith('package.json') ? '{"name":"unrelated"}' : '@"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js"' })), null);
});

test('unknown batch wrappers retain fixed metadata probes but reject dynamic argument forwarding', async () => {
  const options = npmFixture({ isFile: async () => false });
  for (const args of [['--version'], ['app-server', '--stdio'], ['resume', '--help']]) {
    const command = await commandInvocation(WINDOWS_SHIM, args, 'win32', options);
    assert.equal(command.binary, 'powershell.exe');
    const script = Buffer.from(command.args.at(-1), 'base64').toString('utf16le');
    assert.ok(script.includes("O''Neil & Friends"));
    assert.ok(script.endsWith(args.map(value => "'" + value + "'").join(' ')));
  }
  await assert.rejects(commandInvocation(WINDOWS_SHIM, ['resume', MAIN, '-C', 'C:\\%TEMP%'], 'win32', options), /不能安全接收/);
  await assert.rejects(commandInvocation(WINDOWS_SHIM, ['hello & calc.exe'], 'win32', options), /不能安全接收/);
});

// Independently decode CRT command lines to verify escaping produces exactly the original argv.
function parseWindowsArguments(line) {
  const args = []; let index = 0;
  while (index < line.length) {
    while (/\s/.test(line[index] || '') && index < line.length) index++;
    if (index === line.length) break;
    let value = ''; let quoted = false;
    while (index < line.length && (quoted || !/\s/.test(line[index]))) {
      let slashes = 0;
      while (line[index] === '\\') { slashes++; index++; }
      if (line[index] === '"') {
        value += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) value += '"'; else quoted = !quoted;
        index++;
      } else {
        value += '\\'.repeat(slashes);
        if (index < line.length) value += line[index++];
      }
    }
    args.push(value);
  }
  return args;
}

test('Windows native process arguments round-trip Chinese, quotes, newlines and cmd metacharacters', async () => {
  const prompt = '我要去芭提雅\n预算 "5000"，路径 C:\\trip\\；%PATH% ! & | < > ^ $(calc.exe)';
  const args = ['', prompt, 'C:\\folder with spaces\\', 'two\\"quotes', "O'Neil"];
  assert.deepEqual(parseWindowsArguments(args.map(windowsArgument).join(' ')), args);
  const prepared = await windowsDiscussionLaunch(WINDOWS_SHIM, "C:\\Work\\O'Neil %TEMP%", 'codex', prompt, npmFixture());
  assert.equal(prepared.needsPaste, false);
  assert.ok(prepared.script.includes('ProcessStartInfo'));
  assert.ok(prepared.script.includes("$launch.FileName = 'C:\\Program Files\\nodejs\\node.exe'"));
  assert.ok(prepared.script.includes('$launch.UseShellExecute = $false'));
  assert.ok(!prepared.script.includes('codex.cmd'));
  const encodedArgs = prepared.script.match(/\$launch\.Arguments = '([\s\S]*?)'\n\$agent/)[1].replaceAll("''", "'");
  assert.deepEqual(parseWindowsArguments(encodedArgs), [WINDOWS_ENTRY, '--cd', "C:\\Work\\O'Neil %TEMP%", prompt]);
  const resume = await windowsResumeScript(WINDOWS_SHIM, "C:\\Work\\O'Neil $test", MAIN, npmFixture());
  assert.ok(resume.includes("Set-Location -LiteralPath 'C:\\Work\\O''Neil $test'"));
  await assert.rejects(windowsResumeScript(WINDOWS_SHIM, 'C:\\Work', 'id;calc.exe', npmFixture()));
});

test('unknown Windows shim does not contain prompt and explicitly requests paste', async () => {
  const prompt = 'UNIQUE_PROMPT " & %TEMP%\nsecond line';
  const prepared = await windowsDiscussionLaunch('C:\\Tools\\agent.cmd', 'C:\\Project', 'cursor', prompt);
  assert.equal(prepared.needsPaste, true);
  assert.ok(!prepared.script.includes(prompt));
  assert.ok(prepared.script.endsWith("& 'C:\\Tools\\agent.cmd'"));
  assert.deepEqual(prepared.invocation, { binary: 'C:\\Tools\\agent.cmd', args: [] });
  assert.ok(prepared.script.includes('粘贴'));
});

test('unknown Codex shim cannot advertise an unverified safe resume capability', async () => {
  const { service } = fixture({ platform: 'win32', findBinary: async () => WINDOWS_SHIM, resolveCodexNpmCommand: async () => null });
  const c = await service.test({ tool: 'codex', projectPath: 'C:\\Project' });
  assert.equal(c.status, 'ready');
  assert.equal(c.capabilities.sourceOpen, false);
  assert.equal(c.capabilities.resume, false);
});

test('discussion API surfaces paste requirement instead of claiming prompt delivery', async () => {
  const { service } = fixture({ launchDiscussion: async () => ({ needsPaste: true }) });
  const c = await service.test({ tool: 'codex', projectPath: '/project' });
  const r = await service.discuss({ connectionId: c.connectionId, prompt: '旅行计划' });
  assert.equal(r.needsPaste, true);
  assert.match(r.message, /未自动传入/);
});

test('discussion launches only after a tested project and explicit request', async () => {
  const launches = [];
  const { service } = fixture({ launchDiscussion: async (...args) => launches.push(args) });
  await assert.rejects(service.discuss({ connectionId: 'missing', prompt: '分析旅行' }), /连接已失效/);
  const connection = await service.test({ tool: 'codex', projectPath: '/project' });
  assert.equal(launches.length, 0);
  await service.discuss({ connectionId: connection.connectionId, prompt: '先分析目的与约束，再拆解任务' });
  assert.deepEqual(launches[0], ['/bin/codex', '/project', 'codex', '先分析目的与约束，再拆解任务']);
  await assert.rejects(service.discuss({ connectionId: connection.connectionId, prompt: '' }));
});

test('interactive discussion uses documented per-tool arguments', async () => {
  const { discussionArguments } = await import('./agent-bridge.mjs');
  assert.deepEqual(discussionArguments('codex', '/project', 'hello'), ['--cd','/project','hello']);
  assert.deepEqual(discussionArguments('claude', '/project', 'hello'), ['hello']);
  assert.deepEqual(discussionArguments('cursor', '/project', 'hello'), ['hello']);
  assert.deepEqual(discussionArguments('opencode', '/project', 'hello'), ['/project']);
});

test('Windows terminal bootstrap quotes the script path and keeps prompts out of the process command line', () => {
  const file = "C:\\Users\\O'Neil %temp%\\invocation.json";
  const outer = windowsTerminalBootstrap(file);
  const encoded = outer.match(/'-EncodedCommand','([^']+)'/)[1];
  const inner = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.ok(inner.includes("Get-Content -LiteralPath 'C:\\Users\\O''Neil %temp%\\invocation.json' -Raw -Encoding UTF8 | ConvertFrom-Json"));
  assert.ok(!inner.includes("ExecutionPolicy"));
  assert.ok(!inner.includes("Invoke-Expression"));
  assert.ok(outer.length < 3000);
});
