import { useState } from "react";
import { useWorkdeck } from "../../../state/WorkdeckContext";
import { TOOL_LABELS } from "../../../integration/contracts";
import { removeConfiguredAgent, testForConfig, useConfiguredAgents } from "../../../integration/configuredAgents";
import { AgentConnectionSetup } from "../AgentConnectionSetup";

export function AgentsPanel() {
  const { snap, toast } = useWorkdeck();
  const { configured, tested } = useConfiguredAgents(snap.agents);
  const legacy = snap.agents.filter((agent) => agent.custom);
  const [connecting, setConnecting] = useState(false);
  return <div className="qd-agents">
    <div className="qd-agent-connect-heading"><p>管理这台设备上的工具与项目目录。</p><button type="button" className="qd-btn" onClick={() => setConnecting(true)}>配置 Agent</button></div>
    {connecting && <AgentConnectionSetup onClose={() => setConnecting(false)} />}
    {!configured.length && !legacy.length && <div className="qd-empty"><strong>还没有配置 Agent</strong><p>选择工具，按照教程安装和登录，再选择本地项目目录。</p><button type="button" className="qd-btn primary" onClick={() => setConnecting(true)}>开始配置</button></div>}
    {legacy.map((agent) => <section key={agent.id} className="qd-agent-card qd-configured-card"><header><strong>{agent.name}</strong><span className="qd-tag">自定义 · 待验证</span></header><p className="qd-configured-path">{agent.endpoint || "尚未填写连接方式"}</p><p className="qd-connection-note">保留已有自定义配置。当前工具需单独提供连接适配器。</p></section>)}
    {configured.map((config) => {
      const result = testForConfig(config, tested);
      return <section key={config.id} className="qd-agent-card qd-configured-card">
        <header><strong>{TOOL_LABELS[config.tool]}</strong><span className="qd-tag">{result?.status === "ready" ? "本次连接已验证" : "已配置 · 待验证"}</span></header>
        <p className="qd-configured-path">{config.projectPath}</p>
        <p className="qd-connection-note">{result?.note ?? "重新打开应用后，请测试当前连接状态。"}</p>
        <footer><button type="button" className="qd-btn ghost small" onClick={() => setConnecting(true)}>连接设置</button><button type="button" className="qd-link" onClick={() => { void removeConfiguredAgent(config.id).catch(error => toast(error instanceof Error ? error.message : "移除失败，请重试", "error")); }}>移除配置</button></footer>
      </section>;
    })}
  </div>;
}
