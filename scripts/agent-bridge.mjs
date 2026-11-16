#!/usr/bin/env node
/** Authenticated loopback companion. Opens discussions only on request; never approves permissions. */
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, realpath, stat, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { createRuntimeDriver, initializeRuntime, runtimeInvocation } from "./runtime/driver.mjs";
import { probeDshVersion } from "./runtime/dshVersion.mjs";
import { classifyIncident, redactDiagnostic, defaultFallbackPolicy } from "./runtime/health.mjs";
import { resolveDshDesktopCommand } from "./runtime/dshDesktop.mjs";
const exec = promisify(execFile);
const TOOLS = { codex: ["codex"], claude: ["claude"], cursor: ["agent", "cursor-agent"], opencode: ["opencode"], dsh: ["dsh", "deepseek-harness"] };
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
// A terminal may be used internally to launch a verified CLI wrapper, but is never an Agent CLI itself.
export function terminalExecutable(value) {
  if (typeof value !== 'string') return null;
  const name = path.win32.basename(value.trim().replaceAll('/', '\\')).toLowerCase().replace(/\.(exe|com)$/i, '');
  return ['powershell', 'powershell_ise', 'pwsh', 'cmd', 'bash', 'zsh', 'sh', 'dash', 'fish', 'wt', 'conhost', 'wscript', 'cscript'].includes(name) ? name : null;
}
function requireAgentExecutable(value) {
  const terminal = terminalExecutable(value);
  if (terminal) throw new Error(`${terminal} 是执行终端，不是 Agent CLI。请选择 DSH 等工具的实际可执行文件或 SDK 入口；企业 Web 版需要厂商提供连接协议，不能用 PowerShell 路径配对。`);
}
const environmentValue = (env, name) => env[name] || Object.entries(env).find(([key, value]) => key.toLowerCase() === name.toLowerCase() && value)?.[1] || '';
const environmentPaths = (env, platform) => Object.entries(env).filter(([name, value]) => (platform === 'win32' ? name.toLowerCase() === 'path' : name === 'PATH') && typeof value === 'string').flatMap(([, value]) => value.split(platform === 'win32' ? ';' : ':')).map(dir => dir.trim().replace(/^"|"$/g, '')).filter(Boolean);
export function toolBinaryCandidates(tool, { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const defaults = [paths.join(home, '.local', 'bin'), paths.join(home, '.opencode', 'bin'), paths.join(home, '.cargo', 'bin')];
  const appData = environmentValue(env, 'APPDATA');
  if (platform === 'win32' && appData) defaults.push(paths.join(appData, 'npm'));
  if (platform !== 'win32') defaults.push('/opt/homebrew/bin', '/usr/local/bin');
  const seen = new Set();
  const dirs = [...environmentPaths(env, platform), ...defaults].filter(dir => {
    const key = platform === 'win32' ? dir.toLowerCase() : dir;
    if (!paths.isAbsolute(dir) || seen.has(key)) return false;
    seen.add(key); return true;
  });
  return dirs.flatMap(dir => (TOOLS[tool] || []).flatMap(name => (platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']).map(extension => paths.join(dir, name + extension))));
}
const missingCLINote = tool => `未在 PATH 或标准安装目录找到 ${tool === 'dsh' ? 'DSH' : tool} CLI。可手动选择实际程序；${tool === 'dsh' ? '企业 Web GUI 可能独立托管，此结果不代表未安装。PowerShell 不是 DSH 入口。' : '此检测不涵盖独立桌面或 Web 版。'}`;


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
  const candidates = [...(options.nodePath ? [options.nodePath] : []), path.win32.join(folder, 'node.exe'),
    ...environmentPaths(env, 'win32').map(dir => path.win32.join(dir, 'node.exe')),
    ...(env.ProgramFiles ? [path.win32.join(env.ProgramFiles, 'nodejs', 'node.exe')] : []),
    ...(path.win32.basename(process.execPath).toLowerCase() === 'node.exe' ? [process.execPath] : []),
  ];
  for (const node of new Set(candidates)) if (await exists(node)) return { binary: node, prefix: [entry] };
  return null;
}
export async function resolveDshNpmCommand(binary, options = {}) {
  if (!/^dsh\.(cmd|bat)$/i.test(path.win32.basename(binary))) return null;
  const read = options.readFile || readFile, exists = options.isFile || isFile, env = options.env || process.env;
  const folder = path.win32.dirname(binary), entry = path.win32.join(folder, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  try {
    const wrapper = String(await read(binary, 'utf8')).replaceAll('/', '\\').toLowerCase();
    const pkg = JSON.parse(await read(path.win32.join(folder, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
    if (pkg.name !== '@deepseek-ai/dsh' || pkg.bin?.dsh !== 'lib/bin.js' || !wrapper.includes('\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js') || !await exists(entry)) return null;
  } catch { return null; }
  const candidates = [...(options.nodePath ? [options.nodePath] : []), path.win32.join(folder, 'node.exe'), ...environmentPaths(env, 'win32').map(dir => path.win32.join(dir, 'node.exe')), ...(env.ProgramFiles ? [path.win32.join(env.ProgramFiles, 'nodejs', 'node.exe')] : [])];
  for (const node of new Set(candidates)) if (await exists(node)) return { binary: node, prefix: [entry] };
  return null;
}
export async function resolveClaudeNpmCommand(binary, options = {}) {
  if (!/^claude\.(cmd|bat)$/i.test(path.win32.basename(binary))) return null;
  const read = options.readFile || readFile, exists = options.isFile || isFile, env = options.env || process.env;
  const folder = path.win32.dirname(binary), entry = path.win32.join(folder, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  try {
    const wrapper = String(await read(binary, 'utf8')).replaceAll('/', '\\').toLowerCase();
    const pkg = JSON.parse(await read(path.win32.join(folder, 'node_modules', '@anthropic-ai', 'claude-code', 'package.json'), 'utf8'));
    if (pkg.name !== '@anthropic-ai/claude-code' || !wrapper.includes('\\node_modules\\@anthropic-ai\\claude-code\\cli.js') || !await exists(entry)) return null;
  } catch { return null; }
  const candidates = [...(options.nodePath ? [options.nodePath] : []), path.win32.join(folder, 'node.exe'), ...environmentPaths(env, 'win32').map(dir => path.win32.join(dir, 'node.exe'))];
  for (const node of new Set(candidates)) if (await exists(node)) return { binary: node, prefix: [entry] };
  return null;
}
export async function commandInvocation(binary, args, platform = process.platform, options = {}) {
  requireAgentExecutable(binary);
  if (platform === 'win32' && isBatch(binary)) {
    const desktop = await resolveDshDesktopCommand(binary, args, options);
    if (desktop) return desktop;
    const native = await resolveCodexNpmCommand(binary, options) || await resolveDshNpmCommand(binary, options) || await resolveClaudeNpmCommand(binary, options);
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
  return exec(invocation.binary, invocation.args, { ...options, env: { ...process.env, ...options?.env, ...invocation.env } });
}
export async function findBinary(tool, options = {}) {
  const platform = options.platform || process.platform;
  for (const candidate of toolBinaryCandidates(tool, options)) {
    try {
      await access(candidate, platform === 'win32' ? 0 : 1);
      if (!(await stat(candidate)).isFile()) continue;
      requireAgentExecutable(await realpath(candidate));
      return candidate;
    } catch {}
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
  if ($settings.env) { foreach ($entry in $settings.env.PSObject.Properties) { $launch.EnvironmentVariables[$entry.Name] = [string]$entry.Value } }
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
  await writeFile(config, JSON.stringify({ binary: invocation.binary, arguments: invocation.args.map(windowsArgument).join(' '), cwd, batch: isBatch(invocation.binary), env: invocation.env ?? {} }), { encoding: 'utf8', mode: 0o600 });
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

export function sourceArguments(tool, cwd, sessionId) {
  if (tool === 'dsh') return ['web']; // SDK sessions have no verified GUI deep-link contract.
  if (!UUID.test(sessionId)) throw new Error('源端会话 ID 无效');
  if (tool === 'codex') return ['resume', sessionId, '-C', cwd];
  if (tool === 'claude') return ['--resume', sessionId];
  throw new Error('此工具尚未提供会话回源入口');
}
export async function openSourceTool(connection, sessionId) {
  const invocation = await runtimeInvocation(connection, sourceArguments(connection.tool, connection.projectPath, sessionId), commandInvocation);
  if (process.platform === 'win32') return launchWindowsTerminal(invocation, connection.projectPath);
  if (process.platform !== 'darwin') throw new Error('当前回源支持 macOS 和 Windows');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'quandeck-source-'));
  const script = path.join(folder, 'source.command');
  const env = Object.entries(invocation.env ?? {}).map(([key,value]) => `${key}=${shellQuote(value)}`);
  await writeFile(script, `#!/bin/sh\ncd ${shellQuote(connection.projectPath)} || exit 1\nexec env ${[...env, ...[invocation.binary,...invocation.args].map(shellQuote)].join(' ')}\n`, {mode:0o700});
  try { await exec('/usr/bin/open', ['-a','Terminal',script], {timeout:5000}); }
  catch (error) { await rm(folder,{recursive:true,force:true}); throw error; }
  const cleanup=setTimeout(()=>void rm(folder,{recursive:true,force:true}),300000); cleanup.unref();
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
    const native = await resolveCodexNpmCommand(binary, options) || await resolveDshNpmCommand(binary, options) || await resolveClaudeNpmCommand(binary, options);
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
  const openTerminal = deps.terminalOpen || ((binary, cwd, id, connection) => openSourceTool(connection ?? {tool:'codex',binary,projectPath:cwd}, id));
  const openTool = deps.openSourceTool || openSourceTool;
  const openDiscussion = deps.launchDiscussion || launchDiscussion;
  const resolveWindowsCodex = deps.resolveCodexNpmCommand || resolveCodexNpmCommand;
  const platform = deps.platform || process.platform;
  const connections = new Map((deps.connections || []).map(connection => [connection.connectionId, structuredClone(connection)]));
  const persistConnections = async () => deps.saveConnections?.([...connections.values()]);
  const runtime = createRuntimeDriver({ getConnection: id => connections.get(id), commandInvocation, spawnProcess: deps.spawnProcess, initialRuns: deps.initialRuns, saveRuns: deps.saveRuns, onPersistenceError: deps.onPersistenceError, systemSdk: deps.systemSdk, beforeStart: id => checkHealth({ connectionId: id }), fallbackConnections: id => { const policy = connections.get(id)?.fallbackPolicy; return policy?.mode === 'auto_before_start' ? policy.connectionIds : []; } });
  const probes = new Map(), activeProbes = new Map();
  async function configuredBinary(input) {
    // Reject misplaced terminal paths before filesystem/project operations or any process launch.
    requireAgentExecutable(input.binary);
    if (terminalExecutable(input.nodePath)) throw new Error('Node.js 路径不能填写 PowerShell 或其他终端，请选择 node.exe / node 可执行文件');
    if (input.nodePath && (!path.isAbsolute(input.nodePath) || !await isFile(input.nodePath))) throw new Error('Node 地址必须是可执行文件的绝对路径');
    if (input.nodePath && terminalExecutable(await realpath(input.nodePath))) throw new Error('Node.js 路径不能指向 PowerShell 或其他终端');
    if (!input.binary) {
      const binary = await locate(input.tool);
      requireAgentExecutable(binary);
      return binary;
    }
    if (typeof input.binary !== 'string' || !path.isAbsolute(input.binary) || /[\0\r\n]/.test(input.binary)) throw new Error('CLI 地址必须是可执行文件的绝对路径，不是命令字符串');
    await access(input.binary, /\.[cm]?js$/i.test(input.binary) || process.platform === 'win32' ? 0 : 1);
    if (!(await stat(input.binary)).isFile()) throw new Error('CLI 地址不是文件');
    requireAgentExecutable(await realpath(input.binary));
    return input.binary;
  }
  const identity = c => createHash('sha256').update(JSON.stringify([c.tool, c.binary, c.projectPath, c.nodePath || '', c.provider || '', c.model || '', c.sessionRoot || '', ...(c.agentId ? [c.agentId] : [])])).digest('hex').slice(0, 32);
  async function remember(connection) { const connectionId = identity(connection); connections.set(connectionId, { ...connections.get(connectionId), ...connection, connectionId }); await persistConnections(); return connectionId; }
  const healthChecks = new Map();
  async function checkHealth({ connectionId }) {
    if (healthChecks.has(connectionId)) return healthChecks.get(connectionId);
    const checking = (async () => {
      const connection = connections.get(connectionId);
      const checks = []; let issue, client, phase = 'installation';
      const check = (key, status, message) => { const at = checks.findIndex(check => check.key === key); const value = { key, status, message }; if (at === -1) checks.push(value); else checks[at] = value; };
      try {
        if (!connection) throw new Error('Agent 连接已失效，请重新配置');
        await configuredBinary(connection);
        check('installation', 'passed', 'Agent 程序可以访问');
        phase = 'project';
        await directory(connection.projectPath);
        check('project', 'passed', '项目目录可以访问');
        phase = 'protocol';
        if (!['dsh', 'codex', 'claude'].includes(connection.tool)) throw new Error('该工具的执行协议尚未接入');
        client = await initializeRuntime(connection, { commandInvocation, spawnProcess: deps.spawnProcess });
        check('protocol', 'passed', 'Agent 已响应连接检查');
        if (connection.tool === 'codex' || connection.tool === 'claude') {
          phase = 'login';
          const account = await client.call('account/read', { refreshToken: false });
          if (!account.account && account.requiresOpenaiAuth) {
            check('login', 'failed', '请先在 Agent 中重新登录');
            throw new Error('请先在 Agent 中登录');
          }
          check('login', account.account ? 'passed' : 'unknown', account.account ? '源端已确认账户信息' : '源端未提供可核验的登录状态');
        } else check('login', 'unknown', '该工具未提供单独的登录检查');
      } catch (error) {
        issue = classifyIncident(error);
        if (!checks.some(c => c.status === 'failed')) check(phase, 'failed', issue.message);
      } finally {
        if (client) { try { await client.close(connection.tool === 'dsh' ? 'shutdown' : undefined); } catch (error) { issue = classifyIncident(error, 'process'); check('protocol', 'failed', '检查用的 Agent 进程未能正常退出'); } }
      }
      for (const key of ['installation', 'project', 'protocol', 'login']) if (!checks.some(c => c.key === key)) check(key, 'unknown', '上一步未通过，暂未检查');
      check('model', 'unknown', '未发送模型请求，将在真实任务中验证');
      check('quota', 'unknown', '源端未提供可查询的剩余额度');
      const checkedAt = new Date().toISOString();
      const report = { connectionId, status: issue ? 'unavailable' : 'available', canStart: !issue, checkedAt, expiresAt: new Date(Date.now() + 30000).toISOString(), checks, ...(issue ? { issue } : {}) };
      if (connection) { connection.health = report; await persistConnections(); }
      return report;
    })();
    healthChecks.set(connectionId, checking);
    try { return await checking; } finally { healthChecks.delete(connectionId); }
  }
  async function setPolicy({ connectionId, mode, connectionIds }) {
    const connection = connections.get(connectionId);
    if (!connection) throw new Error('连接已失效，请重新配置');
    if (!['ask', 'auto_before_start'].includes(mode) || !Array.isArray(connectionIds) || connectionIds.length > 8 || connectionIds.some(id => typeof id !== 'string')) throw new Error('请选择有效的备用方式和 Agent');
    const unique = [...new Set(connectionIds)];
    for (const id of unique) {
      const target = connections.get(id);
      if (id === connectionId || !target || target.projectPath !== connection.projectPath || !['codex', 'claude', 'dsh'].includes(target.tool)) throw new Error('备用 Agent 必须已连接到同一个项目目录，并支持任务执行');
    }
    const policy = { mode, connectionIds: unique };
    const previous = connection.fallbackPolicy;
    connection.fallbackPolicy = policy;
    try { await persistConnections(); } catch (error) { connection.fallbackPolicy = previous; throw error; }
    return policy;
  }
  async function detect(tool) {
    const binary = await locate(tool);
    if (!binary) return { tool, installed: false, version: null, login: "unknown", adapter: "unavailable", note: missingCLINote(tool) };
    if (terminalExecutable(binary)) return { tool, installed: false, version: null, login: "unknown", adapter: "unavailable", note: "检测到的是执行终端，不是 Agent CLI；请指定实际 DSH / SDK 入口。" };
    let version = null;
    try {
      const result = await execute(binary, ["--version"], { timeout: 4000, maxBuffer: 32768 });
      version = /\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/.exec(result.stdout)?.[0] || null;
    } catch {}
    return { tool, installed: true, version, login: "unknown", binary, adapter: ["codex", "dsh", "claude"].includes(tool) ? "available" : "unavailable", note: ["codex", "dsh", "claude"].includes(tool) ? "测试连接后核对真实协议与运行能力" : "已检测安装；此版本的会话适配器待接入" };
  }
  return {
    runtime,
    health: checkHealth,
    policy: setPolicy,
    listConnections() { return { connections: [...connections.values()].map(c => ({ connectionId: c.connectionId, tool: c.tool, projectPath: c.projectPath, provider: c.provider, model: c.model, displayName: c.displayName, agentId: c.agentId, health: c.health, capabilities: { dispatch: ['dsh', 'codex', 'claude'].includes(c.tool) }, fallbackPolicy: c.fallbackPolicy || defaultFallbackPolicy() })) }; },
    exportConnections() { return [...connections.values()].map(connection => ({ ...connection })); },
    async tools() { return { tools: await Promise.all(Object.keys(TOOLS).map(detect)) }; },
    async test(input) {
      if (!TOOLS[input.tool]) throw new Error("不支持的工具");
      const binary = await configuredBinary(input);
      if (!binary) throw new Error(missingCLINote(input.tool));
      const projectPath = await directory(input.projectPath);
      const profile = { ...(typeof input.displayName === 'string' ? { displayName: input.displayName.trim().slice(0, 80) } : {}), ...(typeof input.agentId === 'string' ? { agentId: input.agentId.slice(0, 100) } : {}) };
      const result = { ...profile, tool: input.tool, projectPath, status: "unsupported", login: "unknown", capabilities: noCapabilities(), checkedAt: new Date().toISOString(), note: "已检测安装；此版本的协议适配器尚未启用" };
      if (input.tool === 'dsh') {
        const connection = { ...profile, tool: input.tool, binary, projectPath, nodePath: input.nodePath, provider: input.provider?.trim(), model: input.model?.trim(), sessionRoot: input.sessionRoot ? await directory(input.sessionRoot) : undefined, canResume: true };
        const version = await probeDshVersion(await runtimeInvocation(connection, ['--version'], commandInvocation), { cwd: projectPath, execute: deps.exec });
        if (version.blocked) return { ...result, binary, nodePath: input.nodePath, cliVersion: version.cliVersion, discussionOpen: false, note: version.note };
        const client = await initializeRuntime(connection, { commandInvocation, spawnProcess: deps.spawnProcess, execute: deps.exec });
        const legacy = client.protocol === 'legacy-rc2';
        connection.canResume = !legacy;
        connection.protocol = client.protocol;
        await client.close('shutdown');
        const connectionId = await remember(connection);
        return { ...result, connectionId, binary, nodePath: input.nodePath, cliVersion: version.cliVersion, protocol: client.protocol, provider: connection.provider, model: connection.model, sourceModel: client.sourceModel, status: 'ready', discussionOpen: false, capabilities: { observe: true, dispatch: true, resume: !legacy, usage: true, subAgents: true, sourceOpen: true, permissions: !legacy }, note: legacy ? 'DSH rc.2 SDK 握手通过，未发起模型请求。可委派新任务、同步公开输出与用量，并在本次运行中继续沟通。停止执行或退出 QuanDeck 后无法恢复旧会话；权限确认不支持从 QuanDeck 回传，未获授权的操作由 DSH 拒绝。现有 GUI 会话不会被接管。' : 'DeepSeek Harness SDK 握手通过，未发起模型请求；执行时沿用 DSH SDK 配置，在源执行窗口处理问题与权限。' };
      }
      if (input.tool === 'claude') {
        const connection = { ...profile, tool: input.tool, binary, projectPath, nodePath: input.nodePath, model: input.model?.trim(), canResume: true };
        const client = await initializeRuntime(connection, { commandInvocation });
        try { await client.call('account/read'); } finally { await client.close(); }
        const connectionId = await remember(connection);
        return { ...result, connectionId, binary, status: 'ready', discussionOpen: false, capabilities: { observe: true, dispatch: true, resume: true, usage: true, subAgents: true, sourceOpen: true, permissions: true }, note: 'Claude 官方 SDK 握手通过，沿用本机 CLI 的登录与权限。' };
      }
      if (input.tool !== "codex") {
        const connectionId = await remember({ ...profile, tool: input.tool, binary, projectPath, canResume: false });
        return { ...result, connectionId, discussionOpen: ["darwin", "win32"].includes(platform), note: "可在本机终端开始讨论；任务与结果自动同步待接入" };
      }
      let account;
      if (deps.rpc) account = await rpc(binary, projectPath, call => call('account/read', { refreshToken: false }));
      else {
        const client = await initializeRuntime({ tool: input.tool, binary, projectPath, nodePath: input.nodePath, model: input.model }, { commandInvocation, spawnProcess: deps.spawnProcess });
        try { account = await client.call('account/read', { refreshToken: false }); } finally { await client.close(); }
      }
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
      const connectionId = await remember({ ...profile, tool: input.tool, binary, projectPath, canResume, nodePath: input.nodePath, model: input.model });
      return { ...result, connectionId, discussionOpen: ["darwin", "win32"].includes(platform), status: "ready", binary, capabilities: { observe: true, dispatch: true, resume: true, sourceOpen: true, usage: true, subAgents: true, permissions: true }, note: "Codex App Server 已连接；任务会通过本地源执行会话启动并接收真实回执。" };
    },
    probe(input) {
      const connection=connections.get(input.connectionId);
      if (!connection || connection.tool!==input.tool) return Promise.reject(new Error('连接已失效，请重新配置 Agent'));
      if (typeof input.requestId!=='string' || !/^[\w-]{8,100}$/.test(input.requestId)) return Promise.reject(new Error('测试请求标识无效'));
      const previous=probes.get(input.requestId);
      if(previous) return previous.connectionId===input.connectionId ? previous.promise : Promise.reject(new Error('测试请求标识不可复用'));
      const current=activeProbes.get(input.connectionId);
      if(current) { probes.set(input.requestId,{connectionId:input.connectionId,promise:current}); return current; }
      const promise=(async()=>{
        try {
          const receipt=await runtime.assist({requestId:input.requestId,connectionId:input.connectionId,tool:connection.tool,projectId:'connection-test',kind:'connectivity',prompt:'hello. Reply with exactly {"reply":"hello"}. Do not call tools or perform any other work.',outputSchema:{type:'object',properties:{reply:{type:'string',const:'hello'}},required:['reply'],additionalProperties:false},maxTokens:256,timeoutMs:60000});
          if(receipt.output?.reply!=='hello' || Object.keys(receipt.output).length!==1) return {status:'failed',checkedAt:new Date().toISOString(),message:'未连通，请确认 Agent 能正常回复后重试'};
          return {status:'connected',checkedAt:new Date().toISOString(),message:'已连通'};
        } catch(error) {
          return {status:'failed',checkedAt:new Date().toISOString(),message:error?.code==='SYSTEM_TIMEOUT' ? '未连通，回复超时，请稍后重试' : error?.code==='SYSTEM_ADAPTER_UNSUPPORTED' ? '未连通，请检查 Agent 的 SDK 配置与版本' : '未连通，请确认 Agent 的登录和模型配置后重试'};
        } finally {activeProbes.delete(input.connectionId);}
      })();
      activeProbes.set(input.connectionId,promise); probes.set(input.requestId,{connectionId:input.connectionId,promise});
      if(probes.size>500) probes.delete(probes.keys().next().value);
      return promise;
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
      const requestedId = input.childSessionId || input.sessionId;
      const owned = runtime.listRuns().find(run => run.connectionId === input.connectionId && (run.sessionId === requestedId || run.events?.some(event => event.child?.sessionId === requestedId || event.targetSessionId === requestedId)));
      if (connection.tool === 'dsh') {
        // No invented URL or resume argument: rc.2 and current SDK expose no verified GUI session route.
        await openTool(connection);
        return {status:'opened',message:'已打开 DSH。此版本不能从 SDK 直接定位原会话，请在 DSH 中选择会话；Web 与 SDK 配置可能不同。'};
      }
      if (connection.tool === 'claude') {
        if (!UUID.test(requestedId)) throw new Error('源端会话 ID 无效');
        const known = owned || (await runtime.scan(input.connectionId)).sessions.some(session => session.sessionId === requestedId);
        if (!known) return {status:'unavailable',message:'未找到该项目的 Claude 会话，请在 Claude Code 中查看'};
        await openTool(connection, requestedId);
        return {status:'opened',targetSessionId:requestedId,message:'已打开对应 Claude Code 会话'};
      }
      if (connection.tool !== "codex" || !connection.canResume) return { status: "unavailable", message: "此工具尚未验证会话回源能力" };
      const target = input.childSessionId || input.sessionId;
      for (const id of [target, input.parentSessionId].filter(Boolean)) if (typeof id !== "string" || !UUID.test(id)) throw new Error("源端会话 ID 无效，无法打开示例或未索引的会话");
      let targetId = target; let parent = false;
      const read = (id) => rpc(connection.binary, connection.projectPath, (call) => call("thread/read", { threadId: id, includeTurns: false }));
      let metadata;
      try { metadata = owned ? {thread:{id:targetId,cwd:connection.projectPath}} : await read(targetId); }
      catch (error) {
        if (!input.parentSessionId || input.parentSessionId === targetId) throw error;
        targetId = input.parentSessionId; parent = true;
        metadata = await read(targetId);
      }
      if (metadata?.thread?.id !== targetId || !metadata.thread.cwd || await directory(metadata.thread.cwd) !== connection.projectPath) throw new Error("源会话不属于已验证的项目目录，请切换到对应项目连接");
      await openTerminal(connection.binary, connection.projectPath, targetId, connection);
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
      if (req.method === 'GET' && req.url === '/v1/connections') { json(200, service.listConnections()); return; }
      if (req.method === "GET" && req.url === "/v1/tools") { json(200, await service.tools()); return; }
      if (req.method === 'GET' && req.url === '/v1/runtime/runs') { json(200, { runs: service.runtime.listRuns() }); return; }
      if (req.method !== "POST") { json(404, { error: "接口不存在" }); return; }
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) { json(415, { error: "需要 JSON 请求" }); return; }
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 16384) { json(413, { error: "请求过大" }); return; } }
      let input; try { input = JSON.parse(body); } catch { json(400, { error: "JSON 无效" }); return; }
      if (!input || typeof input !== "object" || Array.isArray(input)) { json(400, { error: "请求格式无效" }); return; }
      if (req.url === "/v1/connections/test") json(200, await service.test(input));
      else if (req.url === "/v1/connections/health") json(200, await service.health(input));
      else if (req.url === "/v1/connections/policy") json(200, await service.policy(input));
      else if (req.url === "/v1/connections/probe") json(200, await service.probe(input));
      else if (req.url === "/v1/discussions/open") json(200, await service.discuss(input));
      else if (req.url === "/v1/source/open") json(200, await service.open(input));
      else if (req.url === "/v1/runtime/run") json(200, await service.runtime.run(input));
      else if (req.url === "/v1/runtime/control") json(200, await service.runtime.control(input.runId, input.action, input.payload));
      else if (req.url === "/v1/runtime/scan") json(200, await service.runtime.scan(input.connectionId));
      else if (req.url === "/v1/interactions/respond" && input.runId) json(200, await service.runtime.control(input.runId, 'reply', input));
      else if (req.url === "/v1/interactions/respond") json(501, { error: "需要源执行会话 runId，不能对未知权限请求代为审批。" });
      else json(404, { error: "接口不存在" });
    } catch (error) { json(400, { error: error instanceof Error ? redactDiagnostic(error) : "连接失败" }); }
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
