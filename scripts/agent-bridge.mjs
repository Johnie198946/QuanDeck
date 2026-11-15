#!/usr/bin/env node
/** Authenticated loopback companion. Opens discussions only on request; never approves permissions. */
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, realpath, stat, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);
const TOOLS = { codex: ["codex"], claude: ["claude"], cursor: ["agent", "cursor-agent"], opencode: ["opencode"] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noCapabilities = () => ({ observe: false, dispatch: false, resume: false, usage: false, subAgents: false, sourceOpen: false, permissions: false });
export const shellQuote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
export function resumeCommand(binary, cwd, id) {
  if (!UUID.test(id)) throw new Error("会话 ID 不是有效 UUID");
  return `exec ${shellQuote(binary)} resume ${shellQuote(id)} -C ${shellQuote(cwd)}\n`;
}
const powershellQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
const isBatch = binary => /\.(cmd|bat)$/i.test(binary);
const isFile = async file => { try { return (await stat(file)).isFile(); } catch { return false; } };

/** Bypass the npm .cmd wrapper; arbitrary prompts must never pass through cmd.exe. */
export async function resolveCodexNpmCommand(binary, options = {}) {
  if (!/^codex\.(cmd|bat)$/i.test(path.win32.basename(binary))) return null;
  const read = options.readFile || readFile;
  const exists = options.isFile || isFile;
  const env = options.env || process.env;
  const folder = path.win32.dirname(binary);
  const entry = path.win32.join(folder, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  try {
    const wrapper = String(await read(binary, 'utf8')).replaceAll('/', '\\').toLowerCase();
    if (!wrapper.includes('\\node_modules\\@openai\\codex\\bin\\codex.js') || !await exists(entry)) return null;
    const pkg = JSON.parse(await read(path.win32.join(folder, 'node_modules', '@openai', 'codex', 'package.json'), 'utf8'));
    if (pkg.name !== '@openai/codex') return null;
  } catch { return null; }
  const candidates = [path.win32.join(folder, 'node.exe'),
    ...(env.PATH || env.Path || '').split(';').filter(Boolean).map(dir => path.win32.join(dir.replace(/^"|"$/g, ''), 'node.exe')),
    ...(env.ProgramFiles ? [path.win32.join(env.ProgramFiles, 'nodejs', 'node.exe')] : []),
    ...(path.win32.basename(process.execPath).toLowerCase() === 'node.exe' ? [process.execPath] : []),
  ];
  for (const node of new Set(candidates)) if (await exists(node)) return { binary: node, prefix: [entry] };
  return null;
}
export async function commandInvocation(binary, args, platform = process.platform, options = {}) {
  if (platform === 'win32' && isBatch(binary)) {
    const native = await resolveCodexNpmCommand(binary, options);
    if (native) return { binary: native.binary, args: [...native.prefix, ...args] };
    // Only fixed protocol probes may cross an unknown batch wrapper. No paths, IDs or prompts.
    if (!['', '--version', 'resume --help', 'app-server --stdio'].includes(args.join(' ')) || args.some(arg => /[\s]/.test(arg))) {
      throw new Error('此命令行包装器不能安全接收任务参数，请在工具中粘贴讨论内容');
    }
    if (/[\0\r\n%!]/.test(binary)) throw new Error('命令行包装器路径含不支持的字符，请使用原生可执行文件');
    const script = '& ' + [binary, ...args].map(powershellQuote).join(' ');
    return { binary: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
  }
  return { binary, args };
}
async function executeCLI(binary, args, options) {
  const invocation = await commandInvocation(binary, args);
  return exec(invocation.binary, invocation.args, options);
}
async function findBinary(tool) {
  const dirs = [...new Set([...(process.env.PATH || "").split(path.delimiter), path.join(os.homedir(), ".local/bin"), path.join(os.homedir(), ".opencode/bin"), path.join(os.homedir(), ".cargo/bin"), ...(process.env.APPDATA ? [path.join(process.env.APPDATA, "npm")] : []), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean))];
  for (const name of TOOLS[tool] || []) for (const dir of dirs) for (const extension of process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]) {
    const candidate = path.join(dir, name + extension);
    try { await access(candidate, process.platform === "win32" ? 0 : 1); if ((await stat(candidate)).isFile()) return candidate; } catch {}
  }
  return null;
}
export async function validDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error("请选择有效的绝对项目目录");
  const resolved = await realpath(value);
  if (!(await stat(resolved)).isDirectory()) throw new Error("项目路径必须是目录");
  return resolved;
}
export async function codexRPC(binary, cwd, action) {
  const invocation = await commandInvocation(binary, ["app-server", "--stdio"]);
  const child = spawn(invocation.binary, invocation.args, { cwd, stdio: ["pipe", "pipe", "pipe"], shell: false });
  const pending = new Map(); let seq = 0; let buffer = "";
  const fail = (error) => { for (const p of pending.values()) p.reject(error); pending.clear(); };
  child.on("error", () => fail(new Error("无法启动 Codex App Server")));
  child.on("exit", () => fail(new Error("Codex App Server 已退出")));
  child.stdin.on("error", () => fail(new Error("Codex 连接已关闭，请重新测试")));
  child.stderr.on("data", () => {}); // Do not expose tokens, emails, configuration or paths from stderr.
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    if (buffer.length > 4 * 1024 * 1024) { fail(new Error("源端响应过大")); child.kill(); return; }
    let pos;
    while ((pos = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
      try {
        const message = JSON.parse(line); const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error("源端未返回可用的会话元数据")); else waiter.resolve(message.result);
      } catch {}
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const timer = setTimeout(() => { fail(new Error("Codex 连接超时")); child.kill(); }, 12000);
  try {
    await call("initialize", { clientInfo: { name: "quandeck_companion", title: "QuanDeck", version: "0.1.0" }, capabilities: { experimentalApi: false } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
    return await action(call);
  } finally { clearTimeout(timer); child.stdin.end(); child.kill(); }
}
/** Windows CRT argument quoting, used directly by ProcessStartInfo, never cmd.exe. */
export function windowsArgument(value) {
  return '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}
export function windowsProcessScript(binary, args, cwd) {
  if (isBatch(binary)) throw new Error('批处理包装器不能接收任务参数');
  return `Set-Location -LiteralPath ${powershellQuote(cwd)}
$launch = New-Object System.Diagnostics.ProcessStartInfo
$launch.FileName = ${powershellQuote(binary)}
$launch.WorkingDirectory = ${powershellQuote(cwd)}
$launch.UseShellExecute = $false
$launch.Arguments = ${powershellQuote(args.map(windowsArgument).join(' '))}
$agent = [System.Diagnostics.Process]::Start($launch)
if ($agent) { $agent.WaitForExit() }`;
}
export async function windowsResumeScript(binary, cwd, id, options = {}) {
  if (!UUID.test(id)) throw new Error('会话 ID 不是有效 UUID');
  const invocation = await commandInvocation(binary, ['resume', id, '-C', cwd], 'win32', options);
  return windowsProcessScript(invocation.binary, invocation.args, cwd);
}
export function windowsTerminalBootstrap(configPath) {
  // Read invocation data, not executable .ps1 files: works with the default script execution policy.
  const bootstrap = `$settings = Get-Content -LiteralPath ${powershellQuote(configPath)} -Raw -Encoding UTF8 | ConvertFrom-Json
Set-Location -LiteralPath $settings.cwd
if ($settings.batch) {
  Write-Host 'QuanDeck: 请从 QuanDeck 复制讨论指令，在工具启动后粘贴。'
  & $settings.binary
} else {
  $launch = New-Object System.Diagnostics.ProcessStartInfo
  $launch.FileName = $settings.binary
  $launch.WorkingDirectory = $settings.cwd
  $launch.UseShellExecute = $false
  $launch.Arguments = $settings.arguments
  $agent = [System.Diagnostics.Process]::Start($launch)
  if ($agent) { $agent.WaitForExit() }
}`;
  const encoded = Buffer.from(bootstrap, 'utf16le').toString('base64');
  return `Start-Process powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NoExit','-EncodedCommand','${encoded}')`;
}
async function launchWindowsTerminal(invocation, cwd) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'quandeck-terminal-'));
  const config = path.join(folder, 'invocation.json');
  await writeFile(config, JSON.stringify({ binary: invocation.binary, arguments: invocation.args.map(windowsArgument).join(' '), cwd, batch: isBatch(invocation.binary) }), { encoding: 'utf8', mode: 0o600 });
  try {
    const launch = windowsTerminalBootstrap(config);
    await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launch, 'utf16le').toString('base64')], { timeout: 5000 });
  } catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
  const cleanup = setTimeout(() => void rm(folder, { recursive: true, force: true }), 300000); cleanup.unref();
}
async function terminalOpen(binary, cwd, id) {
  if (process.platform === "win32") {
    if (!UUID.test(id)) throw new Error('会话 ID 不是有效 UUID');
    await launchWindowsTerminal(await commandInvocation(binary, ['resume', id, '-C', cwd], 'win32'), cwd);
    return;
  }
  if (process.platform !== "darwin") throw new Error("当前回源支持 macOS 和 Windows");
  const dir = await mkdtemp(path.join(os.tmpdir(), "quandeck-resume-"));
  const script = path.join(dir, "open-session.command");
  await writeFile(script, "#!/bin/sh\n" + resumeCommand(binary, cwd, id), { mode: 0o700 });
  try { await exec("/usr/bin/open", ["-a", "Terminal", script], { timeout: 5000 }); }
  catch { await rm(dir, { recursive: true, force: true }); throw new Error("Terminal 未接受打开请求，请检查本机 Terminal 是否可用"); }
  const cleanup = setTimeout(() => void rm(dir, { recursive: true, force: true }), 300000); cleanup.unref();
}

