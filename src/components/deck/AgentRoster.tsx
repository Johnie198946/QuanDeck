import { useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { useConfiguredAgents, toolForAgent, testForConfig } from "../../integration/configuredAgents";
import { AgentLogo } from "../ui/AgentLogo";
import { Icon } from "../ui/Icon";
import { AgentConnectionSetup } from "./AgentConnectionSetup";

export function AgentRoster({ compact = false }: { compact?: boolean }) {
  const { snap, setRailPanel } = useWorkdeck();
  const { agents, configured, tested } = useConfiguredAgents(snap.agents);
  const [connecting, setConnecting] = useState(false);
  return <section className={`qd-roster ${compact ? "is-compact" : ""}`} aria-label="已配置的 Agent">
    {connecting && <AgentConnectionSetup onClose={() => setConnecting(false)} />}
    <div className="qd-roster-strip">
      <span className="qd-roster-strip-title">Agents{agents.length ? ` ${agents.length}` : ""}</span>
      {agents.length ? <ul>{agents.map((agent) => {
        const configs = configured.filter((entry) => entry.agentId ? entry.agentId === agent.id : entry.tool === toolForAgent(agent));
        const verified = configs.some((entry) => testForConfig(entry, tested)?.status === "ready");
        return <li key={agent.id}><button type="button" className={`qd-roster-chip tone-${verified ? "idle" : "off"}`} title={`${agent.name} · ${verified ? "本地连接已验证" : "已配置，待验证"}`} aria-label={`${agent.name}，${verified ? "本地连接已验证" : "已配置，待验证"}。打开管理`} onClick={() => setRailPanel("agents")}><AgentLogo agent={agent} size={22} /><span className="qd-roster-chip-dot" aria-hidden="true" /></button></li>;
      })}</ul> : <span className="qd-roster-empty">尚未配置</span>}
      <button type="button" className="qd-link qd-roster-strip-more" onClick={() => setConnecting(true)}><Icon name="plus" size={14} />配置</button>
      {!!agents.length && <button type="button" className="qd-link" onClick={() => setRailPanel("agents")}>管理</button>}
    </div>
  </section>;
}
