import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOOL_LABELS } from "../../integration/contracts";
import type { Capability, ConnectionInput, ConnectionTest, ToolDetection, ToolId } from "../../integration/contracts";
import { gateway, getGatewaySettings, saveGatewaySettings, saveTestedConnection } from "../../integration/gateway";
import { AGENT_GUIDES } from "../../integration/agentGuides";
import type { GuideId, GuideOS } from "../../integration/agentGuides";
import { connectionCanSave, getConfiguredAgents, persistAgentConfiguration } from "../../integration/configuredAgents";
import { desktopHost } from "../../integration/desktop";
import { AgentSetupGuide, CopyCommand } from "./AgentSetupGuide";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import "../../integration/connection.css";

const CAPABILITIES: [Capability, string][] = [["sourceOpen", "回源会话"], ["resume", "恢复会话"], ["observe", "执行同步"], ["dispatch", "自动派发"], ["usage", "Token 用量"], ["subAgents", "子 Agent"], ["permissions", "权限回执"]];

export function AgentConnectionSetup({ onClose }: { onClose: () => void }) {
  const { api, snap } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState(getGatewaySettings);
  const [tools, setTools] = useState<ToolDetection[]>([]);
  const [guideId, setGuideId] = useState<GuideId>("codex");
  const [os, setOS] = useState<GuideOS>(() => (desktopHost()?.platform ?? navigator.platform).toLowerCase().startsWith("win") ? "windows" : "mac");
  const [tab, setTab] = useState<"guide" | "connect">("guide");
  const [projectPath, setProjectPath] = useState(() => getConfiguredAgents().find((entry) => entry.tool === "codex")?.projectPath ?? "");
  const [binary, setBinary] = useState(() => getConfiguredAgents().find((entry) => entry.tool === "codex")?.binary ?? "");
  const [nodePath, setNodePath] = useState("");
  const [provider, setProvider] = useState("deepseek-official");
  const [model, setModel] = useState("");
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const [pending, setPending] = useState<"detect" | "test" | "host" | "save" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const guide = AGENT_GUIDES.find((entry) => entry.id === guideId)!;
  const supportedTool = guideId in TOOL_LABELS;
  const selected = tools.find((item) => item.tool === guideId);
  const host = desktopHost();

  const detect = async (nextSettings = settings) => {
    const current = ++generation.current;
    setPending("detect"); setError(""); setResult(null); setTools([]);
    try {
      saveGatewaySettings(nextSettings);
      const response = await gateway.detectTools();
      if (current === generation.current) setTools(response.tools);
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "检测失败"); }
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
      }).catch((e) => { if (active) { setError(e instanceof Error ? e.message : "本地服务启动失败"); setPending(null); } });
    }
    return () => { active = false; generation.current++; dialog.current?.close(); trigger?.focus(); };
  }, []);
  const invalidate = () => { generation.current++; setPending(null); setResult(null); setSaved(false); setError(""); };
  const test = async () => {
    if (!supportedTool) return;
    const current = ++generation.current;
    setPending("test"); setError(""); setResult(null); setSaved(false);
    try {
      saveGatewaySettings(settings);
      const input: ConnectionInput = { tool: guideId as ToolId, projectPath: projectPath.trim(), ...(binary.trim() ? { binary:binary.trim() } : {}), ...(nodePath.trim() ? { nodePath:nodePath.trim() } : {}), ...(guideId === "dsh" ? { provider:provider.trim(), model:model.trim() } : {}) };
      const response = { ...input, ...await gateway.testConnection(input) };
      if (current === generation.current) {
        setResult(response);
        if (connectionCanSave(response)) saveTestedConnection(response);
      }
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "连接失败"); }
    finally { if (current === generation.current) setPending(null); }
  };
  const save = async () => {
    if (!connectionCanSave(result)) return;
    if (result.capabilities.dispatch && !snap.project.id) { setError("请先创建一个项目，再为该项目保存 Agent 连接。"); return; }
    setPending("save"); setError("");
    try {
      await persistAgentConfiguration(api, { tool: guideId as ToolId, projectPath, binary:binary.trim() || undefined, nodePath:nodePath.trim() || undefined, ...(guideId === "dsh" ? {provider:provider.trim(),model:model.trim()} : {}) }, result);
      setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : "无法保存配置，请检查本地存储空间后重试。"); }
    finally { setPending(null); }
  };
  const selectTool = (id: GuideId) => {
    invalidate(); setGuideId(id); setTab("guide");
    const previous = getConfiguredAgents().find((entry) => entry.tool === id);
    setProjectPath(previous?.projectPath ?? ""); setBinary(previous?.binary ?? ""); setNodePath(previous?.nodePath ?? ""); setProvider(previous?.provider ?? "deepseek-official"); setModel(previous?.model ?? "");
  };
  const absolutePath = os === "windows" ? /^[a-zA-Z]:[\\/]|^\\\\/.test(projectPath.trim()) : projectPath.trim().startsWith("/");
  const javascriptEntry = /\.[cm]?js$/i.test(binary.trim());
  const pickExecutable = async (node = false) => { try { const chosen = await host?.chooseExecutable(); if (chosen) { invalidate(); node ? setNodePath(chosen) : setBinary(chosen); } } catch { setError("无法打开文件选择器，请手动填写文件的完整路径。"); } };
  const canTest = absolutePath && !!settings.token.trim() && (guideId !== "dsh" || !!provider.trim() && !!model.trim());

  return createPortal(<dialog ref={dialog} className="qd-connection-dialog" aria-labelledby="qd-connect-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <header><div><h2 id="qd-connect-title">配置本地 Agent</h2><p>安装工具、连接项目，再确认可用能力。</p></div><button type="button" className="qd-icon-btn" aria-label="关闭连接设置" onClick={onClose}><Icon name="close" size={18} /></button></header>
    <div className="qd-setup-layout">
      <nav className="qd-tool-list" aria-label="选择 Agent">{AGENT_GUIDES.map((entry) => <button key={entry.id} type="button" className={guideId === entry.id ? "is-selected" : ""} aria-current={guideId === entry.id ? "true" : undefined} disabled={pending === "save"} onClick={() => selectTool(entry.id)}><span>{entry.name}</span>{entry.id === "workbuddy" && <small>手动协作</small>}</button>)}</nav>
      <div className="qd-setup-main">
        <div className="qd-setup-heading"><div><h3>{guide.name}</h3><p>{guide.description}</p></div><div className="qd-os-toggle" role="group" aria-label="教程操作系统"><button type="button" aria-pressed={os === "mac"} onClick={() => setOS("mac")}>macOS</button><button type="button" aria-pressed={os === "windows"} onClick={() => setOS("windows")}>Windows</button></div></div>
        <div className="qd-setup-tabs" role="tablist" aria-label="配置步骤"><button type="button" role="tab" aria-selected={tab === "guide"} onClick={() => setTab("guide")}>安装与登录</button><button type="button" role="tab" aria-selected={tab === "connect"} onClick={() => setTab("connect")}>连接项目</button></div>
        {tab === "guide" ? <div role="tabpanel" aria-label="安装与登录"><AgentSetupGuide guide={guide} os={os} /><button type="button" className="qd-btn primary qd-setup-next" onClick={() => setTab("connect")}>已完成安装，连接项目 <Icon name="arrow-right" size={14} /></button></div> : <div className="qd-connection-body" role="tabpanel" aria-label="连接项目">
          {!supportedTool ? <section><h3>在源工具中协作</h3><p className="qd-connection-note">{guide.connection}</p><p className="qd-connection-note">可将讨论结论记录到任务方案，并保留来源链接。</p></section> : <>
            <section><h3>连接这台电脑</h3>{host ? <p className="qd-connection-note">桌面版自动启动本地服务，配对信息由应用管理。</p> : <><details className="qd-connection-help"><summary>网页版如何启动本地服务？</summary><p>在 QuanDeck 源码目录打开终端，运行下面的命令并保持窗口开启。将终端显示的配对码填入此处。</p><CopyCommand command="pnpm bridge" /></details><label>服务地址<input value={settings.baseUrl} onChange={(e) => { invalidate(); setTools([]); setSettings({ ...settings, baseUrl: e.target.value }); }} placeholder="http://127.0.0.1:4175" /></label><label>配对码<input type="password" autoComplete="off" spellCheck={false} value={settings.token} onChange={(e) => { invalidate(); setTools([]); setSettings({ ...settings, token: e.target.value }); }} placeholder="粘贴本次启动的配对码" /></label></>}
              <button type="button" className="qd-btn" onClick={() => void detect()} disabled={!!pending || !settings.token.trim()}>{pending === "detect" || pending === "host" ? "正在检测…" : "检测本机工具"}</button>
              {selected && <p className="qd-detection-status" role="status"><Icon name={selected.installed ? "check-circle" : "alert"} size={15} />{selected.installed ? `${guide.name} 已安装${selected.version ? ` · ${selected.version}` : ""}` : `未检测到 ${guide.name}，请完成安装后重新检测`}</p>}
            </section>
            <section><h3>CLI 程序</h3><label>CLI 路径 <span className="qd-field-optional">可选 · 留空自动检测</span><div className="qd-project-picker"><input value={binary} disabled={!!pending} onChange={e => { invalidate(); setBinary(e.target.value); }} placeholder={selected?.binary ?? (os === "windows" ? "C:\\路径\\dsh.cmd 或 lib\\bin.js" : "/opt/homebrew/bin/dsh 或 lib/bin.js")} spellCheck={false} />{host && <button type="button" className="qd-btn" disabled={!!pending} onClick={() => void pickExecutable()}>选择程序</button>}</div></label><p className="qd-connection-note">填写可执行文件或 JavaScript 入口的完整路径，不是命令。自动检测失败时，也可以手动选择已安装的程序。</p>
              <details className="qd-node-settings" open={javascriptEntry || !!nodePath}><summary>Node.js 路径</summary><label>Node 可执行文件<div className="qd-project-picker"><input value={nodePath} disabled={!!pending} onChange={e => { invalidate(); setNodePath(e.target.value); }} placeholder={os === "windows" ? "C:\\Program Files\\nodejs\\node.exe" : "/opt/homebrew/bin/node"} spellCheck={false}/>{host && <button type="button" className="qd-btn" disabled={!!pending} onClick={() => void pickExecutable(true)}>选择 Node</button>}</div></label><p className="qd-connection-note">CLI 使用 .js / .mjs 入口时可指定 Node；留空使用系统 Node。</p></details>
            </section>
            <section><h3>选择项目目录</h3><label>本地项目路径<div className="qd-project-picker"><input value={projectPath} disabled={!!pending} onChange={(e) => { invalidate(); setProjectPath(e.target.value); }} placeholder={os === "windows" ? "C:\\Users\\你的用户名\\Projects\\my-app" : "/Users/你的用户名/Projects/my-app"} spellCheck={false} />{host && <button type="button" className="qd-btn" onClick={async () => { try { const directory = await host.chooseDirectory(); if (directory) { invalidate(); setProjectPath(directory); } } catch { setError("无法打开目录选择器，请手动填写路径。"); } }}>选择文件夹</button>}</div></label><p className="qd-connection-note">选择希望 Agent 处理的文件夹。讨论和回源会使用该目录。</p>
              {guideId === "dsh" && <div className="qd-dsh-model"><label>Provider ID<input value={provider} disabled={!!pending} onChange={e => { invalidate(); setProvider(e.target.value); }} spellCheck={false}/></label><label>Model ID<input value={model} disabled={!!pending} onChange={e => { invalidate(); setModel(e.target.value); }} placeholder="填写 DSH 中已配置的模型 ID" spellCheck={false} required/></label><p className="qd-connection-note">先在 DSH 中配置模型与 API Key。这里复用 DSH 的本地凭据，仅填写对应的 Provider 和 Model ID。</p></div>}
              <button type="button" className="qd-btn primary" onClick={test} disabled={!!pending || !canTest}>{pending === "test" ? "正在验证协议与模型…" : "测试连接"}</button>
            </section>
            {result && <section className="qd-connection-result" aria-live="polite"><h3>{result.status === "ready" ? "本次连接已验证" : result.discussionOpen ? "可以打开工具讨论" : result.status === "needs_login" ? "请先在工具中登录" : "自动连接待适配"}</h3><p>{guideId === "dsh" && result.status === "ready" ? "SDK 握手与模型配置已验证；实际请求使用源工具凭据。" : result.login === "signed_in" ? "登录已验证" : result.login === "signed_out" ? "尚未登录" : "登录状态由源工具确认"}</p><ul><li><span>发起讨论</span><span className={result.discussionOpen || result.capabilities.dispatch ? "is-supported" : ""}>{result.discussionOpen || result.capabilities.dispatch ? "可用" : "未接入"}</span></li>{CAPABILITIES.map(([key, label]) => <li key={key}><span>{label}</span><span className={result.capabilities[key] ? "is-supported" : ""}>{result.capabilities[key] ? "可用" : "未接入"}</span></li>)}</ul><p className="qd-connection-note">{result.note}</p></section>}
          </>}
          {error && <p className="qd-connection-error" role="alert">{error}</p>}
          {saved && <p className="qd-config-saved" role="status">配置已保存，可从任务选择 {guide.name}。</p>}
        </div>}
      </div>
    </div>
    <footer><small>{host ? "本地配置保存在这台设备。" : "项目配置保留在本机，配对码仅保留在当前标签页。"}</small><div><button type="button" className="qd-btn ghost" onClick={onClose}>关闭</button>{tab === "connect" && supportedTool && <button type="button" className="qd-btn primary" disabled={!connectionCanSave(result) || !!pending || saved} onClick={save}>{pending === "save" ? "正在保存…" : saved ? "已保存" : "保存配置"}</button>}</div></footer>
  </dialog>, document.body);
}