export function discussionArguments(tool, projectPath, prompt) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 12000 || prompt.includes("\0")) throw new Error("讨论内容需为 1–12000 个字符");
  if (tool === "codex") return ["--cd", projectPath, prompt];
  if (tool === "claude" || tool === "cursor") return [prompt];
  if (tool === "opencode") return [projectPath];
  throw new Error("不支持此讨论工具");
}
export async function windowsDiscussionLaunch(binary, projectPath, tool, prompt, options = {}) {
  const args = discussionArguments(tool, projectPath, prompt);
  let target = { binary, args };
  if (isBatch(binary)) {
    const native = await resolveCodexNpmCommand(binary, options);
    if (native) target = { binary: native.binary, args: [...native.prefix, ...args] };
    else {
      // Launch only the tool, with no project argument or prompt passed through cmd.exe.
      if (/[\0\r\n%!]/.test(binary)) throw new Error('命令行包装器路径含不支持的字符，请使用原生可执行文件');
      return { needsPaste: true, invocation: { binary, args: [] }, script: `Set-Location -LiteralPath ${powershellQuote(projectPath)}
Write-Host 'QuanDeck: 请从 QuanDeck 复制讨论指令，在工具启动后粘贴。'
& ${powershellQuote(binary)}` };
    }
  }
  return { needsPaste: tool === 'opencode', invocation: target, script: windowsProcessScript(target.binary, target.args, projectPath) };
}
async function launchDiscussion(binary, projectPath, tool, prompt) {
  const args = discussionArguments(tool, projectPath, prompt);
  if (process.platform === 'win32') {
    const prepared = await windowsDiscussionLaunch(binary, projectPath, tool, prompt);
    await launchWindowsTerminal(prepared.invocation, projectPath);
    return { needsPaste: prepared.needsPaste };
  }
  if (process.platform !== 'darwin') throw new Error('当前支持 macOS 和 Windows 终端');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'quandeck-discuss-'));
  const script = path.join(folder, 'discussion.command');
  await writeFile(script, `#!/bin/sh\ncd ${shellQuote(projectPath)} || exit 1\nexec ${[binary, ...args].map(shellQuote).join(' ')}\n`, { mode: 0o700 });
  try { await exec('/usr/bin/open', ['-a', 'Terminal', script], { timeout: 5000 }); }
  catch (error) { await rm(folder, {recursive:true,force:true}); throw error; }
  const cleanup = setTimeout(() => void rm(folder,{recursive:true,force:true}), 300000); cleanup.unref();
  return { needsPaste: tool === 'opencode' };
}

