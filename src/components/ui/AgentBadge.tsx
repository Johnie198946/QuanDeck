import type { CSSProperties } from "react";
import type { Agent } from "../../data/types";

/** Agent 身份：稳定色点 + 名称。连接健康与任务状态分开表达。 */
export function AgentBadge({ agent, muted = false }: { agent: Agent; muted?: boolean }) {
  return (
    <span
      className={`qd-agent ${muted ? "is-muted" : ""}`}
      style={{ "--agent": agent.color } as CSSProperties}
    >
      <span className="qd-agent-dot" aria-hidden="true" />
      {agent.name}
    </span>
  );
}

export function AgentSwatch({ agent, size = 10 }: { agent: Agent; size?: number }) {
  return (
    <span
      className="qd-swatch"
      aria-hidden="true"
      style={{ background: agent.color, width: size, height: size } as CSSProperties}
    />
  );
}
