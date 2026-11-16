import { useState } from "react";
import type { CSSProperties } from "react";
import { getConfiguredAgents } from "../../integration/configuredAgents";
import type { Agent } from "../../data/types";
import claudeCode from "../../assets/agents/claude-code.png";
import codex from "../../assets/agents/codex.png";
import workbuddy from "../../assets/agents/workbuddy.svg";
import deepseekHarness from "../../assets/agents/deepseek-harness.svg";
import hermes from "../../assets/agents/hermes.png";
import cursor from "../../assets/agents/cursor.svg";
import opencode from "../../assets/agents/opencode.svg";

/**
 * 官方标志（本地保存，避免热链失效）：
 * Claude Code / Codex 取自各自官方 VS Code 扩展图标（Anthropic / OpenAI 发布者），
 * Hermes 取自本机 Nous Research Hermes.app 的原始图标。其余来源见 assets/agents/README.md。
 */
const OFFICIAL: Record<string, string> = {
  claude: claudeCode,
  codex,
  workbuddy,
  deepseek: deepseekHarness,
  dsh: deepseekHarness,
  hermes,
  cursor,
  opencode,
};

/**
 * Agent 身份标志。标志与名称是主身份，保持原色，不随连接／运行状态染色；
 * 只有资源加载失败或自定义 Agent 未上传头像时，才回退为名称首字。
 */
export function AgentLogo({
  agent,
  size = 24,
  label,
  tool,
}: {
  agent: Pick<Agent, "id" | "name" | "color" | "logo" | "runtimeConnection">;
  /** 会话实际使用的工具；备用接手时优先于注册身份。 */
  tool?: string;
  size?: number;
  /** 独立出现（旁边没有名称）时传入可访问名称；与名称并列时保持装饰性 */
  label?: string;
}) {
  const registeredTool = getConfiguredAgents().find(profile => (profile.agentId || profile.tool) === agent.id)?.tool;
  const src = agent.logo || OFFICIAL[tool || agent.runtimeConnection?.tool || registeredTool || agent.id];
  const [failed, setFailed] = useState<string | null>(null);
  const style = { "--agent": agent.color, width: size, height: size } as CSSProperties;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };

  if (!src || failed === src) {
    const initial = Array.from(agent.name.trim())[0]?.toUpperCase() ?? "?";
    return (
      <span
        className="qd-logo-fallback"
        style={{ ...style, fontSize: Math.round(size * 0.5) }}
        {...a11y}
      >
        {initial}
      </span>
    );
  }
  return (
    <span className={`qd-agent-logo ${agent.logo ? "is-custom" : ""}`} style={style} {...a11y}>
      <img src={src} alt="" width={size} height={size} draggable={false} onError={() => setFailed(src)} />
    </span>
  );
}
