import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { codexConnectionLabel } from "../../integration/contracts";
import type { Capability, ConnectionInput, ConnectionProbe, ConnectionTest, DshModelSource, ToolDetection, ToolId } from "../../integration/contracts";
import { gateway, getGatewaySettings, saveGatewaySettings, saveTestedConnection } from "../../integration/gateway";
import { AGENT_GUIDES } from "../../integration/agentGuides";
import type { GuideId, GuideOS } from "../../integration/agentGuides";
import { connectionCanSave, getConfiguredAgents, persistAgentConfiguration } from "../../integration/configuredAgents";
import type { ConfiguredAgent } from "../../integration/configuredAgents";
import { ConnectionProfileFields, DshDesktopHelp } from "./ConnectionProfileFields";
import { ConnectionHealthPanel } from "./ConnectionHealthPanel";
import { desktopHost } from "../../integration/desktop";
import { AgentSetupGuide, CopyCommand } from "./AgentSetupGuide";
import { DshWebSetup } from "./DshWebSetup";
import { ConnectionDiagnostic } from "./ConnectionDiagnostic";
import { DshModelReuse } from "./DshModelReuse";
import { diagnoseConnection, type ConnectionDiagnosis, type ConnectionStage } from "../../integration/connectionDiagnostics";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import "../../integration/connection.css";


const CAPABILITIES: [Capability, string][] = [["sourceOpen", "回源会话"], ["resume", "恢复会话"], ["observe", "执行同步"], ["dispatch", "自动派发"], ["usage", "Token 用量"], ["subAgents", "子 Agent"], ["permissions", "权限回执"]];