/** Dependency injection makes protocol, validation and launch behavior testable without opening an app. */
export function createBridgeService(deps = {}) {
  const locate = deps.findBinary || findBinary;
  const execute = deps.exec || executeCLI;
  const rpc = deps.rpc || codexRPC;
  const directory = deps.validDirectory || validDirectory;
  const openTerminal = deps.terminalOpen || terminalOpen;
  const openDiscussion = deps.launchDiscussion || launchDiscussion;
  const resolveWindowsCodex = deps.resolveCodexNpmCommand || resolveCodexNpmCommand;
  const platform = deps.platform || process.platform;
  const connections = new Map();
  async function detect(tool) {
    const binary = await locate(tool);
    if (!binary) return { tool, installed: false, version: null, login: "unknown", adapter: "unavailable", note: "未检测到命令行工具" };
    let version = null;
    try {
      const result = await execute(binary, ["--version"], { timeout: 4000, maxBuffer: 32768 });
      version = /\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/.exec(result.stdout)?.[0] || null;
    } catch {}
    return { tool, installed: true, version, login: "unknown", adapter: tool === "codex" ? "available" : "unavailable", note: tool === "codex" ? "测试连接后核对登录状态与回源能力" : "已检测安装；此版本的会话适配器待接入" };
  }
  return {
    async tools() { return { tools: await Promise.all(Object.keys(TOOLS).map(detect)) }; },
    async test(input) {
      if (!TOOLS[input.tool]) throw new Error("不支持的工具");
      const projectPath = await directory(input.projectPath);
      const binary = await locate(input.tool);
      if (!binary) throw new Error("未检测到此工具，请先安装并在工具中登录");
      const result = { tool: input.tool, projectPath, status: "unsupported", login: "unknown", capabilities: noCapabilities(), checkedAt: new Date().toISOString(), note: "已检测安装；此版本的协议适配器尚未启用" };
      if (input.tool !== "codex") {
        const connectionId = randomBytes(16).toString("hex");
        connections.set(connectionId, { tool: input.tool, binary, projectPath, canResume: false });
        return { ...result, connectionId, discussionOpen: ["darwin", "win32"].includes(platform), note: "可在本机终端开始讨论；任务与结果自动同步待接入" };
      }
      const account = await rpc(binary, projectPath, (call) => call("account/read", { refreshToken: false }));
      result.login = account.account ? "signed_in" : account.requiresOpenaiAuth ? "signed_out" : "unknown";
      if (result.login === "signed_out") return { ...result, status: "needs_login", note: "请先在 Codex 中登录，再重新测试" };
      let canResume = false;
      if (["darwin", "win32"].includes(platform)) {
        try {
          const help = await execute(binary, ["resume", "--help"], { timeout: 4000, maxBuffer: 65536 });
          canResume = /Usage:.*codex resume/.test(help.stdout) && /--cd/.test(help.stdout);
          if (canResume && platform === "win32" && isBatch(binary)) canResume = Boolean(await resolveWindowsCodex(binary));
        } catch {}
      }
      const connectionId = randomBytes(16).toString("hex");
      connections.set(connectionId, { tool: input.tool, binary, projectPath, canResume });
      return { ...result, connectionId, discussionOpen: ["darwin", "win32"].includes(platform), status: "ready", capabilities: { ...result.capabilities, resume: canResume, sourceOpen: canResume }, note: canResume ? "Codex 元数据连接已验证。可在 终端打开已存在的会话；任务、进度和用量仍需业务后端同步。" : "Codex 元数据连接已验证。当前环境的会话回源能力尚未验证，任务数据仍需业务后端同步。" };
    },
    async discuss(input) {
      const connection = connections.get(input.connectionId);
      if (!connection) throw new Error("连接已失效，请重新测试 Agent 连接");
      discussionArguments(connection.tool, connection.projectPath, input.prompt);
      const launch = await openDiscussion(connection.binary, connection.projectPath, connection.tool, input.prompt);
      const needsPaste = launch?.needsPaste === true || connection.tool === "opencode";
      return { status: "opened", needsPaste, message: needsPaste ? "已打开工具，请复制讨论指令并粘贴到 Agent 中；本次未自动传入讨论内容。" : "已请求终端打开讨论，请在 Agent 中继续沟通。" };
    },
    async open(input) {
      if (input.mode !== "live") return { status: "unavailable", message: "示例会话不会打开本机 Agent" };
      const connection = connections.get(input.connectionId);
      if (!connection || connection.tool !== input.tool) throw new Error("连接已失效，请重新测试 Agent 连接");
      if (connection.tool !== "codex" || !connection.canResume) return { status: "unavailable", message: "此工具尚未验证会话回源能力" };
      const target = input.childSessionId || input.sessionId;
      for (const id of [target, input.parentSessionId].filter(Boolean)) if (typeof id !== "string" || !UUID.test(id)) throw new Error("源端会话 ID 无效，无法打开示例或未索引的会话");
      let targetId = target; let parent = false;
      const read = (id) => rpc(connection.binary, connection.projectPath, (call) => call("thread/read", { threadId: id, includeTurns: false }));
      let metadata;
      try { metadata = await read(targetId); }
      catch (error) {
        if (!input.parentSessionId || input.parentSessionId === targetId) throw error;
        targetId = input.parentSessionId; parent = true;
        metadata = await read(targetId);
      }
      if (metadata?.thread?.id !== targetId || !metadata.thread.cwd || await directory(metadata.thread.cwd) !== connection.projectPath) throw new Error("源会话不属于已验证的项目目录，请切换到对应项目连接");
      await openTerminal(connection.binary, connection.projectPath, targetId);
      return { status: parent ? "parent_opened" : "opened", targetSessionId: targetId, requestId: input.requestId, childCallId: input.childCallId,
        message: parent ? "已请求 终端打开父会话。子代理没有可恢复的独立会话，请在父会话查看对应调用。" : "已请求 终端打开对应 Codex 会话，请在那里回复或处理权限。" };
    },
  };
}

