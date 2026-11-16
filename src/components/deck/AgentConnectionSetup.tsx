import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOOL_LABELS } from "../../integration/contracts";
import type { ConnectionInput, ConnectionTest, DshModelSource, ToolDetection, ToolId } from "../../integration/contracts";
import { gateway, getGatewaySettings, saveGatewaySettings, saveTestedConnection } from "../../integration/gateway";
import { AGENT_GUIDES } from "../../integration/agentGuides";
import type { GuideId, GuideOS } from "../../integration/agentGuides";
import { connectionCanSave, getConfiguredAgents, persistAgentConfiguration } from "../../integration/configuredAgents";
import { desktopHost } from "../../integration/desktop";
import { AgentSetupGuide, CopyCommand } from "./AgentSetupGuide";
import { DshWebSetup } from "./DshWebSetup";
import { ConnectionDiagnostic } from "./ConnectionDiagnostic";
import { DshModelReuse } from "./DshModelReuse";
import { diagnoseConnection, type ConnectionDiagnosis, type ConnectionStage } from "../../integration/connectionDiagnostics";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import "../../integration/connection.css";



export function AgentConnectionSetup({ onClose }: { onClose: () => void }) {
  const { api, snap } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState(getGatewaySettings);
  const [tools, setTools] = useState<ToolDetection[]>([]);
  const [guideId, setGuideId] = useState<GuideId>("codex");
  const [os, setOS] = useState<GuideOS>(() => (desktopHost()?.platform ?? navigator.platform).toLowerCase().startsWith("win") ? "windows" : "mac");
  const [dshMode, setDshMode] = useState<"cli" | "web">("cli");
  const [tab, setTab] = useState<"guide" | "connect">("guide");
  const [projectPath, setProjectPath] = useState(() => getConfiguredAgents().find((entry) => entry.tool === "codex")?.projectPath ?? "");
  const [binary, setBinary] = useState(() => getConfiguredAgents().find((entry) => entry.tool === "codex")?.binary ?? "");
  const [nodePath, setNodePath] = useState("");
  const [modelScope, setModelScope] = useState(0);
  const [dshModelSource, setDshModelSource] = useState<DshModelSource | undefined>();
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const [pending, setPending] = useState<"detect" | "test" | "host" | "save" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [testStage, setTestStage] = useState<ConnectionStage | "done" | null>(null);
  const [diagnosis, setDiagnosis] = useState<ConnectionDiagnosis | null>(null);
  const [testVersion, setTestVersion] = useState<string | null>(null);
  const generation = useRef(0);
  const activeTest = useRef<number | null>(null);
  const guide = AGENT_GUIDES.find((entry) => entry.id === guideId)!;
  const supportedTool = guideId in TOOL_LABELS;
  const selected = tools.find((item) => item.tool === guideId);
  const host = desktopHost();

  const detect = async (nextSettings = settings) => {
    const current = ++generation.current;
    setPending("detect"); setError(""); setResult(null); setTools([]); setTestStage(null); setDiagnosis(null); setTestVersion(null);
    try {
      saveGatewaySettings(nextSettings);
      const response = await gateway.detectTools();
      if (current === generation.current) setTools(response.tools);
    } catch (e) { if (current === generation.current) setDiagnosis(diagnoseConnection("host", e, guideId as ToolId)); }
    finally { if (current === generation.current) setPending(null); }
  };
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    let active = true;
    if (host) {
      setPending("host");
      host.getConnection().then((connection) => {
        if (!active) return;
        setSettings(connection);
        void detect(connection);
      }).catch((e) => { if (active) { setDiagnosis(diagnoseConnection("host", e, guideId as ToolId)); setPending(null); } });
    }
    return () => { active = false; generation.current++; dialog.current?.close(); trigger?.focus(); };
  }, []);
  const invalidate = () => { generation.current++; setModelScope(value => value + 1); activeTest.current = null; setDshModelSource(undefined); setPending(null); setResult(null); setSaved(false); setError(""); setTestStage(null); setDiagnosis(null); setTestVersion(null); };
  const test = async (sourceOverride?: DshModelSource): Promise<boolean> => {
    if (!supportedTool || pending || activeTest.current !== null) return false;
    const current = ++generation.current; activeTest.current = current;
    let stage: ConnectionStage = "handshake";
    setPending("test"); setError(""); setResult(null); setSaved(false); setDiagnosis(null); setTestStage(stage); setTestVersion(null);
    try {
      saveGatewaySettings(settings);
      const input: ConnectionInput = { tool: guideId as ToolId, projectPath: projectPath.trim(), ...(binary.trim() ? { binary:binary.trim() } : {}), ...(nodePath.trim() ? { nodePath:nodePath.trim() } : {}), ...(guideId === "dsh" && (sourceOverride ?? dshModelSource) ? { dshModelSource:sourceOverride ?? dshModelSource } : {}) };
      const response = { ...input, ...await gateway.testConnection(input) };
      if (current !== generation.current) return false;
      setTestVersion(response.cliVersion ?? null);
      if (response.status === "ready" && !response.connectionId) throw new Error("SDK 未返回连接标识");
      if (response.status === "ready" && response.connectionId) {
        stage = "reply"; setTestStage(stage);
        const probe = await gateway.probeConnection({ connectionId: response.connectionId, tool:response.tool, requestId:crypto.randomUUID() });
        if (probe.status !== "connected") throw new Error(probe.message);
      } else if (!response.discussionOpen) {
        throw new Error(response.status === "needs_login" ? "needs_login" : response.note || "unsupported");
      }
      if (current === generation.current) {
        // The host resolves symlinks and Windows path casing. Save the exact directory it verified.
        setProjectPath(response.projectPath);
        if (response.binary) setBinary(response.binary);
        if (response.tool === "dsh") setDshModelSource(response.dshModelSource);
        setResult(response);
        setTestStage(response.status === "ready" ? "done" : null);
        if (connectionCanSave(response)) saveTestedConnection(response);
        return connectionCanSave(response);
      }
      return false;
    } catch (e) { if (current === generation.current) { const detail = diagnoseConnection(stage, e, guideId as ToolId); setDiagnosis(detail); setTestStage(detail.stage); } return false; }
    finally { if (activeTest.current === current) activeTest.current = null; if (current === generation.current) setPending(null); }
  };
  const save = async () => {
    if (!connectionCanSave(result)) return;
    if (result.capabilities.dispatch && !snap.project.id) { setError("请先创建一个项目，再为该项目保存 Agent 连接。"); return; }
    setPending("save"); setError("");
    try {
      await persistAgentConfiguration(api, { tool: guideId as ToolId, projectPath, binary:binary.trim() || undefined, nodePath:nodePath.trim() || undefined, ...(guideId === "dsh" && dshModelSource ? {dshModelSource} : {}) }, result);
      setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : "无法保存配置，请检查本地存储空间后重试。"); }
    finally { setPending(null); }
  };
  const selectTool = (id: GuideId) => {
    invalidate(); setGuideId(id); setTab("guide");
    const previous = getConfiguredAgents().find((entry) => entry.tool === id);
    setProjectPath(previous?.projectPath ?? ""); setBinary(previous?.binary ?? ""); setNodePath(previous?.nodePath ?? ""); setDshModelSource(id === "dsh" ? previous?.dshModelSource : undefined);
  };
  const absolutePath = os === "windows" ? /^[a-zA-Z]:[\\/]|^\\\\/.test(projectPath.trim()) : projectPath.trim().startsWith("/");
  const webDsh = guideId === "dsh" && dshMode === "web";
  const isShell = (value: string) => /(?:^|[\\/])(?:powershell|powershell_ise|pwsh|cmd|bash|zsh|sh|dash|fish|wt|conhost|wscript|cscript)(?:\.(?:exe|com))?$/i.test(value.trim());
  const shellEntry = isShell(binary);
  const nodeShell = isShell(nodePath);
  const javascriptEntry = /\.[cm]?js$/i.test(binary.trim());
  const pickExecutable = async (node = false) => { try { const chosen = await host?.chooseExecutable(); if (chosen) { invalidate(); node ? setNodePath(chosen) : setBinary(chosen); } } catch { setError("无法打开文件选择器，请手动填写文件的完整路径。"); } };
  const canTest = !shellEntry && !nodeShell && absolutePath && !!settings.token.trim();

  return createPortal(<dialog ref={dialog} className="qd-connection-dialog" aria-labelledby="qd-connect-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <header><div><h2 id="qd-connect-title">配置本地 Agent</h2><p>安装工具、连接项目，再确认可用能力。</p></div><button type="button" className="qd-icon-btn" aria-label="关闭连接设置" onClick={onClose}><Icon name="close" size={18} /></button></header>
    <div className="qd-setup-layout">
      <nav className="qd-tool-list" aria-label="选择 Agent">{AGENT_GUIDES.map((entry) => <button key={entry.id} type="button" className={guideId === entry.id ? "is-selected" : ""} aria-current={guideId === entry.id ? "true" : undefined} disabled={pending === "save"} onClick={() => selectTool(entry.id)}><span>{entry.name}</span>{entry.id === "workbuddy" && <small>手动协作</small>}</button>)}</nav>
      <div className="qd-setup-main">
        <div className="qd-setup-heading"><div><h3>{guide.name}</h3><p>{webDsh ? "先确认企业版本的接入协议" : guide.description}</p></div><div className="qd-os-toggle" role="group" aria-label="教程操作系统"><button type="button" aria-pressed={os === "mac"} onClick={() => setOS("mac")}>macOS</button><button type="button" aria-pressed={os === "windows"} onClick={() => setOS("windows")}>Windows</button></div></div>
        {guideId === "dsh" && <div className="qd-dsh-mode" role="group" aria-label="DSH 接入方式"><button type="button" aria-pressed={dshMode === "cli"} disabled={!!pending} onClick={() => { invalidate(); setDshMode("cli"); }}>CLI / SDK</button><button type="button" aria-pressed={dshMode === "web"} disabled={!!pending} onClick={() => { invalidate(); setDshMode("web"); }}>企业 Web 版</button></div>}
        {!webDsh && <div className="qd-setup-tabs" role="tablist" aria-label="配置步骤"><button type="button" role="tab" aria-selected={tab === "guide"} onClick={() => setTab("guide")}>安装与登录</button><button type="button" role="tab" aria-selected={tab === "connect"} onClick={() => setTab("connect")}>连接项目</button></div>}
        {webDsh ? <DshWebSetup onUseCLI={() => { invalidate(); setDshMode("cli"); setTab("connect"); }} /> : tab === "guide" ? <div role="tabpanel" aria-label="安装与登录"><AgentSetupGuide guide={guide} os={os} /><button type="button" className="qd-btn primary qd-setup-next" onClick={() => setTab("connect")}>已完成安装，连接项目 <Icon name="arrow-right" size={14} /></button></div> : <div className="qd-connection-body" role="tabpanel" aria-label="连接项目">
          {!supportedTool ? <section><h3>在源工具中协作</h3><p className="qd-connection-note">{guide.connection}</p><p className="qd-connection-note">可将讨论结论记录到任务方案，并保留来源链接。</p></section> : <>
            <section><h3>连接这台电脑</h3>{host ? <p className="qd-connection-note">桌面版自动启动本地服务，配对信息由应用管理。</p> : <><details className="qd-connection-help"><summary>网页版如何启动本地服务？</summary><p>在 QuanDeck 源码目录打开终端，运行下面的命令并保持窗口开启。将终端显示的配对码填入此处。</p><CopyCommand command="pnpm bridge" /></details><label>服务地址<input value={settings.baseUrl} onChange={(e) => { invalidate(); setTools([]); setSettings({ ...settings, baseUrl: e.target.value }); }} placeholder="http://127.0.0.1:4175" /></label><label>配对码<input type="password" autoComplete="off" spellCheck={false} value={settings.token} onChange={(e) => { invalidate(); setTools([]); setSettings({ ...settings, token: e.target.value }); }} placeholder="粘贴本次启动的配对码" /></label></>}
              <button type="button" className="qd-btn" onClick={() => void detect()} disabled={!!pending || !settings.token.trim()}>{pending === "detect" || pending === "host" ? "正在检测…" : "检测本机工具"}</button>
              {selected && <p className="qd-detection-status" role="status"><Icon name={selected.installed ? "check-circle" : "alert"} size={15} />{selected.installed ? `${guide.name} 已安装${selected.version ? ` · ${selected.version}` : ""}` : `未识别到可用的 ${guide.name} CLI`}</p>}
              {selected && !selected.installed && <p className="qd-connection-note">{selected.note} {guideId === "dsh" && <>如果使用企业 Web 界面，请选择上方“企业 Web 版”。</>}</p>}
            </section>
            <section><h3>CLI 程序</h3><label>CLI 路径 <span className="qd-field-optional">可选 · 留空自动检测</span><div className="qd-project-picker"><input value={binary} disabled={!!pending} onChange={e => { invalidate(); setBinary(e.target.value); }} placeholder={selected?.binary ?? (os === "windows" ? "C:\\路径\\dsh.cmd 或 lib\\bin.js" : "/opt/homebrew/bin/dsh 或 lib/bin.js")} spellCheck={false} />{host && <button type="button" className="qd-btn" disabled={!!pending} onClick={() => void pickExecutable()}>选择程序</button>}</div></label><p className="qd-connection-note">填写可执行文件或 JavaScript 入口的完整路径，不是命令。自动检测失败时，也可以手动选择已安装的程序。{guideId === "dsh" && " 选择 dsh.cmd 或实际 CLI 入口；Desktop 版会使用它自带的运行环境，不需要填写 Node。"}</p>{shellEntry && <p className="qd-connection-error" role="alert">这是命令执行终端，不是 Agent 程序。请选择工具本身的 CLI 入口；企业 DSH 请查看“企业 Web 版”。</p>}
              <details className="qd-node-settings" open={javascriptEntry || !!nodePath}><summary>Node.js 路径</summary><label>Node 可执行文件<div className="qd-project-picker"><input value={nodePath} disabled={!!pending} onChange={e => { invalidate(); setNodePath(e.target.value); }} placeholder={os === "windows" ? "C:\\Program Files\\nodejs\\node.exe" : "/opt/homebrew/bin/node"} spellCheck={false}/>{host && <button type="button" className="qd-btn" disabled={!!pending} onClick={() => void pickExecutable(true)}>选择 Node</button>}</div></label><p className="qd-connection-note">CLI 使用 .js / .mjs 入口时可指定 Node；留空使用系统 Node。</p>{nodeShell && <p className="qd-connection-error" role="alert">这里需要 Node.js 程序路径，不是 PowerShell 或其他终端。</p>}</details>
            </section>
            <section><h3>选择项目目录</h3><label>本地项目路径<div className="qd-project-picker"><input value={projectPath} disabled={!!pending} onChange={(e) => { invalidate(); setProjectPath(e.target.value); }} placeholder={os === "windows" ? "C:\\Users\\你的用户名\\Projects\\my-app" : "/Users/你的用户名/Projects/my-app"} spellCheck={false} />{host && <button type="button" className="qd-btn" onClick={async () => { try { const directory = await host.chooseDirectory(); if (directory) { invalidate(); setProjectPath(directory); } } catch { setError("无法打开目录选择器，请手动填写路径。"); } }}>选择文件夹</button>}</div></label><p className="qd-connection-note">选择希望 Agent 处理的文件夹。讨论和回源会使用该目录。</p>
              {guideId === "dsh" && <><p className="qd-connection-note">模型与账号由 DSH 管理，QuanDeck 使用 sdk 配置。仅在桌面或网页中选择模型，不保证 sdk 使用同一模型。</p>{os === "windows" && <details className="qd-connection-help"><summary>Windows：先确认 DSH 命令入口</summary><p>已有 DSH / xLink Desktop 时，在源工具选择 Manage dsh Command… → Install / Repair，再新开 PowerShell 执行：</p><CopyCommand command="where.exe dsh" /><CopyCommand command="dsh --version" /><p>选择输出中属于该 Desktop 安装目录的 dsh.cmd，Node.js 路径留空。若有多个入口，用 Get-Command 查看实际优先使用的命令：</p><CopyCommand command="Get-Command dsh -All | Select-Object CommandType, Source" /><p>不需要填写 DSH 网页地址、Provider、Model ID 或 API Key。</p></details>}</>}
              <button type="button" className="qd-btn primary" onClick={() => void test()} disabled={!!pending || !canTest}>{pending === "test" ? "正在测试连接…" : "测试连接"}</button>
              {guideId === "dsh" && <DshModelReuse key={modelScope} input={{ tool:"dsh", projectPath:projectPath.trim(), binary:binary.trim() || undefined, nodePath:nodePath.trim() || undefined, dshModelSource }} disabled={!!pending || !canTest} prepare={async () => { saveGatewaySettings(settings); }} onUse={source => test(source)}/>}

            </section>
            <ConnectionDiagnostic key={`${guideId}:${generation.current}`} stage={testStage} diagnosis={diagnosis} tool={guideId as ToolId} version={testVersion} busy={pending === "test"} />
            {result && <section className="qd-connection-result" aria-live="polite"><h3>{result.status === "ready" ? "已连通" : "未连通"}</h3>{result.status !== "ready" && <p>{result.status === "needs_login" ? "请先在 Agent 中登录后重试。" : result.discussionOpen ? "此工具可手动打开，暂不支持自动检测。" : "请检查 Agent 的 SDK 配置与版本。"}</p>}</section>}
          </>}
          {error && <p className="qd-connection-error" role="alert">{error}</p>}
          {saved && <p className="qd-config-saved" role="status">配置已保存，可从任务选择 {guide.name}。</p>}
        </div>}
      </div>
    </div>
    <footer><small>{host ? "本地配置保存在这台设备。" : "项目配置保留在本机，配对码仅保留在当前标签页。"}</small><div><button type="button" className="qd-btn ghost" onClick={onClose}>关闭</button>{tab === "connect" && supportedTool && !webDsh && <button type="button" className="qd-btn primary" disabled={!connectionCanSave(result) || !!pending || saved} onClick={save}>{pending === "save" ? "正在保存…" : saved ? "已保存" : "保存配置"}</button>}</div></footer>
  </dialog>, document.body);
}