export function AgentConnectionSetup({ onClose, initialConfig, initialCustom = false, initialAgent, initialTool }: { onClose: () => void; initialConfig?: ConfiguredAgent; initialCustom?: boolean; initialAgent?: { id: string; name: string }; initialTool?: ToolId }) {
  const { api, snap, toast } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState(getGatewaySettings);
  const [tools, setTools] = useState<ToolDetection[]>([]);
  const [guideId, setGuideId] = useState<GuideId>(initialConfig?.tool ?? initialTool ?? "codex");
  const [custom, setCustom] = useState(initialCustom || !!initialConfig?.agentId);
  const [displayName, setDisplayName] = useState(initialConfig?.displayName ?? initialAgent?.name ?? "");
  const [profileAgentId, setProfileAgentId] = useState<string | undefined>(() => initialConfig?.agentId ?? initialAgent?.id ?? (initialCustom ? `custom-${crypto.randomUUID()}` : undefined));
  const [os, setOS] = useState<GuideOS>(() => (desktopHost()?.platform ?? navigator.platform).toLowerCase().startsWith("win") ? "windows" : "mac");
  const [dshMode, setDshMode] = useState<"cli" | "web">("cli");
  const [tab, setTab] = useState<"guide" | "connect">(initialConfig || initialCustom || initialAgent || initialTool ? "connect" : "guide");
  const [projectPath, setProjectPath] = useState(() => initialConfig?.projectPath ?? getConfiguredAgents().find((entry) => entry.tool === (initialTool ?? "codex") && !entry.agentId)?.projectPath ?? "");
  const [binary, setBinary] = useState(() => initialConfig?.binary ?? getConfiguredAgents().find((entry) => entry.tool === "codex" && !entry.agentId)?.binary ?? "");
  const [nodePath, setNodePath] = useState(initialConfig?.nodePath ?? "");
  const [model, setModel] = useState(initialConfig?.model ?? "");
  const [modelNote, setModelNote] = useState("");
  const [modelScope, setModelScope] = useState(0);
  const [dshModelSource, setDshModelSource] = useState<DshModelSource | undefined>(initialConfig?.dshModelSource);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const [pending, setPending] = useState<"detect" | "test" | "probe" | "host" | "save" | null>(null);
  const [error, setError] = useState("");
  const [testStage, setTestStage] = useState<ConnectionStage | "done" | null>(null);
  const [diagnosis, setDiagnosis] = useState<ConnectionDiagnosis | null>(null);
  const [testVersion, setTestVersion] = useState<string | null>(null);
  const generation = useRef(0);
  const activeTest = useRef<number | null>(null);
  const guide = AGENT_GUIDES.find((entry) => entry.id === guideId)!;
  const workBuddy = guideId === "workbuddy";
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
      Promise.all([host.getConnection(), host.agentSetupDirectory?.()]).then(([connection, setupDirectory]) => {
        if (!active) return;
        setSettings(connection);
        if (setupDirectory) setProjectPath(setupDirectory);
        void detect(connection);
      }).catch((e) => { if (active) { setDiagnosis(diagnoseConnection("host", e, guideId as ToolId)); setPending(null); } });
    }
    return () => { active = false; generation.current++; dialog.current?.close(); trigger?.focus(); };
  }, []);
  const invalidate = () => { generation.current++; setModelScope(value => value + 1); activeTest.current = null; setDshModelSource(undefined); setPending(null); setResult(null); setError(""); setTestStage(null); setDiagnosis(null); setTestVersion(null); setModelNote(""); };
  const test = async (sourceOverride?: DshModelSource): Promise<boolean> => {
    if (pending || activeTest.current !== null) return false;
    const current = ++generation.current; activeTest.current = current;
    let stage: ConnectionStage = "handshake";
    setPending("test"); setError(""); setResult(null); setDiagnosis(null); setTestStage(stage); setTestVersion(null);
    try {
      saveGatewaySettings(settings);
      const input: ConnectionInput = { tool: guideId as ToolId, ...(custom ? { displayName: displayName.trim(), agentId: profileAgentId } : {}), ...(guideId === "codex" && model.trim() ? { model: model.trim() } : {}), projectPath: projectPath.trim(), ...(!workBuddy && binary.trim() ? { binary:binary.trim() } : {}), ...(!workBuddy && nodePath.trim() ? { nodePath:nodePath.trim() } : {}), ...(guideId === "dsh" && (sourceOverride ?? dshModelSource) ? { dshModelSource:sourceOverride ?? dshModelSource } : {}) };
      const response = { ...input, ...await gateway.testConnection(input) };
      if (current !== generation.current) return false;
      setTestVersion(response.desktopVersion ?? response.cliVersion ?? null);
      if (response.status === "ready" && !response.connectionId) throw new Error("SDK 未返回连接标识");
      if (response.status === "ready" && response.connectionId && response.tool === "dsh") {
        stage = "reply"; setTestStage(stage);
        const probe = await gateway.probeConnection({ connectionId: response.connectionId, tool:response.tool, requestId:crypto.randomUUID() });
        if (probe.status !== "connected") throw new Error(probe.message);
      } else if (response.status !== "ready" && !response.discussionOpen) {
        throw new Error(response.status === "needs_login" ? "needs_login" : response.note || "unsupported");
      }
      if (current === generation.current) {
        // The host resolves symlinks and Windows path casing. Save the exact directory it verified.
        setProjectPath(response.projectPath);
        if (response.binary) setBinary(response.binary);
        if (response.tool === "dsh") setDshModelSource(response.dshModelSource);
        setResult(connectionCanSave(response) ? saveTestedConnection(response) : response);
        setTestStage(response.status === "ready" && response.tool === "dsh" ? "done" : null);
        return connectionCanSave(response);
      }
      return false;
    } catch (e) { if (current === generation.current) { const detail = diagnoseConnection(stage, e, guideId as ToolId); setDiagnosis(detail); setTestStage(detail.stage); } return false; }
    finally { if (activeTest.current === current) activeTest.current = null; if (current === generation.current) setPending(null); }
  };
  const probeModel = async () => {
    if (!result?.connectionId || result.tool === "hermes" || pending) return;
    const current = ++generation.current;
    setPending("probe"); setModelNote("");
    const finish = (probe: ConnectionProbe) => {
      if (current !== generation.current) return;
      setModelNote(probe.status === "connected" ? "模型已回复测试消息。" : probe.message);
      if (result.tool === "codex") setResult(saveTestedConnection({ ...result, modelProbe: probe }));
    };
    try {
      const probe = await gateway.probeConnection({ connectionId: result.connectionId, tool: result.tool, requestId: crypto.randomUUID() });
      finish(probe);
    } catch {
      finish({ status: "failed", checkedAt: new Date().toISOString(), message: "未收到试发结果，请检查本机服务后重试。" });
    } finally {
      if (current === generation.current) setPending(null);
    }
  };
  const save = async () => {
    if (pending || !connectionCanSave(result)) return;
    const current = ++generation.current;
    setPending("save");
    setError("");
    try {
      await persistAgentConfiguration(api, { tool: guideId as ToolId, ...(custom ? { displayName: displayName.trim(), agentId: profileAgentId } : {}), projectPath, binary:workBuddy ? undefined : binary.trim() || undefined, nodePath:workBuddy ? undefined : nodePath.trim() || undefined, dshModelSource: guideId === "dsh" ? dshModelSource : undefined, model: guideId === "codex" ? model.trim() || undefined : undefined }, result, {applicationDefault:true});
      toast(`${custom ? displayName.trim() : guide.name} 应用配置已保存，所有项目的下一次新执行或讨论都会使用`);
      if (current === generation.current) onClose();
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : "无法保存配置，请检查本地存储空间后重试。");
    } finally {
      if (current === generation.current) setPending(null);
    }
  };
  const selectTool = (id: GuideId) => {
    invalidate(); setGuideId(id); setCustom(false); setDisplayName(""); setProfileAgentId(undefined); setTab("guide");
    const previous = getConfiguredAgents().find((entry) => entry.tool === id && !entry.agentId);
    if (!host) setProjectPath(previous?.projectPath ?? ""); setBinary(previous?.binary ?? ""); setNodePath(previous?.nodePath ?? ""); setModel(previous?.model ?? ""); setDshModelSource(id === "dsh" ? previous?.dshModelSource : undefined);
  };
  const platformIsWindows = workBuddy && host ? host.platform === "win32" : os === "windows";
  const absolutePath = platformIsWindows ? /^[a-zA-Z]:[\\/]|^\\\\/.test(projectPath.trim()) : projectPath.trim().startsWith("/");
  const webDsh = guideId === "dsh" && dshMode === "web";
  const isShell = (value: string) => /(?:^|[\\/])(?:powershell|powershell_ise|pwsh|cmd|bash|zsh|sh|dash|fish|wt|conhost|wscript|cscript)(?:\.(?:exe|com))?$/i.test(value.trim());
  const shellEntry = isShell(binary);
  const nodeShell = isShell(nodePath);
  const javascriptEntry = /\.[cm]?js$/i.test(binary.trim());
  const pickExecutable = async (node = false) => { try { const chosen = await host?.chooseExecutable(); if (chosen) { invalidate(); node ? setNodePath(chosen) : setBinary(chosen); } } catch { setError("无法打开文件选择器，请手动填写文件的完整路径。"); } };
  const binaryAbsolute = os === "windows" ? /^[a-zA-Z]:[\\/]|^\\\\/.test(binary.trim()) : binary.trim().startsWith("/");
  const canTest = (workBuddy || (!custom || !!displayName.trim() && binaryAbsolute) && !shellEntry && !nodeShell) && absolutePath && !!settings.token.trim();

  return createPortal(<dialog ref={dialog} className="qd-connection-dialog" aria-labelledby="qd-connect-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <header><div><h2 id="qd-connect-title">配置应用 Agent</h2><p>本机配置一次，所有项目共用。修改后对新执行与新讨论生效，进行中的会话保留原连接。</p></div><button type="button" className="qd-icon-btn" aria-label="关闭连接设置" onClick={onClose}><Icon name="close" size={18} /></button></header>
    <div className="qd-setup-layout">
      <nav className="qd-tool-list" aria-label="选择 Agent">{AGENT_GUIDES.map((entry) => <button key={entry.id} type="button" className={!custom && guideId === entry.id ? "is-selected" : ""} aria-current={!custom && guideId === entry.id ? "true" : undefined} disabled={pending === "save"} onClick={() => selectTool(entry.id)}><span>{entry.name}</span>{entry.id === "workbuddy" && <small>打开讨论</small>}</button>)}<button type="button" className={`qd-custom-connect-entry ${custom ? "is-selected" : ""}`} aria-current={custom ? "true" : undefined} disabled={!!pending} onClick={() => { invalidate(); setCustom(true); setProfileAgentId(`custom-${crypto.randomUUID()}`); setDisplayName(""); setGuideId("dsh"); setDshMode("cli"); setTab("connect"); setBinary(""); setModel(""); }}><span><Icon name="plus" size={14} /> 自定义连接</span><small>兼容工具 · 企业版本</small></button></nav>
      <div className="qd-setup-main">
        <div className="qd-setup-heading"><div><h3>{custom ? "自定义连接" : guide.name}</h3><p>{custom ? "给兼容工具单独命名，验证后使用。" : webDsh ? "先确认企业版本的接入协议" : guide.description}</p></div><div className="qd-os-toggle" role="group" aria-label="教程操作系统"><button type="button" aria-pressed={os === "mac"} onClick={() => setOS("mac")}>macOS</button><button type="button" aria-pressed={os === "windows"} onClick={() => setOS("windows")}>Windows</button></div></div>
        {guideId === "dsh" && !custom && <div className="qd-dsh-mode" role="group" aria-label="DSH 接入方式"><button type="button" aria-pressed={dshMode === "cli"} disabled={!!pending} onClick={() => { invalidate(); setDshMode("cli"); }}>桌面版 / 命令行</button><button type="button" aria-pressed={dshMode === "web"} disabled={!!pending} onClick={() => { invalidate(); setDshMode("web"); }}>企业 Web 版</button></div>}
        {!webDsh && !custom && <div className="qd-setup-tabs" role="tablist" aria-label="配置步骤"><button type="button" role="tab" aria-selected={tab === "guide"} onClick={() => setTab("guide")}>安装与登录</button><button type="button" role="tab" aria-selected={tab === "connect"} onClick={() => setTab("connect")}>连接 Agent</button></div>}
        {webDsh ? <DshWebSetup onUseCLI={() => { invalidate(); setDshMode("cli"); setTab("connect"); }} /> : tab === "guide" ? <div role="tabpanel" aria-label="安装与登录"><AgentSetupGuide guide={guide} os={os} /><button type="button" className="qd-btn primary qd-setup-next" onClick={() => setTab("connect")}>已完成安装，连接 Agent <Icon name="arrow-right" size={14} /></button></div> : <div className="qd-connection-body" role="tabpanel" aria-label="连接 Agent">
          {custom && <ConnectionProfileFields name={displayName} onName={value => { invalidate(); setDisplayName(value); }} tool={guideId as ToolId} onTool={value => { invalidate(); setGuideId(value); setBinary(""); setModel(""); }} disabled={!!pending} />}

            <section><h3>连接这台电脑</h3>{host ? <p className="qd-connection-note">桌面版自动启动本地服务，配对信息由应用管理。</p> : <><details className="qd-connection-help"><summary>网页版如何启动本地服务？</summary><p>在 QuanDeck 源码目录打开终端，运行下面的命令并保持窗口开启。将终端显示的配对码填入此处。</p><CopyCommand command="pnpm bridge" /></details><label>服务地址<input value={settings.baseUrl} onChange={(e) => { invalidate(); setTools([]); setSettings({ ...settings, baseUrl: e.target.value }); }} placeholder="http://127.0.0.1:4175" /></label><label>配对码<input type="password" autoComplete="off" spellCheck={false} value={settings.token} onChange={(e) => { invalidate(); setTools([]); setSettings({ ...settings, token: e.target.value }); }} placeholder="粘贴本次启动的配对码" /></label></>}
              <button type="button" className="qd-btn" onClick={() => void detect()} disabled={!!pending || !settings.token.trim()}>{pending === "detect" || pending === "host" ? "正在检测…" : "检测本机工具"}</button>
              {selected && <p className="qd-detection-status" role="status"><Icon name={selected.installed ? "check-circle" : "alert"} size={15} />{selected.installed ? `${guide.name} 已安装${selected.version ? ` · ${selected.version}` : ""}` : `未识别到可用的 ${guide.name}${workBuddy ? " 客户端" : " CLI"}`}</p>}
              {selected && !selected.installed && <p className="qd-connection-note">{selected.note} {guideId === "dsh" && <>如果使用企业 Web 界面，请选择上方“企业 Web 版”。</>}</p>}
            </section>
            {workBuddy ? <p className="qd-connection-note">{guide.connection}</p> : <section><h3>选择 Agent 程序</h3>{guideId === "dsh" && <DshDesktopHelp os={os} />}<label>程序路径 <span className="qd-field-optional">{custom ? "自定义连接必填" : "留空自动寻找"}</span><div className="qd-project-picker"><input value={binary} disabled={!!pending} onChange={e => { invalidate(); setBinary(e.target.value); }} placeholder={selected?.binary ?? (os === "windows" ? "C:\\路径\\dsh.cmd 或 lib\\bin.js" : "/opt/homebrew/bin/dsh 或 lib/bin.js")} spellCheck={false} />{host && <button type="button" className="qd-btn" disabled={!!pending} onClick={() => void pickExecutable()}>选择程序</button>}</div></label><p className="qd-connection-note">填写可执行文件或 JavaScript 入口的完整路径，不是命令。自动检测失败时，也可以手动选择已安装的程序。{guideId === "dsh" && " 选择 dsh.cmd 或实际 CLI 入口；Desktop 版会使用它自带的运行环境，不需要填写 Node。"}</p>{shellEntry && <p className="qd-connection-error" role="alert">这是命令执行终端，不是 Agent 程序。请选择工具本身的 CLI 入口；企业 DSH 请查看“企业 Web 版”。</p>}
              <details className="qd-node-settings" open={javascriptEntry || !!nodePath}><summary>Node.js 路径</summary><label>Node 可执行文件<div className="qd-project-picker"><input value={nodePath} disabled={!!pending} onChange={e => { invalidate(); setNodePath(e.target.value); }} placeholder={os === "windows" ? "C:\\Program Files\\nodejs\\node.exe" : "/opt/homebrew/bin/node"} spellCheck={false}/>{host && <button type="button" className="qd-btn" disabled={!!pending} onClick={() => void pickExecutable(true)}>选择 Node</button>}</div></label><p className="qd-connection-note">CLI 使用 .js / .mjs 入口时可指定 Node；留空使用系统 Node。</p>{nodeShell && <p className="qd-connection-error" role="alert">这里需要 Node.js 程序路径，不是 PowerShell 或其他终端。</p>}</details>
            </section>}
            <section><h3>验证 Agent 连接</h3>{host ? <p className="qd-connection-note">使用应用的空白验证目录检查连接，不读取你的项目文件。新项目只需选择自己的文件夹。</p> : <><label>验证用文件夹<div className="qd-project-picker"><input value={projectPath} disabled={!!pending} onChange={(e) => { invalidate(); setProjectPath(e.target.value); }} placeholder={os === "windows" ? "C:\\Users\\你的用户名\\Projects\\my-app" : "/Users/你的用户名/Projects/my-app"} spellCheck={false} /></div></label><p className="qd-connection-note">{workBuddy ? "保存讨论对应的项目。打开 WorkBuddy 后，请在客户端选择此文件夹。" : "只用于验证连接；新项目在创建时选择自己的文件夹。"}</p></>}
              {guideId === "dsh" && <><p className="qd-connection-note">模型与账号由 DSH 管理，QuanDeck 使用 sdk 配置。仅在桌面或网页中选择模型，不保证 sdk 使用同一模型。</p>{os === "windows" && <details className="qd-connection-help"><summary>Windows：先确认 DSH 命令入口</summary><p>已有 DSH / xLink Desktop 时，在源工具选择 Manage dsh Command… → Install / Repair，再新开 PowerShell 执行：</p><CopyCommand command="where.exe dsh" /><CopyCommand command="dsh --version" /><p>选择输出中属于该 Desktop 安装目录的 dsh.cmd，Node.js 路径留空。若有多个入口，用 Get-Command 查看实际优先使用的命令：</p><CopyCommand command="Get-Command dsh -All | Select-Object CommandType, Source" /><p>不需要填写 DSH 网页地址、Provider、Model ID 或 API Key。</p></details>}</>}
              {guideId === "codex" && <label>Codex 模型 <span className="qd-field-optional">可选</span><input value={model} disabled={!!pending} onChange={event => { invalidate(); setModel(event.target.value); }} placeholder="留空沿用本机 Codex 配置" autoComplete="off" spellCheck={false} /></label>}
              <button type="button" className="qd-btn primary" onClick={() => void test()} disabled={!!pending || !canTest}>{pending === "test" ? "正在测试连接…" : "测试连接"}</button>
              {guideId === "dsh" && <DshModelReuse key={modelScope} input={{ tool:"dsh", projectPath:projectPath.trim(), binary:binary.trim() || undefined, nodePath:nodePath.trim() || undefined, dshModelSource }} disabled={!!pending || !canTest} prepare={async () => { saveGatewaySettings(settings); }} onUse={source => test(source)}/>}

            </section>
            <ConnectionDiagnostic key={`${guideId}:${generation.current}`} stage={testStage} diagnosis={diagnosis} tool={guideId as ToolId} version={testVersion} busy={pending === "test"} />
            {result && <section className="qd-connection-result" aria-live="polite"><h3>{result.status === "ready" ? result.tool === "codex" ? codexConnectionLabel(result.modelProbe) : "本地连接已验证" : result.discussionOpen ? "可以打开工具讨论" : result.status === "needs_login" ? "请先在工具中登录" : guideId === "dsh" ? "这个版本暂时无法连接" : "自动连接待适配"}</h3>{result.desktopVersion && <p>客户端版本：{result.desktopVersion}</p>}{result.cliVersion && <p>实际 CLI 版本：{result.desktopVersion && <p>客户端版本：{result.desktopVersion}</p>}{result.cliVersion}</p>}<p>{result.login === "signed_in" ? "登录已验证" : result.login === "signed_out" ? "尚未登录" : "登录状态由源工具确认"}</p><details className="qd-capabilities-details"><summary>查看连接信息与支持的能力</summary>{result.sourceModel && <p>沿用 DSH 模型：{result.sourceModel.model} · {result.sourceModel.provider}</p>}<ul><li><span>发起讨论</span><span className={result.discussionOpen || result.capabilities.dispatch ? "is-supported" : ""}>{result.discussionOpen || result.capabilities.dispatch ? "可用" : "未接入"}</span></li>{CAPABILITIES.map(([key, label]) => <li key={key}><span>{label}</span><span className={result.capabilities[key] ? "is-supported" : ""}>{result.capabilities[key] ? "可用" : "未接入"}</span></li>)}</ul><p className="qd-connection-note">{result.note}</p></details>{result.status === "ready" && !["hermes", "dsh"].includes(result.tool) && <div><button type="button" className="qd-btn small" disabled={!!pending} onClick={() => void probeModel()}>{pending === "probe" ? result.tool === "codex" ? "等待模型回复（最多 2 分钟）…" : "等待模型回复…" : "试发一条消息（使用模型额度）"}</button>{(modelNote || result.modelProbe?.message) && <p role="status">{modelNote || result.modelProbe?.message}</p>}</div>}{result.connectionId && !workBuddy && <ConnectionHealthPanel connectionId={result.connectionId} projectPath={result.projectPath} modelProbe={result.modelProbe} showPolicy={false} />}</section>}
          {error && <p className="qd-connection-error" role="alert">{error}</p>}
        </div>}
      </div>
    </div>
    <footer><small>{host ? "应用配置长期保存在这台设备。重新登录或程序位置改变时才需修复。" : "项目配置保留在本机，配对码仅保留在当前标签页。"}</small><div><button type="button" className="qd-btn ghost" onClick={onClose}>关闭</button>{tab === "connect" && !webDsh && <button type="button" className="qd-btn primary" disabled={!connectionCanSave(result) || !!pending} onClick={save}>{pending === "save" ? "正在保存…" : "保存配置"}</button>}</div></footer>
  </dialog>, document.body);
}
