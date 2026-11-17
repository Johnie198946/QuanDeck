import { useState } from "react";
import { useWorkdeck } from "../../../state/WorkdeckContext";
import { TOOL_LABELS, codexConnectionLabel } from "../../../integration/contracts";
import { removeConfiguredAgent, testForConfig, useConfiguredAgents } from "../../../integration/configuredAgents";
import type { ConfiguredAgent } from "../../../integration/configuredAgents";
import { AgentConnectionSetup } from "../AgentConnectionSetup";
import { ConnectionHealthPanel } from "../ConnectionHealthPanel";
import { Icon } from "../../ui/Icon";

type Setup = { config?: ConfiguredAgent; custom?: boolean; agent?: { id: string; name: string } };
export function AgentsPanel() {
  const { snap, toast } = useWorkdeck();
  const { configured, tested } = useConfiguredAgents(snap.agents);
  const legacy = snap.agents.filter((agent) => agent.custom && !configured.some(config => config.agentId === agent.id));
  const [setup, setSetup] = useState<Setup | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="qd-agents">
    <div className="qd-agent-connect-heading"><p>这台设备上的连接</p><div><button type="button" className="qd-btn" onClick={() => setSetup({})}><Icon name="plus" size={14} />连接 Agent</button><button type="button" className="qd-link" onClick={() => setSetup({ custom: true })}>自定义连接</button></div></div>
    {setup && <AgentConnectionSetup initialConfig={setup.config} initialCustom={setup.custom} initialAgent={setup.agent} onClose={() => setSetup(null)} />}
    {!configured.length && !legacy.length && <div className="qd-empty"><strong>连接第一个 Agent</strong><p>配置一次工具，新项目自动复用。</p><button type="button" className="qd-btn primary" onClick={() => setSetup({})}>开始配置</button></div>}
    {legacy.map((agent) => <section key={agent.id} className="qd-agent-card qd-configured-card"><header><strong>{agent.name}</strong><span className="qd-tag">手动协作</span></header><p className="qd-configured-path">{agent.endpoint || "尚未连接工具"}</p><p className="qd-connection-note">选择兼容工具并验证后，才能直接委派任务。</p><button type="button" className="qd-btn small" onClick={() => setSetup({ custom: true, agent })}>连接工具</button></section>)}
    {configured.map((config) => {
      const result = testForConfig(config, tested);
      return <section key={config.id} className="qd-agent-card qd-configured-card">
        <header><div><strong>{config.displayName || TOOL_LABELS[config.tool]}</strong>{config.displayName && <small>{TOOL_LABELS[config.tool]}</small>}</div><span className="qd-tag">{result?.status === "ready" ? config.tool === "codex" ? codexConnectionLabel(result.modelProbe) : "本地连接已验证" : config.tool === "workbuddy" && result?.discussionOpen ? "可打开客户端讨论" : "已配置"}</span></header>
        <p className="qd-configured-path">{config.scope === 'application' ? '应用默认 · 新项目自动复用' : `原项目连接 · ${config.projectPath}`}</p>
        <footer><button type="button" className="qd-btn ghost small" onClick={() => setSetup({ config })}>连接设置</button>{config.connectionId && config.tool !== "workbuddy" && <button type="button" className="qd-btn ghost small" aria-expanded={expanded === config.id} onClick={() => setExpanded(expanded === config.id ? null : config.id)}>检测与备用</button>}<button type="button" className="qd-link" onClick={() => { void removeConfiguredAgent(config.id).catch(error => toast(error instanceof Error ? error.message : "移除失败，请重试", "error")); }}>移除</button></footer>
        {expanded === config.id && config.connectionId && <ConnectionHealthPanel connectionId={config.connectionId} projectPath={config.projectPath} modelProbe={result?.modelProbe} />}
      </section>;
    })}
  </div>;
}