export function createBridgeServer({ token, origins, service = createBridgeService() }) {
  return http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) { json(403, { error: "此网页未获连接许可" }); return; }
    if (origin) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST"); res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type"); res.writeHead(204); res.end(); return; }
    const expected = Buffer.from(`Bearer ${token}`); const actual = Buffer.from(req.headers.authorization || "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) { json(401, { error: "配对码不正确，请使用本次连接服务启动时显示的配对码" }); return; }
    try {
      if (req.method === "GET" && req.url === "/v1/tools") { json(200, await service.tools()); return; }
      if (req.method !== "POST") { json(404, { error: "接口不存在" }); return; }
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) { json(415, { error: "需要 JSON 请求" }); return; }
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 16384) { json(413, { error: "请求过大" }); return; } }
      let input; try { input = JSON.parse(body); } catch { json(400, { error: "JSON 无效" }); return; }
      if (!input || typeof input !== "object" || Array.isArray(input)) { json(400, { error: "请求格式无效" }); return; }
      if (req.url === "/v1/connections/test") json(200, await service.test(input));
      else if (req.url === "/v1/discussions/open") json(200, await service.discuss(input));
      else if (req.url === "/v1/source/open") json(200, await service.open(input));
      else if (req.url === "/v1/interactions/respond") json(501, { error: "请在源 Agent 中回复。本连接服务不代替源端审批。" });
      else json(404, { error: "接口不存在" });
    } catch (error) { json(400, { error: error instanceof Error ? error.message : "连接失败" }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.QUANDECK_BRIDGE_PORT || 4175);
  const token = process.env.QUANDECK_BRIDGE_TOKEN || randomBytes(24).toString("hex");
  const origins = (process.env.QUANDECK_BRIDGE_ORIGINS || "http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4174,http://localhost:4174,http://127.0.0.1:4176,http://localhost:4176").split(",");
  const server = createBridgeServer({ token, origins });
  server.listen(port, "127.0.0.1", () => {
    console.log(`QuanDeck companion: http://127.0.0.1:${port}\n配对码（仅填入你自己的工作台）：${token}\n关闭此终端即断开连接。不会自动派发任务。`);
  });
}
